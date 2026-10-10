# Contributing to Turnwise

Thanks for helping. Turnwise is small on purpose, so changes stay reviewable.

## Setup

```bash
npm install
npm start          # build and launch the app
```

You need Windows 10/11 and Node.js 22+. For a turn against a real model, configure an endpoint in Settings or in `.env` (see the README).

## Before you open a pull request

Run the gates that don't need an API key; CI runs the same ones:

```bash
npm run typecheck
npm run test:ui
npm run selftest
npm run shots      # headless screenshots + interaction checks; fails on overflow or console errors
```

If you touch the main process, the window or the preload, also run `npm run smoke`. If you touch a protocol client, run `npm run e2e:live` or `npm run e2e:anthropic` against your endpoint and paste the last lines in the PR.

When you fix a bug, add the test that would have caught it.

## Code

- TypeScript strict. No `any`, `@ts-ignore` or `as` casts to silence the compiler; fix the type instead.
- Errors are surfaced with context, never swallowed.
- Pure logic goes in functions that `scripts/ui-selftest.ts` can test without Electron or the network.
- Identifiers and comments may be in English or Spanish; the existing code mixes both. Commit messages in English.

## UI

The UI follows [DESIGN-DNA.md](DESIGN-DNA.md). Read it before changing anything visual:

- Colors, spacing, radii and durations come from the tokens in `styles.css`. No literal `z-index`, no `!important`.
- No chat bubbles, no card per tool call, no gradients.
- Interface copy is in Spanish for now: past tense for what was done ("Leyó", "Editó"), actions named by their result ("Deshacer turno"). English i18n is welcome as its own PR.
- If you change a color token, re-measure contrast and update §10 of the DNA.
- Attach before and after screenshots from `npm run shots` (they land in `review/shots/`).

## Good first contributions

Look for issues labeled [`good first issue`](https://github.com/codavidgarcia/turnwise/labels/good%20first%20issue). Verifying an endpoint from the README table is a quick one: run `npm run e2e:live` against it and report the result.
