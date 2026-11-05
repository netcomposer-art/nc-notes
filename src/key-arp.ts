import { normalizeInterval } from './rates.js';
import { ARP_ORDERS, DEFAULT_EUCLID, arpIndex, arpeggioSequence, euclidOf, fitVoicing, type ArpEuclid, type ArpOrder, type ArpSpread } from './chords.js';

/**
 * Held-key arpeggiator. With Note order on, the keys you hold become the arp
 * pool (in the order you pressed them) instead of sounding directly. A locked
 * sequence (from a snapshot) plays the same way with no keys held.
 */

/** A captured arp pattern: notes in press order plus how to step through them. */
export interface ArpSequence {
  notes: number[]; velocities: number[];
  arp: Exclude<ArpOrder, 'off'>; arpOctaves: number; arpSpread: ArpSpread; interval: number; gate: number;
  /** Euclidean only (optional, so older stored sequences still load). */
  arpHits?: number; arpSteps?: number; arpRotate?: number;
}
export interface ArpStep { midi: number; velocity: number }

export const MAX_SEQUENCE_NOTES = 32;
const ORDERS = new Set<string>(ARP_ORDERS.map(o => o.value).filter(v => v !== 'off'));
const SPREADS = new Set<string>(['compact', 'wide', 'wider', 'maximum']);

/** Seconds per arp step at this tempo and grid (1/4, 1/8 dotted, 1/8 triplet, …), same as the Note Generator. */
export const stepSeconds = (tempo: number, interval: number) =>
  (60 / Math.max(20, Math.min(240, tempo))) * (4 / interval);

const SPREAD_EXTENT: Record<ArpSpread, number> = { compact: 0, wide: 1, wider: 2, maximum: 4 };
/**
 * Arp Spread on played notes, the same rule as generator chords: rank the notes
 * low to high and lift the i-th by floor(i * E / (N-1)) octaves (E = 0/1/2/4),
 * then shift the whole set back into MIDI range. Press order is kept.
 */
export function spreadNotes(notes: readonly number[], spread: ArpSpread = 'compact'): number[] {
  const extent = SPREAD_EXTENT[spread] ?? 0;
  if (!extent || notes.length < 2) return [...notes];
  const rank = new Map([...new Set(notes)].sort((a, b) => a - b).map((n, i, all) => [n, Math.floor(i * extent / Math.max(1, all.length - 1))]));
  const lifted = notes.map(n => n + 12 * rank.get(n)!);
  try { return fitVoicing(lifted); } catch { return [...notes]; }
}

/**
 * The notes and velocities one pass of the pattern visits. `notes` keep press
 * order (that is what As Played uses); Spread voices them like a generator chord;
 * Octaves repeats the set an octave up each time.
 */
export function arpPattern(notes: readonly number[], velocities: readonly number[], order: ArpOrder, octaves: number, spread: ArpSpread = 'compact') {
  const vel = new Map<number, number>();
  const pool: number[] = [];
  const span = Math.max(1, Math.min(4, Math.round(octaves) || 1));
  const voiced = spreadNotes(notes, spread);
  for (let o = 0; o < span; o++) voiced.forEach((n, i) => {
    const midi = n + o * 12;
    if (midi < 0 || midi > 127 || vel.has(midi)) return;
    vel.set(midi, velocities[i] ?? 0.85); pool.push(midi);
  });
  const seq = arpeggioSequence(pool, order === 'off' ? 'up' : order);
  return seq.map(midi => ({ midi, velocity: vel.get(midi) ?? 0.85 }));
}

/** Step `step` of a pattern. Random picks any note each step, Walk wanders, Euclidean rests off its hits (null); the others loop. */
export function arpStepAt(pattern: readonly ArpStep[], order: ArpOrder, step: number, random = Math.random, euclid: ArpEuclid = DEFAULT_EUCLID): ArpStep | null {
  const i = arpIndex(order, pattern.length, step, euclid, random);
  return i === null ? null : pattern[i];
}

/**
 * Keys held for the arp, in press order. A key pressed twice keeps its first place.
 * With latch on, the set keeps playing after every key is let go; the next press
 * after a full release starts a new set, a press while keys are still down adds to it.
 */
