import { dictionaries, formatDay, formatTime, isRTL, languages, pickLanguage, translate } from '@/i18n';

it.each(languages)('%s has every key of every language, each with text', (language) => {
  const all = new Set(languages.flatMap((other) => Object.keys(dictionaries[other])));
  const own = dictionaries[language];
  expect(Object.keys(own).sort()).toEqual([...all].sort());
  expect(Object.values(own).filter((text) => !text.trim())).toEqual([]);
});

it('German and Urdu are translations, not copies of English', () => {
  expect(translate('de', 'login.button')).not.toBe(translate('en', 'login.button'));
  expect(translate('ur', 'login.button')).not.toBe(translate('en', 'login.button'));
});

it('only Urdu is right to left', () => {
  expect(languages.filter(isRTL)).toEqual(['ur']);
});

it.each([
  ['ur', 'ur'],
  ['de', 'de'],
  ['en', 'en'],
  ['fr', 'en'],
  [null, 'en'],
])('a device in %s uses %s', (code, language) => {
  expect(pickLanguage(code)).toBe(language);
});

it('fills placeholders and keeps the same placeholders in every language', () => {
  expect(translate('en', 'settings.versionValue', { version: '1.2.3' })).toBe('App version: 1.2.3');
  expect(translate('ur', 'settings.versionValue', { version: '1.2.3' })).toContain('1.2.3');
  const holes = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
  for (const key of Object.keys(dictionaries.en) as (keyof typeof dictionaries.en)[]) {
    expect([key, holes(dictionaries.de[key])]).toEqual([key, holes(dictionaries.en[key])]);
    expect([key, holes(dictionaries.ur[key])]).toEqual([key, holes(dictionaries.en[key])]);
  }
});

it('names the day of a message relative to today', () => {
  const now = new Date(2026, 10, 14, 0, 30).getTime();
  expect(formatDay('en', new Date(2026, 10, 14, 0, 5).getTime(), now)).toBe('Today');
  expect(formatDay('de', new Date(2026, 10, 13, 23, 50).getTime(), now)).toBe('Gestern');
  expect(formatDay('en', new Date(2026, 10, 10, 9).getTime(), now)).toBe('Tue, Nov 10');
  expect(formatDay('en', new Date(2025, 10, 10, 9).getTime(), now)).toBe('Mon, Nov 10, 2025');
  expect(formatTime('en', new Date(2026, 10, 14, 14, 5).getTime())).toBe('2:05 PM');
});
