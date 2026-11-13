import type { ReasoningEffort } from '@famashines/ai-systems-contracts';
import * as Crypto from 'expo-crypto';
import { fetch as streamFetch } from 'expo/fetch';
import { z } from 'zod';

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
export type ChatSummary = { chatId: string; title: string; updatedAt: number };
export type DirectChat = { chatId: string | null; messages: DirectMessage[]; busy: boolean; history: ChatSummary[] };
export type Storage = Pick<typeof cache, 'getItem' | 'setItem' | 'removeItem'>;

export const historyKey = 'direct.history';
export const historyMax = 50;
export const titleMax = 80;
const chatKey = (chatId: string) => `direct.chat.${chatId}`;

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

export function history(messages: DirectMessage[]): Body['messages'] {
  return messages.filter((message) => message.text.trim() !== '' && (message.role === 'user' || message.state !== 'error')).map(({ role, text }) => ({ role, content: text }));
}

type Listener = () => void;

export function createDirectStore(
  run: typeof streamChat = streamChat,
  newId: () => string = () => Crypto.randomUUID(),
  now: () => number = Date.now,
  storage: Storage = cache,
) {
  let state: DirectChat = { chatId: null, messages: [], busy: false, history: [] };
  let abort: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<Listener>();

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
    const history = [{ chatId, title: first.text.slice(0, titleMax), updatedAt: now() }, ...state.history.filter((item) => item.chatId !== chatId)];
    const dropped = history.slice(historyMax);
    set({ ...state, history: history.slice(0, historyMax) });
    void Promise.all([
      storage.setItem(chatKey(chatId), messages),
      storage.setItem(historyKey, state.history),
      ...dropped.map((item) => storage.removeItem(chatKey(item.chatId))),
    ]).catch(() => {});
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
      abort?.abort();
      abort = null;
      set({ ...state, chatId: null, messages: [], busy: false });
    },
    async load() {
      const stored = await storage.getItem<ChatSummary[]>(historyKey).catch(() => null);
      set({ ...state, history: stored?.value ?? [] });
    },
    async open(chatId: string) {
      const stored = await storage.getItem<DirectMessage[]>(chatKey(chatId)).catch(() => null);
      if (!stored) return;
      abort?.abort();
      abort = null;
      const messages = stored.value.map((message) => (message.state === 'streaming' ? { ...message, state: 'stopped' as const } : message));
      set({ ...state, chatId, messages, busy: false });
    },
    remove(chatId: string) {
      if (state.chatId === chatId) {
        abort?.abort();
        abort = null;
        state = { ...state, chatId: null, messages: [], busy: false };
      }
      set({ ...state, history: state.history.filter((item) => item.chatId !== chatId) });
      void Promise.all([storage.removeItem(chatKey(chatId)), storage.setItem(historyKey, state.history)]).catch(() => {});
    },
    forget() {
      const old = state.history;
      abort?.abort();
      abort = null;
      set({ chatId: null, messages: [], busy: false, history: [] });
      void Promise.all([storage.removeItem(historyKey), ...old.map((item) => storage.removeItem(chatKey(item.chatId)))]).catch(() => {});
    },
  };
}

export const direct = createDirectStore();
