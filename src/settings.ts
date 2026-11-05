import type { ArpOrder, ArpSpread } from './chords.js';
import type { ChordStyleId } from './comp.js';
import { emptyPads, type ChordPadMode, type ChordPads } from './chord-pads.js';

/**
 * The Note Generator's modes. 'off' rests (the clock still runs), 'single' plays Note at Octave, 'chord' plays the
 * chord (with Style, Progression and the arp), 'random' picks a note in Octave … Octave + Octave range − 1.
 */
export type GeneratorMode = 'off' | 'single' | 'chord' | 'random';
export const GENERATOR_MODES: readonly GeneratorMode[] = ['off', 'single', 'chord', 'random'];
export const isGeneratorMode = (mode: unknown): mode is GeneratorMode => GENERATOR_MODES.includes(mode as GeneratorMode);

/**
 * Everything the generator reads. These are ASTRID's field names and meanings, so a whole ASTRID settings object
 * (which has many more fields) can be passed as it is. `mode` is a string because a host may have modes of its own
 * (ASTRID's older Situation modes): the generator plays nothing for a mode it doesn't know.
 */
export interface GeneratorSettings {
  /** A GeneratorMode; anything else is silent here. */
  mode: string;
  /** Root pitch class 0–11 and octave (MIDI root = (octave + 1) * 12 + note). */
  note: number; octave: number;
  /** Random mode: how many octaves up from Octave (1–3). */
  octaveRange: number;
  /** A CHORD_LIBRARY id (older display names resolve too) and its inversion. */
  chord: string; inversion: number;
  /** Steps per whole note (4 = quarter notes; see rates.ts for dotted and triplet values). */
  interval: number;
  /** Note length, % of a step (clamped to 10–100). */
  gate: number;
  /** Note order (the arp), its octave span and the voicing spread. */
  arp: ArpOrder; arpOctaves: number; arpSpread: ArpSpread;
  /** Euclidean arp: Hits over Steps, turned by Rotate. */
  arpHits: number; arpSteps: number; arpRotate: number;
  /** Chord mode (comp.ts): Style, voice leading, strum (ms), tension (% of hits), progression and bars per chord. */
  chordStyle: ChordStyleId; voiceLeading: 'fixed' | 'smooth'; strum: number; tension: number;
  chordProgression: string; progressionBars: number;
  /** Favorites (stars) and the sixteen chord pads. The generator doesn't read these; the UI and save code do. */
  favoriteChords?: string[]; chordPads?: ChordPads; chordPadMode?: ChordPadMode;
}

/** ASTRID's defaults for the generator fields (a fresh ASTRID turns `mode` to 'off'). */
export const DEFAULT_GENERATOR_SETTINGS: Readonly<Required<GeneratorSettings>> = {
  mode: 'single', note: 0, octave: 3, octaveRange: 2, chord: 'minor-7', inversion: 0, interval: 4, gate: 75,
  arp: 'off', arpOctaves: 1, arpSpread: 'compact', arpHits: 5, arpSteps: 8, arpRotate: 0,
  chordStyle: 'block', voiceLeading: 'fixed', strum: 0, tension: 0, chordProgression: 'off', progressionBars: 0,
  favoriteChords: [], chordPads: emptyPads(), chordPadMode: 'pad',
};
