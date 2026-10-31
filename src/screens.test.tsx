import { Id } from '@famashines/ai-systems-contracts';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { reloadAppAsync } from 'expo';
import * as LocalAuthentication from 'expo-local-authentication';
import { useLocales } from 'expo-localization';
import type { ReactElement } from 'react';
import { AppState, I18nManager, Text, type AppStateStatus } from 'react-native';

import Chat from '@/app/(tabs)/index';
import Settings from '@/app/(tabs)/settings';
import Tasks from '@/app/(tabs)/tasks';
import Login from '@/app/login';
import { redirectSystemPath } from '@/app/+native-intent';
import { LockScreen } from '@/components/lock-screen';
import { StateView } from '@/components/ui';
import * as auth from '@/lib/auth';
import { getItem, removeItem, setItem } from '@/lib/cache';
import { LiveProvider, slowAfterMs, tasksCacheKey, updatedShowMs } from '@/state/live';
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
      expect(socket.sent[1]).toEqual({ type: 'subscribe', topics: ['tasks'] });
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
    it('turns off the input and send while offline', async () => {
      await show(<Chat />);
      expect(await screen.findByText('No messages yet.')).toBeOnTheScreen();
      expect(screen.getByText('Offline. You can send when the connection is back.')).toBeOnTheScreen();
      expect(screen.getByLabelText('Message')).toHaveProp('editable', false);
      expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    });

    it('shows a message as sending at once and as received when the notice with its commandId comes', async () => {
      server.on('GET /api/tasks', json(200, { items: [], headSeq: 10 }));
      let answer = (_response: Response) => {};
      server.on('POST /api/tasks', () => new Promise<Response>((resolve) => (answer = resolve)));
      await show(<Chat />);
      const socket = await connect();
      await fireEvent.changeText(screen.getByLabelText('Message'), '  Plan the week  ');
      await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
      expect(screen.getByText('Plan the week')).toBeOnTheScreen();
      expect(screen.getByText('Sending')).toBeOnTheScreen();
      expect(screen.getByLabelText('Message')).toHaveProp('value', '');
      const key = posts()[0]!.headers.get('Idempotency-Key')!;
      expect(Id.safeParse(key).success).toBe(true);
      expect(posts()[0]!.body).toEqual({ text: 'Plan the week', mode: 'approval' });
      await receive(socket, 11, task(ids.taskA, 1, 'Plan the week'), key);
      expect(screen.getByText('Received')).toBeOnTheScreen();
      await act(async () => answer(json(202, { taskId: ids.taskA, version: 1 })));
      expect(screen.getByText('Received')).toBeOnTheScreen();
    });

    it('shows still processing after 10 s without the notice', async () => {
      jest.useFakeTimers();
      server.on('GET /api/tasks', json(200, { items: [], headSeq: 10 }));
      server.on('POST /api/tasks', json(202, { taskId: ids.taskA, version: 1 }));
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
      server.on('GET /api/tasks', json(200, { items: [], headSeq: 10 }));
      server.on('POST /api/tasks', new TypeError('Network request failed'), json(202, { taskId: ids.taskA, version: 1 }));
      await show(<Chat />);
      const socket = await connect();
      await fireEvent.changeText(screen.getByLabelText('Message'), 'Plan');
      await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
      expect(await screen.findByText('Not sent')).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('button', { name: 'Send again' }));
      await waitFor(() => expect(posts()).toHaveLength(2));
      const [first, second] = posts().map((request) => request.headers.get('Idempotency-Key'));
      expect(second).toBe(first);
      await receive(socket, 11, task(ids.taskA, 1, 'Plan'));
      expect(await screen.findByText('Received')).toBeOnTheScreen();
      expect(screen.getAllByText('Plan')).toHaveLength(1);
    });

    it('shows a refused message with no retry', async () => {
      server.on('GET /api/tasks', json(200, { items: [], headSeq: 10 }));
      server.on('POST /api/tasks', json(422, { type: 'about:blank', title: 'Bad', status: 422, code: 'validation_failed' }));
      await show(<Chat />);
      await connect();
      await fireEvent.changeText(screen.getByLabelText('Message'), 'Plan');
      await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
      expect(await screen.findByText('The server did not accept this message.')).toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: 'Send again' })).toBeNull();
    });

    it('shows the wait while the service is not available', async () => {
      jest.useFakeTimers();
      jest.spyOn(Math, 'random').mockReturnValue(0);
      server.on('GET /api/tasks', json(200, { items: [], headSeq: 10 }));
      server.on('POST /api/tasks', json(503, { type: 'about:blank', title: 'Down', status: 503, code: 'unavailable' }), json(202, { taskId: ids.taskA, version: 1 }));
      await show(<Chat />);
      await connect();
      await fireEvent.changeText(screen.getByLabelText('Message'), 'Plan');
      await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
      expect(await screen.findByText('Service not available. Trying again.')).toBeOnTheScreen();
      await act(async () => jest.advanceTimersByTime(1_000));
      expect(await screen.findByText('Sending')).toBeOnTheScreen();
      expect(posts()).toHaveLength(2);
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
