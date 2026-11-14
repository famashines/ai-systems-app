import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { reloadAppAsync } from 'expo';
import * as Crypto from 'expo-crypto';
import * as LocalAuthentication from 'expo-local-authentication';
import { useLocales } from 'expo-localization';
import { fetch as streamFetch } from 'expo/fetch';
import type { ReactElement } from 'react';
import { Alert, Clipboard, I18nManager, Keyboard, Text } from 'react-native';

import Budget from '@/app/(tabs)/budget';
import Chat from '@/app/(tabs)/index';
import Settings from '@/app/(tabs)/settings';
import Login from '@/app/login';
import { router } from 'expo-router';
import { redirectSystemPath } from '@/app/+native-intent';
import { LockScreen } from '@/components/lock-screen';
import { shortName } from '@/components/model-picker';
import { StateView } from '@/components/ui';
import * as auth from '@/lib/auth';
import { getItem, removeItem, setItem } from '@/lib/cache';
import { direct, notifyMs } from '@/lib/direct';
import { DataProvider } from '@/state/data';
import { SessionProvider, useSession } from '@/state/session';
import { SettingsProvider } from '@/state/settings';
import { fakeServer, json } from '@/test-fakes';

jest.mock('expo', () => ({ ...jest.requireActual<object>('expo'), reloadAppAsync: jest.fn(async () => {}) }));

const mockParams: { id?: string; edit?: string } = {};
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), navigate: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) },
  useLocalSearchParams: () => mockParams,
}));

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));

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

jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
const realUuid = () => jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID();

function Probe() {
  const { status, locked } = useSession();
  return <Text>{`${status} ${locked ? 'locked' : 'open'}`}</Text>;
}

async function show(ui: ReactElement) {
  await render(
    <SessionProvider>
      <SettingsProvider>
        <DataProvider>{ui}</DataProvider>
      </SettingsProvider>
    </SessionProvider>,
  );
}

