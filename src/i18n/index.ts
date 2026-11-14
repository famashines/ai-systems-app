import de from './de.json';
import en from './en.json';
import ur from './ur.json';

export type Key = keyof typeof en;
export type Language = 'en' | 'de' | 'ur';

export const languages: Language[] = ['en', 'de', 'ur'];

export const dictionaries: Record<Language, Record<Key, string>> = { en, de, ur };

export type Params = Record<string, string>;

export function translate(language: Language, key: Key, params: Params = {}): string {
  return dictionaries[language][key].replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match);
}

export function isRTL(language: Language): boolean {
  return language === 'ur';
}

export function pickLanguage(code: string | null | undefined): Language {
  return languages.find((language) => language === code) ?? 'en';
}

export function formatTime(language: Language, at: number | string): string {
  return new Intl.DateTimeFormat(language, { hour: 'numeric', minute: '2-digit' }).format(new Date(at));
}

const dayMs = 86_400_000;

export function formatDay(language: Language, at: number | string, now: number = Date.now()): string {
  const date = new Date(at);
  const today = new Date(now);
  const days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / dayMs);
  if (days === 0) return translate(language, 'chat.today');
  if (days === 1) return translate(language, 'chat.yesterday');
  const year = date.getFullYear() === today.getFullYear() ? undefined : 'numeric';
  return new Intl.DateTimeFormat(language, { weekday: 'short', month: 'short', day: 'numeric', year }).format(date);
}
