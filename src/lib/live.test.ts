import { WsLimits } from '@famashines/ai-systems-contracts';

import { backoffMs } from '@/lib/api';
import { handshakeMs, LiveClient, minHeartbeatMs, refusedLimit, stableAfterMs, tryAgainLater, type LiveOptions, type LiveStatus } from '@/lib/live';
import { FakeSocket, ids, installFakeSocket, task } from '@/test-fakes';

const url = 'wss://ai.example.test/ws';

function setup(overrides: Partial<LiveOptions> = {}) {
  const statuses: LiveStatus[] = [];
  const options: LiveOptions = {
    url,
    topics: ['tasks', `task:${ids.taskA}`],
    lastSeq: null,
    getToken: jest.fn(async () => 'access-1'),
    refresh: jest.fn(async () => true),
    onStatus: (status) => statuses.push(status),
    onSubscribed: jest.fn(),
    onResync: jest.fn(),
    onNotice: jest.fn(),
    onAuthLost: jest.fn(),
    ...overrides,
  };
  return { client: new LiveClient(options), options, statuses };
}

async function connect(socket: FakeSocket, fromSeq = 11, headSeq = 10) {
  socket.open();
  socket.receive({ type: 'welcome', sessionId: ids.session, headSeq, heartbeatMs: 20_000 });
  socket.receive({ type: 'subscribed', topics: ['tasks'], fromSeq });
}

const flush = () => jest.advanceTimersByTimeAsync(0);

const notice = (seq: number, rev: number, docId = ids.taskA) => ({ type: 'notice' as const, seq, topic: 'tasks' as const, docId, rev, data: task(docId, rev) });

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(Math, 'random').mockReturnValue(1);
  installFakeSocket();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('sends hello with the token in the frame, not in the URL, and omits lastSeq on the first connect', async () => {
  const { client, options } = setup();
  client.start();
  await flush();
  const socket = FakeSocket.last();
  expect(socket.url).toBe(url);
  socket.open();
  expect(socket.sent).toEqual([{ type: 'hello', v: 1, token: 'access-1' }]);
  socket.receive({ type: 'welcome', sessionId: ids.session, headSeq: 10, heartbeatMs: 20_000 });
  expect(socket.sent.at(-1)).toEqual({ type: 'subscribe', topics: ['tasks', `task:${ids.taskA}`] });
  expect(options.onSubscribed).not.toHaveBeenCalled();
  socket.receive({ type: 'subscribed', topics: ['tasks'], fromSeq: 11 });
  expect(options.onSubscribed).toHaveBeenCalledWith(true, 10);
  expect(client.lastSeq).toBe(10);
});

it('drops a notice with seq not higher than lastSeq and passes the others', async () => {
  const { client, options } = setup();
  client.start();
  await flush();
  await connect(FakeSocket.last());
  const socket = FakeSocket.last();
  socket.receive(notice(11, 1));
  socket.receive(notice(11, 1));
  socket.receive(notice(9, 1));
  socket.receive(notice(12, 2));
  expect(jest.mocked(options.onNotice).mock.calls.map(([n]) => n.seq)).toEqual([11, 12]);
  expect(client.lastSeq).toBe(12);
});

it('reconnects with lastSeq and every topic in the first subscribe, with no snapshot when there is no gap', async () => {
  const { client, options, statuses } = setup();
  client.start();
  await flush();
  await connect(FakeSocket.last());
  FakeSocket.last().receive(notice(11, 1));
  FakeSocket.last().serverClose(1006);
  expect(statuses.at(-1)).toBe('reconnecting');
  await jest.advanceTimersByTimeAsync(WsLimits.reconnectMinMs);
  expect(FakeSocket.all).toHaveLength(2);
  const socket = FakeSocket.last();
  socket.open();
  socket.receive({ type: 'welcome', sessionId: ids.session, headSeq: 11, heartbeatMs: 20_000 });
  expect(socket.sent).toEqual([
    { type: 'hello', v: 1, token: 'access-1', lastSeq: 11 },
    { type: 'subscribe', topics: ['tasks', `task:${ids.taskA}`] },
  ]);
  socket.receive({ type: 'subscribed', topics: ['tasks'], fromSeq: 12 });
  expect(options.onSubscribed).toHaveBeenLastCalledWith(false, 11);
  expect(statuses.at(-1)).toBe('live');
});

