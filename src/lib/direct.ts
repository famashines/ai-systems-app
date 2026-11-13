import type { ReasoningEffort } from '@famashines/ai-systems-contracts';
import * as Crypto from 'expo-crypto';
import { fetch as streamFetch } from 'expo/fetch';
import { z } from 'zod';

import { ApiError, changeChat, chatListMax, chatMessages, chatTitle, deleteChat, listChats, type ServerChat, type ServerMessage } from '@/lib/api';
import * as auth from '@/lib/auth';
import * as cache from '@/lib/cache';
import { config } from '@/lib/config';

export const idleTimeoutMs = 45_000;
export const notifyMs = 50;

export type DirectError = 'network' | 'unauthorized' | 'rateLimited' | 'budget' | 'tooLong' | 'failed';
export type DirectState = 'streaming' | 'done' | 'stopped' | 'error';
export type DirectMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  state: DirectState;
  error?: DirectError;
  costMicroUsd?: number;
  cut?: boolean;
};
export type Choice = { model?: string; effort?: ReasoningEffort };
export type ChatSummary = { chatId: string; title: string; updatedAt: number; bookmarked?: boolean; titled?: 'model' | 'owner'; synced?: boolean };
export type NameChat = (chatId: string, messages: { role: 'user' | 'assistant'; content: string }[]) => Promise<string>;
export type DirectChat = { chatId: string | null; messages: DirectMessage[]; busy: boolean; history: ChatSummary[] };
export type Storage = Pick<typeof cache, 'getItem' | 'setItem' | 'removeItem'>;
export type ChatChange = { title?: string; bookmarked?: boolean };
export type Remote = {
  list: () => Promise<ServerChat[]>;
  messages: (chatId: string) => Promise<ServerMessage[]>;
  change: (chatId: string, change: ChatChange) => Promise<void>;
  remove: (chatId: string) => Promise<void>;
};
type Pending = { kind: 'delete'; chatId: string } | { kind: 'change'; chatId: string; change: ChatChange };

const remote: Remote = { list: listChats, messages: chatMessages, change: changeChat, remove: deleteChat };

export const historyKey = 'direct.history';
export const pendingKey = 'direct.pending';
export const historyMax = 50;
export const titleMax = 80;
export const autoTitleMax = 40;
export const titleInputMax = 2000;
const chatKey = (chatId: string) => `direct.chat.${chatId}`;
const newestFirst = (items: ChatSummary[]) => [...items].sort((a, b) => b.updatedAt - a.updatedAt);
const bookmarksFirst = (items: ChatSummary[]) => [...newestFirst(items.filter((item) => item.bookmarked)), ...newestFirst(items.filter((item) => !item.bookmarked))];

const StreamEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('delta'), text: z.string() }),
  z.object({ type: z.literal('done'), finishReason: z.string(), costMicroUsd: z.int().nonnegative() }),
  z.object({ type: z.literal('error'), errorClass: z.string(), costMicroUsd: z.int().nonnegative() }),
]);
type Event = z.infer<typeof StreamEvent>;

export function parseEvents(buffer: string): { events: Event[]; rest: string } {
  const blocks = buffer.split(/\r?\n\r?\n/);
  const rest = blocks.pop() ?? '';
  const events: Event[] = [];
  for (const block of blocks) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('');
    if (!data) continue;
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      continue;
    }
    const event = StreamEvent.safeParse(json);
    if (event.success) events.push(event.data);
  }
  return { events, rest };
}

export function statusError(status: number): DirectError {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 413) return 'tooLong';
  if (status === 429) return 'rateLimited';
  return 'failed';
}

type Body = { chatId: string; model: string; effort?: ReasoningEffort; messages: { role: 'user' | 'assistant'; content: string }[] };
type Outcome = { state: 'done'; costMicroUsd: number; cut: boolean } | { state: 'error'; error: DirectError; costMicroUsd?: number };

async function open(body: Body, signal: AbortSignal, renew: boolean): Promise<Response> {
  const token = renew ? ((await auth.refresh()) ? await auth.getAccessToken() : null) : await auth.getAccessToken();
  if (!token) return new Response(null, { status: 401 });
  return streamFetch(`${config.apiUrl}/api/chat`, {
    method: 'POST',
    headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal,
  }) as unknown as Promise<Response>;
}

