import { formatUsd, parseUsd, usdText } from '@/lib/money';

it.each([
  [0, '$0.00'],
  [49, 'under $0.0001'],
  [50, '$0.0001'],
  [1_234, '$0.0012'],
  [9_999, '$0.0100'],
  [10_000, '$0.01'],
  [12_345, '$0.01'],
  [5_000_000, '$5.00'],
  [1_000_000_000_000, '$1,000,000.00'],
])('shows %i micro-USD as %s in English', (micro, text) => {
  expect(formatUsd('en', micro)).toBe(text);
});

it('uses the number format of the language', () => {
  expect(formatUsd('de', 1_234_560)).toMatch(/^1,23\s\$$/);
  expect(formatUsd('de', 30)).toMatch(/^unter 0,0001\s\$$/);
  expect(formatUsd('ur', 1_234_560)).toContain('1.23');
});

it.each([
  ['5', 5_000_000],
  ['5.5', 5_500_000],
  ['5,25', 5_250_000],
  [' 0.000001 ', 1],
  ['.5', 500_000],
  ['12.', 12_000_000],
  ['1000000', 1_000_000_000_000],
])('reads %s USD as %i micro-USD with no float', (text, micro) => {
  expect(parseUsd(text)).toBe(micro);
});

it.each(['', '.', 'abc', '-1', '1.0000001', '1e3', '1,000.50', '12345678'])('refuses %j', (text) => {
  expect(parseUsd(text)).toBeNull();
});

it.each([
  [0, '0'],
  [1, '0.000001'],
  [5_000_000, '5'],
  [5_250_000, '5.25'],
  [1_000_000_000_000, '1000000'],
])('writes %i micro-USD as the input text %s and reads it back', (micro, text) => {
  expect(usdText(micro)).toBe(text);
  expect(parseUsd(text)).toBe(micro);
});