it('asks for a snapshot when fromSeq is higher than lastSeq + 1', async () => {
  const { client, options } = setup({ lastSeq: 5 });
  client.start();
  await flush();
  await connect(FakeSocket.last(), 9);
  expect(FakeSocket.last().sent[0]).toEqual({ type: 'hello', v: 1, token: 'access-1', lastSeq: 5 });
  expect(options.onSubscribed).toHaveBeenCalledWith(true, 5);
});

it('asks for a snapshot and resets lastSeq after resync', async () => {
  const { client, options } = setup({ lastSeq: 500 });
  client.start();
  await flush();
  const socket = FakeSocket.last();
  socket.open();
  socket.receive({ type: 'welcome', sessionId: ids.session, headSeq: 20, heartbeatMs: 20_000 });
  socket.receive({ type: 'resync', reason: 'too_old' });
  socket.receive({ type: 'subscribed', topics: ['tasks'], fromSeq: 21 });
  expect(options.onSubscribed).toHaveBeenCalledWith(true, 20);
  socket.receive(notice(21, 1));
  expect(options.onNotice).toHaveBeenCalledTimes(1);
});

it('on 4401 refreshes the token and reconnects at once', async () => {
  const getToken = jest.fn().mockResolvedValueOnce('access-1').mockResolvedValueOnce('access-2');
  const { client, options } = setup({ getToken });
  client.start();
  await flush();
  await connect(FakeSocket.last());
  FakeSocket.last().serverClose(4401);
  await flush();
  expect(options.refresh).toHaveBeenCalledTimes(1);
  expect(FakeSocket.all).toHaveLength(2);
  FakeSocket.last().open();
  expect(FakeSocket.last().sent[0]).toEqual({ type: 'hello', v: 1, token: 'access-2', lastSeq: 10 });
});

it('on 4401 signs out when the refresh fails', async () => {
  const { client, options, statuses } = setup({ refresh: jest.fn(async () => false) });
  client.start();
  await flush();
  await connect(FakeSocket.last());
  FakeSocket.last().serverClose(4401);
  await jest.advanceTimersByTimeAsync(60_000);
  expect(options.onAuthLost).toHaveBeenCalledTimes(1);
  expect(FakeSocket.all).toHaveLength(1);
  expect(statuses.at(-1)).toBe('stopped');
});

it('on 4401 backs off when the refresh has a network error, and does not sign out', async () => {
  const { client, options } = setup({ refresh: jest.fn(async () => Promise.reject(new Error('offline'))) });
  client.start();
  await flush();
  await connect(FakeSocket.last());
  FakeSocket.last().serverClose(4401);
  await jest.advanceTimersByTimeAsync(WsLimits.reconnectMinMs - 1);
  expect(FakeSocket.all).toHaveLength(1);
  await jest.advanceTimersByTimeAsync(1);
  expect(FakeSocket.all).toHaveLength(2);
  expect(options.onAuthLost).not.toHaveBeenCalled();
});

it('signs out when no token can be had at connect', async () => {
  const { client, options } = setup({ getToken: jest.fn(async () => null) });
  client.start();
  await flush();
  expect(FakeSocket.all).toHaveLength(0);
  expect(options.onAuthLost).toHaveBeenCalledTimes(1);
});

it('on 1012 reconnects at once', async () => {
  const { client } = setup();
  client.start();
  await flush();
  await connect(FakeSocket.last());
  FakeSocket.last().serverClose(1012);
  await flush();
  expect(FakeSocket.all).toHaveLength(2);
});

