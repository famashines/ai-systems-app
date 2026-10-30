import { dictionaries, isRTL, languages, pickLanguage, translate } from '@/i18n';

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