export async function streamChat(body: Body, signal: AbortSignal, onDelta: (text: string) => void, idleMs = idleTimeoutMs): Promise<Outcome> {
  const idle = new AbortController();
  const both = AbortSignal.any([signal, idle.signal]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const alive = () => {
    clearTimeout(timer);
    timer = setTimeout(() => idle.abort(), idleMs);
  };
  try {
    alive();
    let response = await open(body, both, false);
    if (response.status === 401) response = await open(body, both, true);
    if (!response.ok || !response.body) return { state: 'error', error: statusError(response.status) };
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      alive();
      const parsed = parseEvents(buffer + decoder.decode(value, { stream: true }));
      buffer = parsed.rest;
      for (const event of parsed.events) {
        if (event.type === 'delta') onDelta(event.text);
        else if (event.type === 'done') return { state: 'done', costMicroUsd: event.costMicroUsd, cut: event.finishReason === 'length' };
        else return { state: 'error', error: event.errorClass === 'budget_refused' ? 'budget' : 'failed', costMicroUsd: event.costMicroUsd };
      }
    }
    return { state: 'error', error: 'network' };
  } catch {
    return { state: 'error', error: 'network' };
  } finally {
    clearTimeout(timer);
  }
}

export function autoTitle(text: string): string {
  const line = (text.trim().split('\n')[0] ?? '').replace(/\s+/g, ' ');
  if (line.length <= autoTitleMax) return line;
  const cut = line.slice(0, autoTitleMax);
  const space = cut.lastIndexOf(' ');
  return `${(space > autoTitleMax / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:!?-]+$/, '')}…`;
}

export function history(messages: DirectMessage[]): Body['messages'] {
  return messages.filter((message) => message.text.trim() !== '' && (message.role === 'user' || message.state !== 'error')).map(({ role, text }) => ({ role, content: text }));
}

type Listener = () => void;

