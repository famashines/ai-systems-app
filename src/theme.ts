import type { TextStyle } from 'react-native';

export const lightColors = {
  surface: '#FAF9F5',
  surfaceContainer: '#FFFFFF',
  surfaceContainerHigh: '#F0EEE6',
  onSurface: '#1F1E1D',
  onSurfaceVariant: '#5E5D59',
  primary: '#B5532F',
  onPrimary: '#FFFFFF',
  primaryContainer: '#F7E4DA',
  onPrimaryContainer: '#5A2410',
  error: '#B3261E',
  onError: '#FFFFFF',
  errorContainer: '#F9DEDC',
  onErrorContainer: '#410E0B',
  outline: '#87857D',
  outlineVariant: '#E5E2D9',
  scrim: '#00000066',
};

export type Colors = typeof lightColors;

export const darkColors: Colors = {
  surface: '#262624',
  surfaceContainer: '#30302E',
  surfaceContainerHigh: '#3A3936',
  onSurface: '#F0EEE6',
  onSurfaceVariant: '#BFBCB2',
  primary: '#E8916D',
  onPrimary: '#2A1208',
  primaryContainer: '#4D2D20',
  onPrimaryContainer: '#F8D9CB',
  error: '#FFB4AB',
  onError: '#690005',
  errorContainer: '#93000A',
  onErrorContainer: '#FFDAD6',
  outline: '#8F8C83',
  outlineVariant: '#454440',
  scrim: '#00000099',
};

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 24, full: 999 } as const;

export const shadow = { composer: '0 2px 8px rgba(0, 0, 0, 0.06)' } as const;

export const touchTarget = 48;

export const readingWidth = 720;

export const drawerWidth = 304;

export const motion = { open: 240 } as const;

export const type = {
  headline: { fontSize: 26, lineHeight: 34, fontWeight: '600' },
  title: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '500', letterSpacing: 0.1 },
  body: { fontSize: 16, lineHeight: 26, fontWeight: '400' },
  bodySmall: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
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
