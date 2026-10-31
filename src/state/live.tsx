import { TaskListItemV1, type Topic } from '@famashines/ai-systems-contracts';
import * as Crypto from 'expo-crypto';
import { createContext, useContext, useEffect, useEffectEvent, useReducer, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { z } from 'zod';

import * as api from '@/lib/api';
import * as auth from '@/lib/auth';
import { getItem, removeItem, setItem } from '@/lib/cache';
import { config } from '@/lib/config';
import { LiveClient, type AuthLost, type LiveStatus, type Notice } from '@/lib/live';
import { useSession } from '@/state/session';

export const tasksCacheKey = 'live.tasks';
export const slowAfterMs = 10_000;
export const updatedShowMs = 3_000;
export const cachedTasksMax = 200;
const topics: Topic[] = ['tasks'];

const CachedTasks = z.object({ items: z.array(TaskListItemV1), lastSeq: z.int().nonnegative() });

type Task = TaskListItemV1;
type Items = Record<string, Task>;
type TasksState = { items: Items; lastSeq: number | null; synced: boolean; fresh: boolean; hasMore: boolean };

type Action =
  | { type: 'cache'; items: Task[]; lastSeq: number }
  | { type: 'subscribed'; lastSeq: number; snapshot: boolean }
  | { type: 'page'; items: Task[]; hasMore: boolean; first: boolean }
  | { type: 'notice'; notice: Notice }
  | { type: 'resync' }
  | { type: 'clear' };

const empty: TasksState = { items: {}, lastSeq: null, synced: false, fresh: false, hasMore: false };

export function sortTasks(items: Items): Task[] {
  return Object.values(items).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.taskId < b.taskId ? 1 : a.taskId > b.taskId ? -1 : 0));
}

export function mergePage(items: Items, page: Task[]): Items {
  const next = { ...items };
  for (const item of page) {
    const current = next[item.taskId];
    if (!current || item.rev >= current.rev) next[item.taskId] = item;
  }
  return next;
}

export function applyNotice(items: Items, notice: Notice): Items {
  if (notice.topic !== 'tasks') return items;
  const item = TaskListItemV1.safeParse(notice.data);
  if (!item.success || item.data.taskId !== notice.docId) return items;
  const current = items[notice.docId];
  if (current && notice.rev <= current.rev) return items;
  return { ...items, [notice.docId]: { ...item.data, rev: notice.rev } };
}

export function tasksReducer(state: TasksState, action: Action): TasksState {
  switch (action.type) {
    case 'cache':
      return { items: mergePage({}, action.items), lastSeq: action.lastSeq, synced: true, fresh: false, hasMore: true };
    case 'subscribed':
      return { ...state, lastSeq: action.lastSeq, synced: state.synced && !action.snapshot };
    case 'page':
      return { ...state, items: mergePage(state.items, action.items), hasMore: action.hasMore, synced: state.synced || action.first, fresh: true };
    case 'notice':
      return { ...state, items: applyNotice(state.items, action.notice), lastSeq: action.notice.seq, fresh: true };
    case 'resync':
      return { ...state, lastSeq: null, synced: false };
    case 'clear':
      return empty;
  }
}

export type MessageState = 'sending' | 'waiting' | 'failed' | 'rejected';
export type Message = { key: string; text: string; state: MessageState; slow: boolean; taskId?: string };
export type Load = 'idle' | 'loading' | 'error';

type Value = {
  status: LiveStatus;
  online: boolean;
  updated: boolean;
  tasks: Task[];
  known: (taskId: string | undefined) => boolean;
  updatedAt: number | null;
  snapshot: Load;
  more: Load;
  hasMore: boolean;
  reload: () => void;
  loadMore: () => void;
  reconnect: () => void;
  messages: Message[];
  send: (text: string) => void;
  retry: (key: string) => void;
};

const LiveContext = createContext<Value | null>(null);

