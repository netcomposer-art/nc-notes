// ASTRID's golden note streams, replayed with nc-notes alone. The streams were recorded from ASTRID's own scheduler
// (psemmelhack/NetComposer-Synth at 51adba6, before the generator moved here): every createVoice call as
// [MIDI note, start s from Play, length s, velocity]. This test drives a NoteGenerator the way ASTRID's scheduler
// does (a 20 ms tick, 150 ms lookahead, a constant-tempo clock with nc-clock's arithmetic) and must produce every
// stream exactly: no tolerance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NoteGenerator, placeHit, type GeneratorSettings, type GeneratorHit } from '../src/index.js';

type Row = [number, number, number, number];
interface Case { settings: GeneratorSettings & { tempo: number }; bars: number; seed: number; rows: Row[] }
const golden = JSON.parse(readFileSync(new URL('../../test/golden/astrid-51adba6.json', import.meta.url), 'utf8')) as Record<string, Case>;

/** The Lehmer generator ASTRID's tests seed Math.random and chordRandom with. */
const seeded = (seed = 1) => { let x = seed; return () => { x = (Math.imul(x, 48271) >>> 0) % 2147483647; return x / 2147483647; }; };

function replay({ settings, bars, seed }: Case): Row[] {
  const bpm = settings.tempo, start = 1.01;
  // nc-clock's TempoMap with one segment anchored at (start, beat 0): time = s.time + (beat - s.beat) * 60 / s.bpm.
  const timeAt = (beat: number) => start + (beat - 0) * 60 / bpm;
  const random = seeded(seed);
  random(); // ASTRID's engine draws its drift seed from Math.random first
  const gen = new NoteGenerator(settings, { random, chordRandom: seeded(seed * 31 + 1) });
  const rows: Row[] = [];
  const voices = (hit: GeneratorHit, time: number, duration: number) => {
    for (const n of placeHit(hit.notes, hit)) rows.push([n.midi, time + n.offset - start, duration, hit.velocity]);
  };
  const tick = (now: number) => {
    gen.followInterval();
    const grid = gen.stepBeats(), end = now + 0.15;
    for (let guard = 0; guard < 256; guard++) {
      const beat = gen.nextBeat(), time = timeAt(beat);
      if (time >= end) break;
      const hit = gen.stepHit(beat);
      if (hit) voices(hit, time, (timeAt(beat + grid) - time) * hit.gate);
      gen.advance();
    }
    if (gen.barStyleActive()) {
      for (const hit of gen.barHits(beat => timeAt(beat) < end)) {
        const time = timeAt(hit.beat);
        voices(hit, time, (timeAt(hit.beat + hit.spanBeats) - time) * hit.gate);
      }
    } else gen.syncBars();
  };
  gen.start(0);
  let now = 1;
  tick(now);
  const endAt = now + (bars * 4 * 60 / bpm + 0.05);
  while (now < endAt - 1e-9) { now += 0.02; tick(now); }
  return rows;
}

test('replays ASTRID\'s golden note streams exactly', () => {
  const bad: string[] = [];
  for (const [name, c] of Object.entries(golden)) {
    try { assert.deepStrictEqual(replay(c), c.rows); } catch { bad.push(name); }
  }
  assert.deepEqual(bad, []);
  assert.ok(Object.keys(golden).length >= 250);
});
