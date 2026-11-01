import { ApiError, control, getBudget, getOutput, getTask, getThread, listAgents, listModels, listTasks, postMessage, setBudget } from '@/lib/api';
import * as auth from '@/lib/auth';
import { detail, fakeServer, ids, json, subtaskIds, task } from '@/test-fakes';

jest.mock('@/lib/auth', () => ({
  getAccessToken: jest.fn(async () => 'access-1'),
  refresh: jest.fn(async () => true),
}));

const origin = 'https://ai.famashines.com';
const commandId = '7d1f8a2c-3b4e-4c5d-9e6f-0a1b2c3d4e5f';
const conversationId = 'd4444444-4444-4444-8444-444444444444';
const route = `POST /api/conversations/${conversationId}/messages`;
const posted = { conversationId, messageId: ids.taskB, intent: 'new_task' };
const accepted = () => json(202, posted);
const submitTaskOnce = (text: string, key: string) => postMessage(conversationId, text, false, key, () => {});
const submitTask = (text: string, key: string, onWait?: (kind: 'rateLimited' | 'unavailable') => void) => postMessage(conversationId, text, false, key, onWait);
const problem = (status: number, code: string) => json(status, { type: 'about:blank', title: 'No', status, code });

let server: ReturnType<typeof fakeServer>;

beforeEach(() => {
  jest.useRealTimers();
  jest.mocked(auth.getAccessToken).mockResolvedValue('access-1');
  jest.mocked(auth.refresh).mockResolvedValue(true);
  server = fakeServer(origin);
});

it('posts the message with the Idempotency-Key, the bearer token and the contract body', async () => {
  server.on(route, accepted(), json(202, { ...posted, intent: 'steer', taskId: ids.taskA }));
  expect(await submitTaskOnce('Plan the week', commandId)).toEqual(posted);
  expect(await postMessage(conversationId, 'New topic', true, commandId)).toEqual({ ...posted, intent: 'steer', taskId: ids.taskA });
  const [request, second] = server.requests;
  expect(request!.headers.get('Idempotency-Key')).toBe(commandId);
  expect(request!.headers.get('Authorization')).toBe('Bearer access-1');
  expect(request!.body).toEqual({ text: 'Plan the week', newTask: false });
  expect(second!.body).toEqual({ text: 'New topic', newTask: true });
});

it('refuses a conversation id that is not a lower-case UUID before any request', async () => {
  await expect(postMessage('not-an-id', 'Hi', false, commandId)).rejects.toMatchObject({ kind: 'rejected' });
  expect(server.requests).toHaveLength(0);
});

it('refreshes the token once on 401 and tries again one time', async () => {
  jest.mocked(auth.getAccessToken).mockResolvedValueOnce('access-1').mockResolvedValueOnce('access-2');
  server.on(route, problem(401, 'unauthorized'), accepted());
  await submitTaskOnce('Plan', commandId);
  expect(auth.refresh).toHaveBeenCalledTimes(1);
  expect(server.requests.map((request) => request.headers.get('Authorization'))).toEqual(['Bearer access-1', 'Bearer access-2']);
  expect(server.requests.map((request) => request.headers.get('Idempotency-Key'))).toEqual([commandId, commandId]);
});

it('gives unauthorized after a second 401 or when the refresh fails', async () => {
  server.on(route, problem(401, 'unauthorized'), problem(401, 'unauthorized'));
  await expect(submitTaskOnce('Plan', commandId)).rejects.toMatchObject({ kind: 'unauthorized' });
  jest.mocked(auth.refresh).mockResolvedValue(false);
  server.on(route, problem(401, 'unauthorized'));
  await expect(submitTaskOnce('Plan', commandId)).rejects.toMatchObject({ kind: 'unauthorized' });
  expect(server.requests).toHaveLength(3);
});

it('waits Retry-After on 429 and sends again with the same key', async () => {
  jest.useFakeTimers();
  server.on(route, json(429, { type: 'about:blank', title: 'Slow down', status: 429, code: 'rate_limited' }, { 'Retry-After': '3' }), accepted());
  const waits: string[] = [];
  const result = submitTask('Plan', commandId, (kind) => waits.push(kind));
  await jest.advanceTimersByTimeAsync(2_999);
  expect(server.requests).toHaveLength(1);
  await jest.advanceTimersByTimeAsync(1);
  await expect(result).resolves.toEqual(posted);
  expect(waits).toEqual(['rateLimited']);
  expect(server.requests.map((request) => request.headers.get('Idempotency-Key'))).toEqual([commandId, commandId]);
});

