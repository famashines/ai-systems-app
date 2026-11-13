import { fetch as streamFetch } from 'expo/fetch';

import * as auth from '@/lib/auth';
import { autoTitle, createDirectStore, history, historyMax, parseEvents, statusError, streamChat, type DirectMessage } from '@/lib/direct';

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

it('makes a short title from the first line, cut at a word', () => {
  expect(autoTitle('  Plan a trip  ')).toBe('Plan a trip');
  expect(autoTitle('First line\nSecond line')).toBe('First line');
  expect(autoTitle('In an ai-system, what is the difference between chat and conversation?')).toBe('In an ai-system, what is the difference…');
  expect(autoTitle('x'.repeat(60))).toBe(`${'x'.repeat(40)}…`);
  expect(autoTitle('a'.repeat(39) + ' tail')).toBe(`${'a'.repeat(39)}…`);
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
    const saved = new Map<string, unknown>();
    const storage = {
      getItem: async <T,>(key: string) => (saved.has(key) ? { value: JSON.parse(JSON.stringify(saved.get(key))) as T, updatedAt: 0 } : null),
      setItem: async (key: string, value: unknown) => void saved.set(key, value),
      removeItem: async (key: string) => void saved.delete(key),
    };
    const names: { chatId: string; messages: unknown; done: (title: string | Error) => void }[] = [];
    const nameChat = (chatId: string, messages: unknown) =>
      new Promise<string>((resolve, reject) => names.push({ chatId, messages, done: (title) => (title instanceof Error ? reject(title) : resolve(title)) }));
    const make = () =>
      createDirectStore(
        (body, signal, delta) => new Promise((end) => calls.push({ body, signal, delta, end })),
        () => `id-${(n += 1)}`,
        () => n,
        storage,
        nameChat,
      );
    return { store: make(), calls, saved, make, names };
  }
  const choice = { model: 'openai/gpt-5', effort: 'high' as const };
  const flush = () => new Promise((resolve) => setTimeout(resolve, 80));

  it('sends the chat with no system message, streams the answer and keeps the cost', async () => {
    const { store, calls } = setup();
    const seen: number[] = [];
    store.subscribe(() => seen.push(store.get().messages.length));
    store.send('  Hello  ', choice);
    expect(store.get().busy).toBe(true);
    expect(calls[0]!.body).toEqual({ chatId: 'id-1', model: 'openai/gpt-5', effort: 'high', messages: [{ role: 'user', content: 'Hello' }] });
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
    expect(calls[1]!.body.chatId).toBe('id-1');
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

  it('keeps each chat on the phone, newest first, and opens it again after a restart', async () => {
    const { store, calls, saved, make } = setup();
    store.send('First chat', choice);
    calls[0]!.delta('Answer one');
    calls[0]!.end({ state: 'done', costMicroUsd: 5, cut: false });
    await flush();
    const first = store.get().chatId!;
    store.clear();
    store.send('Second chat', choice);
    await flush();
    const second = store.get().chatId!;
    expect(store.get().history.map((item) => [item.chatId, item.title])).toEqual([
      [second, 'Second chat'],
      [first, 'First chat'],
    ]);
    const again = make();
    expect(again.get().history).toEqual([]);
    await again.load();
    expect(again.get().history.map((item) => item.title)).toEqual(['Second chat', 'First chat']);
    await again.open(second);
    expect(again.get()).toMatchObject({ chatId: second, busy: false });
    expect(again.get().messages).toMatchObject([{ text: 'Second chat' }]);
    await again.open(first);
    expect(again.get().messages).toMatchObject([{ text: 'First chat' }, { text: 'Answer one', state: 'done', costMicroUsd: 5 }]);
    again.send('More', choice);
    expect(calls.at(-1)!.body).toMatchObject({ chatId: first, messages: [{ content: 'First chat' }, { content: 'Answer one' }, { content: 'More' }] });
    expect(again.get().history[0]!.chatId).toBe(first);
    await again.open('unknown');
    expect(again.get().chatId).toBe(first);
    expect(saved.size).toBe(3);
  });

  it('remove deletes one chat, and forget deletes all', async () => {
    const { store, calls, saved } = setup();
    store.send('One', choice);
    calls[0]!.end({ state: 'done', costMicroUsd: 1, cut: false });
    await flush();
    const one = store.get().chatId!;
    store.clear();
    store.send('Two', choice);
    const two = store.get().chatId!;
    store.remove(two);
    expect(calls[1]!.signal.aborted).toBe(true);
    expect(store.get()).toMatchObject({ chatId: null, messages: [], history: [{ chatId: one }] });
    await flush();
    expect([...saved.keys()].sort()).toEqual([`direct.chat.${one}`, 'direct.history']);
    store.forget();
    await flush();
    expect(store.get().history).toEqual([]);
    expect(saved.size).toBe(0);
  });

  it('renames a chat, keeps the name after the next message, and puts bookmarks first', async () => {
    const { store, calls, saved } = setup();
    store.send('One', choice);
    calls[0]!.end({ state: 'done', costMicroUsd: 1, cut: false });
    await flush();
    const one = store.get().chatId!;
    store.clear();
    store.send('Two', choice);
    calls[1]!.end({ state: 'done', costMicroUsd: 1, cut: false });
    await flush();
    store.rename(one, '   ');
    store.rename(one, '  Trip plan  ');
    store.bookmark(one);
    expect(store.get().history.map((item) => [item.title, item.bookmarked])).toEqual([
      ['Trip plan', true],
      ['Two', undefined],
    ]);
    store.send('More', choice);
    await flush();
    expect(store.get().history.map((item) => item.title)).toEqual(['Trip plan', 'Two']);
    expect(saved.get('direct.history')).toEqual(store.get().history);
    store.bookmark(one);
    expect(store.get().history.map((item) => [item.title, item.bookmarked])).toEqual([
      ['Trip plan', false],
      ['Two', undefined],
    ]);
  });

  it('asks the model for a title after the first answer, one time, and keeps a rename', async () => {
    const { store, calls, names } = setup();
    store.send('What is the difference between chat and conversation?', choice);
    const chatId = store.get().chatId!;
    expect(store.get().history[0]!.title).toBe('What is the difference between chat and…');
    calls[0]!.delta('A chat is the thread.');
    calls[0]!.end({ state: 'done', costMicroUsd: 1, cut: false });
    await flush();
    expect(names).toHaveLength(1);
    expect(names[0]).toMatchObject({ chatId, messages: [{ role: 'user', content: 'What is the difference between chat and conversation?' }, { role: 'assistant', content: 'A chat is the thread.' }] });
    store.send('More', choice);
    calls[1]!.end({ state: 'done', costMicroUsd: 1, cut: false });
    await flush();
    expect(names).toHaveLength(1);
    names[0]!.done('Chat vs conversation');
    await flush();
    expect(store.get().history[0]).toMatchObject({ title: 'Chat vs conversation', titled: 'model' });
    store.send('Again', choice);
    calls[2]!.end({ state: 'done', costMicroUsd: 1, cut: false });
    await flush();
    expect(names).toHaveLength(1);
  });

  it('keeps the local title when the title call fails, tries again after a restart, and never replaces a rename', async () => {
    const { store: first, calls, names, make } = setup();
    let store = first;
    store.send('Plan a trip', choice);
    const chatId = store.get().chatId!;
    calls[0]!.end({ state: 'error', error: 'network' });
    await flush();
    expect(names).toHaveLength(0);
    store.regenerate(choice);
    calls[1]!.end({ state: 'done', costMicroUsd: 1, cut: false });
    await flush();
    names[0]!.done(new Error('down'));
    await flush();
    expect(store.get().history[0]).toMatchObject({ title: 'Plan a trip' });
    expect(store.get().history[0]!.titled).toBeUndefined();
    store.send('More', choice);
    calls[2]!.end({ state: 'done', costMicroUsd: 1, cut: false });
    await flush();
    expect(names).toHaveLength(1);
    store = make();
    await store.load();
    await store.open(chatId);
    store.send('Again', choice);
    calls[3]!.end({ state: 'done', costMicroUsd: 1, cut: false });
    await flush();
    expect(names).toHaveLength(2);
    expect((names[1]!.messages as { content: string }[]).map((message) => message.content)).toEqual(['Plan a trip']);
    store.rename(chatId, 'My trip');
    names[1]!.done('Trip planning');
    await flush();
    expect(store.get().history[0]).toMatchObject({ title: 'My trip', titled: 'owner' });
    store.remove(chatId);
    expect(store.get().history).toEqual([]);
  });

  it('keeps at most the newest chats', async () => {
    const { store, saved } = setup();
    for (let i = 0; i < historyMax + 2; i += 1) {
      store.send(`Chat ${i}`, choice);
      store.clear();
    }
    await flush();
    expect(store.get().history).toHaveLength(historyMax);
    expect(store.get().history[0]!.title).toBe(`Chat ${historyMax + 1}`);
    expect(saved.size).toBe(historyMax + 1);
  });

  it('clear stops the call and drops a late answer', async () => {
    const { store, calls } = setup();
    store.send('Hello', choice);
    store.clear();
    expect(calls[0]!.signal.aborted).toBe(true);
    calls[0]!.delta('late');
    calls[0]!.end({ state: 'done', costMicroUsd: 1, cut: false });
    await flush();
    expect(store.get()).toMatchObject({ chatId: null, messages: [], busy: false });
  });
});
