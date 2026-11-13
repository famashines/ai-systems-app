import { fetch as streamFetch } from 'expo/fetch';

import * as auth from '@/lib/auth';
import { createDirectStore, history, parseEvents, statusError, streamChat, type DirectMessage } from '@/lib/direct';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('@/lib/auth', () => ({ getAccessToken: jest.fn(async () => 'token-1'), refresh: jest.fn(async () => true) }));

const send = jest.mocked(streamFetch) as unknown as jest.Mock;
const sse = (event: object) => `data: ${JSON.stringify(event)}\n\n`;
const done = sse({ type: 'done', finishReason: 'stop', inputTokens: 3, outputTokens: 2, costMicroUsd: 42 });

function stream(pieces: string[], status = 200, hold = false): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      if (!hold) controller.close();
    },
  });
  return { ok: status === 200, status, body } as Response;
}

const body = { chatId: 'c1', model: 'openai/gpt-5', messages: [{ role: 'user' as const, content: 'Hi' }] };

beforeEach(() => {
  send.mockReset();
  jest.mocked(auth.getAccessToken).mockResolvedValue('token-1');
  jest.mocked(auth.refresh).mockResolvedValue(true);
});

describe('parseEvents', () => {
  it('gives whole events and keeps the rest', () => {
    const text = `: ping\n\n${sse({ type: 'delta', text: 'a' })}data: {"type":"del`;
    expect(parseEvents(text)).toEqual({ events: [{ type: 'delta', text: 'a' }], rest: 'data: {"type":"del' });
  });

  it('ignores bad JSON and unknown events', () => {
    expect(parseEvents(`data: {bad\n\n${sse({ type: 'other' })}`)).toEqual({ events: [], rest: '' });
  });
});

it('maps an HTTP status to an error kind', () => {
  expect([401, 403, 413, 429, 500].map(statusError)).toEqual(['unauthorized', 'unauthorized', 'tooLong', 'rateLimited', 'failed']);
});

describe('streamChat', () => {
  it('posts the body with the token and gives the deltas and the cost', async () => {
    send.mockResolvedValue(stream([sse({ type: 'delta', text: 'Hel' }), sse({ type: 'delta', text: 'lo' }) + done.slice(0, 10), done.slice(10)]));
    const deltas: string[] = [];
    const outcome = await streamChat(body, new AbortController().signal, (text) => deltas.push(text));
    expect(outcome).toEqual({ state: 'done', costMicroUsd: 42, cut: false });
    expect(deltas).toEqual(['Hel', 'lo']);
    const [url, init] = send.mock.calls[0] as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe('https://ai.famashines.com/api/chat');
    expect(init.headers.Authorization).toBe('Bearer token-1');
    expect(JSON.parse(init.body)).toEqual(body);
  });

  it('marks an answer that reached the length limit', async () => {
    send.mockResolvedValue(stream([sse({ type: 'done', finishReason: 'length', costMicroUsd: 1 })]));
    expect(await streamChat(body, new AbortController().signal, () => {})).toEqual({ state: 'done', costMicroUsd: 1, cut: true });
  });

  it('renews the token one time after a 401', async () => {
    send.mockResolvedValueOnce(stream([], 401)).mockResolvedValueOnce(stream([done]));
    expect((await streamChat(body, new AbortController().signal, () => {})).state).toBe('done');
    expect(auth.refresh).toHaveBeenCalledTimes(1);
    send.mockReset().mockResolvedValue(stream([], 401));
    expect(await streamChat(body, new AbortController().signal, () => {})).toEqual({ state: 'error', error: 'unauthorized' });
  });

  it('gives no request with no token', async () => {
    jest.mocked(auth.getAccessToken).mockResolvedValue(null);
    jest.mocked(auth.refresh).mockResolvedValue(false);
    expect(await streamChat(body, new AbortController().signal, () => {})).toEqual({ state: 'error', error: 'unauthorized' });
    expect(send).not.toHaveBeenCalled();
  });

  it('maps a budget refusal, a model error, an early end and a network error', async () => {
    const run = () => streamChat(body, new AbortController().signal, () => {});
    send.mockResolvedValue(stream([sse({ type: 'error', errorClass: 'budget_refused', reason: 'cap', costMicroUsd: 0 })]));
    expect(await run()).toEqual({ state: 'error', error: 'budget', costMicroUsd: 0 });
    send.mockResolvedValue(stream([sse({ type: 'error', errorClass: 'provider', reason: 'x', costMicroUsd: 7 })]));
    expect(await run()).toEqual({ state: 'error', error: 'failed', costMicroUsd: 7 });
    send.mockResolvedValue(stream([sse({ type: 'delta', text: 'a' })]));
    expect(await run()).toEqual({ state: 'error', error: 'network' });
    send.mockRejectedValue(new Error('offline'));
    expect(await run()).toEqual({ state: 'error', error: 'network' });
    send.mockResolvedValue(stream([], 413));
    expect(await run()).toEqual({ state: 'error', error: 'tooLong' });
  });

  it('stops when the server sends nothing for the idle time', async () => {
    send.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    expect(await streamChat(body, new AbortController().signal, () => {}, 20)).toEqual({ state: 'error', error: 'network' });
  });
});

