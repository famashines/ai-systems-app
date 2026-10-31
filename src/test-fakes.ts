import type { ClientMessageV1, ServerMessageV1 } from '@famashines/ai-systems-contracts';

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

export function task(taskId: string, rev: number, title = `Task ${taskId.slice(0, 1)}`, createdAt = '2026-10-31T10:00:00.000Z') {
  return { taskId, title, status: 'submitted' as const, createdAt, updatedAt: createdAt, rev, asOf: rev };
}
