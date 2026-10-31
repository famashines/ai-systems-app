import { screen } from '@testing-library/react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { Slot } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { Text } from 'react-native';

import RootLayout from '@/app/_layout';
import * as auth from '@/lib/auth';
import { removeItem } from '@/lib/cache';

jest.mock('@/lib/auth', () => ({
  restore: jest.fn(),
  signIn: jest.fn(),
  signOut: jest.fn(async () => {}),
  onSessionEnded: jest.fn(),
}));

const routes = {
  _layout: RootLayout,
  '(tabs)/_layout': () => <Slot />,
  '(tabs)/index': () => <Text>chat content</Text>,
  login: () => <Text>login content</Text>,
};

async function open(signedIn: boolean, initialUrl = '/') {
  jest.mocked(auth.restore).mockResolvedValue(signedIn);
  await renderRouter(routes, { initialUrl });
}

beforeEach(async () => {
  await removeItem('lock.reloadAt');
  jest.mocked(LocalAuthentication.getEnrolledLevelAsync).mockResolvedValue(LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG);
  jest.mocked(LocalAuthentication.authenticateAsync).mockResolvedValue({ success: false, error: 'user_cancel' });
});

it('shows the login and guards the tabs when signed out', async () => {
  await open(false);
  expect(await screen.findByText('login content')).toBeOnTheScreen();
  expect(screen.queryByText('chat content', { includeHiddenElements: true })).toBeNull();
});

it('guards the login when signed in', async () => {
  jest.mocked(LocalAuthentication.getEnrolledLevelAsync).mockResolvedValue(LocalAuthentication.SecurityLevel.NONE);
  await open(true, '/login');
  expect(await screen.findByText('chat content')).toBeOnTheScreen();
  expect(screen.queryByText('login content', { includeHiddenElements: true })).toBeNull();
  expect(screen.queryByText('AI Systems is locked')).toBeNull();
});

it('covers the content with the lock and hides it from accessibility', async () => {
  await open(true);
  expect(await screen.findByText('AI Systems is locked')).toBeOnTheScreen();
  expect(screen.queryByText('chat content')).toBeNull();
  let node = screen.getByText('chat content', { includeHiddenElements: true }).parent;
  while (node && node.props.importantForAccessibility !== 'no-hide-descendants') node = node.parent;
  expect(node).not.toBeNull();
});
