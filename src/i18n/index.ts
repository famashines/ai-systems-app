import de from './de.json';
import en from './en.json';
import ur from './ur.json';

export type Key = keyof typeof en;
export type Language = 'en' | 'de' | 'ur';

export const languages: Language[] = ['en', 'de', 'ur'];

export const dictionaries: Record<Language, Record<Key, string>> = { en, de, ur };

export function translate(language: Language, key: Key): string {
  return dictionaries[language][key];
}

export function isRTL(language: Language): boolean {
  return language === 'ur';
}

export function pickLanguage(code: string | null | undefined): Language {
  return languages.find((language) => language === code) ?? 'en';
}
