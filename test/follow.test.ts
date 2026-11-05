// Pitch from a source (CALLIOPE stage 4): PitchFollower, followPitch, ChordTrack.cut and points, route transpose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ChordTrack, DEFAULT_GENERATOR_SETTINGS, NoteGenerator, PitchFollower, followPitch, noteId, notesMessage, notesMessageError,
  offMessage, parseNotesMessage, routeForTarget, routesMessage, runOfId,
  type GeneratorSettings, type NoteEvent,
} from '../src/index.js';

const chordSettings: GeneratorSettings = {
  ...DEFAULT_GENERATOR_SETTINGS, mode: 'chord', chord: 'Major', chordProgression: 'pop-1-5-6-4', progressionBars: 1, interval: 4, gate: 50,
} as GeneratorSettings;

function run(settings: GeneratorSettings, toBeat: number): NoteEvent[] {
  const gen = new NoteGenerator(settings, { random: () => 0.5, chordRandom: () => 0.5 });
  gen.start(0);
  return gen.window(toBeat);
}
const ROUTE = { source: 'cal', name: 'CALLIOPE 1', role: 'root' as const };

test('followPitch: the pitch class in the octave from low, then the whole octaves of transpose', () => {
  // Bass: E1 (28) up to D#2 (39).
  assert.equal(followPitch(57, { low: 28 }), 33, 'A3 -> A1');
  assert.equal(followPitch(48, { low: 28 }), 36, 'C3 -> C2');
  assert.equal(followPitch(52, { low: 28 }), 28, 'E3 -> E1');
  assert.equal(followPitch(51, { low: 28 }), 39, 'D#3 -> D#2');
  // The root as sent already carries the transpose: only its octaves are added again.
  assert.equal(followPitch(57 - 12, { low: 28, transpose: -12 }), 21, 'Octave -1: A0');
  assert.equal(followPitch(57 + 24, { low: 28, transpose: 24 }), 57, 'Octave +2: A3');
  // NYX: a pad recorded at C3 (48): low 42 (F#2), so -6 … +5 semitones.
  assert.equal(followPitch(57, { low: 42 }) - 48, -3, 'A: three down');
  assert.equal(followPitch(53, { low: 42 }) - 48, 5, 'F: five up');
  assert.equal(followPitch(54, { low: 42 }) - 48, -6, 'F#: a tritone down');
  assert.equal(followPitch(0, { low: -10 }), 0, 'clamped to MIDI');
  assert.equal(followPitch(127, { low: 125, transpose: 48 }), 127, 'clamped to MIDI');
});

test('route transpose: optional, checked, copied; runOfId reads the run back', () => {
  const r = routesMessage([{ ...ROUTE, transpose: -12 }]);
  assert.equal(notesMessageError(r), null);
  assert.deepEqual(parseNotesMessage(r), r);
  assert.match(String(notesMessageError(routesMessage([{ ...ROUTE, transpose: 1.5 }]))), /transpose/);
  assert.match(String(notesMessageError(routesMessage([{ ...ROUTE, transpose: 60 }]))), /transpose/);
  const plain = routesMessage([ROUTE]);
  assert.deepEqual(parseNotesMessage(plain), plain, 'absent stays absent (a v1 route)');
  assert.equal(runOfId(noteId('calliope#2', 7, 'root', 3, 0)), 7);
  assert.equal(runOfId('a|b|c|d|e|f'.replace('c', 'x')), null);
  assert.equal(runOfId('nope'), null);
});

test('ChordTrack.cut: a resend from a beat keeps the chord before it (no gap); points list the changes', () => {
  const track = new ChordTrack();
  track.add(run(chordSettings, 16));
  track.cut(6);
  assert.equal(track.pitchAt(7)! % 12, 7, 'G still in effect after the cut (no gap, unlike off)');
  assert.ok(track.points().every(p => p.beat < 6));
  const off = new ChordTrack();
  off.add(run(chordSettings, 16));
  off.off(6);
  assert.equal(off.pitchAt(7), null, 'off ends the chord');
  assert.deepEqual(off.points(5.5).map(p => [p.beat, p.root === null ? null : p.root % 12]), [[5, 7], [6, null]]);
});

