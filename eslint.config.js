const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const globals = require('globals');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.expo/*', 'coverage/*', 'android/*'],
  },
  {
    files: ['scripts/**/*.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/**/*.test.{ts,tsx}'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/theme.ts', 'src/**/*.test.{ts,tsx}'],
    rules: {
      'react/jsx-no-literals': ['error', { noStrings: true, ignoreProps: true }],
      'no-restricted-syntax': ['error',
        { selector: 'Literal[value=/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/]', message: 'Use a colour token from src/theme.ts.' },
        { selector: 'Literal[value=/^(rgb|hsl)a?\\(/i]', message: 'Use a colour token from src/theme.ts.' },
        { selector: 'JSXAttribute[name.name=/^(accessibilityLabel|accessibilityHint|placeholder|title)$/] > Literal', message: 'Use t() for user-facing text.' },
        { selector: 'JSXAttribute[name.name=/^(accessibilityLabel|accessibilityHint|placeholder|title)$/] > JSXExpressionContainer > :matches(Literal[value=/./], TemplateLiteral)', message: 'Use t() for user-facing text.' },
      ],
    },
  },
]);