it('treats 502 and 503 the same as unavailable, backs off, and stops after the last attempt', async () => {
  jest.useFakeTimers();
  jest.spyOn(Math, 'random').mockReturnValue(1);
  server.on(route, problem(502, 'unavailable'), problem(503, 'unavailable'), problem(502, 'unavailable'), problem(503, 'unavailable'));
  const waits: string[] = [];
  const result = submitTask('Plan', commandId, (kind) => waits.push(kind)).catch((error: unknown) => error);
  await jest.advanceTimersByTimeAsync(1_000 + 2_000 + 4_000);
  const error = await result;
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ kind: 'unavailable' });
  expect(waits).toEqual(['unavailable', 'unavailable', 'unavailable']);
  expect(new Set(server.requests.map((request) => request.headers.get('Idempotency-Key')))).toEqual(new Set([commandId]));
  jest.restoreAllMocks();
});

it('gives a network error at once, with no automatic retry', async () => {
  server.on(route, new TypeError('Network request failed'));
  await expect(submitTask('Plan', commandId)).rejects.toMatchObject({ kind: 'network' });
  expect(server.requests).toHaveLength(1);
});

it('gives a network error when the token refresh has a network error', async () => {
  jest.mocked(auth.getAccessToken).mockRejectedValue(new Error('offline'));
  await expect(submitTaskOnce('Plan', commandId)).rejects.toMatchObject({ kind: 'network' });
});

it('refuses a text that does not fit the contract before any request', async () => {
  await expect(submitTask('x'.repeat(20_001), commandId)).rejects.toMatchObject({ kind: 'rejected' });
  await expect(submitTask('   ', commandId)).rejects.toMatchObject({ kind: 'rejected' });
  expect(server.requests).toHaveLength(0);
});

it('gives the problem of a refused command', async () => {
  server.on(route, problem(409, 'conflict'));
  await expect(submitTask('Plan', commandId)).rejects.toMatchObject({ kind: 'rejected', problem: { code: 'conflict' } });
  server.on(route, new Response('<html>', { status: 400 }));
  await expect(submitTask('Plan', commandId)).rejects.toMatchObject({ kind: 'rejected', problem: undefined });
});

it('refuses an answer that does not match the contract', async () => {
  server.on('GET /api/tasks', json(200, { items: [{ taskId: 'x' }], headSeq: 1 }));
  await expect(listTasks()).rejects.toMatchObject({ kind: 'unavailable' });
});

it('reads a page of tasks with before and beforeId', async () => {
  server.on('GET /api/tasks', json(200, { items: [task(ids.taskA, 1)], headSeq: 4 }), json(200, { items: [], headSeq: 4 }));
  expect((await listTasks()).items).toHaveLength(1);
  await listTasks({ before: '2026-10-31T10:00:00.000Z', beforeId: ids.taskA });
  expect(server.requests.map((request) => Object.fromEntries(request.query))).toEqual([
    { limit: '50' },
    { limit: '50', before: '2026-10-31T10:00:00.000Z', beforeId: ids.taskA },
  ]);
});

it('reads Retry-After as an HTTP date too', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-31T10:00:00Z'));
  server.on('GET /api/tasks', json(429, {}, { 'Retry-After': 'Sat, 31 Oct 2026 10:00:05 GMT' }), json(429, {}));
  await expect(listTasks()).rejects.toMatchObject({ kind: 'rateLimited', retryAfterMs: 5_000 });
  await expect(listTasks()).rejects.toMatchObject({ kind: 'rateLimited', retryAfterMs: 1_000 });
  jest.restoreAllMocks();
});

it('reads a page of the thread with before and beforeId', async () => {
  server.on(`GET /api/conversations/${conversationId}/messages`, json(200, { items: [], headSeq: 4 }), json(200, { items: [], headSeq: 4 }));
  expect(await getThread(conversationId)).toEqual({ items: [], headSeq: 4 });
  await getThread(conversationId, { before: '2026-10-31T10:00:00.000Z', beforeId: ids.taskA });
  expect(server.requests.map((request) => Object.fromEntries(request.query))).toEqual([
    { limit: '50' },
    { limit: '50', before: '2026-10-31T10:00:00.000Z', beforeId: ids.taskA },
  ]);
});

it('gives null for the budget on 404 and the month view on 200', async () => {
  const month = { month: '2026-11', capMicroUsd: 5_000_000, spentMicroUsd: 0, reservedMicroUsd: 0, remainingMicroUsd: 5_000_000, overCapMicroUsd: 0, rev: 1, asOf: 1 };
  server.on('GET /api/budget', problem(404, 'not_found'), json(200, month), problem(400, 'validation_failed'));
  expect(await getBudget()).toBeNull();
  expect(await getBudget()).toEqual(month);
  await expect(getBudget()).rejects.toMatchObject({ kind: 'rejected', status: 400 });
});

