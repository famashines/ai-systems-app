import { act, render, screen } from '@testing-library/react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { AppState, Text, type AppStateStatus } from 'react-native';

import * as auth from '@/lib/auth';
import { removeItem, setItem } from '@/lib/cache';
import { lockAfterMs, reloadGraceMs, shouldLock } from '@/lib/lock';
import { SessionProvider, useSession } from '@/state/session';

jest.mock('@/lib/auth', () => ({
  restore: jest.fn(),
  signIn: jest.fn(),
  signOut: jest.fn(),
  onSessionEnded: jest.fn(),
}));

let change: (state: AppStateStatus) => void = () => {};
let now = 0;

function Probe() {
  const { status, locked, unlock, deviceSecure } = useSession();
  return (
    <>
      <Text testID="probe" onPress={() => void unlock('Unlock')}>
        {status} {locked ? 'locked' : 'open'}
      </Text>
      <Text testID="secure">{deviceSecure ? 'secure' : 'insecure'}</Text>
    </>
  );
}

async function start(signedIn: boolean) {
  jest.mocked(auth.restore).mockResolvedValue(signedIn);
  await render(
    <SessionProvider>
      <Probe />
    </SessionProvider>,
  );
  await screen.findByText(new RegExp(signedIn ? 'signedIn' : 'signedOut'));
}

async function away(ms: number) {
  await act(async () => change('background'));
  now += ms;
  await act(async () => change('active'));
}

beforeEach(async () => {
  await removeItem('lock.reloadAt');
  now = 1_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    change = handler;
    return { remove: () => {} };
  });
  jest.mocked(LocalAuthentication.getEnrolledLevelAsync).mockResolvedValue(LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG);
  jest.mocked(LocalAuthentication.authenticateAsync).mockResolvedValue({ success: true });
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('locks after 5 minutes in the background, not before', () => {
  expect(lockAfterMs).toBe(300_000);
  expect(shouldLock(null, 10_000_000)).toBe(false);
  expect(shouldLock(0, 299_999)).toBe(false);
  expect(shouldLock(0, 300_000)).toBe(true);
});

it('starts locked when a stored session is restored', async () => {
  await start(true);
  expect(screen.getByTestId('probe')).toHaveTextContent('signedIn locked');
});

it('does not lock a device that has no screen lock, because it cannot unlock', async () => {
  jest.mocked(LocalAuthentication.getEnrolledLevelAsync).mockResolvedValue(LocalAuthentication.SecurityLevel.NONE);
  await start(true);
  expect(screen.getByTestId('probe')).toHaveTextContent('signedIn open');
});

it('stays open after 4:59 in the background and locks after 5:00', async () => {
  await start(true);
  await act(async () => screen.getByTestId('probe').props.onPress());
  expect(screen.getByTestId('probe')).toHaveTextContent('signedIn open');

  await away(lockAfterMs - 1);
  expect(screen.getByTestId('probe')).toHaveTextContent('signedIn open');

  await away(lockAfterMs);
  expect(screen.getByTestId('probe')).toHaveTextContent('signedIn locked');
});

it('does not lock when signed out', async () => {
  await start(false);
  await away(lockAfterMs * 2);
  expect(screen.getByTestId('probe')).toHaveTextContent('signedOut open');
});

it('stays locked when the biometric check fails', async () => {
  jest.mocked(LocalAuthentication.authenticateAsync).mockResolvedValue({ success: false, error: 'user_cancel' });
  await start(true);
  await act(async () => screen.getByTestId('probe').props.onPress());
  expect(screen.getByTestId('probe')).toHaveTextContent('signedIn locked');
});

it('goes to signed out when the server ends the session', async () => {
  await start(true);
  const ended = jest.mocked(auth.onSessionEnded).mock.calls.at(-1)![0];
  await act(async () => ended());
  expect(screen.getByTestId('probe')).toHaveTextContent('signedOut open');
});

it('locks when the clock moved back while in the background', async () => {
  expect(shouldLock(1_000, 999)).toBe(true);
  await start(true);
  await act(async () => screen.getByTestId('probe').props.onPress());
  await away(-60_000);
  expect(screen.getByTestId('probe')).toHaveTextContent('signedIn locked');
});

it('locks on resume without waiting for any async check', async () => {
  await start(true);
  await act(async () => screen.getByTestId('probe').props.onPress());
  jest.mocked(LocalAuthentication.getEnrolledLevelAsync).mockReturnValue(new Promise(() => {}));
  await away(lockAfterMs);
  expect(screen.getByTestId('probe')).toHaveTextContent('signedIn locked');
});

it('fails closed: locks when the screen-lock check throws', async () => {
  jest.mocked(LocalAuthentication.getEnrolledLevelAsync).mockRejectedValue(new Error('no keystore'));
  await start(true);
  expect(screen.getByTestId('probe')).toHaveTextContent('signedIn locked');
});

it('reports a device without a screen lock and updates when one is set', async () => {
  jest.mocked(LocalAuthentication.getEnrolledLevelAsync).mockResolvedValue(LocalAuthentication.SecurityLevel.NONE);
  await start(true);
  expect(screen.getByTestId('secure')).toHaveTextContent('insecure');
  jest.mocked(LocalAuthentication.getEnrolledLevelAsync).mockResolvedValue(LocalAuthentication.SecurityLevel.SECRET);
  await away(1_000);
  expect(screen.getByTestId('secure')).toHaveTextContent('secure');
});

it('does not lock after the app reloads itself for a language change', async () => {
  await setItem('lock.reloadAt', now - 1_000);
  await start(true);
  expect(screen.getByTestId('probe')).toHaveTextContent('signedIn open');
});

it.each([
  ['too old', -reloadGraceMs],
  ['in the future', 60_000],
])('locks when the reload mark is %s', async (_name, offset) => {
  await setItem('lock.reloadAt', now + offset);
  await start(true);
  expect(screen.getByTestId('probe')).toHaveTextContent('signedIn locked');
});
