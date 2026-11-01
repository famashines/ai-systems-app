import { TaskDetailV1, type ClientMessageV1, type ServerMessageV1, type TaskStatus } from '@famashines/ai-systems-contracts';

export class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static all: FakeSocket[] = [];

  readyState = FakeSocket.CONNECTING;
  sent: ClientMessageV1[] = [];
  closedWith: number | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }

  static last(): FakeSocket {
    const socket = FakeSocket.all.at(-1);
    if (!socket) throw new Error('No socket was opened');
    return socket;
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as ClientMessageV1);
  }

  close(code = 1000): void {
    this.readyState = FakeSocket.CLOSED;
    this.closedWith = code;
  }

  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }

  receive(message: ServerMessageV1 | string): void {
    this.onmessage?.({ data: typeof message === 'string' ? message : JSON.stringify(message) });
  }

  serverClose(code: number): void {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.({ code });
  }
}

export function installFakeSocket(): void {
  FakeSocket.all = [];
  global.WebSocket = FakeSocket as unknown as typeof WebSocket;
}

export type FakeRequest = { method: string; path: string; query: URLSearchParams; headers: Headers; body: unknown };
type Answer = Response | Error | ((request: FakeRequest) => Response | Promise<Response>);

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

export function fakeServer(origin: string) {
  const requests: FakeRequest[] = [];
  const answers = new Map<string, Answer[]>();
  global.fetch = jest.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const request: FakeRequest = {
      method: init.method ?? 'GET',
      path: url.pathname,
      query: url.searchParams,
      headers: new Headers(init.headers),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };
    requests.push(request);
    if (url.origin !== origin) throw new TypeError(`Network request failed: ${url}`);
    const answer = answers.get(`${request.method} ${request.path}`)?.shift();
    if (!answer) throw new TypeError(`Network request failed: ${url}`);
    if (answer instanceof Error) throw answer;
    return typeof answer === 'function' ? answer(request) : answer;
  }) as typeof fetch;
  return {
    requests,
    on(route: string, ...list: Answer[]) {
      answers.set(route, [...(answers.get(route) ?? []), ...list]);
    },
  };
}

export const ids = {
  session: '0b6c2c55-8a0a-4f5e-9c1d-2e3f4a5b6c7d',
  taskA: 'a1111111-1111-4111-8111-111111111111',
  taskB: 'b2222222-2222-4222-8222-222222222222',
  taskC: 'c3333333-3333-4333-8333-333333333333',
};

export function task(taskId: string, rev: number, title = `Task ${taskId.slice(0, 1)}`, createdAt = '2026-10-31T10:00:00.000Z', status: TaskStatus = 'submitted') {
  return { taskId, title, status, createdAt, updatedAt: createdAt, rev, asOf: rev };
}

export const subtaskIds = ['e5555555-5555-4555-8555-555555555555', 'f6666666-6666-4666-8666-666666666666', '97777777-7777-4777-8777-777777777777'];
export const agentIds = ['a8888888-8888-4888-8888-888888888888', 'b9999999-9999-4999-8999-999999999999'];

export function detail(change: Partial<TaskDetailV1> = {}): TaskDetailV1 {
  return TaskDetailV1.parse({
    taskId: ids.taskA,
    title: 'Plan the week',
    status: 'awaiting_approval',
    mode: 'approval',
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
    plan: {
      planVersion: 1,
      subtasks: [
        { subtaskId: subtaskIds[0], title: 'Facts', instructions: 'Find the facts.', agentId: agentIds[0], dependsOn: [], needsApproval: false, estimatedCostMicroUsd: 2_000, estimatedDurationMs: 30_000 },
        { subtaskId: subtaskIds[1], title: 'Summary', instructions: 'Write the summary.', agentId: agentIds[1], dependsOn: [subtaskIds[0]], needsApproval: true, estimatedCostMicroUsd: 15_000, estimatedDurationMs: 120_000 },
      ],
    },
    currentCall: null,
    subtasks: [],
    checkpoints: [],
    costMicroUsd: 0,
    rev: 1,
    asOf: 1,
    ...change,
  });
}