it('sets the monthly cap with the Idempotency-Key and the contract body', async () => {
  server.on('POST /api/budget', json(202, { version: 2 }), json(202, { version: 3 }), problem(403, 'forbidden'));
  expect(await setBudget(5_000_000, 4_000_000, commandId)).toBe(2);
  expect(await setBudget(1, undefined, commandId)).toBe(3);
  await expect(setBudget(1, undefined, commandId)).rejects.toMatchObject({ kind: 'rejected', status: 403 });
  expect(server.requests.map((request) => request.body)).toEqual([
    { scope: { kind: 'month' }, hardCapMicroUsd: 5_000_000, softCapMicroUsd: 4_000_000 },
    { scope: { kind: 'month' }, hardCapMicroUsd: 1 },
    { scope: { kind: 'month' }, hardCapMicroUsd: 1 },
  ]);
  expect(server.requests[0]!.headers.get('Idempotency-Key')).toBe(commandId);
});

it('refuses a cap that does not fit the contract before any request', async () => {
  await expect(setBudget(5, 6, commandId)).rejects.toMatchObject({ kind: 'rejected', status: 0 });
  await expect(setBudget(1_000_000_000_001, undefined, commandId)).rejects.toMatchObject({ kind: 'rejected', status: 0 });
  await expect(setBudget(1.5, undefined, commandId)).rejects.toMatchObject({ kind: 'rejected', status: 0 });
  expect(server.requests).toHaveLength(0);
});

describe('owner controls', () => {
  const accepted = (version = 5) => json(202, { taskId: ids.taskA, version });
  const controlRoute = (name: string) => `POST /api/tasks/${ids.taskA}/${name}`;

  it('posts each control to its path with its own Idempotency-Key and no taskId in the body', async () => {
    server.on(controlRoute('approve-plan'), accepted(2));
    server.on(controlRoute('retry-subtask'), accepted(3));
    expect(await control(ids.taskA, 'approve-plan', { planVersion: 1 }, commandId)).toBe(2);
    expect(await control(ids.taskA, 'retry-subtask', { subtaskId: subtaskIds[0]! }, ids.taskC)).toBe(3);
    const [approve, retry] = server.requests;
    expect(approve!.headers.get('Idempotency-Key')).toBe(commandId);
    expect(approve!.headers.get('Authorization')).toBe('Bearer access-1');
    expect(approve!.body).toEqual({ planVersion: 1 });
    expect(retry!.headers.get('Idempotency-Key')).toBe(ids.taskC);
    expect(retry!.body).toEqual({ subtaskId: subtaskIds[0] });
  });

  it('refuses a body that does not fit the contract before any request', async () => {
    await expect(control(ids.taskA, 'reject-plan', { planVersion: 1, reason: '' }, commandId)).rejects.toMatchObject({ kind: 'rejected' });
    await expect(control('not-an-id', 'pause-run', {}, commandId)).rejects.toMatchObject({ kind: 'rejected' });
    expect(server.requests).toHaveLength(0);
  });

  it('gives 409 and 400 as rejected with the status, and does not retry them', async () => {
    server.on(controlRoute('resume-run'), problem(409, 'conflict'), problem(400, 'validation_failed'));
    await expect(control(ids.taskA, 'resume-run', {}, commandId)).rejects.toMatchObject({ kind: 'rejected', status: 409 });
    await expect(control(ids.taskA, 'resume-run', {}, commandId)).rejects.toMatchObject({ kind: 'rejected', status: 400 });
    expect(server.requests).toHaveLength(2);
  });

  it('retries 503 with the same key and tells the caller that it waits', async () => {
    jest.useFakeTimers();
    jest.spyOn(Math, 'random').mockReturnValue(0);
    server.on(controlRoute('pause-run'), problem(503, 'unavailable'), accepted());
    const waits: string[] = [];
    const done = control(ids.taskA, 'pause-run', {}, commandId, (kind) => waits.push(kind));
    await jest.advanceTimersByTimeAsync(1_000);
    expect(await done).toBe(5);
    expect(waits).toEqual(['unavailable']);
    expect(server.requests.map((request) => request.headers.get('Idempotency-Key'))).toEqual([commandId, commandId]);
    jest.restoreAllMocks();
  });

  it('gives unavailable after the last 503, and for an answer about another task', async () => {
    jest.useFakeTimers();
    server.on(controlRoute('cancel-run'), problem(503, 'unavailable'), problem(503, 'unavailable'), problem(503, 'unavailable'), problem(503, 'unavailable'));
    const failed = expect(control(ids.taskA, 'cancel-run', {}, commandId)).rejects.toMatchObject({ kind: 'unavailable' });
    await jest.advanceTimersByTimeAsync(60_000);
    await failed;
    jest.useRealTimers();
    server.on(controlRoute('cancel-task'), json(202, { taskId: ids.taskB, version: 1 }));
    await expect(control(ids.taskA, 'cancel-task', {}, commandId)).rejects.toMatchObject({ kind: 'unavailable' });
  });
});

