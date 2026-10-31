import { Id, ProblemJson, SubmitTaskCommandPayloadV1, TaskListResultV1, WsLimits, type Timestamp } from '@famashines/ai-systems-contracts';
import { z } from 'zod';

import * as auth from '@/lib/auth';
import { config } from '@/lib/config';

export const fetchTimeoutMs = 15_000;
export const pageSize = 50;
export const sendAttempts = 4;
export const taskTextMax = 20_000;

export type ApiErrorKind = 'network' | 'unauthorized' | 'rateLimited' | 'unavailable' | 'rejected';

export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    readonly retryAfterMs = 0,
    readonly problem?: ProblemJson,
  ) {
    super(problem?.title ?? kind);
  }
}

const SubmitTaskResult = z.object({ taskId: Id, version: z.int().nonnegative() });
type Submitted = z.infer<typeof SubmitTaskResult>;

function retryAfter(header: string | null): number {
  const seconds = Number(header);
  if (header && Number.isFinite(seconds)) return Math.min(Math.max(seconds, 0), 60) * 1000;
  const date = header ? Date.parse(header) : NaN;
  return Number.isNaN(date) ? 1000 : Math.min(Math.max(date - Date.now(), 0), 60_000);
}

async function send(path: string, init: RequestInit, token: string): Promise<Response> {
  const controller = new AbortController();
  const handle = setTimeout(() => controller.abort(), fetchTimeoutMs);
  try {
    return await fetch(`${config.apiUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { Accept: 'application/json', ...init.headers, Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new ApiError('network');
  } finally {
    clearTimeout(handle);
  }
}

async function token(renew: boolean): Promise<string> {
  let value: string | null;
  try {
    value = renew ? ((await auth.refresh()) ? await auth.getAccessToken() : null) : await auth.getAccessToken();
  } catch {
    throw new ApiError('network');
  }
  if (!value) throw new ApiError('unauthorized');
  return value;
}

async function request<T>(path: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
  let response = await send(path, init, await token(false));
  if (response.status === 401) response = await send(path, init, await token(true));
  if (response.ok) {
    const body = schema.safeParse(await response.json().catch(() => null));
    if (!body.success) throw new ApiError('unavailable');
    return body.data;
  }
  if (response.status === 401) throw new ApiError('unauthorized');
  if (response.status === 429) throw new ApiError('rateLimited', retryAfter(response.headers.get('Retry-After')));
  if (response.status === 502 || response.status === 503) throw new ApiError('unavailable');
  const problem = ProblemJson.safeParse(await response.json().catch(() => null));
  throw new ApiError('rejected', 0, problem.success ? problem.data : undefined);
}

export async function submitTaskOnce(text: string, key: string): Promise<Submitted> {
  const payload = SubmitTaskCommandPayloadV1.safeParse({ text });
  if (!payload.success) throw new ApiError('rejected');
  return request(
    '/api/tasks',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify(payload.data),
    },
    SubmitTaskResult,
  );
}

export function backoffMs(attempt: number, random = Math.random()): number {
  const ceiling = Math.min(WsLimits.reconnectMaxMs, WsLimits.reconnectMinMs * 2 ** attempt);
  return Math.max(WsLimits.reconnectMinMs, Math.round(ceiling * (0.5 + random / 2)));
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function submitTask(text: string, key: string, onWait: (kind: 'rateLimited' | 'unavailable') => void = () => {}): Promise<Submitted> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await submitTaskOnce(text, key);
    } catch (error) {
      const last = attempt + 1 >= sendAttempts;
      if (!(error instanceof ApiError) || last || (error.kind !== 'rateLimited' && error.kind !== 'unavailable')) throw error;
      onWait(error.kind);
      await sleep(error.kind === 'rateLimited' ? error.retryAfterMs : backoffMs(attempt));
    }
  }
}

export function listTasks(page: { before?: Timestamp; beforeId?: Id } = {}): Promise<TaskListResultV1> {
  const query = new URLSearchParams({ limit: String(pageSize) });
  if (page.before) query.set('before', page.before);
  if (page.beforeId) query.set('beforeId', page.beforeId);
  return request(`/api/tasks?${query}`, { method: 'GET' }, TaskListResultV1);
}
