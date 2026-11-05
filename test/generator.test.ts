import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  NoteGenerator, DEFAULT_GENERATOR_SETTINGS, seededRandom, routeRole, hitEvents, nextGridBeat, padPatch,
  type GeneratorSettings, type NoteEvent,
} from '../src/index.js';

const base = (patch: Partial<GeneratorSettings> = {}): GeneratorSettings => ({ ...DEFAULT_GENERATOR_SETTINGS, ...patch });
const gen = (patch: Partial<GeneratorSettings>, seed = 1) =>
  new NoteGenerator(base(patch), { random: seededRandom(seed), chordRandom: seededRandom(seed + 1000) });
/** The whole stream up to `beats`, asked for in windows of `chunk` beats. */
function stream(patch: Partial<GeneratorSettings>, beats: number, chunk: number, seed = 1): NoteEvent[] {
  const g = gen(patch, seed), out: NoteEvent[] = [];
  g.start(0);
  for (let b = chunk; b < beats + 1e-9; b += chunk) out.push(...g.window(b));
  return out;
}
const strip = (events: NoteEvent[]) => events.map(({ hit: _hit, ...e }) => e);

test('window(): Single plays the root on every step, gate × step long', () => {
  const ev = stream({ mode: 'single', note: 9, octave: 3, interval: 8, gate: 50 }, 2, 1);
  assert.deepEqual(ev.map(e => [e.note, e.startBeat, e.lengthBeats, e.role]), [0, 0.5, 1, 1.5].map(b => [57, b, 0.25, 'note']));
});

test('window(): Chord plays the chord together, roles and roots', () => {
  const ev = stream({ mode: 'chord', chord: 'major-7', note: 0, octave: 3 }, 1, 1);
  assert.deepEqual(ev.map(e => e.note), [48, 52, 55, 59]);
  assert.ok(ev.every(e => e.role === 'chord' && e.root === 48 && e.startBeat === 0 && e.lengthBeats === 0.75));
  assert.equal(new Set(ev.map(e => e.hit)).size, 1, 'one hit');
});

test('window(): the stream does not depend on how it is cut into windows', () => {
  const patches: Partial<GeneratorSettings>[] = [
    { mode: 'chord', chordProgression: 'pop-1-5-6-4', chordStyle: 'charleston', voiceLeading: 'smooth', tension: 40 },
    { mode: 'chord', chordStyle: 'walk-random', interval: 8, strum: 20 },
    { mode: 'chord', chord: 'minor-9', arp: 'euclidean', arpHits: 5, arpSteps: 8, arpRotate: 2, interval: 16 },
    { mode: 'random', octaveRange: 3, interval: 16 },
    { mode: 'chord', chordProgression: 'jazz-2-5-1', chordStyle: 'push' },
  ];
  for (const p of patches) assert.deepEqual(strip(stream(p, 32, 0.37, 5)), strip(stream(p, 32, 4, 5)), JSON.stringify(p));
});

test('determinism: the same seed gives the same stream; another seed another one', () => {
  const p = { mode: 'chord', chord: 'major-9', arp: 'random', arpOctaves: 3, interval: 16, tension: 50 } as const;
  assert.deepEqual(stream(p, 16, 1, 42), stream(p, 16, 1, 42));
  assert.notDeepEqual(stream(p, 16, 1, 42).map(e => e.note), stream(p, 16, 1, 43).map(e => e.note));
  const r = seededRandom(7), xs = Array.from({ length: 1000 }, r);
  assert.ok(xs.every(x => x >= 0 && x < 1));
  assert.deepEqual(xs.slice(0, 5), Array.from({ length: 5 }, seededRandom(7)));
});

test('a bar style follows the bar; a progression changes chord on bar lines', () => {
  const ev = stream({ mode: 'chord', chordStyle: 'charleston', chordProgression: 'pop-1-5-6-4', progressionBars: 1 }, 16, 2);
  assert.deepEqual([...new Set(ev.map(e => e.startBeat))], [0, 1.5, 4, 5.5, 8, 9.5, 12, 13.5]);
  assert.deepEqual([0, 4, 8, 12].map(b => ev.find(e => e.startBeat === b)!.root % 12), [0, 7, 9, 5]);
});

test('Strum offsets are in seconds and follow the direction; strum keeps the hit together', () => {
  const ev = stream({ mode: 'chord', chord: 'major', strum: 20, interval: 8 }, 1, 1);
  const down = ev.filter(e => e.startBeat === 0), up = ev.filter(e => e.startBeat === 0.5);
  assert.deepEqual(down.map(e => [e.note, e.offsetSec]), [[48, 0], [52, 0.02], [55, 0.04]]);
  assert.deepEqual(up.map(e => [e.note, e.offsetSec]), [[55, 0], [52, 0.02], [48, 0.04]]);
});

test('muted steps keep the pattern\'s place (held keys over the generator)', () => {
  const p = { mode: 'chord', chord: 'major', arp: 'up', interval: 4 } as const;
  const g = gen(p);
  g.start(0);
  g.window(2, { muted: () => true });
  assert.deepEqual(g.window(4).map(e => [e.startBeat, e.note]), [[2, 55], [3, 48]], 'steps 3 and 4 of the arp');
});

