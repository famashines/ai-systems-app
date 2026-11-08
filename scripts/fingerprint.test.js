const { verdict } = require('./fingerprint');

test('allows an update only when the fingerprint is the one of the last store release', () => {
  expect(verdict('abc', 'abc')).toBeNull();
  expect(verdict('abc', 'def')).toMatch(/differs/);
  expect(verdict('abc', '')).toMatch(/no native fingerprint/);
});
