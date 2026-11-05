/**
 * The Bass rule (Peter, 2026-11-04): a Bass under CALLIOPE keeps its own rhythm and takes the pitch "at the moment of
 * each Bass step: the root of whatever chord is sounding then".
 *
 * ChordTrack follows a source's event stream (any role: chords, arp notes, single notes) and answers, for any beat,
 * which hit is in effect there: the last one that started at or before that beat. A gap between chords (a gate under
 * 100 %, a Euclid rest) keeps the last chord's harmony; an `off` (Stop, target off) ends it. The Bass asks
 * pitchAt(stepBeat) at each of its own steps.
 */
import type { NoteEvent } from './events.js';

const EPS = 1e-6;

/** The chord in effect at a beat. */
export interface ChordAt {
  /** The hit's root (MIDI). */
  root: number;
  /** Every note of the hit, low to high. */
  notes: number[];
  /** Where the hit starts and how long its notes last (beats). */
  startBeat: number;
  lengthBeats: number;
  /** True while the hit's notes still sound at that beat (false in a gap after them). */
  sounding: boolean;
  /** The hit's running number in its stream. */
  hit: number;
}

interface Entry { startBeat: number; chord: ChordAt | null }

/** Place a MIDI note's pitch class in octave `octave` (MIDI octave numbers: C3 = 48 is octave 3), clamped to 0–127. */
export function inOctave(midi: number, octave: number): number {
  return Math.min(127, Math.max(0, (octave + 1) * 12 + (((midi % 12) + 12) % 12)));
}

/** Follows an event stream's chords (see the file comment). */
export class ChordTrack {
  /** Entries in start order: a hit, or null (an off: no chord from there). */
  private entries: Entry[] = [];

  /** Add events (any order; a hit's notes may come in several calls). */
  add(events: readonly NoteEvent[]): void {
    for (const e of events) {
      let entry = this.entries.find(x => x.chord?.hit === e.hit && Math.abs(x.startBeat - e.startBeat) < EPS);
      if (!entry) {
        entry = { startBeat: e.startBeat, chord: { root: e.root, notes: [], startBeat: e.startBeat, lengthBeats: 0, sounding: true, hit: e.hit } };
        this.insert(entry);
      }
      const chord = entry.chord!;
      if (!chord.notes.includes(e.note)) { chord.notes.push(e.note); chord.notes.sort((a, b) => a - b); }
      chord.lengthBeats = Math.max(chord.lengthBeats, e.lengthBeats);
    }
  }

  /**
   * The stream stopped (an `off`): no chord from `atBeat` on (hits starting there or later are dropped). Without a
   * beat, everything is cleared.
   */
  off(atBeat?: number): void {
    if (atBeat === undefined) { this.entries = []; return; }
    this.entries = this.entries.filter(x => x.startBeat < atBeat - EPS);
    this.entries.push({ startBeat: atBeat, chord: null });
  }

  /**
   * A resend from `atBeat` (an `off` with reason 'restart': the source plays a change from there and sends again):
   * hits starting there or later are dropped, and the chord in effect before it stays in effect until a resent hit
   * replaces it. Unlike off(), no gap: a Bass step between the change beat and the next resent hit keeps the harmony.
   */
  cut(atBeat: number): void {
    this.entries = this.entries.filter(x => x.startBeat < atBeat - EPS);
  }

  /**
   * The track as a timeline from the entry in effect at `fromBeat` on: each change's beat and its chord's root
   * (null: no chord from there, after an off). For a host that hands the pitch to an audio thread.
   */
  points(fromBeat = Number.NEGATIVE_INFINITY): { beat: number; root: number | null }[] {
    let first = 0;
    for (let i = 0; i < this.entries.length; i++) if (this.entries[i].startBeat <= fromBeat + EPS) first = i;
    return this.entries.slice(first).map(x => ({ beat: x.startBeat, root: x.chord ? x.chord.root : null }));
  }

  /** The chord in effect at `beat`, or null (none yet, or after an off). */
  chordAt(beat: number): ChordAt | null {
    let found: Entry | null = null;
    for (const x of this.entries) {
      if (x.startBeat > beat + EPS) break;
      found = x;
    }
    if (!found?.chord) return null;
    const c = found.chord;
    return { ...c, notes: [...c.notes], sounding: beat < c.startBeat + c.lengthBeats - EPS };
  }

  /**
   * The Bass pitch at `beat`: the root of the chord in effect there, in `octave` when given (else where the chord has
   * it), or null when there is none.
   */
  pitchAt(beat: number, { octave }: { octave?: number } = {}): number | null {
    const chord = this.chordAt(beat);
    if (!chord) return null;
    return octave === undefined ? chord.root : inOctave(chord.root, octave);
  }

  /** Forget hits that were followed by another one before `beat` (the one in effect at `beat` stays). */
  prune(beat: number): void {
    let keep = 0;
    for (let i = 0; i < this.entries.length; i++) if (this.entries[i].startBeat <= beat + EPS) keep = i;
    if (keep > 0) this.entries.splice(0, keep);
  }

  /** How many hits (and offs) are kept. */
  get size(): number { return this.entries.length; }

  private insert(entry: Entry) {
    let i = this.entries.length;
    while (i > 0 && this.entries[i - 1].startBeat > entry.startBeat + EPS) i--;
    // A hit on the same beat as an off replaces nothing: it comes after it (the stream started again there).
    this.entries.splice(i, 0, entry);
  }
}

/** The chord in effect at `beat` in a list of events (ChordTrack over the whole list). */
export function chordAt(events: readonly NoteEvent[], beat: number): ChordAt | null {
  const track = new ChordTrack();
  track.add(events);
  return track.chordAt(beat);
}

/** The Bass pitch at `beat` in a list of events (see ChordTrack.pitchAt). */
export function pitchAt(events: readonly NoteEvent[], beat: number, options: { octave?: number } = {}): number | null {
  const track = new ChordTrack();
  track.add(events);
  return track.pitchAt(beat, options);
}