export class HeldArp {
  private order: number[] = [];
  private velocity = new Map<number, number>();
  /** Keys physically down right now (differs from the pool only while latched). */
  private down = new Set<number>();
  private latch = false;
  /** Steps taken since the set started; adding or releasing keys never resets it. */
  step = 0;
  press(midi: number, velocity: number) {
    if (this.latch && !this.down.size && this.order.length) { this.order = []; this.velocity.clear(); this.step = 0; }
    this.down.add(midi);
    if (!this.velocity.has(midi)) this.order.push(midi);
    this.velocity.set(midi, velocity);
  }
  /** Key up. Returns true when the pool changed (never while latched). */
  release(midi: number): boolean {
    const wasDown = this.down.delete(midi);
    if (this.latch || !wasDown || !this.velocity.has(midi)) return false;
    this.velocity.delete(midi);
    this.order = this.order.filter(m => m !== midi);
    if (!this.order.length) this.step = 0;
    return true;
  }
  /** Latch on/off. Turning it off keeps only keys still down. Returns true when the pool changed. */
  setLatch(on: boolean): boolean {
    this.latch = on;
    if (on) return false;
    const before = this.order.length;
    this.order = this.order.filter(m => this.down.has(m));
    for (const m of [...this.velocity.keys()]) if (!this.down.has(m)) this.velocity.delete(m);
    if (!this.order.length) this.step = 0;
    return this.order.length !== before;
  }
  get latched() { return this.latch; }
  /** Latched and still playing with no key down. */
  get holding() { return this.latch && this.order.length > 0 && !this.down.size; }
  isDown(midi: number) { return this.down.has(midi); }
  clear() { this.order = []; this.velocity.clear(); this.down.clear(); this.step = 0; }
  get active() { return this.order.length > 0; }
  /** Press order. */
  held(): number[] { return [...this.order]; }
  velocities(): number[] { return this.order.map(m => this.velocity.get(m) ?? 0.85); }
  /** The last key pressed still in the set (a locked sequence transposes to it). */
  last(): number | undefined { return this.order[this.order.length - 1]; }
  /** Pool size (unique notes) for this pattern, Octaves and Spread included. */
  static size(notes: readonly number[], octaves: number, spread: ArpSpread) {
    return arpPattern(notes, [], 'as-played', octaves, spread).length;
  }
}

/** Validate a stored sequence; null when it is not usable. */
export function sanitizeSequence(raw: unknown): ArpSequence | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const notes = Array.isArray(r.notes) ? [...new Set(r.notes.filter((n): n is number =>
    typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 127))].slice(0, MAX_SEQUENCE_NOTES) : [];
  if (!notes.length || typeof r.arp !== 'string' || !ORDERS.has(r.arp)) return null;
  const rawVel = Array.isArray(r.velocities) ? r.velocities : [];
  const srcNotes = r.notes as unknown[];
  const velocities = notes.map(n => {
    const v = rawVel[srcNotes.indexOf(n)];
    return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.85;
  });
  const num = (v: unknown, def: number) => (typeof v === 'number' && Number.isFinite(v) ? v : def);
  return {
    notes, velocities, arp: r.arp as ArpSequence['arp'],
    arpOctaves: Math.max(1, Math.min(4, Math.round(num(r.arpOctaves, 1)))),
    arpSpread: typeof r.arpSpread === 'string' && SPREADS.has(r.arpSpread) ? r.arpSpread as ArpSpread : 'compact',
    interval: normalizeInterval(r.interval),
    gate: Math.max(10, Math.min(100, num(r.gate, 75))),
    ...(r.arp === 'euclidean' ? (({ hits, steps, rotate }) => ({ arpHits: hits, arpSteps: steps, arpRotate: rotate }))(euclidOf(r as Partial<Record<'arpHits' | 'arpSteps' | 'arpRotate', number>>)) : {}),
  };
}

/** Sequence fields that have a control (Arp panel: Note order, Octaves, Spread, Hits/Steps/Rotate; Rate's grid and Gate in the Note Generator). */
export const SEQUENCE_CONTROL_FIELDS = ['arp', 'arpOctaves', 'arpSpread', 'interval', 'gate', 'arpHits', 'arpSteps', 'arpRotate'] as const;
export type SequenceControls = { arp: ArpSequence['arp']; arpOctaves: number; arpSpread: ArpSpread; interval: number; gate: number; arpHits?: number; arpSteps?: number; arpRotate?: number };
/**
 * The settings that show a sequence in the controls: exactly what it was dialed in with.
 * Euclidean Hits/Steps/Rotate only when it is Euclidean (other orders do not store them).
 * Notes and velocities have no control (the pool count shows them); tempo is not stored.
 */
export function sequenceControls(seq: ArpSequence): SequenceControls {
  const out: SequenceControls = { arp: seq.arp, arpOctaves: seq.arpOctaves, arpSpread: seq.arpSpread, interval: seq.interval, gate: seq.gate };
  if (seq.arp === 'euclidean') {
    const e = euclidOf(seq);
    Object.assign(out, { arpHits: e.hits, arpSteps: e.steps, arpRotate: e.rotate });
  }
  return out;
}
/** A sequence re-dialed from the controls (its notes kept). Null when Note order is Off. */
export function retuneSequence(seq: ArpSequence, s: Pick<SequenceControls, 'arpOctaves' | 'arpSpread' | 'interval' | 'gate'> & { arp: ArpOrder; arpHits: number; arpSteps: number; arpRotate: number }): ArpSequence | null {
  if (s.arp === 'off') return null;
  const { arpHits: _h, arpSteps: _s, arpRotate: _r, ...rest } = seq;
  const next: ArpSequence = { ...rest, arp: s.arp, arpOctaves: s.arpOctaves, arpSpread: s.arpSpread, interval: s.interval, gate: s.gate };
  if (s.arp === 'euclidean') {
    const e = euclidOf(s);
    Object.assign(next, { arpHits: e.hits, arpSteps: e.steps, arpRotate: e.rotate });
  }
  return next;
}
