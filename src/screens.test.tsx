import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { reloadAppAsync } from 'expo';
import * as LocalAuthentication from 'expo-local-authentication';
import { useLocales } from 'expo-localization';
import type { ReactElement } from 'react';
import { I18nManager, Text } from 'react-native';

import Chat from '@/app/(tabs)/index';
import Settings from '@/app/(tabs)/settings';
import Tasks from '@/app/(tabs)/tasks';
import Login from '@/app/login';
import { redirectSystemPath } from '@/app/+native-intent';
import { LockScreen } from '@/components/lock-screen';
import { StateView } from '@/components/ui';
import * as auth from '@/lib/auth';
import { getItem, removeItem, setItem } from '@/lib/cache';
import { SessionProvider, useSession } from '@/state/session';
import { SettingsProvider } from '@/state/settings';

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
  };
});

function Probe() {
  const { status, locked } = useSession();
  return <Text>{`${status} ${locked ? 'locked' : 'open'}`}</Text>;
}

async function show(ui: ReactElement) {
  await render(
    <SessionProvider>
      <SettingsProvider>{ui}</SettingsProvider>
    </SessionProvider>,
  );
}

beforeEach(async () => {
  jest.clearAllMocks();
  await removeItem('settings');
  await removeItem('rtlReload');
  await removeItem('lock.reloadAt');
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

describe('Chat', () => {
  it('shows the empty state and a disabled input and send button with a note', async () => {
    await show(<Chat />);
    expect(await screen.findByText('No messages yet.')).toBeOnTheScreen();
    expect(screen.getByText('Coming in the next task')).toBeOnTheScreen();
    expect(screen.getByLabelText('Message')).toHaveProp('editable', false);
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });
});

describe('Tasks', () => {
  it('shows the empty state', async () => {
    await show(<Tasks />);
    expect(await screen.findByText('No tasks yet.')).toBeOnTheScreen();
    expect(screen.getByText('Tasks that you start in the chat show here.')).toBeOnTheScreen();
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
          <Probe />
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
