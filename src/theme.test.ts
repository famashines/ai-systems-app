import { contrastRatio, darkColors, lightColors, type Colors } from '@/theme';

type Key = keyof Colors;

const pairs: [Key, Key, number][] = [
  ['onSurface', 'surface', 4.5],
  ['onSurface', 'surfaceContainer', 4.5],
  ['onSurface', 'surfaceContainerHigh', 4.5],
  ['onSurfaceVariant', 'surface', 4.5],
  ['onSurfaceVariant', 'surfaceContainer', 4.5],
  ['onSurfaceVariant', 'surfaceContainerHigh', 4.5],
  ['primary', 'surface', 4.5],
  ['primary', 'surfaceContainer', 4.5],
  ['onPrimary', 'primary', 4.5],
  ['onPrimaryContainer', 'primaryContainer', 4.5],
  ['error', 'surface', 4.5],
  ['error', 'surfaceContainer', 4.5],
  ['error', 'primaryContainer', 4.5],
  ['onError', 'error', 4.5],
  ['onErrorContainer', 'errorContainer', 4.5],
  ['outline', 'surface', 3],
  ['outline', 'surfaceContainer', 3],
  ['error', 'surfaceContainerHigh', 4.5],
  ['outline', 'surfaceContainerHigh', 3],
];

describe.each([['light', lightColors], ['dark', darkColors]] as const)('%s colours', (_name, colors) => {
  it.each(pairs)('%s on %s reaches %s:1', (fg, bg, floor) => {
    expect(contrastRatio(colors[fg], colors[bg])).toBeGreaterThanOrEqual(floor);
  });
});

it('measures the WCAG ratio', () => {
  expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21);
  expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1);
});
