import { Id } from '@famashines/ai-systems-contracts';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { reloadAppAsync } from 'expo';
import * as LocalAuthentication from 'expo-local-authentication';
import { useLocales } from 'expo-localization';
import type { ReactElement } from 'react';
import { AppState, I18nManager, Text, type AppStateStatus } from 'react-native';

import Budget from '@/app/(tabs)/budget';
import Chat from '@/app/(tabs)/index';
import Settings from '@/app/(tabs)/settings';
import Tasks from '@/app/(tabs)/tasks';
import Login from '@/app/login';
import TaskScreen from '@/app/task/[id]';
import { router } from 'expo-router';
import { redirectSystemPath } from '@/app/+native-intent';
import { LockScreen } from '@/components/lock-screen';
import { Button, StateView } from '@/components/ui';
import * as auth from '@/lib/auth';
import { getItem, removeItem, setItem } from '@/lib/cache';
import { cachedTasksMax, conversationKey, LiveProvider, reloadDelayMs, slowAfterMs, tasksCacheKey, updatedShowMs, useLive } from '@/state/live';
import { SessionProvider, useSession } from '@/state/session';
import { SettingsProvider } from '@/state/settings';
import { agentIds, detail, FakeSocket, fakeServer, ids, installFakeSocket, json, subtaskIds, task } from '@/test-fakes';

jest.mock('expo', () => ({ ...jest.requireActual<object>('expo'), reloadAppAsync: jest.fn(async () => {}) }));

const mockParams: { id?: string; edit?: string } = {};
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) },
  useLocalSearchParams: () => mockParams,
}));

jest.mock('expo-constants', () => ({ expoConfig: { version: '0.1.0' } }));

jest.mock('@/lib/auth', () => {
  const actual = jest.requireActual<typeof import('@/lib/auth')>('@/lib/auth');
  return {
    IssuerUnreachableError: actual.IssuerUnreachableError,
    restore: jest.fn(async () => true),
    signIn: jest.fn(async () => true),
    signOut: jest.fn(async () => {}),
    onSessionEnded: jest.fn(),
    onAccessToken: jest.fn(),
    resumeRefresh: jest.fn(),
    getAccessToken: jest.fn(),
    refresh: jest.fn(async () => true),
  };
});

jest.mock('expo-crypto', () => ({ randomUUID: () => jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID() }));

function Probe() {
  const { status, locked } = useSession();
  return <Text>{`${status} ${locked ? 'locked' : 'open'}`}</Text>;
}

async function show(ui: ReactElement) {
  await render(
    <SessionProvider>
      <SettingsProvider>
        <LiveProvider>{ui}</LiveProvider>
      </SettingsProvider>
    </SessionProvider>,
  );
}