export function LiveProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const signedIn = session.status === 'signedIn';
  const [tasks, dispatch] = useReducer(tasksReducer, empty);
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const [updated, setUpdated] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<Load>('idle');
  const [more, setMore] = useState<Load>('idle');
  const [messages, setMessages] = useState<Message[]>([]);
  const client = useRef<LiveClient | null>(null);
  const run = useRef(0);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const load = async () => {
    const mine = run.current;
    setSnapshot('loading');
    try {
      const page = await api.listTasks();
      if (mine !== run.current) return;
      dispatch({ type: 'page', items: page.items, hasMore: page.items.length === api.pageSize, first: true });
      setSnapshot('idle');
    } catch {
      if (mine === run.current) setSnapshot('error');
    }
  };
  const loadSnapshot = useEffectEvent(() => void load());
  const authLost = useEffectEvent((reason: AuthLost) => void session.signOut(reason === 'refused' ? 'refused' : undefined).catch(() => {}));

  useEffect(() => {
    run.current += 1;
    const mine = run.current;
    const pending = timers.current;
    if (session.status !== 'signedIn') {
      if (session.status === 'signedOut') void removeItem(tasksCacheKey).catch(() => {});
      return;
    }
    let live: LiveClient | null = null;
    void getItem<unknown>(tasksCacheKey)
      .catch(() => null)
      .then((cached) => {
        if (mine !== run.current) return;
        const parsed = CachedTasks.safeParse(cached?.value);
        if (parsed.success && cached) {
          dispatch({ type: 'cache', items: parsed.data.items, lastSeq: parsed.data.lastSeq });
          setUpdatedAt(cached.updatedAt);
        }
        live = new LiveClient({
          url: config.wsUrl,
          topics,
          lastSeq: parsed.success ? parsed.data.lastSeq : null,
          getToken: auth.getAccessToken,
          refresh: auth.refresh,
          onStatus: setStatus,
          onSubscribed: (needed, lastSeq) => {
            dispatch({ type: 'subscribed', lastSeq, snapshot: needed });
            if (needed) loadSnapshot();
          },
          onResync: () => {
            dispatch({ type: 'resync' });
            loadSnapshot();
          },
          onNotice: (notice) => {
            dispatch({ type: 'notice', notice });
            const { commandId } = notice;
            if (commandId) setMessages((list) => list.map((message) => (message.key === commandId ? { ...message, taskId: notice.docId } : message)));
          },
          onAuthLost: (reason) => authLost(reason),
        });
        client.current = live;
        auth.onAccessToken((token) => live?.reauth(token));
        live.start();
      });
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') live?.wake();
    });
    return () => {
      run.current += 1;
      subscription.remove();
      auth.onAccessToken(() => {});
      live?.stop();
      client.current = null;
      for (const handle of pending.values()) clearTimeout(handle);
      pending.clear();
      dispatch({ type: 'clear' });
      setMessages([]);
      setStatus('connecting');
      setUpdatedAt(null);
      setSnapshot('idle');
      setMore('idle');
    };
  }, [session.status]);

  useEffect(() => {
    if (!tasks.synced || !tasks.fresh || tasks.lastSeq === null) return;
    const mine = run.current;
    void setItem(tasksCacheKey, { items: sortTasks(tasks.items).slice(0, cachedTasksMax), lastSeq: tasks.lastSeq })
      .then(() => {
        if (mine === run.current) setUpdatedAt(Date.now());
      })
      .catch(() => {});
  }, [tasks]);

  const previous = useRef(status);
  useEffect(() => {
    const was = previous.current;
    previous.current = status;
    if (status !== 'live' || was !== 'reconnecting') return;
    setUpdated(true);
    const handle = setTimeout(() => setUpdated(false), updatedShowMs);
    return () => clearTimeout(handle);
  }, [status]);

  const patch = (key: string, change: Partial<Message>) => setMessages((list) => list.map((message) => (message.key === key ? { ...message, ...change } : message)));

  const submit = async (key: string, text: string) => {
    const mine = run.current;
    clearTimeout(timers.current.get(key));
    timers.current.set(
      key,
      setTimeout(() => patch(key, { slow: true }), slowAfterMs),
    );
    try {
      const result = await api.submitTask(text, key, () => {
        if (mine === run.current) patch(key, { state: 'waiting' });
      });
      if (mine === run.current) patch(key, { state: 'sending', taskId: result.taskId });
    } catch (error) {
      if (mine !== run.current) return;
      clearTimeout(timers.current.get(key));
      patch(key, { state: error instanceof api.ApiError && error.kind === 'rejected' ? 'rejected' : 'failed', slow: false });
    }
  };

  const online = signedIn && status === 'live';
  const sorted = sortTasks(tasks.items);

  const value: Value = {
    status,
    online,
    updated,
    tasks: sorted,
    known: (taskId) => taskId !== undefined && taskId in tasks.items,
    updatedAt,
    snapshot,
    more,
    hasMore: tasks.hasMore,
    reload: () => void load(),
    reconnect: () => client.current?.wake(),
    loadMore: () => {
      const last = sorted.at(-1);
      if (!last || !online || !tasks.hasMore || more === 'loading') return;
      const mine = run.current;
      setMore('loading');
      api
        .listTasks({ before: last.createdAt, beforeId: last.taskId })
        .then((page) => {
          if (mine !== run.current) return;
          dispatch({ type: 'page', items: page.items, hasMore: page.items.length === api.pageSize, first: false });
          setMore('idle');
        })
        .catch(() => {
          if (mine === run.current) setMore('error');
        });
    },
    messages,
    send: (text) => {
      const trimmed = text.trim();
      if (!trimmed || !online) return;
      const key = Crypto.randomUUID();
      setMessages((list) => [...list, { key, text: trimmed, state: 'sending', slow: false }]);
      void submit(key, trimmed);
    },
    retry: (key) => {
      const message = messages.find((item) => item.key === key);
      if (!message || !online || message.state !== 'failed') return;
      patch(key, { state: 'sending', slow: false });
      void submit(key, message.text);
    },
  };
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): Value {
  const value = useContext(LiveContext);
  if (!value) throw new Error('useLive needs a LiveProvider');
  return value;
}
