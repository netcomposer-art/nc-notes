# Changelog

## [0.7.0] - 2026-11-11

For LUPA's voice laps (v1b; decision 14 of the Song Looper spec revision 2): LUCY records the mic one lap at a time,
and LUPA plays the laps it kept. No change to any note stream (the golden test still replays ASTRID's 255 streams
exactly). The contract stays v1: a new control type, which a receiver from before refuses with its message (`bad
type`): LUPA sends take controls to LUCY only (the Studio's targeted send), so no other receiver sees one.

- Contract: `TakeEvent` (`type: 'take'`, id, beat, `take` (the audio's name in the recorder's store), `lengthBeats`
  (above 0, at most `MAX_TAKE_BEATS`), and for controls `gain` (0–`MAX_TAKE_GAIN`) and `offsetBeats`). A
  `ControlEvent`, so `played` (LUCY: a lap kept) and `controls` (LUPA: play it) carry it; `controlEventError` checks it.
- Contract: `LapEvent` (`type: 'lap'`, id, beat, `lengthBeats`): LUPA announces each lap ahead, as a control to LUCY
  only, so an armed LUCY records it; an `off` drops the laps not begun.

## [0.6.0] - 2026-11-10

For the Song Looper (step 1 of its build; spec revision 2, approved by Peter 2026-11-10): instruments report what is
played on them by hand, and the Looper plays it back. No change to any note stream (the golden test still replays
ASTRID's 255 streams exactly). The contract stays v1: two new message kinds, which a receiver from before drops as
unknown, and two new optional fields, which it ignores.

- Contract: `played` (`playedMessage(source, events)`), from an instrument to the Studio: `PlayedNote` (`on` and `off`
  with one id, the beat the player heard, MIDI note, velocity, a pad's `slice`), `SlotEvent` (a slot recalled by hand,
  1–`MAX_SLOT`) and `ChordPadEvent` (a CALLIOPE chord pad latched, 1–16, or let go, null). `playedEventError` says what
  is wrong with one.
- Contract: `controls` (`controlsMessage(source, events)`): slot and chord-pad changes to make at their beats, sent
  ahead and idempotent by id like notes. `NotesInbox` keeps them (`controlsSize`, `takeControls(due)`); an `off`
  drops the waiting ones; `prune` drops past ones. `controlEventError` checks one.
- Contract: `NotesRoute.layer` (optional): the source adds to what the instrument plays, so its own generator and keys
  keep playing. `NotesInbox.standsAside` is true only while a route that isn't a layer plays it (`active` is
  unchanged: any route). A receiver from before ignores `layer` and stands aside.
- Pads as notes: `padNote(pad)` and `padOfNote(note)` (pads 1–16 are MIDI 36–51, `PAD_NOTE_BASE`), and
  `WireNote.slice` (optional, 0–`MAX_SLICE`) for a pad's slice.
- `PitchFollower` ignores `played` and `controls` (no pitch in them), even from the source it follows.

## [0.5.0] - 2026-11-05

For CALLIOPE: a pad clicked while the Studio is stopped is heard at once (Peter, 2026-11-05: he clicked a pad, heard
nothing and thought it was broken). No change to any note stream (the golden test still replays ASTRID's 255 streams
exactly). The contract stays v1: one new message kind, which a receiver from before drops as unknown (nothing plays
there, nothing else changes).

- Contract: `audition` (`auditionMessage(source, events, holdSec)`): routed notes played now, once, each held
  `holdSec` (at most `MAX_AUDITION_HOLD_SEC`, 8 s; at most `MAX_AUDITION_NOTES`, 64) and released; `startBeat` and the
  gate are not read. A newer audition from the same source releases the one before; an `off` releases it too.
  `NotesInbox` takes it and keeps nothing.
- `auditionEvents(settings, hit?)`: the chord a pad would play, as one Block hit (the generator's voicing; no arp,
  progression, strum or colour tone), at beat 0. `AUDITION_HOLD_SEC` (1.5 s) is the default hold.

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