it.each([
  ['4429 rate limit', 4429],
  ['1013 try again later', tryAgainLater],
  ['4400 bad message', 4400],
  ['4408 slow consumer', 4408],
  ['1006 lost', 1006],
])('on %s reconnects with exponential backoff up to 30 s', async (_name, code) => {
  const { client } = setup();
  client.start();
  await flush();
  await connect(FakeSocket.last());
  const delays = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000];
  for (const [index, delay] of delays.entries()) {
    FakeSocket.last().serverClose(code);
    await jest.advanceTimersByTimeAsync(delay - 1);
    expect(FakeSocket.all).toHaveLength(index + 1);
    await jest.advanceTimersByTimeAsync(1);
    expect(FakeSocket.all).toHaveLength(index + 2);
  }
});

it('backs off from 1 s to 30 s with jitter', () => {
  expect(backoffMs(0, 0)).toBe(1_000);
  expect(backoffMs(3, 0)).toBe(4_000);
  expect(backoffMs(3, 1)).toBe(8_000);
  expect(backoffMs(20, 0.5)).toBe(22_500);
  expect(backoffMs(20, 1)).toBe(30_000);
});

it('sends reauth with a new token after hello, also before subscribed, and uses the newest token in hello', async () => {
  const { client } = setup();
  client.start();
  await flush();
  const socket = FakeSocket.last();
  client.reauth('access-2');
  socket.open();
  expect(socket.sent[0]).toEqual({ type: 'hello', v: 1, token: 'access-2' });
  client.reauth('access-3');
  expect(socket.sent.at(-1)).toEqual({ type: 'reauth', token: 'access-3' });
  socket.receive({ type: 'welcome', sessionId: ids.session, headSeq: 10, heartbeatMs: 20_000 });
  socket.receive({ type: 'subscribed', topics: ['tasks'], fromSeq: 11 });
  client.reauth('access-4');
  expect(socket.sent.at(-1)).toEqual({ type: 'reauth', token: 'access-4' });
});

it('answers a server ping with pong', async () => {
  const { client } = setup();
  client.start();
  await flush();
  await connect(FakeSocket.last());
  FakeSocket.last().receive({ type: 'ping', t: 42 });
  expect(FakeSocket.last().sent.at(-1)).toEqual({ type: 'pong', t: 42 });
});

it('sends ping on wake and reconnects when no pong comes', async () => {
  const { client } = setup();
  client.start();
  await flush();
  await connect(FakeSocket.last());
  client.wake();
  expect(FakeSocket.last().sent.at(-1)).toMatchObject({ type: 'ping' });
  FakeSocket.last().receive({ type: 'pong', t: 1 });
  await jest.advanceTimersByTimeAsync(WsLimits.pongTimeoutMs);
  expect(FakeSocket.all).toHaveLength(1);

  client.wake();
  await jest.advanceTimersByTimeAsync(WsLimits.pongTimeoutMs);
  expect(FakeSocket.all[0]!.closedWith).toBe(1000);
  await jest.advanceTimersByTimeAsync(1_000);
  expect(FakeSocket.all).toHaveLength(2);
});

it('sends a heartbeat ping each heartbeatMs and reconnects when no pong comes', async () => {
  const { client } = setup();
  client.start();
  await flush();
  const socket = FakeSocket.last();
  socket.open();
  socket.receive({ type: 'welcome', sessionId: ids.session, headSeq: 10, heartbeatMs: 5_000 });
  socket.receive({ type: 'subscribed', topics: ['tasks'], fromSeq: 11 });
  await jest.advanceTimersByTimeAsync(5_000);
  expect(socket.sent.at(-1)).toMatchObject({ type: 'ping' });
  socket.receive({ type: 'pong', t: 1 });
  await jest.advanceTimersByTimeAsync(5_000);
  expect(socket.sent.filter((frame) => frame.type === 'ping')).toHaveLength(2);
  await jest.advanceTimersByTimeAsync(WsLimits.pongTimeoutMs);
  expect(socket.closedWith).toBe(1000);
  expect(FakeSocket.all).toHaveLength(1);
  await jest.advanceTimersByTimeAsync(1_000);
  expect(FakeSocket.all).toHaveLength(2);
});

