# Changelog

## [0.4.1] - 2026-11-05

- `PitchFollower`: a Stop (`off` 'stop' with no beat) keeps the timeline until the next run (an off for the target
  or a new route still ends it). An instrument's clock stops a moment after the source hears it: a Bass step already
  on its way at the Stop played its own note; now it plays the root at its beat. Found by nc-studio's pitch-timing
  test.

## [0.4.0] - 2026-11-05

For CALLIOPE (stage 4): OLIVE Bass and NYX keep their own rhythm and take the pitch. No change to any note stream (the
golden test still replays ASTRID's 255 streams exactly). The contract stays v1: one new optional field.

- `follow.ts`: `PitchFollower`, the receiving side for an instrument that takes only the pitch: it keeps the followed
  source's chords as a timeline and answers `rootAt(beat)`; `points(fromBeat)` hands the timeline to an audio thread.
  Follows the first route; a newer run replaces the timeline, an older run's events are ignored; `off` 'restart'
  cuts without a gap, any other `off` ends the chord. `followPitch(root, { low, transpose })` places a root's pitch
  class in the octave from `low` and adds the transpose's whole octaves (Bass: E1 to D#2; NYX: a pad's own note −6 …
  +5).
- `routeRole` moved to `route.ts` (still exported from `events.ts` and the index): the contract no longer imports the
  chord tables, so an instrument that imports `follow.ts` or `contract.ts` directly bundles only those (OLIVE Bass:
  about 3 kB gz less).
- `ChordTrack.cut(atBeat)` (a resend from that beat: the chord before it holds, no gap) and `ChordTrack.points()`.
- Contract: `NotesRoute.transpose` (optional, whole semitones, at most ±48: what the source moved this target's notes
  by, CALLIOPE's Octave × 12). A receiver from before ignores it. `runOfId(id)` reads a `noteId`'s run.

## [0.3.0] - 2026-11-04

For CALLIOPE (stage 3): changes heard on the next beat. No change to any note stream (the golden test still replays
ASTRID's 255 streams exactly).

- `NoteGenerator.clone(options?)`: a copy that goes on exactly where the generator is (grid, step counter, progression
  place and pending jump, voicing memory, bar style position, event serials). A host keeps copies as snapshots and plays
  a change from a beat it has already sent: restore the snapshot, play up to the change beat, change, play on (same
  ids for what didn't change, so the resend is safe). `options` may replace the settings source and random functions.
- Contract (docs only, no shape change): an `off` with reason `'restart'` and `atBeat` is a resend from that beat:
  receivers drop what waits from there; notes already sounding keep their length.

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
