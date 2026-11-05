import type { GeneratorSettings } from './settings.js';
import { arpIndex, arpeggioPool, arpeggioSequence, chordVoicing, euclidOf } from './chords.js';

/**
 * The notes of one generator step (`step` counts from 0): Off rests, Single plays the root, Random a note in the
 * octave range, anything else the chord (or one arp note of it). Direction reversals don't repeat either endpoint.
 * Arp-off ignores octave span. An empty list is a rest.
 */
export function generateNotes(s: Pick<GeneratorSettings, 'mode' | 'note' | 'octave' | 'octaveRange' | 'chord' | 'inversion' | 'arp' | 'arpOctaves' | 'arpSpread' | 'arpHits' | 'arpSteps' | 'arpRotate'>, step: number, random = Math.random): number[] {
  if (s.mode === 'off') return [];
  const root = Math.min(127, Math.max(0, (s.octave + 1) * 12 + s.note));
  if (s.mode === 'single') return [root];
  if (s.mode === 'random') {
    const lower = Math.min(127, (s.octave + 1) * 12);
    const upper = Math.min(127, lower + s.octaveRange * 12 - 1);
    return [lower + Math.floor(random() * (upper - lower + 1))];
  }
  const chord = chordVoicing(root, s.chord, s.inversion, s.arpSpread);
  if (s.arp === 'off') return chord;
  const pool = arpeggioPool(chord, s.arpOctaves);
  const notes = arpeggioSequence(pool, s.arp);
  // null: a Euclidean rest.
  const index = arpIndex(s.arp, notes.length, step, euclidOf(s), random);
  return index === null ? [] : [notes[index]];
}