it('the history has no empty text and no failed answer', () => {
  const message = (role: 'user' | 'assistant', text: string, state: DirectMessage['state'] = 'done'): DirectMessage => ({ id: text, role, text, createdAt: '', state });
  expect(history([message('user', 'Hi'), message('assistant', '', 'error'), message('assistant', 'Half', 'stopped'), message('assistant', 'Bad', 'error'), message('user', 'Again')])).toEqual([
    { role: 'user', content: 'Hi' },
    { role: 'assistant', content: 'Half' },
    { role: 'user', content: 'Again' },
  ]);
});

describe('the store', () => {
  type Run = Parameters<typeof createDirectStore>[0];
  type Call = { body: Parameters<NonNullable<Run>>[0]; signal: AbortSignal; delta: (text: string) => void; end: (outcome: Awaited<ReturnType<NonNullable<Run>>>) => void };

  function setup() {
    const calls: Call[] = [];
    let n = 0;
    const store = createDirectStore(
      (body, signal, delta) => new Promise((end) => calls.push({ body, signal, delta, end })),
      () => `id-${(n += 1)}`,
      () => 0,
    );
    return { store, calls };
  }
  const choice = { model: 'openai/gpt-5', effort: 'high' as const };
  const flush = () => new Promise((resolve) => setTimeout(resolve, 80));

  it('sends the chat with no system message, streams the answer and keeps the cost', async () => {
    const { store, calls } = setup();
    const seen: number[] = [];
    store.subscribe(() => seen.push(store.get().messages.length));
    store.send('  Hello  ', choice);
    expect(store.get().busy).toBe(true);
    expect(calls[0]!.body).toEqual({ chatId: 'id-3', model: 'openai/gpt-5', effort: 'high', messages: [{ role: 'user', content: 'Hello' }] });
    store.send('Second', choice);
    expect(calls).toHaveLength(1);
    calls[0]!.delta('Hi ');
    calls[0]!.delta('there');
    await flush();
    expect(store.get().messages.at(-1)).toMatchObject({ role: 'assistant', text: 'Hi there', state: 'streaming' });
    calls[0]!.end({ state: 'done', costMicroUsd: 42, cut: false });
    await flush();
    expect(store.get()).toMatchObject({ busy: false, messages: [{ role: 'user', text: 'Hello' }, { role: 'assistant', text: 'Hi there', state: 'done', costMicroUsd: 42 }] });
    store.send('More', choice);
    expect(calls[1]!.body.messages).toEqual([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
      { role: 'user', content: 'More' },
    ]);
    expect(calls[1]!.body.chatId).toBe('id-3');
    expect(seen.length).toBeGreaterThan(3);
  });

  it('needs text, a model and no open answer', () => {
    const { store, calls } = setup();
    store.send('   ', choice);
    store.send('Hello', {});
    store.regenerate(choice);
    expect(calls).toHaveLength(0);
    expect(store.get().messages).toEqual([]);
  });

  it('stop keeps the partial answer as stopped', async () => {
    const { store, calls } = setup();
    store.send('Hello', choice);
    calls[0]!.delta('Par');
    store.stop();
    expect(calls[0]!.signal.aborted).toBe(true);
    calls[0]!.end({ state: 'error', error: 'network' });
    await flush();
    expect(store.get()).toMatchObject({ busy: false, messages: [{ role: 'user' }, { text: 'Par', state: 'stopped' }] });
  });

  it('regenerate replaces the last answer, also after an error', async () => {
    const { store, calls } = setup();
    store.send('Hello', choice);
    calls[0]!.end({ state: 'error', error: 'budget' });
    await flush();
    expect(store.get().messages.at(-1)).toMatchObject({ state: 'error', error: 'budget' });
    store.regenerate(choice);
    expect(store.get().messages).toHaveLength(2);
    expect(calls[1]!.body.messages).toEqual([{ role: 'user', content: 'Hello' }]);
    calls[1]!.end({ state: 'done', costMicroUsd: 1, cut: true });
    await flush();
    expect(store.get().messages.at(-1)).toMatchObject({ state: 'done', cut: true });
  });

  it('clear stops the call and drops a late answer', async () => {
    const { store, calls } = setup();
    store.send('Hello', choice);
    store.clear();
    expect(calls[0]!.signal.aborted).toBe(true);
    calls[0]!.delta('late');
    calls[0]!.end({ state: 'done', costMicroUsd: 1, cut: false });
    await flush();
    expect(store.get()).toEqual({ chatId: null, messages: [], busy: false });
  });
});