test('PitchFollower: the root at each beat from the followed source only, across runs, offs and resends', () => {
  const f = new PitchFollower();
  const events = run(chordSettings, 16);
  const wired = routeForTarget('cal', 1, events, 'root');
  // Notes before routes: not followed yet.
  f.receive(notesMessage('cal', wired));
  assert.equal(f.rootAt(0), null);
  f.receive(routesMessage([{ ...ROUTE, transpose: -12 }]));
  assert.equal(f.route?.transpose, -12);
  f.receive(notesMessage('cal', wired));
  assert.deepEqual([0, 4, 8, 12, 15.75].map(b => f.rootAt(b)! % 12), [0, 7, 9, 5, 5], 'C G A F, F holds');
  // Another source's notes are ignored (it isn't the first route).
  const other = routeForTarget('cal2', 1, events.map(e => ({ ...e, root: e.root + 1 })), 'root');
  f.receive(routesMessage([ROUTE, { ...ROUTE, source: 'cal2', name: 'CALLIOPE 2' }]));
  f.receive(notesMessage('cal2', other));
  assert.equal(f.rootAt(0)! % 12, 0);
  // A restart from beat 6: the chord before it holds until a resent hit (no gap), then the resend.
  const v = f.version;
  f.receive(offMessage('cal', 'restart', 6));
  assert.ok(f.version > v);
  assert.equal(f.rootAt(7)! % 12, 7, 'no gap at the change');
  const resent = wired.filter(e => e.startBeat >= 8).map(e => ({ ...e, root: e.root + 2 }));
  f.receive(notesMessage('cal', resent));
  assert.equal(f.rootAt(8)! % 12, 11, 'the resend takes over from its own hit');
  // Stop: the chord in effect holds (a step already on its way when the clock stopped plays it), at any beat, until
  // the next run replaces the old timeline (its beats start again).
  const atStop = f.rootAt(1000);
  f.receive(offMessage('cal', 'stop'));
  assert.equal(f.rootAt(8), atStop);
  assert.equal(f.rootAt(-5), atStop);
  assert.deepEqual(f.points(), [{ beat: Number.NEGATIVE_INFINITY, root: atStop }]);
  f.receive(notesMessage('cal', routeForTarget('cal', 2, run({ ...chordSettings, chordProgression: 'pop-6-4-1-5' } as GeneratorSettings, 4), 'root')));
  assert.equal(f.rootAt(0)! % 12, 9, 'run 2 from beat 0: Am');
  // A late event of run 1 is ignored.
  f.receive(notesMessage('cal', wired.slice(0, 1)));
  assert.equal(f.rootAt(0)! % 12, 9);
  assert.ok(f.stats.ignored >= 2);
  // An off with a beat ends the chord there; the timeline shows it.
  f.receive(offMessage('cal', 'off', 2));
  assert.equal(f.rootAt(2.5), null);
  assert.equal(f.points(1).at(-1)!.root, null);
  // Routes gone: nothing followed, own pitches.
  f.receive(routesMessage([]));
  assert.equal(f.active, false);
  assert.equal(f.rootAt(0), null);
  assert.deepEqual(f.points(), []);
  assert.equal(f.receive({ v: 1, kind: 'nope' }), null);
  assert.equal(f.stats.invalid, 1);
});

test('PitchFollower: a target switched off and on again (or a new Octave) gets the chord in effect again', () => {
  const f = new PitchFollower();
  const wired = routeForTarget('cal', 1, run(chordSettings, 8), 'root');
  f.receive(routesMessage([ROUTE]));
  f.receive(notesMessage('cal', wired));
  // The Studio's bus on a new Octave: off (no beat), routes, then what is in effect now and coming.
  f.receive(offMessage('cal', 'off'));
  assert.equal(f.rootAt(5), null);
  f.receive(routesMessage([{ ...ROUTE, transpose: 12 }]));
  f.receive(notesMessage('cal', wired.filter(e => e.startBeat >= 4).map(e => ({ ...e, note: e.note + 12, root: e.root + 12 }))));
  assert.equal(f.rootAt(5)! % 12, 7);
  f.prune(7);
  assert.equal(f.rootAt(7)! % 12, 7, 'pruning keeps the chord in effect');
});

test('PitchFollower: a Stop holds the root until the next run; an off for a target or a new route ends it', () => {
  const f = new PitchFollower();
  f.receive(routesMessage([ROUTE]));
  f.receive(notesMessage('cal', routeForTarget('cal', 1, run(chordSettings, 8), 'root')));
  f.receive(offMessage('cal', 'stop'));
  assert.equal(f.rootAt(0)! % 12, 7, 'G, the chord at the end');
  f.receive(offMessage('cal', 'off'));
  assert.equal(f.rootAt(0), null, 'switched off (or a new Octave): nothing held');
  f.receive(notesMessage('cal', routeForTarget('cal', 2, run(chordSettings, 4), 'root')));
  f.receive(offMessage('cal', 'stop'));
  f.receive(routesMessage([]));
  f.receive(routesMessage([ROUTE]));
  assert.equal(f.rootAt(0), null, 'routes gone and back: nothing held');
});