beforeEach(async () => {
  jest.clearAllMocks();
  await removeItem('settings');
  await removeItem('rtlReload');
  await removeItem('lock.reloadAt');
  await removeItem(tasksCacheKey);
  await setItem(conversationKey, conversationId);
  installFakeSocket();
  jest.mocked(auth.getAccessToken).mockImplementation(() => new Promise(() => {}));
  jest.mocked(auth.refresh).mockResolvedValue(true);
  jest.mocked(useLocales).mockReturnValue([{ languageCode: 'en' } as ReturnType<typeof useLocales>[number]]);
  jest.mocked(LocalAuthentication.authenticateAsync).mockResolvedValue({ success: true });
  jest.mocked(LocalAuthentication.getEnrolledLevelAsync).mockResolvedValue(LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG);
  jest.spyOn(I18nManager, 'forceRTL').mockImplementation(() => {});
  jest.spyOn(I18nManager, 'allowRTL').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Login', () => {
  it('shows the sign-in button with a 48 dp touch target', async () => {
    await show(<Login />);
    const button = await screen.findByRole('button', { name: 'Sign in' });
    expect(button).toHaveStyle({ minHeight: 48 });
    expect(screen.getByText('Sign in with your famashines account.')).toBeOnTheScreen();
  });

  it('shows the busy state while the browser is open', async () => {
    let finish = (_value: boolean) => {};
    jest.mocked(auth.signIn).mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await show(<Login />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('button', { name: 'Signing in' })).toBeBusy();
    await act(async () => finish(true));
  });

  it('shows a clear error when the issuer is unreachable', async () => {
    jest.mocked(auth.signIn).mockRejectedValue(new auth.IssuerUnreachableError('down'));
    await show(<Login />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach the login server. Check the connection and try again.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });

  it('shows a different error when the sign-in fails', async () => {
    jest.mocked(auth.signIn).mockRejectedValue(new Error('invalid_request'));
    await show(<Login />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in did not complete. Try again.');
  });

  it('is in Urdu and sets right to left on an Urdu device', async () => {
    jest.mocked(useLocales).mockReturnValue([{ languageCode: 'ur' } as ReturnType<typeof useLocales>[number]]);
    await show(<Login />);
    expect(await screen.findByRole('button', { name: 'سائن ان کریں' })).toBeOnTheScreen();
    expect(I18nManager.forceRTL).toHaveBeenLastCalledWith(true);
    expect(I18nManager.allowRTL).toHaveBeenLastCalledWith(true);
  });

  it.each([
    ['en', 'Your session ended. Sign in again.'],
    ['de', 'Ihre Sitzung ist beendet. Melden Sie sich erneut an.'],
    ['ur', 'آپ کا سیشن ختم ہو گیا۔ دوبارہ سائن ان کریں۔'],
  ])('tells in %s that the session ended when the server refuses the refresh token', async (languageCode, text) => {
    jest.mocked(useLocales).mockReturnValue([{ languageCode } as ReturnType<typeof useLocales>[number]]);
    await show(<Login />);
    const ended = jest.mocked(auth.onSessionEnded).mock.calls.at(-1)![0];
    await act(async () => ended());
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
  });
});

describe('Lock', () => {
  it('asks for biometrics or the device credential when it opens', async () => {
    jest.mocked(LocalAuthentication.authenticateAsync).mockResolvedValue({ success: false, error: 'user_cancel' });
    await show(<LockScreen />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Unlock did not complete. Try again.');
    expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledWith({ promptMessage: 'Unlock Fama AI' });
  });

  it('asks again from the retry button', async () => {
    jest.mocked(LocalAuthentication.authenticateAsync).mockResolvedValue({ success: false, error: 'user_cancel' });
    await show(<LockScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('alert')).toBeOnTheScreen();
    expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledTimes(2);
  });

  it('signs out from the lock screen and shows the busy state', async () => {
    jest.mocked(LocalAuthentication.authenticateAsync).mockResolvedValue({ success: false, error: 'user_cancel' });
    let finish = () => {};
    jest.mocked(auth.signOut).mockReturnValueOnce(new Promise<void>((resolve) => (finish = resolve)));
    await show(<LockScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Sign out' }));
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeBusy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDisabled();
    await act(async () => finish());
  });

  it('shows an error when the sign-out from the lock screen fails', async () => {
    jest.mocked(LocalAuthentication.authenticateAsync).mockResolvedValue({ success: false, error: 'user_cancel' });
    jest.mocked(auth.signOut).mockRejectedValueOnce(new Error('disk'));
    await show(<LockScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText('Sign-out did not complete. Try again.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
  });
});

const api = 'https://ai.famashines.com';
const conversationId = 'd4444444-4444-4444-8444-444444444444';
const threadRoute = `GET /api/conversations/${conversationId}/messages`;
const postRoute = `POST /api/conversations/${conversationId}/messages`;
let server: ReturnType<typeof fakeServer>;

async function socketNumber(n: number): Promise<FakeSocket> {
  await waitFor(() => expect(FakeSocket.all.length).toBeGreaterThanOrEqual(n));
  return FakeSocket.all[n - 1]!;
}

async function connect(n = 1, fromSeq = 11): Promise<FakeSocket> {
  const socket = await socketNumber(n);
  await act(async () => {
    socket.open();
    socket.receive({ type: 'welcome', sessionId: ids.session, headSeq: fromSeq - 1, heartbeatMs: 20_000 });
    socket.receive({ type: 'subscribed', topics: ['tasks'], fromSeq });
  });
  return socket;
}

async function receive(socket: FakeSocket, seq: number, item: ReturnType<typeof task>, commandId?: string) {
  await act(async () => socket.receive({ type: 'notice', seq, topic: 'tasks', docId: item.taskId, rev: item.rev, data: item, ...(commandId ? { commandId } : {}) }));
}

const tasksCalls = () => server.requests.filter((request) => request.method === 'GET' && request.path === '/api/tasks');
const posts = () => server.requests.filter((request) => request.method === 'POST');

describe('Live', () => {
  beforeEach(() => {
    server = fakeServer(api);
    jest.mocked(auth.getAccessToken).mockResolvedValue('access-1');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Tasks', () => {
    it('subscribes first, waits for subscribed, then reads the snapshot', async () => {
      server.on('GET /api/tasks', json(200, { items: [task(ids.taskA, 1, 'Plan the week')], headSeq: 10 }));
      await show(<Tasks />);
      const socket = await socketNumber(1);
      expect(screen.getByLabelText('Loading tasks')).toBeOnTheScreen();
      await act(async () => {
        socket.open();
        socket.receive({ type: 'welcome', sessionId: ids.session, headSeq: 10, heartbeatMs: 20_000 });
      });
      expect(socket.sent.map((frame) => frame.type)).toEqual(['hello', 'subscribe']);
      expect(socket.sent[0]).toEqual({ type: 'hello', v: 1, token: 'access-1' });
      expect(socket.sent[1]).toEqual({ type: 'subscribe', topics: ['tasks', 'budget', `conversation:${conversationId}`] });
      expect(tasksCalls()).toHaveLength(0);
      await act(async () => socket.receive({ type: 'subscribed', topics: ['tasks'], fromSeq: 11 }));
      expect(await screen.findByText('Plan the week')).toBeOnTheScreen();
      expect(tasksCalls()).toHaveLength(1);
      expect(tasksCalls()[0]!.headers.get('Authorization')).toBe('Bearer access-1');
    });

    it('applies notices by docId and rev, also a notice that comes before the snapshot answer', async () => {
      let answer = (_response: Response) => {};
      server.on('GET /api/tasks', () => new Promise<Response>((resolve) => (answer = resolve)));
      await show(<Tasks />);
      const socket = await connect();
      await receive(socket, 11, task(ids.taskA, 2, 'Plan v2'));
      await act(async () => answer(json(200, { items: [task(ids.taskA, 1, 'Plan v1'), task(ids.taskB, 1, 'Other', '2026-10-30T10:00:00.000Z')], headSeq: 10 })));
      expect(await screen.findByText('Plan v2')).toBeOnTheScreen();
      expect(screen.queryByText('Plan v1')).toBeNull();

      await receive(socket, 12, task(ids.taskA, 2, 'Same rev'));
      await receive(socket, 13, task(ids.taskA, 1, 'Older rev'));
      await receive(socket, 13, task(ids.taskA, 9, 'Old seq'));
      await receive(socket, 14, task(ids.taskB, 2, 'Other v2', '2026-10-30T10:00:00.000Z'));
      await receive(socket, 15, task(ids.taskC, 1, 'Newest', '2026-10-31T11:00:00.000Z'));
      expect(screen.getByText('Plan v2')).toBeOnTheScreen();
      expect(screen.queryByText('Same rev')).toBeNull();
      expect(screen.queryByText('Older rev')).toBeNull();
      expect(screen.queryByText('Old seq')).toBeNull();
      expect(screen.getAllByText(/^(Newest|Plan v2|Other v2)$/).map((node) => node.props.children)).toEqual(['Newest', 'Plan v2', 'Other v2']);
      await waitFor(async () => expect((await getItem<{ lastSeq: number }>(tasksCacheKey))?.value.lastSeq).toBe(15));
    });

    it('shows the empty state', async () => {
      server.on('GET /api/tasks', json(200, { items: [], headSeq: 10 }));
      await show(<Tasks />);
      await connect();
      expect(await screen.findByText('No tasks yet.')).toBeOnTheScreen();
      expect(screen.getByText('Tasks that you start in the chat show here.')).toBeOnTheScreen();
    });

    it('shows the error state and reads again from the retry button', async () => {
      server.on('GET /api/tasks', json(503, { type: 'about:blank', title: 'Down', status: 503, code: 'unavailable' }), json(200, { items: [task(ids.taskA, 1, 'Back')], headSeq: 10 }));
      await show(<Tasks />);
      await connect();
      expect(await screen.findByText('The tasks did not load.')).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByText('Back')).toBeOnTheScreen();
    });

    it('reads the next page with before and beforeId of the last task', async () => {
      const page = Array.from({ length: 50 }, (_, i) => task(`${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`, 1, `Task ${i}`, new Date(Date.UTC(2026, 9, 31, 10, 0, 59 - i)).toISOString()));
      const last = page.at(-1)!;
      server.on('GET /api/tasks', json(200, { items: page, headSeq: 10 }), json(200, { items: [task(ids.taskC, 1, 'Oldest', '2026-10-01T00:00:00.000Z')], headSeq: 10 }));
      await show(<Tasks />);
      await connect();
      await screen.findByText('Task 0');
      await act(async () => fireEvent(screen.getByTestId('tasks-list'), 'onEndReached'));
      await waitFor(() => expect(tasksCalls()).toHaveLength(2));
      expect(Object.fromEntries(tasksCalls()[1]!.query)).toEqual({ limit: '50', before: last.createdAt, beforeId: last.taskId });
      await act(async () => fireEvent(screen.getByTestId('tasks-list'), 'onEndReached'));
      expect(tasksCalls()).toHaveLength(2);
    });

    it('shows the cached list offline with the time of the last update, and resumes from the cached lastSeq', async () => {
      await setItem(tasksCacheKey, { items: [task(ids.taskA, 3, 'Cached task')], lastSeq: 42 }, Date.UTC(2026, 9, 31, 9, 5));
      await show(<Tasks />);
      expect(await screen.findByText('Cached task')).toBeOnTheScreen();
      expect(screen.getByText(/^Offline, last update \d{2}:\d{2}/)).toBeOnTheScreen();
      const socket = await connect(1, 43);
      expect(socket.sent[0]).toEqual({ type: 'hello', v: 1, token: 'access-1', lastSeq: 42 });
      expect(screen.queryByText(/^Offline/)).toBeNull();
      expect(tasksCalls()).toHaveLength(0);
    });

    it('loads the snapshot again when fromSeq is higher than lastSeq + 1', async () => {
      await setItem(tasksCacheKey, { items: [task(ids.taskA, 1, 'Cached task')], lastSeq: 42 });
      server.on('GET /api/tasks', json(200, { items: [task(ids.taskA, 4, 'Fresh task')], headSeq: 90 }));
      await show(<Tasks />);
      await connect(1, 91);
      expect(await screen.findByText('Fresh task')).toBeOnTheScreen();
      expect(tasksCalls()).toHaveLength(1);
    });

    it('loads the snapshot again after resync', async () => {
      await setItem(tasksCacheKey, { items: [task(ids.taskA, 1, 'Cached task')], lastSeq: 42 });
      server.on('GET /api/tasks', json(200, { items: [task(ids.taskA, 1, 'Rebuilt task')], headSeq: 3 }));
      await show(<Tasks />);
      const socket = await socketNumber(1);
      await act(async () => {
        socket.open();
        socket.receive({ type: 'welcome', sessionId: ids.session, headSeq: 3, heartbeatMs: 20_000 });
        socket.receive({ type: 'resync', reason: 'too_old' });
        socket.receive({ type: 'subscribed', topics: ['tasks'], fromSeq: 4 });
      });
      expect(await screen.findByText('Rebuilt task')).toBeOnTheScreen();
      await receive(socket, 4, task(ids.taskB, 1, 'After resync'));
      expect(await screen.findByText('After resync')).toBeOnTheScreen();
    });

    it('shows the reconnecting bar, then updated, and sends lastSeq after the reconnect', async () => {
      jest.useFakeTimers();
      jest.spyOn(Math, 'random').mockReturnValue(0);
      server.on('GET /api/tasks', json(200, { items: [task(ids.taskA, 1, 'Plan')], headSeq: 10 }));
      await show(<Tasks />);
      const first = await connect();
      await receive(first, 11, task(ids.taskB, 1, 'Live one'));
      await act(async () => first.serverClose(1006));
      expect(screen.getByText('Reconnecting')).toBeOnTheScreen();
      expect(screen.getByText(/^Offline, last update/)).toBeOnTheScreen();
      expect(screen.getByText('Live one')).toBeOnTheScreen();
      await act(async () => jest.advanceTimersByTime(1_000));
      const second = await connect(2, 12);
      expect(second.sent[0]).toEqual({ type: 'hello', v: 1, token: 'access-1', lastSeq: 11 });
      expect(screen.getByText('Updated')).toBeOnTheScreen();
      await act(async () => jest.advanceTimersByTime(updatedShowMs));
      expect(screen.queryByText('Updated')).toBeNull();
      expect(tasksCalls()).toHaveLength(1);
    });

    it('shows the offline state when there is no cache and no connection', async () => {
      await show(<Tasks />);
      const socket = await socketNumber(1);
      await act(async () => socket.serverClose(1006));
      expect(await screen.findByText('Offline. The tasks show when the connection is back.')).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
      await socketNumber(2);
    });

    it('signs out when the token cannot be renewed after 4401', async () => {
      jest.mocked(auth.refresh).mockResolvedValue(false);
      server.on('GET /api/tasks', json(200, { items: [], headSeq: 10 }));
      await show(<Tasks />);
      const socket = await connect();
      await act(async () => socket.serverClose(4401));
      await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1));
    });

    it('signs out with a clear message after 3 refused tokens in one minute', async () => {
      jest.useFakeTimers();
      jest.spyOn(Math, 'random').mockReturnValue(0);
      server.on('GET /api/tasks', json(200, { items: [], headSeq: 10 }));
      await show(
        <>
          <Tasks />
          <Login />
        </>,
      );
      for (const n of [1, 2, 3]) {
        const socket = await connect(n);
        await act(async () => socket.serverClose(4401));
        await act(async () => jest.advanceTimersByTime(1_000));
      }
      await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1));
      expect(await screen.findByText('The server did not accept your sign-in. Sign in again.')).toBeOnTheScreen();
    });

    it('loads the snapshot again on a resync during the session', async () => {
      server.on('GET /api/tasks', json(200, { items: [task(ids.taskA, 1, 'Before')], headSeq: 10 }), json(200, { items: [task(ids.taskA, 1, 'After restart')], headSeq: 2 }));
      await show(<Tasks />);
      const socket = await connect();
      await screen.findByText('Before');
      await act(async () => socket.receive({ type: 'resync', reason: 'too_old' }));
      expect(await screen.findByText('After restart')).toBeOnTheScreen();
      await receive(socket, 3, task(ids.taskB, 1, 'New stream'));
      expect(await screen.findByText('New stream')).toBeOnTheScreen();
    });

    it('reads the snapshot one time for a burst of bad notices', async () => {
      jest.useFakeTimers();
      let answer = (_response: Response) => {};
      server.on(
        'GET /api/tasks',
        json(200, { items: [], headSeq: 10 }),
        () => new Promise<Response>((resolve) => (answer = resolve)),
        json(200, { items: [task(ids.taskB, 1, 'Late')], headSeq: 12 }),
      );
      await show(<Tasks />);
      const socket = await connect();
      await waitFor(() => expect(tasksCalls()).toHaveLength(1));
      await act(async () => {
        for (let seq = 11; seq < 16; seq += 1) socket.receive(`{"type":"notice","seq":${seq},"topic":"tasks"}`);
      });
      await act(async () => jest.advanceTimersByTime(reloadDelayMs));
      expect(tasksCalls()).toHaveLength(2);
      await act(async () => {
        for (let seq = 16; seq < 19; seq += 1) socket.receive(`{"type":"notice","seq":${seq},"topic":"tasks"}`);
      });
      await act(async () => jest.advanceTimersByTime(reloadDelayMs * 4));
      expect(tasksCalls()).toHaveLength(2);
      await act(async () => answer(json(200, { items: [task(ids.taskA, 1, 'Fresh')], headSeq: 11 })));
      await act(async () => jest.advanceTimersByTime(reloadDelayMs));
      expect(tasksCalls()).toHaveLength(3);
      expect(await screen.findByText('Late')).toBeOnTheScreen();
    });

    it('keeps at most 200 tasks in the cache', async () => {
      const many = Array.from({ length: cachedTasksMax + 5 }, (_, i) => task(`${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`, 1, `Task ${i}`, new Date(Date.UTC(2026, 9, 31, 10, 0, 0, 1000 - i)).toISOString()));
      await setItem(tasksCacheKey, { items: many.slice(0, 50), lastSeq: 42 });
      server.on('GET /api/tasks', json(200, { items: many, headSeq: 90 }));
      await show(<Tasks />);
      await connect(1, 91);
      await waitFor(async () => expect((await getItem<{ items: unknown[] }>(tasksCacheKey))?.value.items).toHaveLength(cachedTasksMax));
      expect((await getItem<{ items: { title: string }[] }>(tasksCacheKey))?.value.items[0]!.title).toBe('Task 0');
    });

    it('sends reauth with a new token and ping when the app comes to the foreground', async () => {
      const handlers: ((state: AppStateStatus) => void)[] = [];
      jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
        handlers.push(handler);
        return { remove: () => {} };
      });
      const change = (state: AppStateStatus) => handlers.forEach((handler) => handler(state));
      server.on('GET /api/tasks', json(200, { items: [], headSeq: 10 }));
      await show(<Tasks />);
      const socket = await connect();
      const handler = jest.mocked(auth.onAccessToken).mock.calls.at(-1)![0];
      await act(async () => handler('access-2'));
      expect(socket.sent.at(-1)).toEqual({ type: 'reauth', token: 'access-2' });
      await act(async () => change('active'));
      expect(auth.resumeRefresh).toHaveBeenCalledTimes(1);
      expect(socket.sent.at(-1)).toMatchObject({ type: 'ping' });
    });

    it('clears the user data on sign-out and keeps the settings', async () => {
      server.on('GET /api/tasks', json(200, { items: [task(ids.taskA, 1, 'Private task')], headSeq: 10 }));
      await show(
        <>
          <Tasks />
          <Settings />
        </>,
      );
      await connect();
      await screen.findByText('Private task');
      await fireEvent.press(screen.getByRole('radio', { name: 'Dark' }));
      await waitFor(async () => expect(await getItem(tasksCacheKey)).not.toBeNull());
      const socket = FakeSocket.last();
      await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
      await waitFor(async () => expect(await getItem(tasksCacheKey)).toBeNull());
      expect(await getItem('settings')).toEqual(expect.objectContaining({ value: { language: 'system', theme: 'dark' } }));
      expect(socket.closedWith).toBe(1000);
      expect(screen.queryByText('Private task')).toBeNull();
    });

    it('shows the status in Urdu, right to left', async () => {
      jest.mocked(useLocales).mockReturnValue([{ languageCode: 'ur' } as ReturnType<typeof useLocales>[number]]);
      await setItem(tasksCacheKey, { items: [task(ids.taskA, 1, 'Plan')], lastSeq: 1 });
      await show(<Tasks />);
      expect(await screen.findByText(/^آف لائن، آخری اپ ڈیٹ/)).toBeOnTheScreen();
      expect(screen.getByText(/^جمع ہو گیا · /)).toBeOnTheScreen();
      expect(I18nManager.forceRTL).toHaveBeenLastCalledWith(true);
    });
  });

  describe('Chat', () => {
    const owner = (messageId: string, text: string, rev = 1, taskId?: string, createdAt = '2026-11-01T10:00:00.000Z') => ({
      role: 'owner' as const,
      messageId,
      text,
      intent: 'new_task' as const,
      createdAt,
      rev,
      asOf: 1,
      ...(taskId ? { taskId } : {}),
    });
    const agent = (messageId: string, taskId: string, text: string, costMicroUsd?: number, rev = 1) => ({
      role: 'agent' as const,
      messageId,
      taskId,
      text,
      createdAt: '2026-11-01T10:01:00.000Z',
      rev,
      asOf: 2,
      ...(costMicroUsd === undefined ? {} : { costMicroUsd }),
    });
    const said = async (socket: FakeSocket, seq: number, message: ReturnType<typeof owner> | ReturnType<typeof agent>, commandId?: string) =>
      act(async () =>
        socket.receive({ type: 'notice', seq, topic: `conversation:${conversationId}`, docId: message.messageId, rev: message.rev, data: message, ...(commandId ? { commandId } : {}) }),
      );
    const delta = async (socket: FakeSocket, attempt: number, i: number, text: string, taskId = ids.taskA) =>
      act(async () => socket.receive({ type: 'delta', taskId, callId: ids.taskC, attempt, i, text }));
    const posted = (messageId = ids.taskB) => json(202, { conversationId, messageId, intent: 'new_task' });
    const threadCalls = () => server.requests.filter((request) => request.method === 'GET' && request.path === `/api/conversations/${conversationId}/messages`);

    beforeEach(() => {
      server.on('GET /api/tasks', json(200, { items: [], headSeq: 10 }));
    });

    it('turns off the input, the new task switch and send while offline', async () => {
      await show(<Chat />);
      expect(await screen.findByText('No messages yet.')).toBeOnTheScreen();
      expect(screen.getByText('Offline. You can send when the connection is back.')).toBeOnTheScreen();
      expect(screen.getByLabelText('Message')).toHaveProp('editable', false);
      expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
      expect(screen.getByRole('switch', { name: 'New task' })).toBeDisabled();
    });

    it('reads the thread after subscribed, keeps one conversation id, and reads older pages until an empty page', async () => {
      const newest = owner(ids.taskA, 'Newest', 1, undefined, '2026-11-01T10:05:00.000Z');
      const older = owner(ids.taskB, 'Older', 1, undefined, '2026-11-01T09:00:00.000Z');
      server.on(threadRoute, json(200, { items: [newest], headSeq: 10 }), json(200, { items: [older], headSeq: 10 }), json(200, { items: [], headSeq: 10 }));
      await show(<Chat />);
      await connect();
      expect(await screen.findByText('Newest')).toBeOnTheScreen();
      expect(screen.getByLabelText('Newest. Received')).toBeOnTheScreen();
      expect(Object.fromEntries(threadCalls()[0]!.query)).toEqual({ limit: '50' });
      await act(async () => fireEvent(screen.getByTestId('chat-list'), 'onEndReached'));
      expect(await screen.findByText('Older')).toBeOnTheScreen();
      expect(Object.fromEntries(threadCalls()[1]!.query)).toEqual({ limit: '50', before: newest.createdAt, beforeId: ids.taskA });
      await act(async () => fireEvent(screen.getByTestId('chat-list'), 'onEndReached'));
      await waitFor(() => expect(threadCalls()).toHaveLength(3));
      expect(Object.fromEntries(threadCalls()[2]!.query)).toEqual({ limit: '50', before: older.createdAt, beforeId: ids.taskB });
      await act(async () => fireEvent(screen.getByTestId('chat-list'), 'onEndReached'));
      expect(threadCalls()).toHaveLength(3);
      expect((await getItem(conversationKey))?.value).toBe(conversationId);
    });

    it('clears the thread, live text, sent messages and budget on sign-out, and keeps the conversation id for the next sign-in', async () => {
      server.on('GET /api/tasks', json(200, { items: [task(ids.taskA, 1, 'Old task')], headSeq: 10 }));
      server.on(threadRoute, json(200, { items: [owner(ids.taskB, 'Old thread', 2, ids.taskA)], headSeq: 10 }));
      server.on('GET /api/budget', json(200, { month: '2026-11', capMicroUsd: 5_000_000, spentMicroUsd: 0, reservedMicroUsd: 0, remainingMicroUsd: 5_000_000, overCapMicroUsd: 0, rev: 1, asOf: 1 }));
      server.on(postRoute, new TypeError('Network request failed'));
      jest.mocked(auth.signIn).mockResolvedValue(true);
      await show(
        <>
          <Chat />
          <Budget />
          <Settings />
          <Login />
        </>,
      );
      const socket = await connect();
      await screen.findByText('Old thread');
      await screen.findByText('Month 2026-11');
      await delta(socket, 1, 0, 'Old stream');
      await fireEvent.changeText(screen.getByLabelText('Message'), 'Pending text');
      await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
      await screen.findByText('Not sent');
      expect(screen.getByText('Old stream')).toBeOnTheScreen();
      await waitFor(async () => expect(await getItem(tasksCacheKey)).not.toBeNull());
      await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
      await waitFor(async () => expect(await getItem(tasksCacheKey)).toBeNull());
      await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
      await socketNumber(2);
      for (const text of ['Old thread', 'Old stream', 'Pending text', 'Month 2026-11']) expect(screen.queryByText(text)).toBeNull();
      expect(screen.getByText('No messages yet.')).toBeOnTheScreen();
      expect(screen.getByLabelText('Loading the budget')).toBeOnTheScreen();
      expect((await getItem(conversationKey))?.value).toBe(conversationId);
    });

    it('makes and keeps a conversation id when the device has none', async () => {
      await removeItem(conversationKey);
      await show(<Chat />);
      const socket = await socketNumber(1);
      await act(async () => {
        socket.open();
        socket.receive({ type: 'welcome', sessionId: ids.session, headSeq: 10, heartbeatMs: 20_000 });
      });
      const made = (await getItem<string>(conversationKey))?.value;
      expect(Id.safeParse(made).success).toBe(true);
      expect(socket.sent[1]).toEqual({ type: 'subscribe', topics: ['tasks', 'budget', `conversation:${made}`] });
    });

    it('shows the error state of the thread and reads again from the retry button', async () => {
      server.on(threadRoute, json(503, { type: 'about:blank', title: 'Down', status: 503, code: 'unavailable' }), json(200, { items: [owner(ids.taskA, 'Back')], headSeq: 10 }));
      await show(<Chat />);
      await connect();
      expect(await screen.findByText('The messages did not load.')).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByText('Back')).toBeOnTheScreen();
    });

    it('shows a message as sending at once and as received when the notice with its commandId comes', async () => {
      server.on(threadRoute, json(200, { items: [], headSeq: 10 }));
      let answer = (_response: Response) => {};
      server.on(postRoute, () => new Promise<Response>((resolve) => (answer = resolve)));
      await show(<Chat />);
      const socket = await connect();
      await fireEvent.changeText(screen.getByLabelText('Message'), '  Plan the week  ');
      await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
      expect(screen.getByText('Plan the week')).toBeOnTheScreen();
      expect(screen.getByText('Sending')).toBeOnTheScreen();
      expect(screen.getByLabelText('Message')).toHaveProp('value', '');
      const post = posts()[0]!;
      const key = post.headers.get('Idempotency-Key')!;
      expect(Id.safeParse(key).success).toBe(true);
      expect(post.body).toEqual({ text: 'Plan the week', newTask: false });
      await said(socket, 11, owner(ids.taskB, 'Plan the week'), key);
      expect(screen.getByText('Received')).toBeOnTheScreen();
      expect(screen.getAllByText('Plan the week')).toHaveLength(1);
      await act(async () => answer(posted()));
      expect(screen.getByText('Received')).toBeOnTheScreen();
      expect(screen.getAllByText('Plan the week')).toHaveLength(1);
    });

    it('sends newTask true once when the new task switch is on', async () => {
      server.on(threadRoute, json(200, { items: [], headSeq: 10 }));
      server.on(postRoute, posted(ids.taskA), posted(ids.taskB));
      await show(<Chat />);
      await connect();
      await fireEvent.press(screen.getByRole('switch', { name: 'New task' }));
      expect(screen.getByRole('switch', { name: 'New task' })).toBeChecked();
      expect(screen.getByText('The next message starts a new task.')).toBeOnTheScreen();
      await fireEvent.changeText(screen.getByLabelText('Message'), 'Another topic');
      await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
      expect(screen.getByRole('switch', { name: 'New task' })).not.toBeChecked();
      await fireEvent.changeText(screen.getByLabelText('Message'), 'Follow up');
      await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
      await waitFor(() => expect(posts()).toHaveLength(2));
      expect(posts().map((request) => request.body)).toEqual([
        { text: 'Another topic', newTask: true },
        { text: 'Follow up', newTask: false },
      ]);
    });

    it('streams the deltas of the task, restarts on a new attempt, and replaces the text with the final reply and its cost', async () => {
      server.on(threadRoute, json(200, { items: [owner(ids.taskB, 'Write a poem')], headSeq: 10 }));
      await show(<Chat />);
      const socket = await connect();
      await screen.findByText('Write a poem');
      await said(socket, 11, owner(ids.taskB, 'Write a poem', 2, ids.taskA));
      expect(socket.sent.at(-1)).toEqual({ type: 'subscribe', topics: [`task:${ids.taskA}`] });
      await act(async () => socket.receive({ type: 'subscribed', topics: [`task:${ids.taskA}`], fromSeq: 30 }));
      expect(threadCalls()).toHaveLength(1);
      await delta(socket, 1, 0, 'Roses ');
      await delta(socket, 1, 1, 'are red');
      expect(screen.getByTestId(`stream-${ids.taskA}`)).toHaveTextContent('Roses are redWriting');
      expect(screen.getByTestId(`stream-${ids.taskA}`)).not.toHaveProp('accessibilityLiveRegion');
      await delta(socket, 2, 0, 'Violets');
      expect(screen.getByText('Violets')).toBeOnTheScreen();
      expect(screen.queryByText(/Roses/)).toBeNull();
      await delta(socket, 1, 2, ' late');
      expect(screen.getByText('Violets')).toBeOnTheScreen();
      await receive(socket, 12, task(ids.taskA, 2, 'Write a poem', undefined, 'running'));
      await said(socket, 13, agent(ids.taskC, ids.taskA, 'Violets are blue'));
      expect(screen.getByText('Violets are blue')).toBeOnTheScreen();
      expect(screen.getByTestId(`stream-${ids.taskA}`)).toBeOnTheScreen();
      await receive(socket, 14, task(ids.taskA, 3, 'Write a poem', undefined, 'completed'));
      expect(screen.queryByTestId(`stream-${ids.taskA}`)).toBeNull();
      await said(socket, 15, agent(ids.taskC, ids.taskA, 'Violets are blue', 1_234, 2));
      expect(screen.getByText('Cost $0.0012')).toBeOnTheScreen();
      expect(screen.getByLabelText('Agent: Violets are blue. Cost $0.0012')).toHaveProp('accessibilityLiveRegion', 'polite');
      expect(socket.sent.at(-1)).toEqual({ type: 'unsubscribe', topics: [`task:${ids.taskA}`] });
      await act(async () => socket.receive({ type: 'unsubscribed', topics: [`task:${ids.taskA}`] }));
      await delta(socket, 2, 1, ' stray');
      expect(screen.queryByTestId(`stream-${ids.taskA}`)).toBeNull();
    });

    it('keeps the task topic after a refusal reply while the task runs', async () => {
      server.on(threadRoute, json(200, { items: [agent(ids.taskC, ids.taskA, 'The task is running. Wait for it.'), owner(ids.taskB, 'Plan', 2, ids.taskA)], headSeq: 10 }));
      await show(<Chat />);
      const socket = await connect();
      await screen.findByText('The task is running. Wait for it.');
      expect(socket.sent.filter((frame) => frame.type === 'subscribe')).toHaveLength(1);
      await receive(socket, 11, task(ids.taskA, 2, 'Plan', undefined, 'running'));
      await waitFor(() => expect(socket.sent.at(-1)).toEqual({ type: 'subscribe', topics: [`task:${ids.taskA}`] }));
      await delta(socket, 1, 0, 'Still going');
      expect(screen.getByText('Still going')).toBeOnTheScreen();
      await said(socket, 12, agent('e5555555-5555-4555-8555-555555555555', ids.taskA, 'The task is running. Wait for it, again.'));
      expect(screen.getByText('Still going')).toBeOnTheScreen();
      await receive(socket, 13, task(ids.taskA, 3, 'Plan', undefined, 'completed'));
      expect(screen.queryByText('Still going')).toBeNull();
      expect(socket.sent.at(-1)).toEqual({ type: 'unsubscribe', topics: [`task:${ids.taskA}`] });
    });

    it('shows still processing after 10 s without the notice', async () => {
      jest.useFakeTimers();
      server.on(threadRoute, json(200, { items: [], headSeq: 10 }));
      server.on(postRoute, posted());
      await show(<Chat />);
      await connect();
      await fireEvent.changeText(screen.getByLabelText('Message'), 'Plan');
      await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
      await act(async () => jest.advanceTimersByTime(slowAfterMs - 1));
      expect(screen.getByText('Sending')).toBeOnTheScreen();
      await act(async () => jest.advanceTimersByTime(1));
      expect(screen.getByText('Still processing')).toBeOnTheScreen();
    });

    it('shows not sent on a network error, and the retry sends the same key', async () => {
      server.on(threadRoute, json(200, { items: [], headSeq: 10 }));
      server.on(postRoute, new TypeError('Network request failed'), posted());
      await show(<Chat />);
      await connect();
      await fireEvent.changeText(screen.getByLabelText('Message'), 'Plan');
      await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
      expect(await screen.findByText('Not sent')).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('button', { name: 'Send again' }));
      await waitFor(() => expect(posts()).toHaveLength(2));
      const [first, second] = posts().map((request) => request.headers.get('Idempotency-Key'));
      expect(second).toBe(first);
      expect(await screen.findByText('Sending')).toBeOnTheScreen();
    });

    it('keeps the thread and shows the error when a snapshot read fails', async () => {
      server.on(threadRoute, json(200, { items: [owner(ids.taskA, 'Kept')], headSeq: 10 }), json(503, { type: 'about:blank', title: 'Down', status: 503, code: 'unavailable' }));
      await show(<Chat />);
      const socket = await connect();
      await screen.findByText('Kept');
      await act(async () => socket.receive({ type: 'resync', reason: 'too_old' }));
      expect(await screen.findByText('The messages did not load.')).toBeOnTheScreen();
      expect(screen.getByText('Kept')).toBeOnTheScreen();
    });

    it('drops the sent message when the thread snapshot has its messageId', async () => {
      server.on(threadRoute, json(200, { items: [], headSeq: 10 }), json(200, { items: [owner(ids.taskB, 'Plan')], headSeq: 12 }));
      server.on(postRoute, posted());
      await show(<Chat />);
      const socket = await connect();
      await fireEvent.changeText(screen.getByLabelText('Message'), 'Plan');
      await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
      await waitFor(() => expect(posts()).toHaveLength(1));
      await act(async () => socket.receive({ type: 'resync', reason: 'too_old' }));
      expect(await screen.findByText('Received')).toBeOnTheScreen();
      expect(screen.getAllByText('Plan')).toHaveLength(1);
    });

    it('shows a refused message with no retry', async () => {
      server.on(threadRoute, json(200, { items: [], headSeq: 10 }));
      server.on(postRoute, json(422, { type: 'about:blank', title: 'Bad', status: 422, code: 'validation_failed' }));
      await show(<Chat />);
      await connect();
      await fireEvent.changeText(screen.getByLabelText('Message'), 'Plan');
      await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
      expect(await screen.findByText('The server did not accept this message.')).toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: 'Send again' })).toBeNull();
    });

    it('limits the input to 20000 characters and refuses a longer text with no retry', async () => {
      server.on(threadRoute, json(200, { items: [], headSeq: 10 }));
      await show(<Chat />);
      await connect();
      expect(screen.getByLabelText('Message')).toHaveProp('maxLength', 20_000);
      await fireEvent.changeText(screen.getByLabelText('Message'), 'x'.repeat(20_001));
      await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
      expect(await screen.findByText('The server did not accept this message.')).toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: 'Send again' })).toBeNull();
      expect(posts()).toHaveLength(0);
    });

    it('announces the status of a message', async () => {
      server.on(threadRoute, json(200, { items: [], headSeq: 10 }));
      server.on(postRoute, posted());
      await show(<Chat />);
      await connect();
      await fireEvent.changeText(screen.getByLabelText('Message'), 'Plan');
      await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
      expect(screen.getByLabelText('Plan. Sending')).toHaveProp('accessibilityLiveRegion', 'polite');
    });

    it('shows the wait while the service is not available', async () => {
      jest.useFakeTimers();
      jest.spyOn(Math, 'random').mockReturnValue(0);
      server.on(threadRoute, json(200, { items: [], headSeq: 10 }));
      server.on(postRoute, json(503, { type: 'about:blank', title: 'Down', status: 503, code: 'unavailable' }), posted());
      await show(<Chat />);
      await connect();
      await fireEvent.changeText(screen.getByLabelText('Message'), 'Plan');
      await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
      expect(await screen.findByText('Service not available. Trying again.')).toBeOnTheScreen();
      await act(async () => jest.advanceTimersByTime(1_000));
      expect(await screen.findByText('Sending')).toBeOnTheScreen();
      expect(posts()).toHaveLength(2);
    });

    it('shows the cost in German', async () => {
      jest.mocked(useLocales).mockReturnValue([{ languageCode: 'de' } as ReturnType<typeof useLocales>[number]]);
      server.on(threadRoute, json(200, { items: [agent(ids.taskC, ids.taskA, 'Fertig', 2_500_000)], headSeq: 10 }));
      await show(<Chat />);
      await connect();
      expect(await screen.findByText(/^Kosten 2,50\s\$$/)).toBeOnTheScreen();
    });
  });

  describe('Task detail', () => {
    const [s1, s2] = subtaskIds as [string, string];
    const taskRoute = `GET /api/tasks/${ids.taskA}`;
    const agents = {
      items: [
        { agentId: agentIds[0], name: 'researcher', enabled: true, activeVersion: 1, latestVersion: 1, rev: 1, asOf: 1 },
        { agentId: agentIds[1], name: 'writer', enabled: true, activeVersion: 1, latestVersion: 1, rev: 1, asOf: 1 },
      ],
      headSeq: 1,
    };
    const state = (subtaskId: string, status: string, extra: Record<string, unknown> = {}) => ({ subtaskId, status, tries: 1, inputTokens: 0, outputTokens: 0, costMicroUsd: 0, ...extra });
    const sendDetail = async (socket: FakeSocket, seq: number, doc: ReturnType<typeof detail>) =>
      act(async () => socket.receive({ type: 'notice', seq, topic: `task:${ids.taskA}`, docId: ids.taskA, rev: doc.rev, data: doc }));
    const controlPosts = (name: string) => posts().filter((request) => request.path === `/api/tasks/${ids.taskA}/${name}`);
    const accepted = () => json(202, { taskId: ids.taskA, version: 9 });
    const conflict = () => json(409, { type: 'about:blank', title: 'Conflict', status: 409, code: 'conflict' });

    beforeEach(() => {
      mockParams.id = ids.taskA;
      delete mockParams.edit;
      server.on('GET /api/tasks', json(200, { items: [], headSeq: 10 }));
      server.on(threadRoute, json(200, { items: [], headSeq: 10 }));
      server.on('GET /api/agents', json(200, agents));
    });

    it('subscribes the task topic, reads the detail after subscribed, and shows the plan by steps with text statuses', async () => {
      server.on(taskRoute, json(200, detail()));
      await show(<TaskScreen />);
      const socket = await connect();
      expect(socket.sent[1]).toEqual({ type: 'subscribe', topics: ['tasks', 'budget', `conversation:${conversationId}`, `task:${ids.taskA}`] });
      expect(await screen.findByText('Plan version 1, 2 subtasks')).toBeOnTheScreen();
      expect(screen.getByText('Plan the week')).toBeOnTheScreen();
      expect(screen.getByText('Step 1')).toBeOnTheScreen();
      expect(screen.getByText('Step 2')).toBeOnTheScreen();
      expect(screen.getByLabelText('Facts. Not started. Agent researcher')).toBeOnTheScreen();
      expect(screen.getByLabelText('Summary. Not started. Agent writer. After Facts')).toBeOnTheScreen();
      expect(screen.getByLabelText('Waiting for approval. Approval required. Cost $0.00')).toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: 'Cancel task' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    });

    it('approves the plan with its version and a new key for each action, and shows the conflict and reads again on 409', async () => {
      server.on(taskRoute, json(200, detail()), json(200, detail({ rev: 2, plan: { ...detail().plan!, planVersion: 2 } })));
      server.on(`POST /api/tasks/${ids.taskA}/approve-plan`, conflict(), accepted());
      await show(<TaskScreen />);
      await connect();
      await fireEvent.press(await screen.findByRole('button', { name: 'Approve plan' }));
      expect(await screen.findByText('The task changed. The screen shows the new state now.')).toBeOnTheScreen();
      expect(await screen.findByText('Plan version 2, 2 subtasks')).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('button', { name: 'Approve plan' }));
      await waitFor(() => expect(controlPosts('approve-plan')).toHaveLength(2));
      const [first, second] = controlPosts('approve-plan');
      expect(first!.body).toEqual({ planVersion: 1 });
      expect(second!.body).toEqual({ planVersion: 2 });
      const keys = [first!, second!].map((request) => request.headers.get('Idempotency-Key'));
      expect(keys.every((key) => Id.safeParse(key).success)).toBe(true);
      expect(keys[0]).not.toBe(keys[1]);
      await waitFor(() => expect(screen.queryByText('The task changed. The screen shows the new state now.')).toBeNull());
    });

    it('makes a new key for the same action after a 409, because the server answered it', async () => {
      server.on(taskRoute, json(200, detail()), json(200, detail({ rev: 2 })));
      server.on(`POST /api/tasks/${ids.taskA}/approve-plan`, conflict(), accepted());
      await show(<TaskScreen />);
      await connect();
      await fireEvent.press(await screen.findByRole('button', { name: 'Approve plan' }));
      expect(await screen.findByText('The task changed. The screen shows the new state now.')).toBeOnTheScreen();
      await waitFor(() => expect(server.requests.filter((request) => request.path === `/api/tasks/${ids.taskA}`)).toHaveLength(2));
      await fireEvent.press(screen.getByRole('button', { name: 'Approve plan' }));
      await waitFor(() => expect(controlPosts('approve-plan')).toHaveLength(2));
      const [first, second] = controlPosts('approve-plan');
      expect(second!.body).toEqual(first!.body);
      expect(second!.headers.get('Idempotency-Key')).not.toBe(first!.headers.get('Idempotency-Key'));
    });

    it('rejects the plan only with a reason, and shows a refused action', async () => {
      server.on(taskRoute, json(200, detail()));
      server.on(`POST /api/tasks/${ids.taskA}/reject-plan`, json(400, { type: 'about:blank', title: 'Bad', status: 400, code: 'validation_failed' }));
      await show(<TaskScreen />);
      await connect();
      await fireEvent.press(await screen.findByRole('button', { name: 'Reject plan' }));
      expect(screen.getByRole('button', { name: 'Reject and end the task' })).toBeDisabled();
      await fireEvent.changeText(screen.getByLabelText('Reason for the rejection'), ' Too long. ');
      await fireEvent.press(screen.getByRole('button', { name: 'Reject and end the task' }));
      expect(await screen.findByText('The server did not accept this action.')).toBeOnTheScreen();
      expect(controlPosts('reject-plan')[0]!.body).toEqual({ planVersion: 1, reason: 'Too long.' });
      server.on(`POST /api/tasks/${ids.taskA}/reject-plan`, accepted());
      await fireEvent.press(screen.getByRole('button', { name: 'Reject and end the task' }));
      await waitFor(() => expect(controlPosts('reject-plan')).toHaveLength(2));
      const [first, second] = controlPosts('reject-plan');
      expect(second!.body).toEqual(first!.body);
      expect(second!.headers.get('Idempotency-Key')).not.toBe(first!.headers.get('Idempotency-Key'));
    });

    it('opens the editor only while the plan waits for approval, and closes it when the task moves on', async () => {
      mockParams.edit = '1';
      server.on(taskRoute, json(200, detail()));
      await show(<TaskScreen />);
      const socket = await connect();
      expect(await screen.findByTestId('plan-editor')).toBeOnTheScreen();
      await sendDetail(socket, 11, detail({ rev: 2, status: 'running', runId: ids.taskC }));
      await waitFor(() => expect(screen.queryByTestId('plan-editor')).toBeNull());
      expect(screen.queryByRole('button', { name: 'Approve plan' })).toBeNull();
    });

    it('says so when a new plan version comes during an edit, and loads it on request', async () => {
      mockParams.edit = '1';
      server.on(taskRoute, json(200, detail()));
      await show(<TaskScreen />);
      const socket = await connect();
      await fireEvent.changeText(await screen.findByLabelText('Title of subtask 1'), 'My draft');
      const next = detail({ rev: 2 }).plan!;
      await sendDetail(socket, 11, detail({ rev: 2, plan: { planVersion: 2, subtasks: [{ ...next.subtasks[0]!, title: 'Server facts' }, next.subtasks[1]!] } }));
      expect(await screen.findByText('The plan changed on the server while you edited it.')).toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: 'Save plan' })).toBeNull();
      await fireEvent.press(screen.getByRole('button', { name: 'Edit the new plan' }));
      expect(await screen.findByText('Edit plan version 2')).toBeOnTheScreen();
      expect(screen.getByLabelText('Title of subtask 1')).toHaveProp('value', 'Server facts');
    });

    it('edits the plan: changes a title, adds a subtask, refuses a cycle, and sends the full plan with no estimates', async () => {
      mockParams.edit = '1';
      server.on(taskRoute, json(200, detail()));
      server.on(`POST /api/tasks/${ids.taskA}/edit-plan`, accepted());
      await show(<TaskScreen />);
      await connect();
      expect(await screen.findByText('Edit plan version 1')).toBeOnTheScreen();
      await fireEvent.changeText(screen.getByLabelText('Title of subtask 1'), 'Facts and figures');
      await fireEvent.press(screen.getByRole('checkbox', { name: 'After Summary' }));
      await fireEvent.press(screen.getByRole('button', { name: 'Save plan' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('The subtasks wait for each other in a loop. Remove one of the Starts after choices.');
      expect(controlPosts('edit-plan')).toHaveLength(0);
      await fireEvent.press(screen.getByRole('checkbox', { name: 'After Summary' }));
      await fireEvent.press(screen.getByRole('button', { name: 'Add subtask' }));
      await fireEvent.press(screen.getByRole('button', { name: 'Save plan' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Each subtask needs a title and instructions.');
      await fireEvent.changeText(screen.getByLabelText('Title of subtask 3'), 'Check');
      await fireEvent.changeText(screen.getByLabelText('Instructions for subtask 3'), 'Check the summary.');
      await fireEvent.press(screen.getAllByRole('radio', { name: 'writer' })[2]!);
      await fireEvent.press(screen.getAllByRole('checkbox', { name: 'After Summary' }).at(-1)!);
      await fireEvent.press(screen.getByRole('button', { name: 'Move Check up' }));
      await fireEvent.press(screen.getByRole('button', { name: 'Save plan' }));
      await waitFor(() => expect(controlPosts('edit-plan')).toHaveLength(1));
      const body = controlPosts('edit-plan')[0]!.body as { planVersion: number; subtasks: Record<string, unknown>[] };
      expect(body.planVersion).toBe(1);
      expect(body.subtasks.map((item) => item.title)).toEqual(['Facts and figures', 'Check', 'Summary']);
      const added = body.subtasks[1]!;
      expect(Id.safeParse(added.subtaskId).success).toBe(true);
      expect(added).toMatchObject({ agentId: agentIds[1], dependsOn: [s2], needsApproval: false, instructions: 'Check the summary.' });
      expect(body.subtasks.some((item) => 'estimatedCostMicroUsd' in item || 'estimatedDurationMs' in item)).toBe(false);
      expect(await screen.findByRole('button', { name: 'Approve plan' })).toBeOnTheScreen();
    });

    it('applies task notices by rev, shows the live text of the running call, reads the output of a done subtask and the result', async () => {
      const running = detail({
        status: 'running',
        runId: ids.taskC,
        rev: 2,
        currentCall: null,
        subtasks: [state(s1, 'running', { callId: ids.taskB, startedAt: '2026-11-01T10:01:00.000Z' }), state(s2, 'waiting')] as never,
      });
      server.on(taskRoute, json(200, detail()));
      server.on(`GET /api/tasks/${ids.taskA}/subtasks/${s1}/output`, json(200, { taskId: ids.taskA, runId: ids.taskC, subtaskId: s1, text: 'All the facts.' }));
      server.on(`GET /api/tasks/${ids.taskA}/output`, json(200, { taskId: ids.taskA, runId: ids.taskC, text: 'The final week plan.' }));
      await show(<TaskScreen />);
      const socket = await connect();
      await screen.findByText('Plan version 1, 2 subtasks');
      await sendDetail(socket, 11, running);
      expect(await screen.findByLabelText('Facts. Running. Agent researcher. Try 1')).toBeOnTheScreen();
      expect(screen.getByLabelText('Running. Approval required. Cost $0.00')).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Pause' })).toBeOnTheScreen();
      await act(async () => socket.receive({ type: 'delta', taskId: ids.taskA, callId: ids.taskB, attempt: 1, i: 0, text: 'Some ' }));
      await act(async () => socket.receive({ type: 'delta', taskId: ids.taskA, callId: ids.taskB, attempt: 1, i: 1, text: 'facts' }));
      expect(screen.getByLabelText('Live output: Some facts')).toBeOnTheScreen();
      await sendDetail(socket, 12, { ...running, rev: 1, title: 'Old rev' });
      expect(screen.queryByText('Old rev')).toBeNull();
      await sendDetail(socket, 13, {
        ...running,
        rev: 3,
        currentCall: { callId: ids.taskC, kind: 'aggregate' },
        subtasks: [state(s1, 'done', { callId: ids.taskB, startedAt: '2026-11-01T10:01:00.000Z', endedAt: '2026-11-01T10:02:00.000Z', inputTokens: 10, outputTokens: 20, costMicroUsd: 1_500 }), state(s2, 'queued')] as never,
      });
      expect(await screen.findByLabelText('Output: All the facts.')).toBeOnTheScreen();
      expect(screen.queryByLabelText('Live output: Some facts')).toBeNull();
      expect(screen.getByLabelText('The orchestrator writes the result: No text yet')).toBeOnTheScreen();
      expect(screen.getByLabelText(/Facts\. Done\. Agent researcher\. Try 1\. 10 tokens in, 20 tokens out\. Cost \$0\.0015/)).toBeOnTheScreen();
      expect(screen.getByText('Timeline')).toBeOnTheScreen();
      await sendDetail(socket, 14, { ...running, rev: 4, status: 'completed', currentCall: null, subtasks: [state(s1, 'done'), state(s2, 'done')] as never });
      expect(await screen.findByLabelText('Result: The final week plan.')).toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
      expect(screen.queryByRole('switch', { name: 'Auto-run this task' })).toBeNull();
    });

    it('resolves a checkpoint only while its subtask waits for approval, and keeps the key after a network error', async () => {
      const checkpoint = { checkpointId: ids.taskC, subtaskId: s2, reason: 'Approval needed for Summary', status: 'open', openedAt: '2026-11-01T10:03:00.000Z' };
      const base = { status: 'running' as const, runId: ids.taskC, checkpoints: [checkpoint] as never };
      server.on(taskRoute, json(200, detail({ ...base, subtasks: [state(s1, 'done'), state(s2, 'queued')] as never })));
      server.on(`POST /api/tasks/${ids.taskA}/resolve-checkpoint`, new TypeError('Network request failed'), accepted());
      await show(<TaskScreen />);
      const socket = await connect();
      await screen.findByText('Plan version 1, 2 subtasks');
      expect(screen.queryByText('Approval needed for Summary')).toBeNull();
      await sendDetail(socket, 11, detail({ ...base, rev: 2, subtasks: [state(s1, 'done'), state(s2, 'awaiting_approval')] as never }));
      expect(await screen.findByText('Approval needed for Summary')).toBeOnTheScreen();
      await fireEvent.changeText(screen.getByLabelText('Comment, optional'), 'Keep it short.');
      await fireEvent.press(screen.getByRole('button', { name: 'Approve' }));
      expect(await screen.findByText('Not sent. Check the connection and try again.')).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('button', { name: 'Approve' }));
      await waitFor(() => expect(controlPosts('resolve-checkpoint')).toHaveLength(2));
      const [first, second] = controlPosts('resolve-checkpoint');
      expect(first!.body).toEqual({ checkpointId: ids.taskC, decision: 'approved', comment: 'Keep it short.' });
      expect(second!.headers.get('Idempotency-Key')).toBe(first!.headers.get('Idempotency-Key'));
    });

    it('pauses, cancels the run after a confirm, retries and reassigns a failed subtask, and changes the mode', async () => {
      server.on(taskRoute, json(200, detail({ status: 'running', runId: ids.taskC, subtasks: [state(s1, 'failed', { reason: 'The model gave no output.' }), state(s2, 'waiting')] as never })));
      for (const name of ['pause-run', 'cancel-run', 'retry-subtask', 'reassign-subtask', 'set-task-mode']) server.on(`POST /api/tasks/${ids.taskA}/${name}`, accepted());
      await show(<TaskScreen />);
      await connect();
      expect(await screen.findByText('The model gave no output.')).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('button', { name: 'Pause' }));
      await fireEvent.press(screen.getByRole('button', { name: 'Cancel run' }));
      expect(controlPosts('cancel-run')).toHaveLength(0);
      await fireEvent.press(screen.getByRole('button', { name: 'Yes, cancel the run' }));
      await fireEvent.press(screen.getAllByRole('button', { name: 'Retry subtask' })[0]!);
      await fireEvent.press(screen.getAllByRole('button', { name: 'Change agent' })[0]!);
      expect(screen.getByRole('button', { name: 'Save agent' })).toBeDisabled();
      await fireEvent.press(screen.getByRole('radio', { name: 'writer' }));
      await fireEvent.press(screen.getByRole('button', { name: 'Save agent' }));
      await fireEvent.press(screen.getByRole('switch', { name: 'Auto-run this task' }));
      await waitFor(() => expect(controlPosts('set-task-mode')).toHaveLength(1));
      expect(controlPosts('pause-run')[0]!.body).toEqual({});
      expect(controlPosts('cancel-run')[0]!.body).toEqual({});
      expect(controlPosts('retry-subtask')[0]!.body).toEqual({ subtaskId: s1 });
      expect(controlPosts('reassign-subtask')[0]!.body).toEqual({ subtaskId: s1, agentId: agentIds[1] });
      expect(controlPosts('set-task-mode')[0]!.body).toEqual({ mode: 'auto' });
      const keys = new Set(posts().map((request) => request.headers.get('Idempotency-Key')));
      expect(keys.size).toBe(5);
    });

    it('opens the task from the task list', async () => {
      await show(<Tasks />);
      const socket = await connect();
      await receive(socket, 11, task(ids.taskA, 1, 'Plan the week'));
      await fireEvent.press(await screen.findByRole('button', { name: /^Plan the week\. Submitted/ }));
      expect(router.push).toHaveBeenCalledWith({ pathname: '/task/[id]', params: { id: ids.taskA } });
    });

    it('shows an error for a task that does not load, and reads it again from the retry button', async () => {
      server.on(taskRoute, json(404, { type: 'about:blank', title: 'Not Found', status: 404, code: 'not_found' }), json(200, detail()));
      await show(<TaskScreen />);
      await connect();
      expect(await screen.findByText('The task did not load.')).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByText('Plan version 1, 2 subtasks')).toBeOnTheScreen();
    });
  });

  describe('Plan preview and reply in the chat', () => {
    const owner = { role: 'owner' as const, messageId: ids.taskB, text: 'Plan my week', intent: 'new_task' as const, taskId: ids.taskA, createdAt: '2026-11-01T10:00:00.000Z', rev: 2, asOf: 1 };
    const agent = { role: 'agent' as const, messageId: ids.taskC, taskId: ids.taskA, text: 'Plan version 1, 2 subtasks: 1. Facts 2. Summary The plan waits for your approval.', createdAt: '2026-11-01T10:01:00.000Z', rev: 1, asOf: 2 };

    beforeEach(() => {
      server.on('GET /api/tasks', json(200, { items: [task(ids.taskA, 3, 'Plan the week', '2026-11-01T10:00:00.000Z', 'awaiting_approval')], headSeq: 10 }));
      server.on(threadRoute, json(200, { items: [agent, owner], headSeq: 10 }));
      server.on('GET /api/agents', json(200, { items: [{ agentId: agentIds[0], name: 'researcher', enabled: true, rev: 1, asOf: 1 }], headSeq: 1 }));
      server.on(`GET /api/tasks/${ids.taskA}`, json(200, detail()));
    });

    it('subscribes the task later, reads its detail after subscribed, and approves the plan from the chat', async () => {
      server.on(`POST /api/tasks/${ids.taskA}/approve-plan`, json(202, { taskId: ids.taskA, version: 4 }));
      await show(<Chat />);
      const socket = await connect();
      await waitFor(() => expect(socket.sent.at(-1)).toEqual({ type: 'subscribe', topics: [`task:${ids.taskA}`] }));
      expect(server.requests.filter((request) => request.path === `/api/tasks/${ids.taskA}`)).toHaveLength(0);
      await act(async () => socket.receive({ type: 'subscribed', topics: [`task:${ids.taskA}`], fromSeq: 11 }));
      expect(await screen.findByText('Plan for Plan the week, version 1')).toBeOnTheScreen();
      expect(screen.getByLabelText('Summary. Agent unknown. After Facts. Estimate $0.02. About 2 min. Needs your approval before it starts')).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('button', { name: 'Approve plan' }));
      await waitFor(() => expect(posts()).toHaveLength(1));
      expect(posts()[0]!.body).toEqual({ planVersion: 1 });
    });

    it('replies to a task with its taskId, turns off New task while it replies, and can cancel the reply', async () => {
      server.on(postRoute, json(202, { conversationId, messageId: ids.session, intent: 'steer', taskId: ids.taskA }));
      await show(<Chat />);
      const socket = await connect();
      await receive(socket, 11, task(ids.taskA, 4, 'Plan the week', '2026-11-01T10:00:00.000Z', 'running'));
      await fireEvent.press((await screen.findAllByRole('button', { name: 'Reply to this task' }))[0]!);
      expect(screen.getByText('Your next message goes to the task: Plan the week')).toBeOnTheScreen();
      expect(screen.getByRole('switch', { name: 'New task' })).toBeDisabled();
      await fireEvent.press(screen.getByRole('button', { name: 'Cancel reply' }));
      expect(screen.queryByText('Your next message goes to the task: Plan the week')).toBeNull();
      await fireEvent.press(screen.getAllByRole('button', { name: 'Reply to this task' })[0]!);
      await fireEvent.changeText(screen.getByLabelText('Message'), 'Use English only.');
      await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
      await waitFor(() => expect(posts()).toHaveLength(1));
      expect(posts()[0]!.body).toEqual({ text: 'Use English only.', newTask: false, taskId: ids.taskA });
      expect(screen.queryByText('Your next message goes to the task: Plan the week')).toBeNull();
      expect(screen.getByRole('switch', { name: 'New task' })).toBeEnabled();
    });

    it('shows Reply only for a clarifying, running or paused task, from the task list status before a stale detail', async () => {
      await show(<Chat />);
      const socket = await connect();
      await act(async () => socket.receive({ type: 'subscribed', topics: [`task:${ids.taskA}`], fromSeq: 11 }));
      await screen.findByText('Plan for Plan the week, version 1');
      expect(screen.queryByRole('button', { name: 'Reply to this task' })).toBeNull();
      const replies = () => screen.queryAllByRole('button', { name: 'Reply to this task' });
      for (const [seq, status, shown] of [
        [11, 'clarifying', true],
        [12, 'blocked', false],
        [13, 'paused', true],
        [14, 'planning', false],
        [15, 'running', true],
      ] as const) {
        await receive(socket, seq, task(ids.taskA, seq, 'Plan the week', '2026-11-01T10:00:00.000Z', status));
        expect([status, replies().length > 0]).toEqual([status, shown]);
      }
      await act(async () => socket.receive({ type: 'notice', seq: 16, topic: `task:${ids.taskA}`, docId: ids.taskA, rev: 5, data: detail({ rev: 5, status: 'running', runId: ids.taskC }) }));
      await receive(socket, 17, task(ids.taskA, 20, 'Plan the week', '2026-11-01T10:00:00.000Z', 'completed'));
      expect(replies()).toHaveLength(0);
      expect(screen.queryByRole('button', { name: 'Open task' })).toBeNull();
    });

    it('never sends newTask together with a reply taskId', async () => {
      server.on(postRoute, json(202, { conversationId, messageId: ids.session, intent: 'steer', taskId: ids.taskA }));
      function Sender() {
        const { send } = useLive();
        return <Button label="Probe send" onPress={() => send('Use English only.', true, ids.taskA)} />;
      }
      await show(<Sender />);
      await connect();
      await fireEvent.press(screen.getByRole('button', { name: 'Probe send' }));
      await waitFor(() => expect(posts()).toHaveLength(1));
      expect(posts()[0]!.body).toEqual({ text: 'Use English only.', newTask: false, taskId: ids.taskA });
    });
  });

  describe('Budget', () => {
    const month = (change: Record<string, unknown> = {}) => ({
      month: '2026-11',
      capMicroUsd: 5_000_000,
      softCapMicroUsd: 4_000_000,
      spentMicroUsd: 1_234_567,
      reservedMicroUsd: 20_000,
      remainingMicroUsd: 3_745_433,
      overCapMicroUsd: 0,
      rev: 3,
      asOf: 7,
      ...change,
    });
    const notFound = () => json(404, { type: 'about:blank', title: 'Not Found', status: 404, code: 'not_found' });
    const budgetCalls = () => server.requests.filter((request) => request.method === 'GET' && request.path === '/api/budget');
    const sendBudget = async (socket: FakeSocket, seq: number, data: ReturnType<typeof month>, rev = data.rev) =>
      act(async () => socket.receive({ type: 'notice', seq, topic: 'budget', docId: data.month, rev, data }));

    beforeEach(() => {
      server.on('GET /api/tasks', json(200, { items: [], headSeq: 10 }));
      server.on(threadRoute, json(200, { items: [], headSeq: 10 }));
    });

    it('shows the cap, soft cap, spent, reserved and remaining of the month, and applies a newer notice', async () => {
      server.on('GET /api/budget', json(200, month()));
      await show(<Budget />);
      expect(screen.getByLabelText('Loading the budget')).toBeOnTheScreen();
      const socket = await connect();
      expect(await screen.findByText('Month 2026-11')).toBeOnTheScreen();
      expect(screen.getByLabelText('Monthly cap: $5.00')).toBeOnTheScreen();
      expect(screen.getByLabelText('Soft cap: $4.00')).toBeOnTheScreen();
      expect(screen.getByLabelText('Spent: $1.23')).toBeOnTheScreen();
      expect(screen.getByLabelText('Reserved: $0.02')).toBeOnTheScreen();
      expect(screen.getByLabelText('Remaining: $3.75')).toBeOnTheScreen();
      expect(screen.queryByText('Over the cap')).toBeNull();
      expect(screen.getByLabelText('Monthly cap in USD')).toHaveProp('value', '5');
      await sendBudget(socket, 11, month({ spentMicroUsd: 6_000_000, remainingMicroUsd: 0, overCapMicroUsd: 1_000_000 }), 4);
      expect(screen.getByLabelText('Over the cap: $1.00')).toBeOnTheScreen();
      await sendBudget(socket, 12, month({ month: '2026-10', spentMicroUsd: 9 }), 9);
      await sendBudget(socket, 13, month({ spentMicroUsd: 1 }), 4);
      expect(screen.getByLabelText('Spent: $6.00')).toBeOnTheScreen();
      expect(budgetCalls()).toHaveLength(1);
    });

    it('shows no cap set on 404, sets the cap with the soft cap, and reads the month again', async () => {
      server.on('GET /api/budget', notFound(), json(200, month({ spentMicroUsd: 0, reservedMicroUsd: 0, remainingMicroUsd: 5_000_000 })));
      server.on('POST /api/budget', json(202, { version: 1 }));
      await show(<Budget />);
      await connect();
      expect(await screen.findByText('No cap is set. The agents cannot call a model until you set a cap.')).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Save cap' })).toBeDisabled();
      await fireEvent.changeText(screen.getByLabelText('Monthly cap in USD'), '5,00');
      await fireEvent.changeText(screen.getByLabelText('Soft cap in USD, optional'), '4');
      await fireEvent.press(screen.getByRole('button', { name: 'Save cap' }));
      expect(await screen.findByText('The cap is saved. The view updates in a moment.')).toBeOnTheScreen();
      const [post] = posts();
      expect(post!.body).toEqual({ scope: { kind: 'month' }, hardCapMicroUsd: 5_000_000, softCapMicroUsd: 4_000_000 });
      expect(Id.safeParse(post!.headers.get('Idempotency-Key')).success).toBe(true);
      expect(await screen.findByLabelText('Monthly cap: $5.00')).toBeOnTheScreen();
      expect(budgetCalls()).toHaveLength(2);
    });

    it('reads the month again on a budget notice while no cap is shown', async () => {
      server.on('GET /api/budget', notFound(), json(200, month()));
      await show(<Budget />);
      const socket = await connect();
      await screen.findByText(/^No cap is set/);
      await sendBudget(socket, 11, month());
      expect(await screen.findByLabelText('Monthly cap: $5.00')).toBeOnTheScreen();
    });

    it('checks the amounts before it sends, and keeps the key for a retry after a network error', async () => {
      server.on('GET /api/budget', json(200, month()));
      server.on('POST /api/budget', new TypeError('Network request failed'), json(202, { version: 2 }));
      await show(<Budget />);
      await connect();
      await screen.findByText('Month 2026-11');
      await fireEvent.changeText(screen.getByLabelText('Monthly cap in USD'), 'abc');
      await fireEvent.press(screen.getByRole('button', { name: 'Save cap' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Write an amount from 0 to 1000000 USD, for example 5.00.');
      await fireEvent.changeText(screen.getByLabelText('Monthly cap in USD'), '2000000');
      await fireEvent.press(screen.getByRole('button', { name: 'Save cap' }));
      expect(await screen.findByText(/^Write an amount/)).toBeOnTheScreen();
      await fireEvent.changeText(screen.getByLabelText('Monthly cap in USD'), '3');
      await fireEvent.press(screen.getByRole('button', { name: 'Save cap' }));
      expect(await screen.findByText('The soft cap must not be above the monthly cap.')).toBeOnTheScreen();
      expect(posts()).toHaveLength(0);
      await fireEvent.changeText(screen.getByLabelText('Soft cap in USD, optional'), '');
      await fireEvent.press(screen.getByRole('button', { name: 'Save cap' }));
      expect(await screen.findByText('The cap is not saved. Try again.')).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('button', { name: 'Save cap' }));
      expect(await screen.findByText('The cap is saved. The view updates in a moment.')).toBeOnTheScreen();
      expect(posts().map((request) => request.body)).toEqual([
        { scope: { kind: 'month' }, hardCapMicroUsd: 3_000_000 },
        { scope: { kind: 'month' }, hardCapMicroUsd: 3_000_000 },
      ]);
      const [first, second] = posts().map((request) => request.headers.get('Idempotency-Key'));
      expect(second).toBe(first);
    });

    it('shows a refused cap', async () => {
      server.on('GET /api/budget', json(200, month()));
      server.on('POST /api/budget', json(403, { type: 'about:blank', title: 'Forbidden', status: 403, code: 'forbidden' }));
      await show(<Budget />);
      await connect();
      await screen.findByText('Month 2026-11');
      await fireEvent.press(screen.getByRole('button', { name: 'Save cap' }));
      expect(await screen.findByText('The server did not accept this cap.')).toBeOnTheScreen();
    });

    it('shows the error state and reads again from the retry button', async () => {
      server.on('GET /api/budget', json(503, { type: 'about:blank', title: 'Down', status: 503, code: 'unavailable' }), json(200, month()));
      await show(<Budget />);
      await connect();
      expect(await screen.findByText('The budget did not load.')).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByText('Month 2026-11')).toBeOnTheScreen();
    });

    it('shows the offline state when there is no connection at the start', async () => {
      await show(<Budget />);
      const socket = await socketNumber(1);
      await act(async () => socket.serverClose(1006));
      expect(await screen.findByText('Offline. You can change the cap when the connection is back.')).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
      await socketNumber(2);
    });

    it('reads the budget in a new session after a sign-out while the old read still waits', async () => {
      server.on('GET /api/budget', () => new Promise<Response>(() => {}), json(200, month()));
      jest.mocked(auth.signIn).mockResolvedValue(true);
      await show(
        <>
          <Budget />
          <Settings />
          <Login />
        </>,
      );
      await connect();
      await waitFor(() => expect(budgetCalls()).toHaveLength(1));
      await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
      await fireEvent.press(await screen.findByRole('button', { name: 'Sign in' }));
      await connect(2);
      expect(await screen.findByText('Month 2026-11')).toBeOnTheScreen();
      expect(budgetCalls()).toHaveLength(2);
    });

    it('shows the read amount before Save and refuses a separator with exactly three digits', async () => {
      server.on('GET /api/budget', notFound());
      await show(<Budget />);
      await connect();
      await screen.findByText(/^No cap is set/);
      await fireEvent.changeText(screen.getByLabelText('Monthly cap in USD'), '1,5');
      expect(screen.getByTestId('budget-hard-read')).toHaveTextContent('Amount: $1.50');
      await fireEvent.changeText(screen.getByLabelText('Monthly cap in USD'), '0.000001');
      expect(screen.getByTestId('budget-hard-read')).toHaveTextContent('Amount: $0.000001');
      await fireEvent.changeText(screen.getByLabelText('Monthly cap in USD'), '1,000');
      expect(screen.queryByTestId('budget-hard-read')).toBeNull();
      await fireEvent.press(screen.getByRole('button', { name: 'Save cap' }));
      expect(await screen.findByText('A dot or comma with exactly three digits after it is not clear. Write 1000 for one thousand USD, or 1.00 for one USD.')).toBeOnTheScreen();
      await fireEvent.changeText(screen.getByLabelText('Soft cap in USD, optional'), '1.000');
      await fireEvent.changeText(screen.getByLabelText('Monthly cap in USD'), '2');
      await fireEvent.press(screen.getByRole('button', { name: 'Save cap' }));
      expect(await screen.findByText(/^A dot or comma with exactly three digits/)).toBeOnTheScreen();
      expect(posts()).toHaveLength(0);
    });

    it('is in Urdu, right to left, with the offline note', async () => {
      jest.mocked(useLocales).mockReturnValue([{ languageCode: 'ur' } as ReturnType<typeof useLocales>[number]]);
      server.on('GET /api/budget', notFound());
      await show(<Budget />);
      const socket = await connect();
      expect(await screen.findByRole('header', { name: 'بجٹ' })).toBeOnTheScreen();
      expect(await screen.findByText(/^کوئی حد مقرر نہیں/)).toBeOnTheScreen();
      await act(async () => socket.serverClose(1006));
      expect(screen.getByText('آف لائن۔ کنکشن واپس آنے پر آپ حد بدل سکتے ہیں۔')).toBeOnTheScreen();
      expect(I18nManager.forceRTL).toHaveBeenLastCalledWith(true);
    });
  });
});

