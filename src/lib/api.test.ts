import { ApiError, getBudget, listModels, setBudget } from '@/lib/api';
import * as auth from '@/lib/auth';
import { fakeServer, json } from '@/test-fakes';

jest.mock('@/lib/auth', () => ({
  getAccessToken: jest.fn(async () => 'access-1'),
  refresh: jest.fn(async () => true),
}));

const origin = 'https://ai.famashines.com';
const commandId = '7d1f8a2c-3b4e-4c5d-9e6f-0a1b2c3d4e5f';
const route = 'POST /api/budget';
const saved = () => json(202, { version: 2 });
const problem = (status: number, code: string) => json(status, { type: 'about:blank', title: 'No', status, code });

let server: ReturnType<typeof fakeServer>;

beforeEach(() => {
  jest.useRealTimers();
  jest.mocked(auth.getAccessToken).mockResolvedValue('access-1');
  jest.mocked(auth.refresh).mockResolvedValue(true);
  server = fakeServer(origin);
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('sets the monthly cap with the Idempotency-Key, the bearer token and the contract body', async () => {
  server.on(route, saved(), json(202, { version: 3 }), problem(403, 'forbidden'));
  expect(await setBudget(5_000_000, 4_000_000, commandId)).toBe(2);
  expect(await setBudget(1, undefined, commandId)).toBe(3);
  await expect(setBudget(1, undefined, commandId)).rejects.toMatchObject({ kind: 'rejected', status: 403 });
  expect(server.requests.map((request) => request.body)).toEqual([
    { scope: { kind: 'month' }, hardCapMicroUsd: 5_000_000, softCapMicroUsd: 4_000_000 },
    { scope: { kind: 'month' }, hardCapMicroUsd: 1 },
    { scope: { kind: 'month' }, hardCapMicroUsd: 1 },
  ]);
  expect(server.requests[0]!.headers.get('Idempotency-Key')).toBe(commandId);
  expect(server.requests[0]!.headers.get('Authorization')).toBe('Bearer access-1');
});

it('refuses a cap that does not fit the contract before any request', async () => {
  await expect(setBudget(5, 6, commandId)).rejects.toMatchObject({ kind: 'rejected', status: 0 });
  await expect(setBudget(1_000_000_000_001, undefined, commandId)).rejects.toMatchObject({ kind: 'rejected', status: 0 });
  await expect(setBudget(1.5, undefined, commandId)).rejects.toMatchObject({ kind: 'rejected', status: 0 });
  expect(server.requests).toHaveLength(0);
});

it('refreshes the token once on 401 and tries again one time', async () => {
  jest.mocked(auth.getAccessToken).mockResolvedValueOnce('access-1').mockResolvedValueOnce('access-2');
  server.on(route, problem(401, 'unauthorized'), saved());
  await setBudget(1, undefined, commandId);
  expect(auth.refresh).toHaveBeenCalledTimes(1);
  expect(server.requests.map((request) => request.headers.get('Authorization'))).toEqual(['Bearer access-1', 'Bearer access-2']);
  expect(server.requests.map((request) => request.headers.get('Idempotency-Key'))).toEqual([commandId, commandId]);
});

it('gives unauthorized after a second 401, when the refresh fails, or with no token', async () => {
  server.on(route, problem(401, 'unauthorized'), problem(401, 'unauthorized'));
  await expect(setBudget(1, undefined, commandId)).rejects.toMatchObject({ kind: 'unauthorized' });
  jest.mocked(auth.refresh).mockResolvedValue(false);
  server.on(route, problem(401, 'unauthorized'));
  await expect(setBudget(1, undefined, commandId)).rejects.toMatchObject({ kind: 'unauthorized' });
  expect(server.requests).toHaveLength(3);
  jest.mocked(auth.getAccessToken).mockResolvedValue(null);
  await expect(setBudget(1, undefined, commandId)).rejects.toMatchObject({ kind: 'unauthorized' });
  expect(server.requests).toHaveLength(3);
});

it('waits Retry-After on 429 and sends again with the same key', async () => {
  jest.useFakeTimers();
  server.on(route, json(429, { type: 'about:blank', title: 'Slow down', status: 429, code: 'rate_limited' }, { 'Retry-After': '3' }), saved());
  const result = setBudget(1, undefined, commandId);
  await jest.advanceTimersByTimeAsync(2_999);
  expect(server.requests).toHaveLength(1);
  await jest.advanceTimersByTimeAsync(1);
  await expect(result).resolves.toBe(2);
  expect(server.requests.map((request) => request.headers.get('Idempotency-Key'))).toEqual([commandId, commandId]);
});

it('treats 502 and 503 as unavailable, backs off, and stops after the last attempt', async () => {
  jest.useFakeTimers();
  jest.spyOn(Math, 'random').mockReturnValue(1);
  server.on(route, problem(502, 'unavailable'), problem(503, 'unavailable'), problem(502, 'unavailable'), problem(503, 'unavailable'));
  const result = setBudget(1, undefined, commandId).catch((error: unknown) => error);
  await jest.advanceTimersByTimeAsync(1_000 + 2_000 + 4_000);
  const error = await result;
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ kind: 'unavailable' });
  expect(server.requests).toHaveLength(4);
});

it('gives a network error at once, with no automatic retry, also when the token read fails', async () => {
  server.on(route, new TypeError('Network request failed'));
  await expect(setBudget(1, undefined, commandId)).rejects.toMatchObject({ kind: 'network' });
  expect(server.requests).toHaveLength(1);
  jest.mocked(auth.getAccessToken).mockRejectedValue(new Error('offline'));
  await expect(setBudget(1, undefined, commandId)).rejects.toMatchObject({ kind: 'network' });
});

it('refuses an answer that does not match the contract', async () => {
  server.on('GET /api/budget', json(200, { month: 11 }));
  await expect(getBudget()).rejects.toMatchObject({ kind: 'unavailable' });
});

it('gives null for the budget on 404 and the month view on 200', async () => {
  const month = { month: '2026-11', capMicroUsd: 5_000_000, spentMicroUsd: 0, reservedMicroUsd: 0, remainingMicroUsd: 5_000_000, overCapMicroUsd: 0, rev: 1, asOf: 1 };
  server.on('GET /api/budget', problem(404, 'not_found'), json(200, month), problem(400, 'validation_failed'));
  expect(await getBudget()).toBeNull();
  expect(await getBudget()).toEqual(month);
  await expect(getBudget()).rejects.toMatchObject({ kind: 'rejected', status: 400 });
});

it('reads Retry-After as a number of seconds or as an HTTP date', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-31T10:00:00Z'));
  server.on('GET /api/budget', json(429, {}, { 'Retry-After': 'Sat, 31 Oct 2026 10:00:05 GMT' }), json(429, {}));
  await expect(getBudget()).rejects.toMatchObject({ kind: 'rateLimited', retryAfterMs: 5_000 });
  await expect(getBudget()).rejects.toMatchObject({ kind: 'rateLimited', retryAfterMs: 1_000 });
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
