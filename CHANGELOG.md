# Changelog

## [0.1.0] - 2026-11-04

First release: ASTRID's Note Generator logic, moved out of ASTRID (psemmelhack/NetComposer-Synth at 51adba6)
unchanged, plus the generator as a clock-free state machine.

- `NoteGenerator`: start, the step API (`nextBeat`, `stepHit`, `advance`, `barHits`, …) and `window(toBeat)`.
- `NoteEvent`, `hitEvents`, `placeHit`, `routeRole` (chord, root, top).
- From ASTRID, unchanged: `chords.ts`, `comp.ts`, `chord-pads.ts`, `key-arp.ts`, `rates.ts`, `notes.ts`
  (`generateNotes` now takes `GeneratorSettings`), `chord-pad-timing.ts`.
- `GeneratorSettings`, `DEFAULT_GENERATOR_SETTINGS`, `seededRandom`.
- Golden test: 255 of ASTRID's recorded note streams, replayed exactly.
