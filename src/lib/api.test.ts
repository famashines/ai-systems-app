import { ApiError, listTasks, submitTask, submitTaskOnce } from '@/lib/api';
import * as auth from '@/lib/auth';
import { fakeServer, ids, json, task } from '@/test-fakes';

jest.mock('@/lib/auth', () => ({
  getAccessToken: jest.fn(async () => 'access-1'),
  refresh: jest.fn(async () => true),
}));

const origin = 'https://ai.famashines.com';
const commandId = '7d1f8a2c-3b4e-4c5d-9e6f-0a1b2c3d4e5f';
const accepted = () => json(202, { taskId: ids.taskA, version: 1 });
const problem = (status: number, code: string) => json(status, { type: 'about:blank', title: 'No', status, code });

let server: ReturnType<typeof fakeServer>;

beforeEach(() => {
  jest.useRealTimers();
  jest.mocked(auth.getAccessToken).mockResolvedValue('access-1');
  jest.mocked(auth.refresh).mockResolvedValue(true);
  server = fakeServer(origin);
});

it('posts the task with the Idempotency-Key, the bearer token and the contract body', async () => {
  server.on('POST /api/tasks', accepted());
  expect(await submitTaskOnce('Plan the week', commandId)).toEqual({ taskId: ids.taskA, version: 1 });
  const [request] = server.requests;
  expect(request!.headers.get('Idempotency-Key')).toBe(commandId);
  expect(request!.headers.get('Authorization')).toBe('Bearer access-1');
  expect(request!.body).toEqual({ text: 'Plan the week', mode: 'approval' });
});

it('refreshes the token once on 401 and tries again one time', async () => {
  jest.mocked(auth.getAccessToken).mockResolvedValueOnce('access-1').mockResolvedValueOnce('access-2');
  server.on('POST /api/tasks', problem(401, 'unauthorized'), accepted());
  await submitTaskOnce('Plan', commandId);
  expect(auth.refresh).toHaveBeenCalledTimes(1);
  expect(server.requests.map((request) => request.headers.get('Authorization'))).toEqual(['Bearer access-1', 'Bearer access-2']);
  expect(server.requests.map((request) => request.headers.get('Idempotency-Key'))).toEqual([commandId, commandId]);
});

it('gives unauthorized after a second 401 or when the refresh fails', async () => {
  server.on('POST /api/tasks', problem(401, 'unauthorized'), problem(401, 'unauthorized'));
  await expect(submitTaskOnce('Plan', commandId)).rejects.toMatchObject({ kind: 'unauthorized' });
  jest.mocked(auth.refresh).mockResolvedValue(false);
  server.on('POST /api/tasks', problem(401, 'unauthorized'));
  await expect(submitTaskOnce('Plan', commandId)).rejects.toMatchObject({ kind: 'unauthorized' });
  expect(server.requests).toHaveLength(3);
});

it('waits Retry-After on 429 and sends again with the same key', async () => {
  jest.useFakeTimers();
  server.on('POST /api/tasks', json(429, { type: 'about:blank', title: 'Slow down', status: 429, code: 'rate_limited' }, { 'Retry-After': '3' }), accepted());
  const waits: string[] = [];
  const result = submitTask('Plan', commandId, (kind) => waits.push(kind));
  await jest.advanceTimersByTimeAsync(2_999);
  expect(server.requests).toHaveLength(1);
  await jest.advanceTimersByTimeAsync(1);
  await expect(result).resolves.toEqual({ taskId: ids.taskA, version: 1 });
  expect(waits).toEqual(['rateLimited']);
  expect(server.requests.map((request) => request.headers.get('Idempotency-Key'))).toEqual([commandId, commandId]);
});

it('treats 502 and 503 the same as unavailable, backs off, and stops after the last attempt', async () => {
  jest.useFakeTimers();
  jest.spyOn(Math, 'random').mockReturnValue(1);
  server.on('POST /api/tasks', problem(502, 'unavailable'), problem(503, 'unavailable'), problem(502, 'unavailable'), problem(503, 'unavailable'));
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
  server.on('POST /api/tasks', new TypeError('Network request failed'));
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
  server.on('POST /api/tasks', problem(409, 'conflict'));
  await expect(submitTask('Plan', commandId)).rejects.toMatchObject({ kind: 'rejected', problem: { code: 'conflict' } });
  server.on('POST /api/tasks', new Response('<html>', { status: 400 }));
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
