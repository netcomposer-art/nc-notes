/**
 * The chord a pad would play, as one hit of note events (0.5.0: CALLIOPE auditions a pad clicked while the Studio is
 * stopped; Peter, 2026-11-05). The generator's own voicing (chord, root, inversion, spread, voice leading from a
 * fresh start), played as one Block hit: no arp, no progression, no strum, no colour tone. Times are beat 0; an
 * `audition` message plays them now.
 */
import type { NoteEvent } from './events.js';
import { NoteGenerator } from './generator.js';
import { seededRandom } from './random.js';
import type { GeneratorSettings } from './settings.js';

/** How long an audition holds each note by default (s). */
export const AUDITION_HOLD_SEC = 1.5;

/** The first hit `settings` play as a held chord: its events (empty when there is no chord to play). */
export function auditionEvents(settings: GeneratorSettings, hit = 0): NoteEvent[] {
  const s: GeneratorSettings = {
    ...settings, mode: 'chord', arp: 'off', chordStyle: 'block', chordProgression: 'off', strum: 0, tension: 0,
  };
  const gen = new NoteGenerator(s, { random: seededRandom(1), chordRandom: seededRandom(2) });
  gen.start(0);
  const events = gen.window(4);
  if (!events.length) return [];
  const first = events[0];
  return events
    .filter(e => e.hit === first.hit && e.startBeat === first.startBeat)
    .map(e => ({ ...e, startBeat: 0, offsetSec: 0, hit }));
}
