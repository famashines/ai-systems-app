import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Clipboard, Linking } from 'react-native';

import { copiedShowMs, CopyButton, Markdown, safeLink } from '@/components/markdown';
import { SessionProvider } from '@/state/session';
import { SettingsProvider } from '@/state/settings';
import { lightColors } from '@/theme';

jest.mock('@/lib/auth', () => ({ restore: jest.fn(async () => false), onSessionEnded: jest.fn(), onAccessToken: jest.fn() }));

const text = [
  '# Title',
  'Plain **bold** *slanted* ~~gone~~ `a < b` and [a link](https://example.com/x) and [bad](javascript:alert(1)).',
  '> quoted',
  '1. one\n2. two\n\n- [x] done item\n- open item',
  '| A | B |\n| - | - |\n| c1 | c2 |',
  '---',
  '<b>not html</b>',
  '```ts\nconst a = 1 <',
].join('\n\n');

async function show(ui: React.ReactElement) {
  await render(
    <SessionProvider>
      <SettingsProvider>{ui}</SettingsProvider>
    </SessionProvider>,
  );
  await screen.findByTestId('probe');
}

it('opens only http and https links', () => {
  expect(safeLink('https://example.com')).toBe('https://example.com');
  expect(safeLink('HTTP://example.com')).toBe('HTTP://example.com');
  for (const href of ['javascript:alert(1)', 'intent://x', 'file:///etc/passwd', 'example.com', '']) expect(safeLink(href)).toBeNull();
});

it('shows markdown as native text, with an open code block and no HTML', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  const copy = jest.spyOn(Clipboard, 'setString').mockImplementation(() => {});
  await show(
    <>
      <Markdown text={text} />
      <CopyButton testID="probe" text="x" label="Copy" />
    </>,
  );
  expect(screen.getByRole('header', { name: 'Title' })).toBeOnTheScreen();
  for (const part of ['bold', 'slanted', 'gone', 'a < b', 'quoted', 'one', 'two', '2.', '\u2611', 'done item', 'open item', 'c1', 'c2', '<b>not html</b>', 'ts', 'const a = 1 <']) {
    expect(screen.getAllByText(part, { exact: false }).length).toBeGreaterThan(0);
  }
  expect(screen.queryByText('#', { exact: false })).toBeNull();
  await fireEvent.press(screen.getByRole('link', { name: 'a link' }));
  expect(open).toHaveBeenCalledWith('https://example.com/x');
  expect(screen.queryByRole('link', { name: 'bad' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Copy the code' }));
  expect(copy).toHaveBeenCalledWith('const a = 1 <');
});

it('copies the text and shows Copied for a short time', async () => {
  jest.useFakeTimers();
  const copy = jest.spyOn(Clipboard, 'setString').mockImplementation(() => {});
  await show(<CopyButton testID="probe" text="The text" label="Copy the message" />);
  await fireEvent.press(screen.getByRole('button', { name: 'Copy the message' }));
  expect(copy).toHaveBeenCalledWith('The text');
  expect(screen.getByRole('button', { name: 'Copied' })).toBeOnTheScreen();
  expect(JSON.stringify(screen.toJSON())).toContain(lightColors.success);
  await act(async () => {
    jest.advanceTimersByTime(copiedShowMs);
  });
  expect(screen.getByRole('button', { name: 'Copy the message' })).toBeOnTheScreen();
  expect(JSON.stringify(screen.toJSON())).not.toContain(lightColors.success);
  jest.useRealTimers();
});
