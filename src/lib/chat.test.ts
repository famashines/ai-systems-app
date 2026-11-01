import type { Topic } from '@famashines/ai-systems-contracts';

import { applyDelta, chatReducer, chatTopics, emptyChat, sortMessages, streamText, visibleStreams, type ChatMessage, type Delta } from '@/lib/chat';
import { ids } from '@/test-fakes';

const conversationId = 'd4444444-4444-4444-8444-444444444444';
const callA = 'e5555555-5555-4555-8555-555555555555';
const callB = 'f6666666-6666-4666-8666-666666666666';

const owner = (messageId: string, rev = 1, taskId?: string, createdAt = '2026-11-01T10:00:00.000Z'): ChatMessage => ({
  role: 'owner',
  messageId,
  text: `Owner ${messageId.slice(0, 1)}`,
  intent: 'new_task',
  createdAt,
  rev,
  asOf: 1,
  ...(taskId ? { taskId } : {}),
});
const agent = (messageId: string, taskId: string, createdAt = '2026-11-01T10:01:00.000Z', costMicroUsd?: number): ChatMessage => ({
  role: 'agent',
  messageId,
  taskId,
  text: 'Final answer',
  createdAt,
  rev: 1,
  asOf: 2,
  ...(costMicroUsd === undefined ? {} : { costMicroUsd }),
});
const delta = (i: number, text: string, attempt = 1, callId = callA, taskId = ids.taskA): Delta => ({ taskId, callId, attempt, i, text });
const notice = (seq: number, message: ChatMessage, rev = message.rev, topic: Topic = `conversation:${conversationId}`) => ({
  type: 'notice' as const,
  seq,
  topic,
  docId: message.messageId,
  rev,
  data: message,
});

describe('deltas', () => {
  it('keeps the text of each call in index order, also out of order and with a lost delta', () => {
    let streams = applyDelta({}, delta(1, ' world'));
    streams = applyDelta(streams, delta(0, 'Hello'));
    streams = applyDelta(streams, delta(1, ' world'));
    streams = applyDelta(streams, delta(3, '!'));
    streams = applyDelta(streams, delta(1_000_000_000, '?'));
    expect(streamText(streams[ids.taskA]!)).toBe('Hello world!?');
  });

  it('drops the earlier text and starts again at i = 0 when the attempt grows, and drops a delta of an older attempt', () => {
    let streams = applyDelta({}, delta(0, 'First '));
    streams = applyDelta(streams, delta(1, 'try'));
    streams = applyDelta(streams, delta(0, 'Second', 2));
    expect(streamText(streams[ids.taskA]!)).toBe('Second');
    expect(applyDelta(streams, delta(2, 'late', 1))).toBe(streams);
    streams = applyDelta(streams, delta(1, ' try', 2));
    expect(streamText(streams[ids.taskA]!)).toBe('Second try');
  });

  it('keeps the state for each (taskId, callId)', () => {
    let streams = applyDelta({}, delta(0, 'Call one'));
    streams = applyDelta(streams, delta(0, 'Call two', 3, callB));
    streams = applyDelta(streams, delta(0, 'Other task', 1, callA, ids.taskB));
    expect(streamText(streams[ids.taskA]!)).toBe('Call one\n\nCall two');
    expect(streamText(streams[ids.taskB]!)).toBe('Other task');
  });
});

