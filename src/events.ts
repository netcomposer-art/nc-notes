import type { GeneratorHit } from './generator.js';
import { strumOffsets } from './comp.js';

/** Where each note of a hit starts, relative to the hit (seconds; Strum is in milliseconds, not beats). */
export function placeHit(notes: readonly number[], hit: Pick<GeneratorHit, 'direction' | 'strumMs'>): { midi: number; offset: number }[] {
  return hit.direction && hit.strumMs > 0 && notes.length > 1 ? strumOffsets(notes, hit.strumMs, hit.direction) : notes.map(midi => ({ midi, offset: 0 }));
}


/**
 * What a target plays from a generator: the whole chord (Synth, NYX tuned pads), the chord's root only (Bass), or
 * its top note (a lead). The generator itself emits 'chord' (chord notes), 'arp' (one arp note) and 'note' (Single,
 * Random); routeRole() turns a stream into what one target plays.
 */
export type NoteRole = 'chord' | 'root' | 'top' | 'arp' | 'note';
export type TargetRole = 'chord' | 'root' | 'top';

/**
 * One note on the Studio clock. Times are beats; `offsetSec` is a Strum offset in seconds (Strum is set in
 * milliseconds, so it doesn't stretch with tempo), added to the time `startBeat` maps to.
 */
export interface NoteEvent {
  /** MIDI note 0–127. */
  note: number;
  /** 0–1. */
  velocity: number;
  startBeat: number;
  /** spanBeats × gate. */
  lengthBeats: number;
  role: NoteRole;
  offsetSec: number;
  /** The span the gate applies to and the gate (0.1–1). A host that maps beats to seconds as ASTRID does uses
   *  (time(startBeat + spanBeats) − time(startBeat)) × gate, which is exactly ASTRID's arithmetic. */
  spanBeats: number; gate: number;
  /** Which hit (chord) the note belongs to (a running number), and that hit's root (MIDI). */
  hit: number; root: number;
}

/** A hit as note events (in the order the voices start: a strum's order). */
export function hitEvents(hit: GeneratorHit, serial = 0): NoteEvent[] {
  return placeHit(hit.notes, hit).map(({ midi, offset }) => ({
    note: midi, velocity: hit.velocity, startBeat: hit.beat, lengthBeats: hit.spanBeats * hit.gate, role: hit.role,
    offsetSec: offset, spanBeats: hit.spanBeats, gate: hit.gate, hit: serial, root: hit.root,
  }));
}

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
