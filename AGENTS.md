# AGENTS.md: nc-notes

For AI agents (and people) working in this repo. Short on purpose; the README has the detail.

## What this is

`@netcomposer/nc-notes`: NetComposer's Note Generator. Chords, progressions, chord styles, chord pads, the arp and
Euclid rhythms, as note events on beats. It came out of ASTRID (the synth) unchanged; ASTRID vendors it and drives its
built-in generator with it, and the Studio's CALLIOPE module will drive other instruments with it. TypeScript, no
runtime dependencies, MIT; created by Peter Semmelhack (keep the credit in NOTICE).

## Commands

```sh
npm ci
npm run typecheck
npm test            # compiles the tests and runs them with plain node (no browser)
npm run build       # tsc -> dist/
```

CI runs `npm ci`, typecheck, test, build on Node 20, 22 and 24.

## Rules

- **Pure:** nothing in `src/` touches `window`, `document`, Web Audio, timers, `Worker` or `Date` (a test enforces
  it; `tsconfig.json` has no DOM lib). Times are beats; the host maps them to its clock.
- **Deterministic:** never call `Math.random` directly in the generator; use the `random` / `chordRandom` it is given.
- **The notes are the reference:** `test/golden/astrid-51adba6.json` is what ASTRID played before the move. A change
  that alters any stream needs Peter's yes, a regenerated fixture and a CHANGELOG line saying what changed and why.
- **Old saves load:** ids (chords, progressions, arp orders and their numbers, styles) are never renamed or reused.
- JSDoc on new exports, and a test for every behaviour change. No new runtime dependencies.
- **Vendoring:** apps copy this repo (ASTRID: `lib/nc-notes`, sha256-pinned in its `VENDORED.md`) at a pinned commit.
  Change it here, then re-vendor; never edit a copy.
- Copy: short plain sentences.

## Where to ask

Open an issue on [netcomposer-art/nc-notes](https://github.com/netcomposer-art/nc-notes/issues). Peter Semmelhack
decides product, sound and design questions.