it('reads the task detail, the outputs and the agents, and gives null for an output that is not there yet', async () => {
  const doc = detail();
  server.on(`GET /api/tasks/${ids.taskA}`, json(200, doc));
  server.on(`GET /api/tasks/${ids.taskA}/output`, json(200, { taskId: ids.taskA, runId: ids.taskC, text: 'Result' }));
  server.on(`GET /api/tasks/${ids.taskA}/subtasks/${subtaskIds[0]}/output`, problem(404, 'not_found'));
  server.on('GET /api/agents', json(200, { items: [], headSeq: 3 }));
  expect(await getTask(ids.taskA)).toEqual(doc);
  expect(await getOutput(ids.taskA)).toBe('Result');
  expect(await getOutput(ids.taskA, subtaskIds[0])).toBeNull();
  expect(await listAgents()).toEqual({ items: [], headSeq: 3 });
  server.on(`GET /api/tasks/${ids.taskA}`, json(200, { ...doc, currentCall: { callId: ids.taskC, kind: 'subtask' } }));
  await expect(getTask(ids.taskA)).rejects.toMatchObject({ kind: 'unavailable' });
});

it('sends the taskId of a reply, and never together with newTask', async () => {
  server.on(route, json(202, { ...posted, intent: 'answer', taskId: ids.taskA }));
  expect(await postMessage(conversationId, 'Yes, in English.', false, commandId, () => {}, ids.taskA)).toMatchObject({ intent: 'answer', taskId: ids.taskA });
  expect(server.requests[0]!.body).toEqual({ text: 'Yes, in English.', newTask: false, taskId: ids.taskA });
  await expect(postMessage(conversationId, 'Hi', true, commandId, () => {}, ids.taskA)).rejects.toMatchObject({ kind: 'rejected' });
  expect(server.requests).toHaveLength(1);
});

it('sends the model and effort of a new message, never with a reply taskId, and never an effort with no model', async () => {
  server.on(route, accepted(), accepted());
  await postMessage(conversationId, 'Plan', true, commandId, () => {}, undefined, { model: 'openai/gpt-5', effort: 'high' });
  await postMessage(conversationId, 'Plan', false, commandId, () => {}, undefined, { model: 'openai/gpt-4.1-nano' });
  expect(server.requests.map((request) => request.body)).toEqual([
    { text: 'Plan', newTask: true, model: 'openai/gpt-5', effort: 'high' },
    { text: 'Plan', newTask: false, model: 'openai/gpt-4.1-nano' },
  ]);
  await expect(postMessage(conversationId, 'Plan', false, commandId, () => {}, undefined, { effort: 'high' })).rejects.toMatchObject({ kind: 'rejected' });
  await expect(postMessage(conversationId, 'Plan', false, commandId, () => {}, undefined, { model: 'not a model' })).rejects.toMatchObject({ kind: 'rejected' });
  expect(server.requests).toHaveLength(2);
});

describe('model list', () => {
  const models = { items: [{ id: 'openai/gpt-5', name: 'OpenAI: GPT-5', efforts: ['high', 'medium', 'low', 'minimal'], defaultEffort: 'medium' }] };
  const down = () => problem(503, 'unavailable');

  it('reads the list with the bearer token', async () => {
    server.on('GET /api/models', json(200, models));
    expect(await listModels(0)).toEqual(models.items);
    expect(server.requests[0]!.headers.get('Authorization')).toBe('Bearer access-1');
  });

  it('tries one more time after a 503 or a bad answer, then gives unavailable', async () => {
    server.on('GET /api/models', down(), json(200, models));
    expect(await listModels(0)).toEqual(models.items);
    server.on('GET /api/models', down(), json(200, { items: [{ id: 'bad' }] }));
    await expect(listModels(0)).rejects.toMatchObject({ kind: 'unavailable' });
    expect(server.requests).toHaveLength(4);
  });

  it('does not try again after a network error or a refused request', async () => {
    server.on('GET /api/models', new TypeError('Network request failed'), problem(403, 'forbidden'));
    await expect(listModels(0)).rejects.toMatchObject({ kind: 'network' });
    await expect(listModels(0)).rejects.toMatchObject({ kind: 'rejected', status: 403 });
    expect(server.requests).toHaveLength(2);
  });
});
