# Changelog

## [0.2.0] - 2026-11-04

The notes contract and the Bass rule (CALLIOPE stage 2). No change to any note stream (the golden test still
replays ASTRID's 255 streams exactly).

- `contract.ts`: the notes contract v1 (`NOTES_VERSION`): `WireNote`, `NotesMessage` (`notes`, `off`, `routes`),
  `NotesRoute`; `noteId`, `routeForTarget`; `notesMessage`, `offMessage`, `routesMessage`; `notesMessageError`,
  `parseNotesMessage`; `NotesInbox` (idempotent by id, start order, off, prune).
- `chord-track.ts`: `ChordTrack` (`chordAt`, `pitchAt`, `off`, `prune`), `chordAt` and `pitchAt` on a list, `inOctave`:
  the Bass keeps its rhythm and takes the root of the chord sounding at each of its steps.

## [0.1.0] - 2026-11-04

First release: ASTRID's Note Generator logic, moved out of ASTRID (psemmelhack/NetComposer-Synth at 51adba6)
unchanged, plus the generator as a clock-free state machine.

- `NoteGenerator`: start, the step API (`nextBeat`, `stepHit`, `advance`, `barHits`, …) and `window(toBeat)`.
- `NoteEvent`, `hitEvents`, `placeHit`, `routeRole` (chord, root, top).
- From ASTRID, unchanged: `chords.ts`, `comp.ts`, `chord-pads.ts`, `key-arp.ts`, `rates.ts`, `notes.ts`
  (`generateNotes` now takes `GeneratorSettings`), `chord-pad-timing.ts`.
- `GeneratorSettings`, `DEFAULT_GENERATOR_SETTINGS`, `seededRandom`.
- Golden test: 255 of ASTRID's recorded note streams, replayed exactly.
