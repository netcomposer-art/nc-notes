// From ASTRID's lib/synth-audio/src/notes.test.ts (moved with generateNotes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateNotes, getChord, DEFAULT_GENERATOR_SETTINGS, type GeneratorSettings } from '../src/index.js';

// ASTRID's CHORDS table (types.ts): the nine classic chord names.
const CHORDS = Object.fromEntries(['Major', 'Minor', 'Diminished', 'Augmented', 'Major 7th', 'Minor 7th', 'Dominant 7th', 'Sus2', 'Sus4']
  .map(name => [name, [...getChord(name).intervals]]));

const settings: GeneratorSettings = { ...DEFAULT_GENERATOR_SETTINGS, mode: 'chord', chord: 'Major', arp: 'up' };
const sequence = (patch: Partial<GeneratorSettings>, count: number) =>
  Array.from({ length: count }, (_, step) => generateNotes({ ...settings, ...patch }, step)[0]);

test('ascending and descending span the selected octaves before repeating', () => {
  assert.deepEqual(sequence({ arpOctaves: 2 }, 7), [48, 52, 55, 60, 64, 67, 48]);
  assert.deepEqual(sequence({ arp: 'down', arpOctaves: 2 }, 7), [67, 64, 60, 55, 52, 48, 67]);
});
test('Up/Down and Down/Up reverse without repeating endpoints', () => {
  assert.deepEqual(sequence({ arp: 'up-down' }, 9), [48, 52, 55, 52, 48, 52, 55, 52, 48]);
  assert.deepEqual(sequence({ arp: 'down-up' }, 9), [55, 52, 48, 52, 55, 52, 48, 52, 55]);
  assert.deepEqual(sequence({ arp: 'up-down', arpOctaves: 2 }, 12), [48, 52, 55, 60, 64, 67, 64, 60, 55, 52, 48, 52]);
});
test('all chord types retain simultaneous chord behavior with arpeggiation off', () => {
  for (const [chord, offsets] of Object.entries(CHORDS)) {
    assert.deepEqual(generateNotes({ ...settings, chord, arp: 'off', arpOctaves: 4 }, 0), offsets.map(n => 48 + n));
  }
});
test('all arp directions and octave spans remain within MIDI bounds', () => {
  for (const arp of ['up', 'down', 'up-down', 'down-up', 'random'] as const) {
    for (const arpOctaves of [1, 2, 3, 4]) {
      const s = { ...settings, octave: 7, note: 11, arp, arpOctaves };
      for (let step = 0; step < 100; step++) {
        const [note] = generateNotes(s, step);
        assert.ok(Number.isInteger(note) && note >= 0 && note <= 127);
      }
    }
  }
});
test('random arp can reach both ends of its expanded chord', () => {
  const s = { ...settings, arp: 'random' as const, arpOctaves: 3 };
  assert.deepEqual(generateNotes(s, 0, () => 0), [48]);
  assert.deepEqual(generateNotes(s, 0, () => 0.999999), [79]);
});
test('single and random modes ignore arp controls', () => {
  assert.deepEqual(generateNotes({ ...settings, mode: 'single', arpOctaves: 4 }, 5), [48]);
  const s = { ...settings, mode: 'random' as const, octaveRange: 2 };
  assert.deepEqual(generateNotes(s, 0, () => 0), [48]);
  assert.deepEqual(generateNotes(s, 0, () => 0.999999), [71]);
});