describe('thread', () => {
  it('sorts newest first, with the id for the same time', () => {
    const a = owner('a0000000-0000-4000-8000-000000000000');
    const b = owner('b0000000-0000-4000-8000-000000000000');
    const c = agent('c0000000-0000-4000-8000-000000000000', ids.taskA);
    expect(sortMessages({ [a.messageId]: a, [b.messageId]: b, [c.messageId]: c }).map((m) => m.messageId)).toEqual([c.messageId, b.messageId, a.messageId]);
  });

  it('pages until an empty page, not by the number of items, with the last item as the cursor', () => {
    const first = [owner(ids.taskB, 1, undefined, '2026-11-01T10:05:00.000Z')];
    let state = chatReducer(emptyChat, { type: 'page', items: first, first: true });
    expect(state).toMatchObject({ loaded: true, hasMore: true, cursor: { before: '2026-11-01T10:05:00.000Z', beforeId: ids.taskB } });
    state = chatReducer(state, { type: 'page', items: [owner(ids.taskA)], first: false });
    expect(state).toMatchObject({ hasMore: true, cursor: { beforeId: ids.taskA } });
    state = chatReducer(state, { type: 'page', items: [], first: false });
    expect(state).toMatchObject({ hasMore: false, cursor: { beforeId: ids.taskA } });
    expect(chatReducer(emptyChat, { type: 'page', items: [], first: true })).toMatchObject({ loaded: true, hasMore: false, cursor: null });
  });

  it('starts the paging again when a reload of the first page shares no message with the stored items', () => {
    let state = chatReducer(emptyChat, { type: 'page', items: [], first: true });
    expect(state).toMatchObject({ loaded: true, hasMore: false, cursor: null });
    state = chatReducer(state, { type: 'page', items: [owner(ids.taskB)], first: true });
    expect(state).toMatchObject({ hasMore: true, cursor: { beforeId: ids.taskB } });
    state = chatReducer(state, { type: 'page', items: [owner(ids.taskA)], first: false });
    state = chatReducer(state, { type: 'page', items: [owner(ids.taskC)], first: true });
    expect(Object.keys(state.items)).toEqual([ids.taskC]);
    expect(state).toMatchObject({ hasMore: true, cursor: { beforeId: ids.taskC } });
    state = chatReducer(state, { type: 'page', items: [], first: true });
    expect(state).toMatchObject({ items: {}, hasMore: false, cursor: null });
  });

  it('keeps the deeper cursor when the first page loads again', () => {
    let state = chatReducer(emptyChat, { type: 'page', items: [owner(ids.taskB)], first: true });
    state = chatReducer(state, { type: 'page', items: [owner(ids.taskA)], first: false });
    state = chatReducer(state, { type: 'page', items: [owner(ids.taskC), owner(ids.taskB)], first: true });
    expect(state.cursor?.beforeId).toBe(ids.taskA);
  });

  it('applies a notice by docId and rev, and only for its own conversation', () => {
    const base = owner(ids.taskA);
    let state = chatReducer(emptyChat, { type: 'page', items: [base], first: true });
    const linked = owner(ids.taskA, 2, ids.taskB);
    state = chatReducer(state, { type: 'notice', notice: notice(5, linked), conversationId });
    expect(state.items[ids.taskA]).toMatchObject({ taskId: ids.taskB, rev: 2 });
    const same = chatReducer(state, { type: 'notice', notice: notice(6, owner(ids.taskA, 2)), conversationId });
    expect(same).toBe(state);
    const other = chatReducer(state, { type: 'notice', notice: notice(7, owner(ids.taskC), 1, `conversation:${ids.taskC}`), conversationId });
    expect(other).toBe(state);
    const wrongDoc = { ...notice(8, owner(ids.taskC)), docId: ids.taskB };
    expect(chatReducer(state, { type: 'notice', notice: wrongDoc, conversationId })).toBe(state);
    expect(chatReducer(state, { type: 'page', items: [owner(ids.taskA, 1)], first: false }).items[ids.taskA]?.rev).toBe(2);
  });

  it('hides the streamed text when the agent reply of its task arrives, and shows it again on a later delta', () => {
    let state = chatReducer(emptyChat, { type: 'delta', delta: delta(0, 'Draft') });
    const reply = agent(ids.taskC, ids.taskA);
    state = chatReducer(state, { type: 'notice', notice: notice(3, reply), conversationId });
    expect(state.streams[ids.taskA]?.hidden).toBe(true);
    state = chatReducer(state, { type: 'notice', notice: notice(4, { ...agent(ids.taskC, ids.taskA, undefined, 10), rev: 2 }, 2), conversationId });
    expect(state.streams[ids.taskA]?.hidden).toBe(true);
    state = chatReducer(state, { type: 'delta', delta: delta(1, ' more') });
    expect(state.streams[ids.taskA]).toMatchObject({ hidden: false });
    expect(streamText(state.streams[ids.taskA]!)).toBe('Draft more');
    state = chatReducer(state, { type: 'unsubscribed', topics: ['budget', `task:${ids.taskA}`] });
    expect(state.streams).toEqual({});
    expect(chatReducer(state, { type: 'clear' })).toBe(emptyChat);
  });
});

describe('visible streams', () => {
  it('keeps the live text after a refusal reply while the task runs, and hides it after the final reply of a completed or failed task', () => {
    let state = chatReducer(emptyChat, { type: 'delta', delta: delta(0, 'Working') });
    state = chatReducer(state, { type: 'notice', notice: notice(3, agent(ids.taskC, ids.taskA)), conversationId });
    const rows = (status?: 'running' | 'completed' | 'failed' | 'blocked') => visibleStreams(state.streams, () => status);
    expect(rows('running')).toEqual([{ taskId: ids.taskA, text: 'Working' }]);
    expect(rows(undefined)).toHaveLength(1);
    expect(rows('blocked')).toHaveLength(1);
    expect(rows('completed')).toEqual([]);
    expect(rows('failed')).toEqual([]);
    state = chatReducer(state, { type: 'delta', delta: delta(1, ' more') });
    expect(rows('completed')).toEqual([{ taskId: ids.taskA, text: 'Working more' }]);
  });

  it('lists the newest stream first and leaves out a stream with no text', () => {
    let streams = applyDelta({}, delta(0, 'Old'));
    streams = applyDelta(streams, delta(0, 'New', 1, callA, ids.taskB));
    streams = applyDelta(streams, delta(0, '', 1, callA, ids.taskC));
    expect(visibleStreams(streams, () => 'running').map((row) => row.taskId)).toEqual([ids.taskB, ids.taskA]);
  });
});

describe('topics', () => {
  const base = ['tasks', 'budget', `conversation:${conversationId}`];

  it('subscribes a task while its owner message waits for a reply, or while the task is not ended', () => {
    const thread = [agent(ids.taskC, ids.taskA), owner(ids.taskB, 2, ids.taskA), owner(ids.taskC, 2, ids.taskB)];
    expect(chatTopics(conversationId, thread, () => undefined)).toEqual([...base, `task:${ids.taskB}`]);
    expect(chatTopics(conversationId, thread, (taskId) => (taskId === ids.taskA ? 'running' : 'completed'))).toEqual([...base, `task:${ids.taskA}`, `task:${ids.taskB}`]);
    expect(chatTopics(conversationId, thread, () => 'blocked')).toEqual([...base, `task:${ids.taskB}`]);
    expect(chatTopics(conversationId, [{ role: 'owner' }], () => undefined)).toEqual(base);
  });

  it('keeps the total at 50 topics with the newest tasks', () => {
    const many = Array.from({ length: 60 }, (_, n) => ({ role: 'owner' as const, taskId: `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000` }));
    const topics = chatTopics(conversationId, many, () => undefined);
    expect(topics).toHaveLength(50);
    expect(topics[3]).toBe(`task:${many[0]!.taskId}`);
  });
});
