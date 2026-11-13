import type { TextStyle } from 'react-native';

export const lightColors = {
  surface: '#F8F9FB',
  surfaceContainer: '#ECEFF4',
  surfaceContainerHigh: '#E2E6ED',
  onSurface: '#1A1C20',
  onSurfaceVariant: '#44474F',
  primary: '#2F5BB7',
  onPrimary: '#FFFFFF',
  primaryContainer: '#D9E2FF',
  onPrimaryContainer: '#001A43',
  success: '#1B6E3A',
  error: '#B3261E',
  onError: '#FFFFFF',
  errorContainer: '#F9DEDC',
  onErrorContainer: '#410E0B',
  outline: '#74777F',
  outlineVariant: '#C4C6D0',
  scrim: '#00000066',
};

export type Colors = typeof lightColors;

export const darkColors: Colors = {
  surface: '#111318',
  surfaceContainer: '#1D2024',
  surfaceContainerHigh: '#282A2F',
  onSurface: '#E2E2E9',
  onSurfaceVariant: '#C4C6D0',
  primary: '#B0C6FF',
  onPrimary: '#002D6E',
  primaryContainer: '#284777',
  onPrimaryContainer: '#D9E2FF',
  success: '#7DD99A',
  error: '#FFB4AB',
  onError: '#690005',
  errorContainer: '#93000A',
  onErrorContainer: '#FFDAD6',
  outline: '#8E9099',
  outlineVariant: '#44474F',
  scrim: '#00000099',
};

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;

export const radius = { md: 8, field: 14, full: 999 } as const;

export const shadow = { composer: '0 2px 8px rgba(0, 0, 0, 0.06)' } as const;

export const motion = { fade: 160, open: 240, pulse: 900 } as const;

export const touchTarget = 48;

export const rail = { node: 13, nodeOn: 17, edge: 4 } as const;

export const readingWidth = 720;

export const tableCell = 144;

export const drawerWidth = 304;

export const fonts = {
  serif: 'Literata_400Regular',
  serifItalic: 'Literata_400Regular_Italic',
  serifBold: 'Literata_600SemiBold',
  serifBoldItalic: 'Literata_600SemiBold_Italic',
} as const;

export const mark = { thinking: 10, small: 28 } as const;

export const type = {
  headline: { fontSize: 26, lineHeight: 34, fontWeight: '600' },
  title: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '500', letterSpacing: 0.1 },
  body: { fontSize: 16, lineHeight: 26, fontWeight: '400' },
  bodySmall: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  code: { fontSize: 14, lineHeight: 21, fontWeight: '400', fontFamily: 'monospace' },
  answer: { fontSize: 17, lineHeight: 28, fontFamily: fonts.serif },
  answerHead1: { fontSize: 24, lineHeight: 32, fontFamily: fonts.serifBold },
  answerHead2: { fontSize: 20, lineHeight: 28, fontFamily: fonts.serifBold },
  answerHead3: { fontSize: 17, lineHeight: 28, fontFamily: fonts.serifBold },
} as const satisfies Record<string, TextStyle>;

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
  const [r = 0, g = 0, b = 0] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}
