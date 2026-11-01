import {
  BudgetMonthV1,
  ConversationThreadResultV1,
  Id,
  MessageIntent,
  PostOwnerMessageCommandPayloadV1,
  ProblemJson,
  SetBudgetCommandPayloadV1,
  TaskListResultV1,
  WsLimits,
  type Timestamp,
} from '@famashines/ai-systems-contracts';
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
    readonly status = 0,
  ) {
    super(problem?.title ?? kind);
  }
}

const PostedAnswer = z.object({ conversationId: Id, messageId: Id, intent: MessageIntent, taskId: Id.exactOptional() });
export type Posted = z.infer<typeof PostedAnswer>;

const BudgetVersion = z.object({ version: z.int().min(1) });

export type Page = { before?: Timestamp; beforeId?: Id };
type Wait = (kind: 'rateLimited' | 'unavailable') => void;

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
  throw new ApiError('rejected', 0, problem.success ? problem.data : undefined, response.status);
}

function post<T>(path: string, body: unknown, key: string, schema: z.ZodType<T>): Promise<T> {
  return request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body) }, schema);
}

export function backoffMs(attempt: number, random = Math.random()): number {
  const ceiling = Math.min(WsLimits.reconnectMaxMs, WsLimits.reconnectMinMs * 2 ** attempt);
  return Math.max(WsLimits.reconnectMinMs, Math.round(ceiling * (0.5 + random / 2)));
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function withRetry<T>(once: () => Promise<T>, onWait: Wait): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await once();
    } catch (error) {
      const last = attempt + 1 >= sendAttempts;
      if (!(error instanceof ApiError) || last || (error.kind !== 'rateLimited' && error.kind !== 'unavailable')) throw error;
      onWait(error.kind);
      await sleep(error.kind === 'rateLimited' ? error.retryAfterMs : backoffMs(attempt));
    }
  }
}

export async function postMessage(conversationId: string, text: string, newTask: boolean, key: string, onWait: Wait = () => {}): Promise<Posted> {
  const payload = PostOwnerMessageCommandPayloadV1.safeParse({ conversationId, text, newTask });
  if (!payload.success) throw new ApiError('rejected');
  return withRetry(() => post(`/api/conversations/${payload.data.conversationId}/messages`, { text: payload.data.text, newTask: payload.data.newTask }, key, PostedAnswer), onWait);
}

function pageQuery(page: Page): URLSearchParams {
  const query = new URLSearchParams({ limit: String(pageSize) });
  if (page.before) query.set('before', page.before);
  if (page.beforeId) query.set('beforeId', page.beforeId);
  return query;
}

export function listTasks(page: Page = {}): Promise<TaskListResultV1> {
  return request(`/api/tasks?${pageQuery(page)}`, { method: 'GET' }, TaskListResultV1);
}

export function getThread(conversationId: string, page: Page = {}): Promise<ConversationThreadResultV1> {
  return request(`/api/conversations/${Id.parse(conversationId)}/messages?${pageQuery(page)}`, { method: 'GET' }, ConversationThreadResultV1);
}

export async function getBudget(): Promise<BudgetMonthV1 | null> {
  try {
    return await request('/api/budget', { method: 'GET' }, BudgetMonthV1);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function setBudget(hardCapMicroUsd: number, softCapMicroUsd: number | undefined, key: string): Promise<number> {
  const payload = SetBudgetCommandPayloadV1.safeParse({ scope: { kind: 'month' }, hardCapMicroUsd, ...(softCapMicroUsd === undefined ? {} : { softCapMicroUsd }) });
  if (!payload.success) throw new ApiError('rejected');
  return (await withRetry(() => post('/api/budget', payload.data, key, BudgetVersion), () => {})).version;
}