beforeEach(async () => {
  jest.clearAllMocks();
  await removeItem('settings');
  await removeItem('rtlReload');
  await removeItem('lock.reloadAt');
  jest.mocked(Crypto.randomUUID).mockReset().mockImplementation(realUuid);
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
let server: ReturnType<typeof fakeServer>;

const modelList = {
  items: [
    { id: 'anthropic/claude-opus-5.5', name: 'Anthropic: Claude Opus 5.5', efforts: ['max', 'high', 'medium', 'low', 'none'], defaultEffort: 'high' },
    { id: 'openai/gpt-5', name: 'OpenAI: GPT-5', efforts: ['high', 'medium', 'low'], defaultEffort: 'medium' },
    { id: 'openai/gpt-4.1-nano', name: 'OpenAI: GPT-4.1 Nano', efforts: [] },
  ],
};
const notFound = () => json(404, { type: 'about:blank', title: 'Not Found', status: 404, code: 'not_found' }, { 'Content-Type': 'application/problem+json' });

async function ready() {
  await waitFor(() => expect(server.requests.some((request) => request.path === '/api/models')).toBe(true));
  await act(async () => {});
}

const posts = () => server.requests.filter((request) => request.method === 'POST');

describe('App', () => {
  beforeEach(() => {
    server = fakeServer(api);
    server.always('GET /api/models', () => json(200, modelList));
    server.always('GET /api/budget', notFound);
    direct.forget();
    jest.mocked(auth.getAccessToken).mockResolvedValue('access-1');
    jest.mocked(LocalAuthentication.getEnrolledLevelAsync).mockResolvedValue(LocalAuthentication.SecurityLevel.NONE);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Direct chat', () => {
    const chatFetch = jest.mocked(streamFetch) as unknown as jest.Mock;
    const sse = (event: object) => new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
    const done = { type: 'done', finishReason: 'stop', inputTokens: 3, outputTokens: 2, costMicroUsd: 4200 };
    let push = (_event: object) => {};
    let end = () => {};

    function openStream() {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          push = (event) => controller.enqueue(sse(event));
          end = () => controller.close();
        },
      });
      return { ok: true, status: 200, body };
    }
    const settle = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, notifyMs + 30)));

    beforeEach(async () => {
      direct.forget();
      chatFetch.mockReset().mockImplementation(async () => openStream());
      jest.mocked(auth.getAccessToken).mockResolvedValue('token-1');
      await setItem('settings', { language: 'system', theme: 'system', model: 'openai/gpt-5', effort: null });
    });

    it('sends a message directly to the model, streams markdown, and offers stop, copy and regenerate', async () => {
      const copy = jest.spyOn(Clipboard, 'setString').mockImplementation(() => {});
      await show(<Chat />);
      await ready();
      await fireEvent.changeText(screen.getByLabelText('Message'), 'Say hi');
      await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
      expect(screen.getAllByText('Say hi')).toHaveLength(2);
      expect(screen.getByLabelText('Message')).toHaveProp('value', '');
      await waitFor(() => expect(chatFetch).toHaveBeenCalledTimes(1));
      const [url, init] = chatFetch.mock.calls[0] as [string, { body: string }];
      expect(url).toBe('https://ai.famashines.com/api/chat');
      const sent = JSON.parse(init.body) as { chatId: string; model: string; messages: unknown[] };
      expect(sent).toEqual({ chatId: sent.chatId, model: 'openai/gpt-5', effort: 'medium', messages: [{ role: 'user', content: 'Say hi' }] });
      expect(posts()).toHaveLength(0);
      expect(screen.getByLabelText('Writing')).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Stop the answer' })).toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
      await act(async () => push({ type: 'delta', text: 'Hi **the' }));
      await act(async () => push({ type: 'delta', text: 're**' }));
      await settle();
      expect(screen.getByText('there')).toBeOnTheScreen();
      expect(screen.queryByText('**', { exact: false })).toBeNull();
      await act(async () => {
        push(done);
        end();
      });
      await settle();
      expect(screen.queryByLabelText('Writing')).toBeNull();
      expect(screen.getByLabelText(/, Cost \$0\.0042$/)).toBeOnTheScreen();
      expect(screen.getByRole('header', { name: 'Today' })).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Send' })).toBeOnTheScreen();
      await fireEvent.press(screen.getByTestId('copy-answer'));
      expect(copy).toHaveBeenCalledWith('Hi **there**');
      await fireEvent.press(screen.getAllByRole('button', { name: 'Copy the message' })[0]!);
      expect(copy).toHaveBeenCalledTimes(2);
      await fireEvent.press(screen.getByRole('button', { name: 'Make the answer again' }));
      await waitFor(() => expect(chatFetch).toHaveBeenCalledTimes(2));
      expect((JSON.parse((chatFetch.mock.calls[1] as [string, { body: string }])[1].body) as { messages: unknown[] }).messages).toEqual([{ role: 'user', content: 'Say hi' }]);
      await act(async () => {
        push(done);
        end();
      });
      await settle();
    });

    it('stop keeps the partial answer, and New chat clears the direct chat', async () => {
      await show(<Chat />);
      await ready();
      await fireEvent.changeText(screen.getByLabelText('Message'), 'Long story');
      await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
      await waitFor(() => expect(chatFetch).toHaveBeenCalledTimes(1));
      const { signal } = (chatFetch.mock.calls[0] as [string, { signal: AbortSignal }])[1];
      await act(async () => push({ type: 'delta', text: 'Once' }));
      await settle();
      await fireEvent.press(screen.getByRole('button', { name: 'Stop the answer' }));
      expect(signal.aborted).toBe(true);
      await act(async () => end());
      await settle();
      expect(screen.getByText('Once')).toBeOnTheScreen();
      expect(screen.getByText('Stopped')).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('button', { name: 'New chat' }));
      expect(screen.queryByText('Long story')).toBeNull();
      expect(screen.queryByTestId('chat-list')).toBeNull();
    });

    it('lists the chats in the menu, opens an old chat, deletes a chat, and forgets all at sign-out', async () => {
      jest.mocked(LocalAuthentication.getEnrolledLevelAsync).mockResolvedValue(LocalAuthentication.SecurityLevel.NONE);
      await show(
        <>
          <Chat />
          <Settings />
          <Login />
        </>,
      );
      await ready();
      await fireEvent.changeText(screen.getByLabelText('Message'), 'First question');
      await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
      await waitFor(() => expect(chatFetch).toHaveBeenCalledTimes(1));
      await act(async () => {
        push({ type: 'delta', text: 'First answer' });
        push(done);
        end();
      });
      await settle();
      await fireEvent.press(screen.getByRole('button', { name: 'New chat' }));
      expect(screen.queryByText('First answer')).toBeNull();
      await fireEvent.press(screen.getAllByTestId('menu')[0]!);
      const row = await screen.findByRole('button', { name: 'Chat: First question' });
      await fireEvent.press(row);
      expect(await screen.findByText('First answer')).toBeOnTheScreen();
      expect(await getItem('direct.history')).not.toBeNull();
      await fireEvent.press(screen.getAllByTestId('menu')[0]!);
      expect(screen.queryByRole('button', { name: 'Delete the chat First question' })).toBeNull();
      const confirm = jest.spyOn(Alert, 'alert');
      await fireEvent(await screen.findByRole('button', { name: 'Chat: First question' }), 'accessibilityAction', { nativeEvent: { actionName: 'delete' } });
      expect(screen.getByRole('button', { name: 'Chat: First question' })).toBeOnTheScreen();
      const choices = confirm.mock.calls.at(-1)![2]!;
      await act(async () => choices.find((choice) => choice.style === 'destructive')!.onPress!());
      expect(screen.queryByRole('button', { name: 'Chat: First question' })).toBeNull();
      expect(screen.getAllByText('No chats yet.').length).toBeGreaterThan(0);
      expect(screen.queryByText('First answer')).toBeNull();
      await fireEvent.press(screen.getAllByTestId('drawer-scrim', { includeHiddenElements: true })[0]!);
      await fireEvent.changeText(screen.getByLabelText('Message'), 'Second question');
      await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
      await waitFor(async () => expect((await getItem<unknown[]>('direct.history'))?.value).toHaveLength(1));
      await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
      await waitFor(async () => expect(await getItem('direct.history')).toBeNull());
    });

    it('bookmarks, renames and deletes the open chat from its menu', async () => {
      const alert = jest.spyOn(Alert, 'alert');
      await show(<Chat />);
      await ready();
      expect(screen.queryByRole('button', { name: 'More options' })).toBeNull();
      await fireEvent.changeText(screen.getByLabelText('Message'), 'Plan a trip');
      await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
      await waitFor(() => expect(chatFetch).toHaveBeenCalledTimes(1));
      await act(async () => {
        push({ type: 'delta', text: 'Sure' });
        push(done);
        end();
      });
      await settle();
      expect(screen.getByRole('header', { name: 'Plan a trip' })).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('button', { name: 'More options' }));
      await fireEvent.press(screen.getByRole('menuitem', { name: 'Bookmark' }));
      expect(screen.queryByTestId('chat-menu-panel')).toBeNull();
      await fireEvent.press(screen.getByTestId('menu'));
      expect(screen.getByRole('header', { name: 'Bookmarks' })).toBeOnTheScreen();
      await fireEvent.press(screen.getByTestId('drawer-scrim', { includeHiddenElements: true }));
      await fireEvent.press(screen.getByRole('button', { name: 'More options' }));
      expect(screen.getByRole('menuitem', { name: 'Remove bookmark' })).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('menuitem', { name: 'Rename' }));
      await fireEvent.changeText(screen.getByTestId('rename-input'), '   ');
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
      await fireEvent.changeText(screen.getByTestId('rename-input'), 'Trip to Lahore');
      await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
      expect(screen.queryByTestId('rename-dialog')).toBeNull();
      expect(screen.getByRole('header', { name: 'Trip to Lahore' })).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('button', { name: 'More options' }));
      await fireEvent.press(screen.getByRole('menuitem', { name: 'Delete' }));
      expect(alert).toHaveBeenCalledWith('Delete this chat?', 'You cannot undo this.', expect.any(Array));
      const buttons = alert.mock.calls[0]![2]!;
      await act(async () => buttons.find((button) => button.style === 'destructive')!.onPress!());
      expect(screen.getByRole('header', { name: 'New chat' })).toBeOnTheScreen();
      expect(screen.queryByText('Sure')).toBeNull();
    });

    it('shows the reason when the budget refuses the message', async () => {
      await show(<Chat />);
      await ready();
      await fireEvent.changeText(screen.getByLabelText('Message'), 'Costly');
      await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
      await waitFor(() => expect(chatFetch).toHaveBeenCalledTimes(1));
      await act(async () => {
        push({ type: 'error', errorClass: 'budget_refused', reason: 'cap', costMicroUsd: 0 });
        end();
      });
      await settle();
      expect(screen.getByText('The budget does not allow this message.')).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Make the answer again' })).toBeOnTheScreen();
    });
  });

  describe('Chat screen', () => {
    it('shows an empty chat with only the message field, and needs a model', async () => {
      await show(<Chat />);
      await ready();
      expect(screen.getAllByRole('header')).toHaveLength(1);
      expect(screen.getByRole('header', { name: 'New chat' })).toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: 'New chat' })).toBeNull();
      expect(screen.queryByTestId('fama-mark')).toBeNull();
      expect(screen.getByText('Choose a model to send a message.')).toBeOnTheScreen();
      const dismiss = jest.spyOn(Keyboard, 'dismiss');
      await fireEvent.press(screen.getByTestId('chat-empty'));
      expect(dismiss).toHaveBeenCalled();
      await fireEvent.changeText(screen.getByLabelText('Message'), 'Help me plan my week');
      expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Send' })).toHaveStyle({ width: 36, height: 36, borderRadius: 999 });
    });

    it('chooses a model and an effort in the picker, searches, and keeps the choice', async () => {
      await show(<Chat />);
      await ready();
      await fireEvent.press(screen.getByTestId('model-chip'));
      await fireEvent.changeText(screen.getByTestId('model-search'), 'opus');
      expect(screen.queryByRole('radio', { name: 'OpenAI: GPT-5' })).toBeNull();
      await fireEvent.press(screen.getByRole('radio', { name: 'Anthropic: Claude Opus 5.5' }));
      expect(screen.getByRole('radio', { name: 'High' })).toBeChecked();
      await fireEvent.press(screen.getByRole('radio', { name: 'Low' }));
      await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
      expect(screen.queryByTestId('model-panel')).toBeNull();
      expect(screen.queryByTestId('model-chip')).toBeNull();
      await fireEvent(screen.getByLabelText('Message'), 'focus');
      expect(screen.getByTestId('model-chip')).toHaveProp('accessibilityLabel', 'Model Anthropic: Claude Opus 5.5, effort Low');
      expect(screen.getByText(shortName('Anthropic: Claude Opus 5.5'))).toBeOnTheScreen();
      expect((await getItem<{ model: string; effort: string }>('settings'))?.value).toMatchObject({ model: 'anthropic/claude-opus-5.5', effort: 'low' });
      expect(screen.queryByText('Choose a model to send a message.')).toBeNull();
      await fireEvent.press(screen.getByTestId('model-chip'));
      await fireEvent.changeText(screen.getByTestId('model-search'), 'nothing like this');
      expect(screen.getByText('No model matches the search.')).toBeOnTheScreen();
    });

    it('asks for a model again when the saved model left the list', async () => {
      await setItem('settings', { language: 'system', theme: 'system', model: 'gone/old-model', effort: 'high' });
      await show(<Chat />);
      await ready();
      expect(await screen.findByText('Choose a model to send a message.')).toBeOnTheScreen();
    });

    it('shows an error in the picker when the list does not load, and loads again from its retry button', async () => {
      server.on('GET /api/models', new TypeError('Network request failed'));
      await show(<Chat />);
      await ready();
      await fireEvent.press(screen.getByTestId('model-chip'));
      expect(await screen.findByRole('radio', { name: 'OpenAI: GPT-5' })).toBeOnTheScreen();
    });
  });

  describe('Budget', () => {
    const month = { month: '2026-11', capMicroUsd: 20_000_000, softCapMicroUsd: 15_000_000, spentMicroUsd: 3_210_000, reservedMicroUsd: 0, remainingMicroUsd: 16_790_000, overCapMicroUsd: 0, rev: 4, asOf: 9 };

    it('shows the cap, soft cap, spent, reserved and remaining of the month', async () => {
      server.on('GET /api/budget', json(200, month));
      await show(<Budget />);
      expect(await screen.findByText('Month 2026-11')).toBeOnTheScreen();
      for (const label of ['Monthly cap: $20.00', 'Spent: $3.21', 'Remaining: $16.79']) expect(screen.getByLabelText(label)).toBeOnTheScreen();
      expect(screen.getByTestId('budget-hard')).toHaveProp('value', '20');
    });

    it('shows no cap set on 404, sets the cap, and reads the month again', async () => {
      server.on('POST /api/budget', json(202, { version: 2 }));
      await show(<Budget />);
      expect(await screen.findByRole('alert')).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Save cap' })).toBeDisabled();
      await fireEvent.changeText(screen.getByTestId('budget-hard'), '20');
      await fireEvent.changeText(screen.getByTestId('budget-soft'), '15,5');
      expect(screen.getByTestId('budget-soft-read')).toHaveTextContent(/15\.50/);
      server.on('GET /api/budget', json(200, month));
      await fireEvent.press(screen.getByRole('button', { name: 'Save cap' }));
      expect(await screen.findByText('Month 2026-11')).toBeOnTheScreen();
      expect(posts()[0]!.body).toEqual({ scope: { kind: 'month' }, hardCapMicroUsd: 20_000_000, softCapMicroUsd: 15_500_000 });
    });

    it('checks the amounts before it sends, and shows a refused cap', async () => {
      await show(<Budget />);
      await screen.findByRole('alert');
      await fireEvent.changeText(screen.getByTestId('budget-hard'), '10');
      await fireEvent.changeText(screen.getByTestId('budget-soft'), '12');
      await fireEvent.press(screen.getByRole('button', { name: 'Save cap' }));
      expect(posts()).toHaveLength(0);
      await fireEvent.changeText(screen.getByTestId('budget-soft'), '');
      server.on('POST /api/budget', json(403, { type: 'about:blank', title: 'No', status: 403, code: 'forbidden' }));
      await fireEvent.press(screen.getByRole('button', { name: 'Save cap' }));
      await waitFor(() => expect(posts()).toHaveLength(1));
      expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(1);
    });

    it('shows the error state and reads again from the retry button', async () => {
      server.on('GET /api/budget', new TypeError('Network request failed'), json(200, month));
      await show(<Budget />);
      await fireEvent.press(await screen.findByRole('button', { name: 'Try again' }));
      expect(await screen.findByText('Month 2026-11')).toBeOnTheScreen();
    });
  });

  describe('Menu', () => {
    it('opens with the chat list and the sections, and closes from the scrim, the close button and the back button', async () => {
      await show(<Chat />);
      await ready();
      expect(screen.queryByTestId('drawer-panel')).toBeNull();
      const menu = screen.getByRole('button', { name: 'Open the menu' });
      expect(menu).toHaveStyle({ width: 48, height: 48 });
      await fireEvent.press(menu);
      expect(screen.getByRole('button', { name: 'Budget' })).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Settings' })).toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: 'New chat' })).toBeNull();
      expect(screen.getByText('No chats yet.')).toBeOnTheScreen();
      await fireEvent.press(screen.getByTestId('drawer-scrim', { includeHiddenElements: true }));
      expect(screen.queryByTestId('drawer-panel')).toBeNull();
      await fireEvent.press(menu);
      await fireEvent.press(screen.getByRole('button', { name: 'Close the menu' }));
      expect(screen.queryByTestId('drawer-panel')).toBeNull();
      await fireEvent.press(menu);
      await fireEvent(screen.getByTestId('drawer'), 'requestClose');
      expect(screen.queryByTestId('drawer-panel')).toBeNull();
      expect(router.navigate).not.toHaveBeenCalled();
    });

    it('goes to a section, and its back button goes to the chat', async () => {
      await show(<Chat />);
      await ready();
      await fireEvent.press(screen.getByRole('button', { name: 'Open the menu' }));
      await fireEvent.press(screen.getByRole('button', { name: 'Settings' }));
      expect(router.navigate).toHaveBeenLastCalledWith('/settings');
      expect(screen.queryByTestId('drawer-panel')).toBeNull();
      await screen.unmount();
      await show(<Budget />);
      expect(screen.queryByRole('button', { name: 'Open the menu' })).toBeNull();
      await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
      expect(router.navigate).toHaveBeenLastCalledWith('/');
    });

    it('is in Urdu, right to left', async () => {
      await setItem('settings', { language: 'ur', theme: 'system' });
      await show(<Chat />);
      await ready();
      expect(screen.getByRole('header', { name: 'نئی چیٹ' })).toBeOnTheScreen();
      await fireEvent.press(screen.getByTestId('menu'));
      expect(screen.getByText('چیٹس')).toBeOnTheScreen();
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
          <DataProvider>
            <Probe />
          </DataProvider>
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
  expect(redirectSystemPath({ path: 'exp://192.168.1.20:8081/--/oauth2redirect?code=x', initial: false })).toBe('/');
  expect(redirectSystemPath({ path: '/--/oauth2redirect?code=x', initial: false })).toBe('/');
  expect(redirectSystemPath({ path: '/settings', initial: false })).toBe('/settings');
});