describe('Settings', () => {
  it('shows the app version and the current choices', async () => {
    await show(<Settings />);
    expect(await screen.findByText('0.1.0')).toBeOnTheScreen();
    expect(screen.getByLabelText('App version: 0.1.0')).toBeOnTheScreen();
    expect(screen.queryByText(/no screen lock/)).toBeNull();
    expect(screen.getAllByRole('radio', { checked: true }).map((radio) => radio.props.accessibilityLabel)).toEqual(['Device language', 'Device setting']);
  });

  it('warns when the device has no screen lock', async () => {
    jest.mocked(LocalAuthentication.getEnrolledLevelAsync).mockResolvedValue(LocalAuthentication.SecurityLevel.NONE);
    await show(<Settings />);
    expect(await screen.findByText(/This device has no screen lock/)).toBeOnTheScreen();
  });

  it('changes the language at once and keeps the choice', async () => {
    await show(<Settings />);
    await fireEvent.press(await screen.findByRole('radio', { name: 'Deutsch' }));
    expect(await screen.findByRole('header', { name: 'Einstellungen' })).toBeOnTheScreen();
    expect(reloadAppAsync).not.toHaveBeenCalled();
  });

  it('reloads once to flip the layout when Urdu is chosen, and marks the reload so it does not lock', async () => {
    jest.mocked(LocalAuthentication.getEnrolledLevelAsync).mockResolvedValue(LocalAuthentication.SecurityLevel.NONE);
    await show(<Settings />);
    await fireEvent.press(await screen.findByRole('radio', { name: 'اردو' }));
    expect(await screen.findByRole('header', { name: 'ترتیبات' })).toBeOnTheScreen();
    expect(I18nManager.forceRTL).toHaveBeenLastCalledWith(true);
    expect(reloadAppAsync).toHaveBeenCalledTimes(1);
    expect(await getItem('lock.reloadAt')).not.toBeNull();
  });

  it('does not mark the reload when the language is picked while locked', async () => {
    await show(
      <>
        <Probe />
        <Settings />
      </>,
    );
    expect(await screen.findByText('signedIn locked')).toBeOnTheScreen();
    await fireEvent.press(await screen.findByRole('radio', { name: 'اردو' }));
    await screen.findByRole('header', { name: 'ترتیبات' });
    expect(reloadAppAsync).toHaveBeenCalledTimes(1);
    expect(await getItem('lock.reloadAt')).toBeNull();
  });

  it('does not reload again when the first reload did not flip the layout', async () => {
    await setItem('rtlReload', true);
    await setItem('settings', { language: 'ur', theme: 'system' });
    await show(<Settings />);
    await screen.findByRole('header', { name: 'ترتیبات' });
    expect(reloadAppAsync).not.toHaveBeenCalled();
  });

  it('changes the theme', async () => {
    await show(<Settings />);
    await fireEvent.press(await screen.findByRole('radio', { name: 'Dark' }));
    expect(await screen.findByRole('radio', { name: 'Dark', checked: true })).toBeOnTheScreen();
  });

  it('signs out', async () => {
    await show(<Settings />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Sign out' }));
    await act(async () => {});
    expect(auth.signOut).toHaveBeenCalledTimes(1);
  });

  it('shows the error state when sign-out fails', async () => {
    jest.mocked(auth.signOut).mockRejectedValueOnce(new Error('disk'));
    await show(<Settings />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText('Something went wrong.')).toBeOnTheScreen();
  });
});

describe('Lock and language', () => {
  it('keeps the lock when the device language changes to Urdu while locked', async () => {
    await show(<Probe />);
    expect(await screen.findByText('signedIn locked')).toBeOnTheScreen();

    jest.mocked(useLocales).mockReturnValue([{ languageCode: 'ur' } as ReturnType<typeof useLocales>[number]]);
    await screen.rerender(
      <SessionProvider>
        <SettingsProvider>
          <LiveProvider>
            <Probe />
          </LiveProvider>
        </SettingsProvider>
      </SessionProvider>,
    );
    await act(async () => {});
    expect(reloadAppAsync).toHaveBeenCalledTimes(1);
    expect(await getItem('lock.reloadAt')).toBeNull();

    await screen.unmount();
    await show(<Probe />);
    expect(await screen.findByText('signedIn locked')).toBeOnTheScreen();
  });
});

describe('StateView', () => {
  it('shows the loading state with a label', async () => {
    await show(<StateView kind="loading" title="Loading" />);
    expect(await screen.findByLabelText('Loading')).toBeOnTheScreen();
  });

  it('shows the error state with a retry button', async () => {
    const retry = jest.fn();
    await show(<StateView kind="error" title="Something went wrong." retryLabel="Try again" onRetry={retry} />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

it('sends the login redirect to the start route, not to a missing screen', () => {
  expect(redirectSystemPath({ path: 'com.famashines.ai:/oauth2redirect?code=x&state=y', initial: false })).toBe('/');
  expect(redirectSystemPath({ path: '/oauth2redirect?code=x', initial: false })).toBe('/');
  expect(redirectSystemPath({ path: '/settings', initial: false })).toBe('/settings');
});
