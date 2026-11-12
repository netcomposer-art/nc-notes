/**
 * Pitch from a source (CALLIOPE stage 4, Peter 2026-11-05): an instrument that keeps its own rhythm and takes only the
 * pitch from a note source. OLIVE Bass plays its own steps (hits, lengths, accents, slides) and each step's pitch is
 * the root of the chord sounding at that step's beat; NYX plays its own pattern and its following pads are tuned to
 * that root at each hit.
 *
 * PitchFollower is the receiving side of the notes contract for such an instrument: it takes the same messages as a
 * NotesInbox (`notes`, `off`, `routes`), but instead of playing the events it keeps the source's chords as a timeline
 * (ChordTrack) and answers "which root at this beat?". The instrument looks the root up when it schedules each of its
 * own steps (on its audio thread, from points()), so the pitch is as sample-accurate as the step itself.
 *
 *  - It follows one source: the first in `routes` (a second CALLIOPE on the same Bass is listed but not followed).
 *  - Runs: an event from a newer run of that source (a Play) replaces the timeline; an older run's is ignored.
 *  - `off` with reason 'restart' and `atBeat` (a change heard on the next beat, resent from there) cuts the timeline
 *    there without a gap; any other `off` ends the chord (from `atBeat`, else at once and everything).
 *  - A Stop (`off` 'stop' with no beat: the clock stopped) keeps the timeline: an instrument whose clock stops a
 *    moment after the source heard it (a step already on its way) still plays the root at that step's beat, never its
 *    own note. The next run (a Play) replaces it.
 *  - With no chord in effect (none yet, or after an off) rootAt() is null: the instrument plays its own pitch.
 */
import { ChordTrack } from './chord-track.js';
import { type NotesMessage, type NotesRoute, parseNotesMessage, runOfId } from './contract.js';

/** A change on the timeline: from `beat` on, `root` (MIDI as sent, or null: no chord, the instrument's own pitch). */
export interface FollowPoint {
  beat: number;
  root: number | null;
}

const mod12 = (n: number) => ((n % 12) + 12) % 12;

/**
 * Where an instrument plays a followed root: its pitch class placed in the octave from `low` up (low … low + 11),
 * moved by the whole octaves of the route's `transpose` (CALLIOPE's Octave choice). The root as sent already carries
 * the transpose, so only its octave part is added again here. Clamped to MIDI 0–127.
 *
 * Bass: low E1 (28), so roots sit from E1 to D♯2 like a bass guitar's open strings. NYX: low = the pad's own note − 6,
 * so a pad is retuned by −6 … +5 semitones (never more than a tritone from how it was recorded) before the Octave.
 */
export function followPitch(root: number, { low, transpose = 0 }: { low: number; transpose?: number }): number {
  const t = Number.isFinite(transpose) ? Math.round(transpose) : 0;
  const placed = low + mod12(root - low);
  const n = placed + (t - mod12(t));
  return Math.min(127, Math.max(0, n));
}

/** Follows one source's chords for an instrument that takes only the pitch (see the file comment). */
export class PitchFollower {
  private track = new ChordTrack();
  private run: number | null = null;
  private current: NotesRoute[] = [];
  /** Bumped on every change to the timeline, so a host posts it on only when it changed. */
  private serial = 0;
  readonly stats = { accepted: 0, ignored: 0, invalid: 0 };

  /** The sources routed to this instrument now (the first is the one followed). */
  get routes(): readonly NotesRoute[] { return this.current; }
  /** The route followed now, or null (no source: the instrument plays its own pitches). */
  get route(): NotesRoute | null { return this.current[0] ?? null; }
  /** Whether a source sets the pitch now. */
  get active(): boolean { return this.current.length > 0; }
  /** Changes with every change to the timeline. */
  get version(): number { return this.serial; }

  /** Take a message (checked with parseNotesMessage). Returns the parsed message, or null when it was invalid. */
  receive(raw: unknown): NotesMessage | null {
    const m = parseNotesMessage(raw);
    if (!m) { this.stats.invalid++; return null; }
    if (m.kind === 'routes') {
      const before = this.route?.source ?? null;
      this.current = m.routes;
      if ((this.route?.source ?? null) !== before) this.reset();
      return m;
    }
    const followed = this.route?.source;
    if (m.source !== followed) { this.stats.ignored++; return m; }
    if (m.kind === 'off') {
      // A Stop keeps the timeline (see the file comment); the next run replaces it.
      if (m.reason === 'stop' && m.atBeat === undefined) return m;
      if (m.reason === 'restart' && m.atBeat !== undefined) this.track.cut(m.atBeat);
      else if (m.atBeat !== undefined) this.track.off(m.atBeat);
      else this.track.off();
      this.serial++;
      return m;
    }
    // A report of what was played, slot and chord-pad changes (0.6.0), or a release (0.10.0): no pitch in them.
    if (m.kind === 'played' || m.kind === 'controls' || m.kind === 'release') { this.stats.ignored++; return m; }
    let added = false;
    for (const e of m.events) {
      const run = runOfId(e.id);
      if (run !== null && this.run !== null && run < this.run) { this.stats.ignored++; continue; }
      if (run !== null && (this.run === null || run > this.run)) {
        this.track = new ChordTrack();
        this.run = run;
      }
      this.track.add([e]);
      this.stats.accepted++;
      added = true;
    }
    if (added) this.serial++;
    return m;
  }

  /** The root of the chord in effect at `beat` (MIDI as sent), or null: no chord, the instrument's own pitch. */
  rootAt(beat: number): number | null {
    if (!this.active) return null;
    return this.track.chordAt(beat)?.root ?? null;
  }

  /** The timeline from the change in effect at `fromBeat` on (empty with no source). */
  points(fromBeat = Number.NEGATIVE_INFINITY): FollowPoint[] {
    if (!this.active) return [];
    return this.track.points(fromBeat);
  }

  /** Forget changes that were followed by another before `beat`. */
  prune(beat: number): void {
    this.track.prune(beat);
  }

  /** Forget the timeline (routes stay). */
  reset(): void {
    this.track = new ChordTrack();
    this.run = null;
    this.serial++;
  }
}
