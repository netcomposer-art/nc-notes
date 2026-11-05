/**
 * routeRole on its own (0.4.0): it needs no chord tables, so the notes contract (and an instrument that only takes
 * the pitch, such as OLIVE Bass) can use it without bundling the generator. events.ts re-exports it.
 */
import type { NoteEvent, TargetRole } from './events.js';

/**
 * What one target plays from a stream: 'chord' passes every note through (as 'chord'); 'root' plays each hit's root
 * once, `octave` (MIDI octave number, C3 = 48 is octave 3) placing it, else where the chord has it; 'top' plays each
 * hit's highest note. Root and top notes start with the hit (no strum offset).
 */
export function routeRole(events: readonly NoteEvent[], role: TargetRole, { octave }: { octave?: number } = {}): NoteEvent[] {
  if (role === 'chord') return events.map(e => ({ ...e, role: 'chord' }));
  const byHit = new Map<number, NoteEvent[]>();
  for (const e of events) byHit.set(e.hit, [...(byHit.get(e.hit) ?? []), e]);
  const out: NoteEvent[] = [];
  for (const group of byHit.values()) {
    const first = group[0];
    const velocity = Math.max(...group.map(e => e.velocity));
    if (role === 'top') {
      const top = group.reduce((a, b) => (b.note > a.note ? b : a));
      out.push({ ...top, role: 'top', offsetSec: 0, velocity });
    } else {
      const note = octave === undefined ? first.root : Math.min(127, Math.max(0, (octave + 1) * 12 + (((first.root % 12) + 12) % 12)));
      out.push({ ...first, note, role: 'root', offsetSec: 0, velocity });
    }
  }
  return out;
}
