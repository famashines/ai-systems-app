# CLAUDE.md

The rules for all ai-systems repos are in the docs repo:
[`docs/CLAUDE.md`](https://github.com/famashines/ai-systems-docs/blob/main/CLAUDE.md).

## Commands

| Command | Does |
| ------- | ---- |
| `npm ci` | install from the lock file (Node 22.13.0, `.nvmrc`) |
| `npm run android` | prebuild, build and install the dev build, start Metro |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint and the no-comments check |
| `npm test` | Jest with coverage |
| `npm run verify` | all checks |

## Rules for this repo

- `src/app` holds routes only. Tests sit next to the code (`*.test.ts`),
  screen tests in `src/screens.test.tsx`.
- All UI text comes from `src/i18n/*.json` through `t()`. Add each key to
  all three files. ESLint rejects text in JSX.
- All colours, spacing, type and radius come from `src/theme.ts`. ESLint
  rejects colour literals. Run `npm run contrast` after a colour change.
- Corners match Taseen: `radius.md` (8) for chips, buttons, cards and
  sheets, `radius.field` (14) for input fields, `radius.full` for circles
  and pills. Do not use `borderCurve`. ESLint rejects number literals for
  a radius and any `borderCurve`.
- Touch targets are 48 dp at least. Each control has a TalkBack label.
- Install a package with `npx expo install`. A new dependency needs an ADR.
- Do not commit `android/` or `ios/`; prebuild makes them.
