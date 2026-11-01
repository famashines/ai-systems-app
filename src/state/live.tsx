import { BudgetMonthV1, Id, TaskListItemV1 } from '@famashines/ai-systems-contracts';
import * as Crypto from 'expo-crypto';
import { createContext, useContext, useEffect, useEffectEvent, useReducer, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { z } from 'zod';

import * as api from '@/lib/api';
import * as auth from '@/lib/auth';
import { getItem, removeItem, setItem } from '@/lib/cache';
import { config } from '@/lib/config';
import { chatReducer, chatTopics, emptyChat, sortMessages, visibleStreams, type ChatMessage } from '@/lib/chat';
import { LiveClient, type AuthLost, type LiveStatus, type Notice } from '@/lib/live';
import { useSession } from '@/state/session';

export const tasksCacheKey = 'live.tasks';
export const slowAfterMs = 10_000;
export const updatedShowMs = 3_000;
export const cachedTasksMax = 200;
export const reloadDelayMs = 500;
export const conversationKey = 'chat.conversationId';

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
export type Message = { key: string; text: string; newTask: boolean; state: MessageState; slow: boolean; messageId?: string; taskId?: string };
export type Load = 'idle' | 'loading' | 'error';
export type StreamRow = { taskId: string; text: string };
type Budget = { doc: BudgetMonthV1 | null; load: Load; loaded: boolean };

type Value = {
  status: LiveStatus;
  online: boolean;
  updated: boolean;
  tasks: Task[];
  updatedAt: number | null;
  snapshot: Load;
  more: Load;
  hasMore: boolean;
  reload: () => void;
  loadMore: () => void;
  reconnect: () => void;
  pending: Message[];
  streams: StreamRow[];
  thread: ChatMessage[];
  threadLoad: Load;
  threadMore: Load;
  threadLoaded: boolean;
  loadOlder: () => void;
  reloadThread: () => void;
  send: (text: string, newTask: boolean) => void;
  retry: (key: string) => void;
  budget: Budget;
  reloadBudget: () => void;
};

const LiveContext = createContext<Value | null>(null);

async function conversationOf(): Promise<string> {
  const cached = await getItem<unknown>(conversationKey).catch(() => null);
  const known = Id.safeParse(cached?.value);
  if (known.success) return known.data;
  const fresh = Crypto.randomUUID();
  await setItem(conversationKey, fresh).catch(() => {});
  return fresh;
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const signedIn = session.status === 'signedIn';
  const [tasks, dispatch] = useReducer(tasksReducer, empty);
  const [chat, dispatchChat] = useReducer(chatReducer, emptyChat);
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const [updated, setUpdated] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<Load>('idle');
  const [more, setMore] = useState<Load>('idle');
  const [threadLoad, setThreadLoad] = useState<Load>('idle');
  const [threadMore, setThreadMore] = useState<Load>('idle');
  const [budget, setBudget] = useState<Budget>({ doc: null, load: 'idle', loaded: false });
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const client = useRef<LiveClient | null>(null);
  const conversation = useRef<string | null>(null);
  const run = useRef(0);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const budgetRuns = useRef<{ loading: number | null; again: boolean }>({ loading: null, again: false });

  const loadTasks = async () => {
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
  const loadThread = async () => {
    const mine = run.current;
    const id = conversation.current;
    if (!id) return;
    setThreadLoad('loading');
    try {
      const page = await api.getThread(id);
      if (mine !== run.current) return;
      dispatchChat({ type: 'page', items: page.items, first: true });
      setThreadLoad('idle');
    } catch {
      if (mine === run.current) setThreadLoad('error');
    }
  };
  const loadBudget = async (): Promise<void> => {
    const runs = budgetRuns.current;
    const mine = run.current;
    if (runs.loading === mine) {
      runs.again = true;
      return;
    }
    runs.loading = mine;
    setBudget((current) => ({ ...current, load: 'loading' }));
    try {
      const doc = await api.getBudget();
      if (mine === run.current) setBudget({ doc, load: 'idle', loaded: true });
    } catch {
      if (mine === run.current) setBudget((current) => ({ ...current, load: 'error' }));
    } finally {
      if (runs.loading === mine) runs.loading = null;
      if (runs.again && mine === run.current) {
        runs.again = false;
        void loadBudget();
      }
    }
  };
  const load = () => Promise.all([loadTasks(), loadThread(), loadBudget()]);
  const reloads = useRef<{ timer?: ReturnType<typeof setTimeout>; running: boolean; again: boolean }>({ running: false, again: false });
  const reload = () => {
    const state = reloads.current;
    if (state.running) state.again = true;
    if (state.running || state.timer) return;
    state.timer = setTimeout(() => {
      state.timer = undefined;
      state.running = true;
      void load().finally(() => {
        state.running = false;
        if (!state.again) return;
        state.again = false;
        reload();
      });
    }, reloadDelayMs);
  };
  const subscribed = useEffectEvent((needed: boolean) => {
    if (needed) void loadTasks();
    if (needed || !chat.loaded) void loadThread();
    if (needed || !budget.loaded) void loadBudget();
  });
  const reloadSnapshot = useEffectEvent(reload);
  const authLost = useEffectEvent((reason: AuthLost) => void session.signOut(reason === 'refused' ? 'refused' : undefined).catch(() => {}));
  const noticed = useEffectEvent((notice: Notice) => {
    dispatch({ type: 'notice', notice });
    if (notice.topic === 'tasks') return;
    if (notice.topic === 'budget') {
      const month = BudgetMonthV1.safeParse(notice.data);
      if (!month.success || month.data.month !== notice.docId) return;
      const shown = budget.doc;
      if (!shown || notice.docId > shown.month) void loadBudget();
      else if (notice.docId === shown.month) setBudget((current) => (current.doc && notice.rev > current.doc.rev ? { ...current, doc: { ...month.data, rev: notice.rev } } : current));
      return;
    }
    const id = conversation.current;
    if (!id) return;
    dispatchChat({ type: 'notice', notice, conversationId: id });
    const { commandId } = notice;
    if (commandId && notice.topic === `conversation:${id}`) setMessages((list) => list.map((message) => (message.key === commandId ? { ...message, messageId: notice.docId } : message)));
  });

  useEffect(() => {
    run.current += 1;
    const mine = run.current;
    const pending = timers.current;
    const reloadState = reloads.current;
    const budgetState = budgetRuns.current;
    if (session.status !== 'signedIn') {
      if (session.status === 'signedOut') void removeItem(tasksCacheKey).catch(() => {});
      return;
    }
    let live: LiveClient | null = null;
    void Promise.all([getItem<unknown>(tasksCacheKey).catch(() => null), conversationOf()]).then(([cached, id]) => {
      if (mine !== run.current) return;
      conversation.current = id;
      setConversationId(id);
      const parsed = CachedTasks.safeParse(cached?.value);
      if (parsed.success && cached) {
        dispatch({ type: 'cache', items: parsed.data.items, lastSeq: parsed.data.lastSeq });
        setUpdatedAt(cached.updatedAt);
      }
      live = new LiveClient({
        url: config.wsUrl,
        topics: chatTopics(id, [], () => undefined),
        lastSeq: parsed.success ? parsed.data.lastSeq : null,
        getToken: auth.getAccessToken,
        refresh: auth.refresh,
        onStatus: setStatus,
        onSubscribed: (needed, lastSeq) => {
          dispatch({ type: 'subscribed', lastSeq, snapshot: needed });
          subscribed(needed);
        },
        onResync: () => {
          dispatch({ type: 'resync' });
          reloadSnapshot();
        },
        onNotice: (notice) => noticed(notice),
        onDelta: ({ taskId, callId, attempt, i, text }) => dispatchChat({ type: 'delta', delta: { taskId, callId, attempt, i, text } }),
        onUnsubscribed: (topics) => dispatchChat({ type: 'unsubscribed', topics }),
        onAuthLost: (reason) => authLost(reason),
      });
      client.current = live;
      auth.onAccessToken((token) => live?.reauth(token));
      live.start();
    });
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      auth.resumeRefresh();
      live?.wake();
    });
    return () => {
      run.current += 1;
      subscription.remove();
      auth.onAccessToken(() => {});
      live?.stop();
      client.current = null;
      conversation.current = null;
      for (const handle of pending.values()) clearTimeout(handle);
      pending.clear();
      clearTimeout(reloadState.timer);
      reloadState.timer = undefined;
      reloadState.again = false;
      budgetState.loading = null;
      budgetState.again = false;
      dispatch({ type: 'clear' });
      dispatchChat({ type: 'clear' });
      setMessages([]);
      setConversationId(null);
      setStatus('connecting');
      setUpdatedAt(null);
      setSnapshot('idle');
      setMore('idle');
      setThreadLoad('idle');
      setThreadMore('idle');
      setBudget({ doc: null, load: 'idle', loaded: false });
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

  const thread = sortMessages(chat.items);
  const pendingRows = messages.filter((message) => !(message.messageId && message.messageId in chat.items)).reverse();
  const topics = conversationId
    ? chatTopics(conversationId, [...pendingRows.map((message) => ({ role: 'owner' as const, taskId: message.taskId })), ...thread], (taskId) => tasks.items[taskId]?.status)
    : [];
  const topicsKey = topics.join(' ');
  useEffect(() => {
    if (topicsKey) client.current?.setTopics(topicsKey.split(' ') as typeof topics);
  }, [topicsKey]);

  const patch = (key: string, change: Partial<Message>) => setMessages((list) => list.map((message) => (message.key === key ? { ...message, ...change } : message)));

  const submit = async (key: string, text: string, newTask: boolean) => {
    const mine = run.current;
    const id = conversation.current;
    if (!id) return;
    clearTimeout(timers.current.get(key));
    timers.current.set(
      key,
      setTimeout(() => patch(key, { slow: true }), slowAfterMs),
    );
    try {
      const result = await api.postMessage(id, text, newTask, key, () => {
        if (mine === run.current) patch(key, { state: 'waiting' });
      });
      if (mine === run.current) patch(key, { state: 'sending', messageId: result.messageId, ...(result.taskId ? { taskId: result.taskId } : {}) });
    } catch (error) {
      if (mine !== run.current) return;
      clearTimeout(timers.current.get(key));
      patch(key, { state: error instanceof api.ApiError && error.kind === 'rejected' ? 'rejected' : 'failed', slow: false });
    }
  };

  const online = signedIn && status === 'live';
  const sorted = sortTasks(tasks.items);
  const streams = visibleStreams(chat.streams, (taskId) => tasks.items[taskId]?.status);

  const value: Value = {
    status,
    online,
    updated,
    tasks: sorted,
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
    pending: pendingRows,
    streams,
    thread,
    threadLoad,
    threadMore,
    threadLoaded: chat.loaded,
    reloadThread: () => void loadThread(),
    loadOlder: () => {
      const id = conversation.current;
      const cursor = chat.cursor;
      if (!id || !cursor || !online || !chat.hasMore || threadMore === 'loading') return;
      const mine = run.current;
      setThreadMore('loading');
      api
        .getThread(id, cursor)
        .then((page) => {
          if (mine !== run.current) return;
          dispatchChat({ type: 'page', items: page.items, first: false });
          setThreadMore('idle');
        })
        .catch(() => {
          if (mine === run.current) setThreadMore('error');
        });
    },
    send: (text, newTask) => {
      const trimmed = text.trim();
      if (!trimmed || !online) return;
      const key = Crypto.randomUUID();
      setMessages((list) => [...list, { key, text: trimmed, newTask, state: 'sending', slow: false }]);
      void submit(key, trimmed, newTask);
    },
    retry: (key) => {
      const message = messages.find((item) => item.key === key);
      if (!message || !online || message.state !== 'failed') return;
      patch(key, { state: 'sending', slow: false });
      void submit(key, message.text, message.newTask);
    },
    budget,
    reloadBudget: () => void loadBudget(),
  };
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): Value {
  const value = useContext(LiveContext);
  if (!value) throw new Error('useLive needs a LiveProvider');
  return value;
}