export function createDirectStore(
  run: typeof streamChat = streamChat,
  newId: () => string = () => Crypto.randomUUID(),
  now: () => number = Date.now,
  storage: Storage = cache,
  nameChat: NameChat = chatTitle,
  server: Remote = remote,
) {
  let state: DirectChat = { chatId: null, messages: [], busy: false, history: [] };
  let abort: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<Listener>();
  const tried = new Set<string>();
  let pending: Pending[] = [];
  let flushing: Promise<boolean> | null = null;
  let generation = 0;
  let opening = 0;

  const emit = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    for (const listener of listeners) listener();
  };
  const set = (next: DirectChat, soon = false) => {
    state = next;
    if (!soon) emit();
    else if (!timer) timer = setTimeout(emit, notifyMs);
  };
  const patch = (id: string, change: (message: DirectMessage) => DirectMessage, soon = false) => {
    set({ ...state, messages: state.messages.map((message) => (message.id === id ? change(message) : message)) }, soon);
  };

  function save() {
    const { chatId, messages } = state;
    const first = messages.find((message) => message.role === 'user');
    if (!chatId || !first) return;
    const old = state.history.find((item) => item.chatId === chatId);
    const current: ChatSummary = { ...old, chatId, title: old?.title ?? autoTitle(first.text), updatedAt: now() };
    const others = bookmarksFirst(state.history.filter((item) => item.chatId !== chatId));
    const kept = others.slice(0, historyMax - 1);
    const dropped = others.slice(historyMax - 1);
    set({ ...state, history: bookmarksFirst([current, ...kept]) });
    void Promise.all([
      storage.setItem(chatKey(chatId), messages),
      storage.setItem(historyKey, state.history),
      ...dropped.map((item) => storage.removeItem(chatKey(item.chatId))),
    ]).catch(() => {});
  }

  async function drain(): Promise<boolean> {
    while (pending[0]) {
      const op = pending[0];
      try {
        await (op.kind === 'delete' ? server.remove(op.chatId) : server.change(op.chatId, op.change));
      } catch (error) {
        if (!(error instanceof ApiError && error.kind === 'rejected')) return false;
      }
      pending = pending.filter((item) => item !== op);
      await storage.setItem(pendingKey, pending).catch(() => {});
    }
    return true;
  }

  function flush(): Promise<boolean> {
    flushing ??= drain().finally(() => {
      flushing = null;
    });
    return flushing;
  }

  function enqueue(op: Pending) {
    generation += 1;
    pending = [...pending, op];
    void storage
      .setItem(pendingKey, pending)
      .catch(() => {})
      .then(flush);
  }

  function merge(remoteItems: ServerChat[]) {
    const local = new Map(state.history.map((item) => [item.chatId, item]));
    const seen = new Set(remoteItems.map((item) => item.chatId));
    const oldest = remoteItems.length > 0 ? Math.min(...remoteItems.map((item) => Date.parse(item.updatedAt))) : Number.POSITIVE_INFINITY;
    const complete = remoteItems.length < chatListMax;
    const changes: Pending[] = [];
    const fromServer = remoteItems.map((item): ChatSummary => {
      const mine = local.get(item.chatId);
      const updatedAt = Math.max(Date.parse(item.updatedAt), mine?.updatedAt ?? 0);
      if (mine && !mine.synced) {
        const renamed = mine.titled === 'owner' && mine.title !== item.title;
        const bookmarked = !!mine.bookmarked && !item.bookmarked;
        if (renamed || bookmarked) changes.push({ kind: 'change', chatId: item.chatId, change: { ...(renamed ? { title: mine.title } : {}), ...(bookmarked ? { bookmarked: true } : {}) } });
        const titled = mine.titled === 'owner' ? 'owner' : item.titled;
        return { chatId: item.chatId, title: mine.titled === 'owner' ? mine.title : (item.title ?? mine.title), updatedAt, bookmarked: item.bookmarked || !!mine.bookmarked, ...(titled ? { titled } : {}), synced: true };
      }
      return { chatId: item.chatId, title: item.title ?? mine?.title ?? '', updatedAt, bookmarked: item.bookmarked, ...(item.titled ? { titled: item.titled } : {}), synced: true };
    });
    const kept = state.history.filter((item) => !seen.has(item.chatId) && !(item.synced && (complete || item.updatedAt >= oldest)));
    const all = bookmarksFirst([...bookmarksFirst(fromServer).slice(0, Math.max(0, historyMax - kept.length)), ...kept]);
    const dropped = state.history.filter((item) => !all.some((entry) => entry.chatId === item.chatId));
    if (state.chatId && dropped.some((item) => item.chatId === state.chatId)) {
      abort?.abort();
      abort = null;
      state = { ...state, chatId: null, messages: [], busy: false };
    }
    set({ ...state, history: all });
    void Promise.all([storage.setItem(historyKey, state.history), ...dropped.map((item) => storage.removeItem(chatKey(item.chatId)))]).catch(() => {});
    for (const change of changes) enqueue(change);
  }

  async function fetchMessages(chatId: string): Promise<DirectMessage[] | null> {
    const items = await server.messages(chatId).catch(() => null);
    if (!items || items.length === 0) return null;
    return items.map(
      (item): DirectMessage => ({
        id: `${chatId}:${item.seq}`,
        role: item.role,
        text: item.text,
        createdAt: item.createdAt,
        state: item.role === 'assistant' ? (item.state ?? 'done') : 'done',
        ...(item.costMicroUsd === undefined ? {} : { costMicroUsd: item.costMicroUsd }),
      }),
    );
  }

  function adopt(chatId: string, messages: DirectMessage[]) {
    set({ ...state, chatId, messages, busy: false });
    const first = messages.find((message) => message.role === 'user');
    const item = state.history.find((entry) => entry.chatId === chatId);
    if (item && !item.title && first) edit(chatId, (entry) => ({ ...entry, title: autoTitle(first.text) }));
    void storage.setItem(chatKey(chatId), messages).catch(() => {});
  }

  function edit(chatId: string, change: (item: ChatSummary) => ChatSummary) {
    set({ ...state, history: bookmarksFirst(state.history.map((item) => (item.chatId === chatId ? change(item) : item))) });
    void storage.setItem(historyKey, state.history).catch(() => {});
  }

  function name(chatId: string) {
    const item = state.history.find((entry) => entry.chatId === chatId);
    const question = state.messages.find((message) => message.role === 'user');
    const reply = state.messages.find((message) => message.role === 'assistant' && message.state === 'done' && message.text.trim() !== '');
    if (!item || item.titled || !question || tried.has(chatId)) return;
    tried.add(chatId);
    const messages = [{ role: 'user' as const, content: question.text.slice(0, titleInputMax) }, ...(reply ? [{ role: 'assistant' as const, content: reply.text.slice(0, titleInputMax) }] : [])];
    void nameChat(chatId, messages)
      .then((title) => {
        const current = state.history.find((entry) => entry.chatId === chatId);
        if (current && !current.titled) edit(chatId, (entry) => ({ ...entry, title: title.slice(0, titleMax), titled: 'model' }));
      })
      .catch(() => {});
  }

  async function answer(choice: Choice) {
    if (!choice.model) return;
    const id = newId();
    const chatId = state.chatId ?? newId();
    const body: Body = { chatId, model: choice.model, ...(choice.effort ? { effort: choice.effort } : {}), messages: history(state.messages) };
    const mine = new AbortController();
    abort = mine;
    set({ ...state, chatId, busy: true, messages: [...state.messages, { id, role: 'assistant', text: '', createdAt: new Date(now()).toISOString(), state: 'streaming' }] });
    const outcome = await run(body, mine.signal, (text) => {
      if (state.chatId === chatId) patch(id, (message) => ({ ...message, text: message.text + text }), true);
    });
    if (state.chatId !== chatId) return;
    if (abort === mine) abort = null;
    const stopped = mine.signal.aborted;
    state = { ...state, busy: false };
    patch(id, (message) =>
      stopped
        ? { ...message, state: 'stopped' }
        : outcome.state === 'done'
          ? { ...message, state: 'done', costMicroUsd: outcome.costMicroUsd, cut: outcome.cut }
          : { ...message, state: 'error', error: outcome.error, ...(outcome.costMicroUsd ? { costMicroUsd: outcome.costMicroUsd } : {}) },
    );
    save();
    if (outcome.state === 'done' && !stopped) name(chatId);
  }

  return {
    get: () => state,
    subscribe: (listener: Listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    send(text: string, choice: Choice) {
      const trimmed = text.trim();
      if (!trimmed || state.busy || !choice.model) return;
      set({ ...state, chatId: state.chatId ?? newId(), messages: [...state.messages, { id: newId(), role: 'user', text: trimmed, createdAt: new Date(now()).toISOString(), state: 'done' }] });
      save();
      void answer(choice);
    },
    regenerate(choice: Choice) {
      const last = state.messages.at(-1);
      if (state.busy || !choice.model || !last) return;
      if (last.role === 'assistant') set({ ...state, messages: state.messages.slice(0, -1) });
      void answer(choice);
    },
    stop() {
      abort?.abort();
    },
    clear() {
      opening += 1;
      abort?.abort();
      abort = null;
      set({ ...state, chatId: null, messages: [], busy: false });
    },
    async load() {
      const asked = generation;
      const [stored, queued] = await Promise.all([storage.getItem<ChatSummary[]>(historyKey).catch(() => null), storage.getItem<Pending[]>(pendingKey).catch(() => null)]);
      if (asked !== generation) return;
      set({ ...state, history: stored?.value ?? [] });
      if (pending.length === 0) pending = queued?.value ?? [];
      if (!(await flush())) return;
      const items = await server.list().catch(() => null);
      if (items && pending.length === 0 && asked === generation) merge(items);
    },
    async open(chatId: string) {
      const ticket = (opening += 1);
      const stored = await storage.getItem<DirectMessage[]>(chatKey(chatId)).catch(() => null);
      if (ticket !== opening) return;
      if (!stored) {
        if (!state.history.some((item) => item.chatId === chatId)) return;
        const fetched = await fetchMessages(chatId);
        if (!fetched || ticket !== opening) return;
        abort?.abort();
        abort = null;
        adopt(chatId, fetched);
        return;
      }
      abort?.abort();
      abort = null;
      const local = stored.value.map((message) => (message.state === 'streaming' ? { ...message, state: 'stopped' as const } : message));
      set({ ...state, chatId, messages: local, busy: false });
      const shown = state.messages;
      const fetched = await fetchMessages(chatId);
      if (fetched && ticket === opening && state.chatId === chatId && state.messages === shown && fetched.length >= history(local).length) adopt(chatId, fetched);
    },
    remove(chatId: string) {
      if (state.chatId === chatId) {
        abort?.abort();
        abort = null;
        state = { ...state, chatId: null, messages: [], busy: false };
      }
      set({ ...state, history: state.history.filter((item) => item.chatId !== chatId) });
      void Promise.all([storage.removeItem(chatKey(chatId)), storage.setItem(historyKey, state.history)]).catch(() => {});
      enqueue({ kind: 'delete', chatId });
    },
    rename(chatId: string, title: string) {
      const trimmed = title.trim().slice(0, titleMax);
      if (!trimmed) return;
      edit(chatId, (item) => ({ ...item, title: trimmed, titled: 'owner' }));
      enqueue({ kind: 'change', chatId, change: { title: trimmed } });
    },
    bookmark(chatId: string) {
      const bookmarked = !state.history.find((item) => item.chatId === chatId)?.bookmarked;
      edit(chatId, (item) => ({ ...item, bookmarked }));
      enqueue({ kind: 'change', chatId, change: { bookmarked } });
    },
    forget() {
      const old = state.history;
      abort?.abort();
      abort = null;
      generation += 1;
      opening += 1;
      set({ chatId: null, messages: [], busy: false, history: [] });
      pending = pending.filter((op) => op.kind === 'delete');
      void Promise.all([storage.removeItem(historyKey), storage.setItem(pendingKey, pending), ...old.map((item) => storage.removeItem(chatKey(item.chatId)))]).catch(() => {});
    },
  };
}

export const direct = createDirectStore();
