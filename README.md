# nc-notes

NetComposer's Note Generator: chords, progressions, chord styles, chord pads, the arp and Euclid rhythms, as timed
note events. It is the "brain" of ASTRID's Note Generator, moved out so the Studio's CALLIOPE module (and anything
else) can drive any instrument with it.

Pure TypeScript (ES modules with types). No DOM, no Web Audio, no timers, no clock of its own, no dependencies. MIT.
nc-notes was created by [Peter Semmelhack](https://psem.me/).

## What's in it

| Module | What it does |
| --- | --- |
| `generator.ts` | `NoteGenerator`: the step counter, the step grid, the progression's position, voicing memory, bar styles, Strum and Tension. Turns settings + a beat window into note events. |
| `notes.ts` | `generateNotes(settings, step)`: the notes of one step (Off, Single, Random, Chord, one arp note). |
| `chords.ts` | The chord library (`CHORD_LIBRARY`, categories, old-name aliases), voicings, inversions and spread, arp orders (`ARP_PATTERNS`), Euclid (`euclidOf`, `euclidHit`). |
| `comp.ts` | Chord mode: styles (Block, inversion walks, Oom-pah, Charleston, Push, Strum…), voice leading, Strum, Tension, the progression library and `resolveProgression`. |
| `chord-pads.ts` | The sixteen chord pads: favorites to pads, reorder, star, `padPatch` (what a pad click changes), both root modes. |
| `chord-pad-timing.ts` | When a pad click lands while playing (the next beat whose notes aren't queued yet). |
| `key-arp.ts` | The keyboard arp's pure parts: `HeldArp` (held and latched keys), `arpPattern`, `arpStepAt`, locked sequences (`sanitizeSequence`, `retuneSequence`). |
| `rates.ts` | Generator and arp rates: straight, dotted and triplet values of `interval`. |
| `follow.ts` | `PitchFollower` and `followPitch`: an instrument that keeps its own rhythm and takes the pitch (OLIVE Bass, NYX). |
| `events.ts` | `NoteEvent`, `hitEvents`, `placeHit`, `routeRole` (from `route.ts`, which needs no chord tables). |
| `random.ts` | `seededRandom(seed)`. |

## Use

```ts
import { NoteGenerator, seededRandom, routeRole, DEFAULT_GENERATOR_SETTINGS } from '@netcomposer/nc-notes';

const gen = new NoteGenerator(
  { ...DEFAULT_GENERATOR_SETTINGS, mode: 'chord', chordProgression: 'pop-1-5-6-4', chordStyle: 'charleston' },
  { random: seededRandom(1), chordRandom: seededRandom(2) },
);
gen.start(0);                       // Play on beat 0 (or { join: true } to enter a running clock)
const events = gen.window(4);       // every note from beat 0 up to beat 4
const bass = routeRole(events, 'root', { octave: 1 });
```

Call `window(toBeat)` again with a later beat as your clock moves (a little ahead of it, like any scheduler). Each
call continues where the last one stopped.

`gen.clone()` is a copy that goes on exactly where `gen` is. A host that sends ahead keeps clones as snapshots, so a
change can be played from a beat it has already sent: restore the snapshot, `window(changeBeat)` with the old
settings, change, `window(ahead)` again. The events from the change beat on keep their ids where nothing changed
(CALLIOPE resends from the change point this way, after an `off` from that beat).

### Settings

`GeneratorSettings` uses ASTRID's field names: `mode` (`off`, `single`, `chord`, `random`), `note`, `octave`,
`octaveRange`, `chord`, `inversion`, `interval` (steps per whole note: 4 = quarters, 16/3 = dotted eighths, 12 =
eighth triplets), `gate` (%), `arp`, `arpOctaves`, `arpSpread`, `arpHits`, `arpSteps`, `arpRotate`, `chordStyle`,
`voiceLeading`, `strum` (ms), `tension` (%), `chordProgression`, `progressionBars`, and the favorites and chord pads.
A whole ASTRID settings object can be passed as it is. Pass a function instead of an object to read live settings;
pass a new object when settings change (bar styles cache a bar's hits per settings object).

### Note events

```ts
interface NoteEvent {
  note: number;          // MIDI 0–127
  velocity: number;      // 0–1
  startBeat: number;     // on the host's clock
  lengthBeats: number;   // spanBeats × gate
  role: 'chord' | 'arp' | 'note' | 'root' | 'top';
  offsetSec: number;     // Strum: seconds after startBeat's time (Strum is set in ms, so it doesn't follow tempo)
  spanBeats: number;     // the step (or bar-style hit) the gate applies to
  gate: number;          // 0.1–1
  hit: number;           // which chord this note belongs to
  root: number;          // that chord's root (MIDI)
}
```

The generator emits `chord` (the notes of a chord), `arp` (one arp note) and `note` (Single, Random).
`routeRole(events, 'chord' | 'root' | 'top', { octave })` turns a stream into what one target plays: every note, each
chord's root once (in a chosen octave), or each chord's top note.

A host that maps beats to seconds the way ASTRID does should compute a note's length as
`(time(startBeat + spanBeats) − time(startBeat)) × gate`: that is ASTRID's arithmetic, bit for bit.

### The notes contract (v1)

How a source (CALLIOPE) hands notes to an instrument through the Studio, the same way for every module
(`src/contract.ts`):

- **Beats, sent ahead.** Events are beats on the Studio clock, sent a little ahead of time (a lookahead window), never
  "play now". The instrument maps each beat to its own audio time with the shared clock mapper when it schedules it.
- **Idempotent.** Every event has an `id` (`noteId(source, run, role, hit, index)`); a resend of the same event carries
  the same id and is ignored, so a target switched back on, or a reloaded frame, never plays a note twice.
- **Note-offs.** A Stop, a target removed or switched off, or a source going away sends `off`: the instrument drops
  that source's events it hasn't started and releases its sounding notes. Nothing hangs. A resend (`reason: 'restart'`,
  `atBeat`: a change heard on the next beat) drops what waits from that beat and lets notes already sounding ring.
- **Routes.** `routes` lists the sources playing an instrument now (role `chord`, `root` or `top`, and an octave). While
  any does, the instrument's own generator stands aside.

```ts
type NotesMessage =
  | { v: 1; kind: 'notes'; source: string; events: WireNote[] }       // WireNote = NoteEvent + { id, source }
  | { v: 1; kind: 'off'; source: string; reason: 'stop' | 'removed' | 'off' | 'restart'; atBeat?: number }
  | { v: 1; kind: 'routes'; routes: { source: string; name: string; role: 'chord' | 'root' | 'top'; octave?: number }[] };
```

- Sender: `routeForTarget(source, run, events, role, { octave })` (routeRole plus ids), `notesMessage`, `offMessage`,
  `routesMessage`.
- Receiver: `parseNotesMessage(x)` checks a message and copies it (null when invalid; `notesMessageError` says why),
  and `NotesInbox` keeps what is waiting in start order: `receive(msg)`, `take(due)`, `off(source, atBeat)`,
  `prune(beat)`, `active` (some source plays it).

#### For the Song Looper (0.6.0)

- **Played.** An instrument reports what was played on it by hand with `played` (`playedMessage`): notes (`on` and
  `off` with one id, a pad's `slice`), slot recalls (`slot`, as labelled from 1) and CALLIOPE chord pads (`pad` 1–16,
  or null when let go). Each carries the beat the player heard: press time minus the output latency, read from the
  audio clock (`AudioContext.getOutputTimestamp`), so a replay at that beat sounds when the key went down.
- **Controls.** Recorded slot and chord-pad changes go back with `controls` (`controlsMessage`), ahead and idempotent
  like notes. `NotesInbox.takeControls(due)` hands them out in beat order; an `off` drops the waiting ones.
- **Layer.** A route with `layer: true` adds to what the instrument plays: its own generator and keys keep going.
  Read `NotesInbox.standsAside` (a route that isn't a layer) to decide whether the generator stands aside.
- **Pads as notes.** Pads 1–16 travel as MIDI 36–51: `padNote(pad)`, `padOfNote(note)`.
- **Sound names (0.8.0).** A `played` note-on may carry `name`, the sound's name as the player sees it (a NYX pad's
  sample, at most `MAX_SOUND_NAME` characters), so LUPA can label a pass. Display only.
- **Takes (0.7.0).** LUPA's voice laps: LUCY reports a lap it kept as a `take` in `played` (the audio's name in its
  store, the beat it started, its length), and LUPA sends `take` controls back to play it (beat, `gain`,
  `offsetBeats`), to LUCY only. LUPA announces each lap ahead with a `lap` control (beat, `lengthBeats`), so an armed
  LUCY records it.

```ts
type PlayedEvent =
  | { type: 'note'; id: string; beat: number; on: boolean; note: number; velocity?: number; slice?: number }
  | { type: 'slot'; id: string; beat: number; slot: number }
  | { type: 'chordPad'; id: string; beat: number; pad: number | null }
  | { type: 'take'; id: string; beat: number; take: string; lengthBeats: number; gain?: number; offsetBeats?: number }
  | { type: 'lap'; id: string; beat: number; lengthBeats: number };
// { v: 1; kind: 'played'; source; events: PlayedEvent[] }  instrument -> Studio
// { v: 1; kind: 'controls'; source; events: (slot | chordPad | take | lap)[] }  Looper -> instrument
```

### The Bass rule

A Bass under CALLIOPE keeps its own rhythm and takes the pitch at each of its steps: the root of whatever chord is
sounding then (Peter, 2026-11-04). `ChordTrack` follows a source's stream (`add(events)`, `off(atBeat)`) and answers
`chordAt(beat)` (the last hit started at or before the beat: its root, notes, and whether they still sound) and
`pitchAt(beat, { octave })`. A gap between chords keeps the last chord's harmony; an `off` ends it. `chordAt(events,
beat)` and `pitchAt(events, beat)` do the same on a list.

### Step by step (how ASTRID drives it)

ASTRID keeps its own scheduler (20 ms tick, 150 ms lookahead, audio-time checks) and asks the generator one step at
a time, so its timing arithmetic is exactly what it was:

```ts
gen.followInterval();                                   // a changed Interval starts its grid on the next step
if (late) skipped += gen.skipTo(beatAt(now + 0.008));  // after a stalled tab: skip, don't burst
gen.applyJump(beatAt(now));                            // a progression jump reaching its bar
while (timeAt(gen.nextBeat()) < end) {
  const hit = gen.stepHit(gen.nextBeat());             // null: a rest
  if (hit) play(hit);                                   // placeHit(hit.notes, hit) gives each note's strum offset
  gen.advance();
}
if (gen.barStyleActive()) for (const hit of gen.barHits(b => timeAt(b) < end, () => keysHeld)) play(hit);
else gen.syncBars();
```

`advanceStep()` counts a step the host played itself (ASTRID's held keys and locked sequences take over the grid,
and the generator keeps its place). `chordPosition(beat)` and `jumpToChord(index, earliestBeat)` drive a progression
strip.

## Determinism

Nothing in nc-notes reads a clock or `Math.random` on its own. The generator takes two random functions:
`random` (Random mode, the random arp orders) and `chordRandom` (Inversion walk random, Tension). Pass seeded ones
(`seededRandom(seed)`) and the same settings give the same events, however the windows are cut. ASTRID passes
`Math.random`, so each Play is new.

## What stays in the host (ASTRID)

nc-notes decides what to play and when, in beats. ASTRID's voice engine (`lib/synth-audio/src/engine.ts`) keeps:

- **The clock and timing:** the transport and NC Sync, mapping beats to audio time, the lookahead and its stall
  stretch, late-note nudges, pending stops and bar-aligned preset loads. These are about one audio context.
- **The keyboard arp's scheduling, latch and locked sequences:** the held-key arp runs on live keys and on its own
  transport when the clock is stopped, rewinds queued steps when keys change, and moves between clocks. Its pure parts
  (`HeldArp`, `arpPattern`, `arpStepAt`, `sanitizeSequence`, `retuneSequence`) are here; the queue that ties steps to
  voices is ASTRID's. Slots (snapshots) keep storing locked sequences in ASTRID's format.
- **Voices:** envelopes, voice stealing, drift, the sound. Situation's older modes (melody, progression, event) and
  the semantic layer (register, duration) also stay there; they are not generator modes.

### Pitch only: OLIVE Bass and NYX (0.4.0)

Some instruments keep their own rhythm and take only the pitch from a source (Peter, 2026-11-05). OLIVE Bass plays its
own steps, accents and slides, and each step's pitch is the root of the chord sounding at that step's beat (its OCT
lane still moves it); NYX plays its own pattern, and the pads set to follow are retuned to that root at each hit.

Such an instrument takes the contract's messages into a `PitchFollower` instead of a `NotesInbox`: the source routes it
the `root` role, the follower keeps the chords as a timeline, and the instrument looks up `rootAt(beat)` for each of its
own steps when it schedules it (or posts `points()` to its audio thread and looks them up there: sample-accurate, the
same beat its step plays on). `followPitch(root, { low, transpose })` places the root: its pitch class in the octave
from `low`, plus the whole octaves of the route's `transpose` (CALLIOPE's Octave). A Studio hands a pitch follower the
hit in effect now as well as what is coming when it is switched on, so it has a pitch at once.

## Proof it plays what ASTRID played

`test/golden/astrid-51adba6.json` holds 255 note streams (12,754 notes) recorded from ASTRID's own scheduler before
the move (psemmelhack/NetComposer-Synth at 51adba6): every Mode, the whole chord library, inversions and spreads, every
arp order at 1–3 octaves, Euclid, rates and gates, every chord style, every progression and bar length, chord pads in
both root modes, at several tempos. `test/golden.test.ts` replays each with nc-notes alone and must match exactly (no
tolerance). ASTRID's own suite checks a further 11 live cases (changes while playing, the keyboard arp, latch, locked
sequences) through its engine.

## Who uses it

- **ASTRID** (NetComposer's synth, [psemmelhack/NetComposer-Synth](https://github.com/psemmelhack/NetComposer-Synth)):
  vendored in `lib/nc-notes`, driving its built-in Note Generator.
- **NetComposer Studio** ([netcomposer-art/nc-studio](https://github.com/netcomposer-art/nc-studio)): vendored in
  `vendor/nc-notes`; its notes bus carries these events from a source to each target's frame.
- **CALLIOPE** ([netcomposer-art/calliope](https://github.com/netcomposer-art/calliope)): the Studio's generator module, playing Synth (notes), Bass and Sampler (pitch only).

## Develop

```sh
npm ci
npm run typecheck
npm test        # compiles the tests and runs them with plain node
npm run build   # tsc -> dist/
```

Apps vendor a copy at a pinned commit (ASTRID: `lib/nc-notes`, with sha256 pins in its `VENDORED.md`). Change it here,
then re-vendor; never edit a copy.

## License

MIT. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
