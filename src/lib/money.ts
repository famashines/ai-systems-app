import { translate, type Language } from '@/i18n';

const microPerUsd = 1_000_000;

export function formatUsd(language: Language, micro: number): string {
  const digits = micro > 0 && micro < 10_000 ? 4 : 2;
  const format = new Intl.NumberFormat(language, { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits });
  if (micro > 0 && micro < 50) return translate(language, 'money.under', { amount: format.format(100 / microPerUsd) });
  return format.format(micro / microPerUsd);
}

export function formatUsdExact(language: Language, micro: number): string {
  return new Intl.NumberFormat(language, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(micro / microPerUsd);
}

export function parseUsd(text: string): number | 'grouping' | null {
  const match = /^(\d{0,7})(?:[.,](\d{0,6}))?$/.exec(text.trim());
  if (!match || !(match[1] || match[2])) return null;
  if (match[2]?.length === 3) return 'grouping';
  return Number(match[1] || '0') * microPerUsd + Number((match[2] ?? '').padEnd(6, '0'));
}

export function usdText(micro: number): string {
  const fraction = String(micro % microPerUsd)
    .padStart(6, '0')
    .replace(/0+$/, '');
  const whole = String(Math.floor(micro / microPerUsd));
  return fraction ? `${whole}.${fraction.length === 3 ? `${fraction}0` : fraction}` : whole;
}
