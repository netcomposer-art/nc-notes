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

// routeRole lives in route.ts (no chord tables), so the contract can use it without pulling in the generator.
export { routeRole } from './route.js';