test('start(): joining a running clock starts on the next grid line with the step counter on the beat', () => {
  const g = gen({ mode: 'chord', chord: 'major', arp: 'up', interval: 8 });
  assert.equal(g.start(5.3, { join: true }), 5.5);
  assert.equal(g.step, 11);
  assert.equal(g.window(6)[0].note, [48, 52, 55][11 % 3]);
  assert.equal(nextGridBeat(4, 1), 4); assert.equal(nextGridBeat(4.2, 0.5), 4.5);
});

test('chordPosition and jumpToChord', () => {
  const g = gen({ mode: 'chord', chordProgression: 'pop-1-5-6-4', progressionBars: 1 });
  g.start(0);
  g.window(1);
  assert.deepEqual(g.chordPosition(0.5), { index: 0, bar: 1, bars: 4 });
  assert.equal(g.jumpToChord(2, 1), true);
  assert.equal(g.jumpToChord(9, 1), false);
  const ev = g.window(12);
  assert.equal(ev.find(e => e.startBeat === 4)!.root % 12, 9, 'Am from the next bar');
  assert.deepEqual(g.chordPosition(8.5), { index: 3, bar: 4, bars: 4 }, 'bar 4 of the 4-bar progression');
});

test('routeRole: chord, root (with an octave) and top', () => {
  const ev = stream({ mode: 'chord', chord: 'major-7', note: 2, octave: 3, interval: 2 }, 4, 4);
  assert.equal(ev.length, 8);
  assert.deepEqual(routeRole(ev, 'root').map(e => [e.note, e.startBeat, e.role]), [[50, 0, 'root'], [50, 2, 'root']]);
  assert.deepEqual(routeRole(ev, 'root', { octave: 1 }).map(e => e.note), [26, 26]);
  assert.deepEqual(routeRole(ev, 'top').map(e => e.note), [61, 61]);
  assert.equal(routeRole(ev, 'chord').length, 8);
});

test('chord pads drive the generator through padPatch', () => {
  const pad = { chord: 'minor-9', root: 9, inversion: 1 };
  const own = stream({ mode: 'chord', note: 2, ...padPatch(pad, 'pad', 'off') }, 1, 1);
  const follow = stream({ mode: 'chord', note: 2, ...padPatch(pad, 'follow', 'off') }, 1, 1);
  assert.equal(own[0].root % 12, 9);
  assert.equal(follow[0].root % 12, 2);
});

test('hitEvents: lengthBeats is spanBeats × gate', () => {
  const [e] = hitEvents({ beat: 1, spanBeats: 0.5, gate: 0.75, velocity: 0.9, notes: [60], kind: 'plain', direction: null, strumMs: 0, chord: null, root: 60, role: 'note' }, 3);
  assert.deepEqual(e, { note: 60, velocity: 0.9, startBeat: 1, lengthBeats: 0.375, role: 'note', offsetSec: 0, spanBeats: 0.5, gate: 0.75, hit: 3, root: 60 });
});

test('pure: no DOM, Web Audio, timers or clocks in src/', () => {
  const dir = new URL('../../src/', import.meta.url);
  for (const f of readdirSync(dir)) {
    const code = readFileSync(new URL(f, dir), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    for (const word of ['window.', 'document', 'globalThis', 'AudioContext', 'AudioNode', 'setTimeout', 'setInterval', 'performance', 'Date.now', 'navigator', 'Worker'])
      assert.ok(!new RegExp(`\\b${word.replace('.', '\\.')}${word.endsWith('.') ? '' : '\\b'}`).test(code), `${f} uses ${word}`);
  }
});

test('clone(): a copy goes on exactly as the original would, and neither disturbs the other', () => {
  for (const patch of [
    { mode: 'chord', chordProgression: 'pop-1-5-6-4', chordStyle: 'charleston', voiceLeading: 'smooth' },
    { mode: 'chord', arp: 'up-down', arpOctaves: 2, interval: 8 },
    { mode: 'chord', chordStyle: 'push', chordProgression: 'pop-1-5-6-4', progressionBars: 1 },
    { mode: 'random', interval: 16 },
  ] as Partial<GeneratorSettings>[]) {
    const settings = { ...DEFAULT_GENERATOR_SETTINGS, ...patch } as GeneratorSettings;
    const a = new NoteGenerator(settings, { random: seededRandom(3), chordRandom: seededRandom(4) });
    const ref = new NoteGenerator(settings, { random: seededRandom(3), chordRandom: seededRandom(4) });
    a.start(0); ref.start(0);
    a.window(5.25); ref.window(5.25);
    a.jumpToChord(2, 6); ref.jumpToChord(2, 6);
    // The copy gets random functions in the same state as the original's (fresh seeds advanced alike).
    const r1 = seededRandom(3), r2 = seededRandom(4);
    const probe = new NoteGenerator(settings, { random: r1, chordRandom: r2 });
    probe.start(0); probe.window(5.25); probe.jumpToChord(2, 6);
    const b = a.clone({ random: r1, chordRandom: r2 });
    const expected = ref.window(20);
    assert.deepEqual(b.window(20), expected, `clone of ${JSON.stringify(patch)}`);
    assert.deepEqual(a.window(20), expected, 'the original is undisturbed');
  }
});
