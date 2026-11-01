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
import { redirectSystemPath } from '@/app/+native-intent';
import { LockScreen } from '@/components/lock-screen';
import { StateView } from '@/components/ui';
import * as auth from '@/lib/auth';
import { getItem, removeItem, setItem } from '@/lib/cache';
import { cachedTasksMax, conversationKey, LiveProvider, reloadDelayMs, slowAfterMs, tasksCacheKey, updatedShowMs } from '@/state/live';
import { SessionProvider, useSession } from '@/state/session';
import { SettingsProvider } from '@/state/settings';
import { FakeSocket, fakeServer, ids, installFakeSocket, json, task } from '@/test-fakes';

jest.mock('expo', () => ({ ...jest.requireActual<object>('expo'), reloadAppAsync: jest.fn(async () => {}) }));

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
    expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledWith({ promptMessage: 'Unlock AI Systems' });
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
      await said(socket, 12, agent(ids.taskC, ids.taskA, 'Violets are blue'));
      expect(screen.queryByTestId(`stream-${ids.taskA}`)).toBeNull();
      expect(screen.getByText('Violets are blue')).toBeOnTheScreen();
      await said(socket, 13, agent(ids.taskC, ids.taskA, 'Violets are blue', 1_234, 2));
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
      await receive(socket, 12, task(ids.taskA, 3, 'Plan', undefined, 'completed'));
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