it('reconnects at once on wake while it waits for the backoff', async () => {
  const { client } = setup();
  client.start();
  await flush();
  FakeSocket.last().serverClose(1006);
  client.wake();
  await flush();
  expect(FakeSocket.all).toHaveLength(2);
  client.wake();
  await flush();
  expect(FakeSocket.all).toHaveLength(2);
});

it('stops: closes with 1000 and does not reconnect', async () => {
  const { client, statuses } = setup();
  client.start();
  await flush();
  await connect(FakeSocket.last());
  const socket = FakeSocket.last();
  client.stop();
  socket.serverClose(1000);
  await jest.advanceTimersByTimeAsync(60_000);
  expect(socket.closedWith).toBe(1000);
  expect(FakeSocket.all).toHaveLength(1);
  expect(statuses.at(-1)).toBe('stopped');
});

it('keeps one socket and one hello when wake comes while the token is read', async () => {
  let give = (_token: string) => {};
  const getToken = jest.fn(() => new Promise<string>((resolve) => (give = resolve)));
  const { client } = setup({ getToken });
  client.start();
  client.wake();
  client.wake();
  await flush();
  give('access-1');
  await flush();
  expect(FakeSocket.all).toHaveLength(1);
  FakeSocket.last().open();
  expect(FakeSocket.last().sent.filter((frame) => frame.type === 'hello')).toHaveLength(1);
});

it('opens no second socket when wake comes during the refresh after 4401', async () => {
  let renew = (_ok: boolean) => {};
  const { client } = setup({ refresh: jest.fn(() => new Promise<boolean>((resolve) => (renew = resolve))) });
  client.start();
  await flush();
  await connect(FakeSocket.last());
  FakeSocket.last().serverClose(4401);
  client.wake();
  await flush();
  expect(FakeSocket.all).toHaveLength(1);
  renew(true);
  await flush();
  client.wake();
  await flush();
  expect(FakeSocket.all).toHaveLength(2);
  FakeSocket.last().open();
  expect(FakeSocket.last().sent.filter((frame) => frame.type === 'hello')).toHaveLength(1);
});

it('sends hello only on the socket that is current, and closes a replaced socket', async () => {
  const { client } = setup();
  client.start();
  await flush();
  const first = FakeSocket.last();
  first.serverClose(1006);
  await jest.advanceTimersByTimeAsync(1_000);
  const second = FakeSocket.last();
  expect(second).not.toBe(first);
  first.open();
  expect(first.sent).toEqual([]);
  second.open();
  expect(second.sent).toHaveLength(1);
});

it('does not reset the backoff at welcome, only when the session is stable', async () => {
  const { client } = setup();
  client.start();
  await flush();
  for (const delay of [1_000, 2_000, 4_000, 8_000, 16_000, 30_000]) {
    const count = FakeSocket.all.length;
    await connect(FakeSocket.last());
    FakeSocket.last().serverClose(tryAgainLater);
    await jest.advanceTimersByTimeAsync(delay - 1);
    expect(FakeSocket.all).toHaveLength(count);
    await jest.advanceTimersByTimeAsync(1);
    expect(FakeSocket.all).toHaveLength(count + 1);
  }
  await connect(FakeSocket.last());
  await jest.advanceTimersByTimeAsync(stableAfterMs);
  FakeSocket.last().serverClose(tryAgainLater);
  await jest.advanceTimersByTimeAsync(1_000);
  expect(FakeSocket.all).toHaveLength(8);
});

it('treats the first notice after subscribed as a stable session', async () => {
  const { client } = setup();
  client.start();
  await flush();
  FakeSocket.last().serverClose(1006);
  await jest.advanceTimersByTimeAsync(1_000);
  await connect(FakeSocket.last());
  FakeSocket.last().receive(notice(11, 1));
  FakeSocket.last().serverClose(1012);
  await flush();
  expect(FakeSocket.all).toHaveLength(3);
});

