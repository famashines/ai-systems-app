import { ConversationMessageV1, WsLimits, type DeltaV1, type TaskStatus, type Topic } from '@famashines/ai-systems-contracts';

import type { Page } from '@/lib/api';
import type { Notice } from '@/lib/live';

export type ChatMessage = ConversationMessageV1;
export type Messages = Record<string, ChatMessage>;
export type Delta = { taskId: string; callId: string } & DeltaV1;
type Call = { attempt: number; parts: Record<number, string> };
export type Stream = { calls: Record<string, Call>; hidden: boolean };
export type Streams = Record<string, Stream>;
export type ChatState = { items: Messages; streams: Streams; cursor: Page | null; hasMore: boolean; loaded: boolean };

export type ChatAction =
  | { type: 'page'; items: ChatMessage[]; first: boolean }
  | { type: 'notice'; notice: Notice; conversationId: string }
  | { type: 'delta'; delta: Delta }
  | { type: 'unsubscribed'; topics: Topic[] }
  | { type: 'clear' };

export const emptyChat: ChatState = { items: {}, streams: {}, cursor: null, hasMore: false, loaded: false };

const baseTopics = 3;
const closed = new Set<TaskStatus>(['blocked', 'completed', 'failed', 'cancelled', 'rejected']);
const ended = new Set<TaskStatus>(['completed', 'failed']);

export function sortMessages(items: Messages): ChatMessage[] {
  return Object.values(items).sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.messageId < b.messageId ? 1 : a.messageId > b.messageId ? -1 : 0),
  );
}

export function streamText(stream: Stream): string {
  return Object.values(stream.calls)
    .map((call) => Object.values(call.parts).join(''))
    .filter(Boolean)
    .join('\n\n');
}

export function applyDelta(streams: Streams, { taskId, callId, attempt, i, text }: Delta): Streams {
  const stream = streams[taskId] ?? { calls: {}, hidden: false };
  const call = stream.calls[callId];
  if (call && attempt < call.attempt) return streams;
  const parts = { ...(call?.attempt === attempt ? call.parts : {}), [i]: text };
  return { ...streams, [taskId]: { calls: { ...stream.calls, [callId]: { attempt, parts } }, hidden: false } };
}

function hideReplied(streams: Streams, before: Messages, added: ChatMessage[]): Streams {
  let next = streams;
  for (const message of added) {
    if (message.role !== 'agent' || message.messageId in before) continue;
    const stream = next[message.taskId];
    if (stream && !stream.hidden) next = { ...next, [message.taskId]: { ...stream, hidden: true } };
  }
  return next;
}

function merge(items: Messages, page: ChatMessage[]): Messages {
  const next = { ...items };
  for (const item of page) {
    const current = next[item.messageId];
    if (!current || item.rev >= current.rev) next[item.messageId] = item;
  }
  return next;
}

function fromNotice(state: ChatState, notice: Notice, conversationId: string): ChatMessage | null {
  if (notice.topic !== `conversation:${conversationId}`) return null;
  const message = ConversationMessageV1.safeParse(notice.data);
  if (!message.success || message.data.messageId !== notice.docId) return null;
  const current = state.items[notice.docId];
  if (current && notice.rev <= current.rev) return null;
  return { ...message.data, rev: notice.rev };
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'page': {
      const last = action.items.at(-1);
      const keep = action.first && state.loaded && action.items.some((item) => item.messageId in state.items);
      const base = action.first && !keep ? {} : state.items;
      return {
        ...state,
        items: merge(base, action.items),
        streams: hideReplied(state.streams, state.items, action.items),
        cursor: keep ? state.cursor : last ? { before: last.createdAt, beforeId: last.messageId } : action.first ? null : state.cursor,
        hasMore: keep ? state.hasMore : action.items.length > 0,
        loaded: true,
      };
    }
    case 'notice': {
      const message = fromNotice(state, action.notice, action.conversationId);
      if (!message) return state;
      return { ...state, items: { ...state.items, [message.messageId]: message }, streams: hideReplied(state.streams, state.items, [message]) };
    }
    case 'delta':
      return { ...state, streams: applyDelta(state.streams, action.delta) };
    case 'unsubscribed': {
      const streams = { ...state.streams };
      for (const topic of action.topics) if (topic.startsWith('task:')) delete streams[topic.slice('task:'.length)];
      return { ...state, streams };
    }
    case 'clear':
      return emptyChat;
  }
}

export function visibleStreams(streams: Streams, status: (taskId: string) => TaskStatus | undefined): { taskId: string; text: string }[] {
  return Object.entries(streams)
    .filter(([taskId, stream]) => {
      const now = status(taskId);
      return !stream.hidden || now === undefined || !ended.has(now);
    })
    .map(([taskId, stream]) => ({ taskId, text: streamText(stream) }))
    .filter((row) => row.text)
    .reverse();
}

export function chatTopics(conversationId: string, newestFirst: { role: 'owner' | 'agent'; taskId?: string }[], status: (taskId: string) => TaskStatus | undefined): Topic[] {
  const latest = new Map<string, 'owner' | 'agent'>();
  for (const { role, taskId } of newestFirst) if (taskId && !latest.has(taskId)) latest.set(taskId, role);
  const open = [...latest]
    .filter(([taskId, role]) => {
      const now = status(taskId);
      return role === 'owner' || (now !== undefined && !closed.has(now));
    })
    .map(([taskId]): Topic => `task:${taskId}`);
  return ['tasks', 'budget', `conversation:${conversationId}`, ...open.slice(0, WsLimits.maxTopics - baseTopics)];
}
