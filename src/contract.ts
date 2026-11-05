/**
 * The notes contract (v1): how a note source (CALLIOPE, the Studio's stand-in) hands note events to an instrument
 * through the Studio, the same way for every module.
 *
 *  - Times are beats on the Studio clock. Events are sent ahead of time (a lookahead window), never "play now": the
 *    instrument maps each beat to its own audio time with the shared clock mapper when it schedules the note.
 *  - Every event has an id. A resend of the same event (a target switched back on, a reloaded frame) carries the same
 *    id, so an instrument that already has it does nothing: no double note.
 *  - Note-offs: a Stop, a target removed or switched off, or a source going away sends `off`, and the instrument
 *    drops what it has not started yet and releases what is sounding from that source. Nothing hangs.
 *  - `routes` tells an instrument which sources play it now (and with which role). While any does, the instrument's
 *    own generator stands aside (no double playing).
 *
 * Messages are plain objects (structured-clonable). A receiver checks every message with parseNotesMessage(), which
 * copies it into fresh objects, so nothing from another frame is kept by reference.
 */
import { routeRole, type NoteEvent, type NoteRole, type TargetRole } from './events.js';

/** The contract's version. A receiver ignores messages from a newer major version. */
export const NOTES_VERSION = 1;

/** The most events one `notes` message may carry. */
export const MAX_EVENTS_PER_MESSAGE = 1024;
/** The most a route's transpose may move notes, in semitones (four octaves either way). */
export const MAX_TRANSPOSE = 48;
/** The longest source id, event id or name, in characters. */
export const MAX_ID_LENGTH = 128;

const TARGET_ROLES: readonly TargetRole[] = ['chord', 'root', 'top'];
const NOTE_ROLES: readonly NoteRole[] = ['chord', 'root', 'top', 'arp', 'note'];

/** One note event on the wire: a NoteEvent with the id that makes it idempotent and the source it came from. */
export interface WireNote extends NoteEvent {
  /** Unique per source and run; the same event resent has the same id. */
  id: string;
  /** The source's id ("calliope", "calliope#2", "studio-dev"). */
  source: string;
}

/** A source playing a target, and how: the role (chord, root, top) and, for root, an octave (C3 = 48 is octave 3). */
export interface NotesRoute {
  source: string;
  /** What the player sees ("CALLIOPE 1"). */
  name: string;
  role: TargetRole;
  octave?: number;
  /**
   * Semitones the source moves every note it sends this target (CALLIOPE's per-target Octave × 12), already in the
   * notes and roots it sends. Optional (0 when absent; added in 0.4.0, a v1 receiver that doesn't know it is
   * unaffected). A pitch follower (follow.ts) reads it to keep the octave choice apart from where it places a root.
   */
  transpose?: number;
}

/**
 * Why an `off` was sent. 'restart' with `atBeat`: the source resends from that beat (a change heard on the next beat,
 * CALLIOPE): what waits from there is dropped and comes again; notes already sounding keep their length, as a host's
 * own generator lets them ring when its settings change.
 */
export type NotesOffReason = 'stop' | 'removed' | 'off' | 'restart';

export type NotesMessage =
  /** Events to play, ahead of time. */
  | { v: typeof NOTES_VERSION; kind: 'notes'; source: string; events: WireNote[] }
  /**
   * Note-offs from one source: drop its events not started yet and release its sounding notes. With `atBeat`, only
   * from that beat on (notes started before it are released there); without, from now.
   */
  | { v: typeof NOTES_VERSION; kind: 'off'; source: string; reason: NotesOffReason; atBeat?: number }
  /** The sources playing this instrument now (empty: none; its own generator plays again). */
  | { v: typeof NOTES_VERSION; kind: 'routes'; routes: NotesRoute[] };

/** The id of event `index` of hit `hit`, played in `role`, in run `run` of `source`. */
// The id's parts are joined with '|'; runOfId() reads the run back from the end (a source id may hold anything).
export function noteId(source: string, run: number, role: NoteRole, hit: number, index: number): string {
  return `${source}|${run}|${role}|${hit}|${index}`;
}

/**
 * What one target gets from a source's events: routeRole() for its role (and octave), each event with its id. The
 * ids depend only on the source, the run, the role and the event's place in its hit, so routing the same events
 * again gives the same ids (a resend is a no-op).
 */
export function routeForTarget(source: string, run: number, events: readonly NoteEvent[], role: TargetRole,
  options: { octave?: number } = {}): WireNote[] {
  const counts = new Map<number, number>();
  return routeRole(events, role, options).map(e => {
    const index = counts.get(e.hit) ?? 0;
    counts.set(e.hit, index + 1);
    return { ...e, id: noteId(source, run, e.role, e.hit, index), source };
  });
}