it('ignores and counts a frame that does not parse, and asks for a snapshot on a bad notice', async () => {
  const { client, options } = setup();
  client.start();
  await flush();
  await connect(FakeSocket.last());
  const socket = FakeSocket.last();
  socket.receive('{"type":"future_message","x":1}');
  socket.receive('not json');
  expect(client.invalidFrames).toBe(2);
  expect(options.onResync).not.toHaveBeenCalled();
  socket.receive('{"type":"notice","seq":"x"}');
  expect(client.invalidFrames).toBe(3);
  expect(options.onResync).toHaveBeenCalledTimes(1);
  expect(socket.closedWith).toBeNull();
  expect(FakeSocket.all).toHaveLength(1);
});

it('signs out with the reason refused after 3 refused tokens in one minute', async () => {
  const { client, options } = setup();
  client.start();
  await flush();
  for (let i = 0; i < refusedLimit; i += 1) {
    await connect(FakeSocket.last());
    FakeSocket.last().serverClose(4401);
    await jest.advanceTimersByTimeAsync(5_000);
  }
  expect(options.refresh).toHaveBeenCalledTimes(refusedLimit - 1);
  expect(options.onAuthLost).toHaveBeenCalledWith('refused');
  expect(FakeSocket.all).toHaveLength(refusedLimit);
});

it('omits a stored lastSeq of 0 and reads the snapshot', async () => {
  const { client, options } = setup({ lastSeq: 0 });
  client.start();
  await flush();
  await connect(FakeSocket.last());
  expect(FakeSocket.last().sent[0]).toEqual({ type: 'hello', v: 1, token: 'access-1' });
  expect(options.onSubscribed).toHaveBeenCalledWith(true, 10);
});

it('loads the snapshot again on resync at any time and takes the next notice', async () => {
  const { client, options } = setup();
  client.start();
  await flush();
  await connect(FakeSocket.last(), 101, 100);
  FakeSocket.last().receive(notice(101, 1));
  FakeSocket.last().receive({ type: 'resync', reason: 'server_restart' });
  expect(options.onResync).toHaveBeenCalledTimes(1);
  FakeSocket.last().receive(notice(3, 1, ids.taskB));
  expect(jest.mocked(options.onNotice).mock.calls.map(([n]) => n.seq)).toEqual([101, 3]);
});

it('sends the heartbeat at least each 5 s apart', async () => {
  const { client } = setup();
  client.start();
  await flush();
  const socket = FakeSocket.last();
  socket.open();
  socket.receive({ type: 'welcome', sessionId: ids.session, headSeq: 10, heartbeatMs: 100 });
  socket.receive({ type: 'subscribed', topics: ['tasks'], fromSeq: 11 });
  await jest.advanceTimersByTimeAsync(minHeartbeatMs - 1);
  expect(socket.sent.filter((frame) => frame.type === 'ping')).toHaveLength(0);
  await jest.advanceTimersByTimeAsync(1);
  expect(socket.sent.filter((frame) => frame.type === 'ping')).toHaveLength(1);
});

it('closes and reconnects with backoff when subscribed does not come in 15 s after open', async () => {
  const { client, statuses } = setup();
  client.start();
  await flush();
  const socket = FakeSocket.last();
  socket.open();
  socket.receive({ type: 'welcome', sessionId: ids.session, headSeq: 10, heartbeatMs: 20_000 });
  await jest.advanceTimersByTimeAsync(handshakeMs - 1);
  expect(socket.closedWith).toBeNull();
  await jest.advanceTimersByTimeAsync(1);
  expect(socket.closedWith).toBe(1000);
  expect(statuses.at(-1)).toBe('reconnecting');
  expect(FakeSocket.all).toHaveLength(1);
  await jest.advanceTimersByTimeAsync(1_000);
  expect(FakeSocket.all).toHaveLength(2);
});

it('keeps the socket when subscribed comes in time', async () => {
  const { client } = setup();
  client.start();
  await flush();
  await connect(FakeSocket.last());
  FakeSocket.last().receive({ type: 'pong', t: 1 });
  await jest.advanceTimersByTimeAsync(handshakeMs);
  expect(FakeSocket.last().closedWith).toBeNull();
});