/** The run an id from noteId() belongs to, or null when it isn't one. */
export function runOfId(id: string): number | null {
  const parts = id.split('|');
  if (parts.length < 5) return null;
  const run = Number(parts[parts.length - 4]);
  return Number.isInteger(run) ? run : null;
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
const isId = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= MAX_ID_LENGTH;
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Why `x` is not a valid wire note, or null when it is. */
export function wireNoteError(x: unknown): string | null {
  if (!isObject(x)) return 'not an object';
  if (!isId(x.id)) return 'bad id';
  if (!isId(x.source)) return 'bad source';
  if (!Number.isInteger(x.note) || (x.note as number) < 0 || (x.note as number) > 127) return 'note must be a whole number 0–127';
  if (!finite(x.velocity) || x.velocity < 0 || x.velocity > 1) return 'velocity must be 0–1';
  if (!finite(x.startBeat)) return 'bad startBeat';
  if (!finite(x.lengthBeats) || x.lengthBeats < 0) return 'bad lengthBeats';
  if (!finite(x.spanBeats) || x.spanBeats <= 0) return 'bad spanBeats';
  if (!finite(x.gate) || x.gate <= 0 || x.gate > 1) return 'gate must be above 0, at most 1';
  if (!finite(x.offsetSec) || Math.abs(x.offsetSec) > 2) return 'bad offsetSec';
  if (typeof x.role !== 'string' || !NOTE_ROLES.includes(x.role as NoteRole)) return 'bad role';
  if (!Number.isInteger(x.hit)) return 'bad hit';
  if (!Number.isInteger(x.root) || (x.root as number) < 0 || (x.root as number) > 127) return 'bad root';
  return null;
}

/** Why `x` is not a valid notes message, or null when it is. */
export function notesMessageError(x: unknown): string | null {
  if (!isObject(x)) return 'not an object';
  if (x.v !== NOTES_VERSION) return `version ${String(x.v)} is not ${NOTES_VERSION}`;
  if (x.kind === 'notes') {
    if (!isId(x.source)) return 'bad source';
    if (!Array.isArray(x.events)) return 'events must be a list';
    if (x.events.length > MAX_EVENTS_PER_MESSAGE) return `more than ${MAX_EVENTS_PER_MESSAGE} events`;
    for (let i = 0; i < x.events.length; i++) {
      const error = wireNoteError(x.events[i]);
      if (error) return `event ${i}: ${error}`;
      if ((x.events[i] as WireNote).source !== x.source) return `event ${i}: from another source`;
    }
    return null;
  }
  if (x.kind === 'off') {
    if (!isId(x.source)) return 'bad source';
    if (!['stop', 'removed', 'off', 'restart'].includes(x.reason as string)) return 'bad reason';
    if (x.atBeat !== undefined && !finite(x.atBeat)) return 'bad atBeat';
    return null;
  }
  if (x.kind === 'routes') {
    if (!Array.isArray(x.routes) || x.routes.length > 64) return 'routes must be a list (at most 64)';
    for (const r of x.routes) {
      if (!isObject(r) || !isId(r.source) || typeof r.name !== 'string' || r.name.length > MAX_ID_LENGTH) return 'bad route';
      if (!TARGET_ROLES.includes(r.role as TargetRole)) return 'bad route role';
      if (r.octave !== undefined && !(Number.isInteger(r.octave) && (r.octave as number) >= -1 && (r.octave as number) <= 9)) return 'bad route octave';
      if (r.transpose !== undefined && !(Number.isInteger(r.transpose) && Math.abs(r.transpose as number) <= MAX_TRANSPOSE)) return 'bad route transpose';
    }
    return null;
  }
  return 'unknown kind';
}

const copyNote = (e: WireNote): WireNote => ({
  id: e.id, source: e.source, note: e.note, velocity: e.velocity, startBeat: e.startBeat, lengthBeats: e.lengthBeats,
  role: e.role, offsetSec: e.offsetSec, spanBeats: e.spanBeats, gate: e.gate, hit: e.hit, root: e.root,
});

/**
 * A checked copy of a notes message (fresh objects, unknown fields dropped), or null when it isn't valid. Receivers
 * call this on everything they get.
 */
export function parseNotesMessage(x: unknown): NotesMessage | null {
  if (notesMessageError(x)) return null;
  const m = x as NotesMessage;
  if (m.kind === 'notes') return { v: NOTES_VERSION, kind: 'notes', source: m.source, events: m.events.map(copyNote) };
  if (m.kind === 'off') return { v: NOTES_VERSION, kind: 'off', source: m.source, reason: m.reason, ...(m.atBeat === undefined ? {} : { atBeat: m.atBeat }) };
  return {
    v: NOTES_VERSION, kind: 'routes',
    routes: m.routes.map(r => ({
      source: r.source, name: r.name, role: r.role,
      ...(r.octave === undefined ? {} : { octave: r.octave }),
      ...(r.transpose === undefined ? {} : { transpose: r.transpose }),
    })),
  };
}

/** Message builders (the sender side), so every source writes the same shape. */
export const notesMessage = (source: string, events: WireNote[]): NotesMessage => ({ v: NOTES_VERSION, kind: 'notes', source, events });
export const offMessage = (source: string, reason: NotesOffReason, atBeat?: number): NotesMessage =>
  ({ v: NOTES_VERSION, kind: 'off', source, reason, ...(atBeat === undefined ? {} : { atBeat }) });
export const routesMessage = (routes: NotesRoute[]): NotesMessage => ({ v: NOTES_VERSION, kind: 'routes', routes });

/**
 * An instrument's side of the contract (its Notes in), in beats: it takes messages, keeps the events not played yet in
 * start order, forgets ids it has seen only once they are long past, and hands out what is due. The instrument maps
 * beats to its audio time itself.
 */
export class NotesInbox {
  private pending: WireNote[] = [];
  /** Every id taken (pending or played), with its end beat, so a resend is a no-op. */
  private seen = new Map<string, number>();
  private current: NotesRoute[] = [];
  /** Events refused (invalid messages) and resends ignored, for tests and diagnostics. */
  readonly stats = { accepted: 0, duplicates: 0, invalid: 0, dropped: 0 };

  /** The sources playing this instrument now. */
  get routes(): readonly NotesRoute[] { return this.current; }
  /** Whether any source plays this instrument now (its own generator stands aside). */
  get active(): boolean { return this.current.length > 0; }
  /** How many events wait to be played. */
  get size(): number { return this.pending.length; }

  /**
   * Take a message (checked with parseNotesMessage). Returns what it was: the parsed message, or null when it was
   * invalid. `notes` adds the events it doesn't already have; `off` drops a source's waiting events (from `atBeat`
   * on, when given); `routes` replaces the routes.
   */
  receive(raw: unknown): NotesMessage | null {
    const m = parseNotesMessage(raw);
    if (!m) { this.stats.invalid++; return null; }
    if (m.kind === 'notes') this.add(m.events);
    else if (m.kind === 'off') this.off(m.source, m.atBeat);
    else this.current = m.routes;
    return m;
  }

  /** Add events (already checked); ids already taken are ignored. Returns the ones added. */
  add(events: readonly WireNote[]): WireNote[] {
    const added: WireNote[] = [];
    for (const e of events) {
      if (this.seen.has(e.id)) { this.stats.duplicates++; continue; }
      this.seen.set(e.id, e.startBeat + Math.max(e.lengthBeats, e.spanBeats));
      added.push(e);
    }
    if (!added.length) return added;
    this.stats.accepted += added.length;
    // Keep start order; equal starts keep the order they came in (a hit's notes, a strum's order).
    const last = this.pending[this.pending.length - 1];
    const ordered = (!last || added[0].startBeat >= last.startBeat) && added.every((e, i) => i === 0 || e.startBeat >= added[i - 1].startBeat);
    this.pending.push(...added);
    if (!ordered) this.pending = stableSort(this.pending);
    return added;
  }

  /**
   * Drop `source`'s waiting events (from `atBeat` on, else all). Their ids are forgotten (they never played), so the
   * same events sent again later (the target switched back on) are taken. Returns how many were dropped.
   */
  off(source: string, atBeat?: number): number {
    const keep: WireNote[] = [];
    let dropped = 0;
    for (const e of this.pending) {
      if (e.source !== source || (atBeat !== undefined && e.startBeat < atBeat - 1e-9)) keep.push(e);
      else { this.seen.delete(e.id); dropped++; }
    }
    this.pending = keep;
    return dropped;
  }

  /** Hand out (and remove) every waiting event whose start beat `due(beat)` accepts, in start order. */
  take(due: (startBeat: number) => boolean): WireNote[] {
    let n = 0;
    while (n < this.pending.length && due(this.pending[n].startBeat)) n++;
    return n ? this.pending.splice(0, n) : [];
  }

  /**
   * Forget what is past: waiting events that start before `beat` are dropped (counted in stats.dropped), and seen ids
   * that ended before `beat - keepBeats` are forgotten.
   */
  prune(beat: number, keepBeats = 16): void {
    let n = 0;
    while (n < this.pending.length && this.pending[n].startBeat < beat - 1e-9) n++;
    if (n) { this.pending.splice(0, n); this.stats.dropped += n; }
    for (const [id, end] of this.seen) if (end < beat - keepBeats) this.seen.delete(id);
  }

  /** Forget everything (events, ids, routes stay). */
  clear(): void { this.pending = []; this.seen.clear(); }
}

function stableSort(events: WireNote[]): WireNote[] {
  return events.map((e, i) => ({ e, i })).sort((a, b) => a.e.startBeat - b.e.startBeat || a.i - b.i).map(x => x.e);
}
