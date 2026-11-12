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
 *    own generator stands aside (no double playing), unless the route is a `layer` (0.6.0: the Song Looper's replay
 *    adds to what the instrument plays).
 *  - `played` (0.6.0) goes the other way: an instrument reports what was played on it by hand (keys, pads, slot and
 *    chord-pad changes), each stamped with the beat the player heard. The Song Looper records it. `controls` (0.6.0)
 *    sends recorded slot and chord-pad changes back, ahead of time, like notes.
 *
 * Messages are plain objects (structured-clonable). A receiver checks every message with parseNotesMessage(), which
 * copies it into fresh objects, so nothing from another frame is kept by reference.
 */
import type { NoteEvent, NoteRole, TargetRole } from './events.js';
import { routeRole } from './route.js';

/** The contract's version. A receiver ignores messages from a newer major version. */
export const NOTES_VERSION = 1;

/** The most events one `notes` message may carry. */
export const MAX_EVENTS_PER_MESSAGE = 1024;
/** The most a route's transpose may move notes, in semitones (four octaves either way). */
export const MAX_TRANSPOSE = 48;
/** The longest source id, event id or name, in characters. */
export const MAX_ID_LENGTH = 128;
/** The longest sound name a played note may carry (0.8.0), in characters. */
export const MAX_SOUND_NAME = 40;
/** The most notes one `audition` message may carry. */
export const MAX_AUDITION_NOTES = 64;
/** The longest an audition note may be held, in seconds. */
export const MAX_AUDITION_HOLD_SEC = 8;
/** The highest slot number (slots are numbered as labelled, from 1; the 0 key is slot 10). */
export const MAX_SLOT = 16;
/** The most note ids one `release` message may carry (0.10.0). */
export const MAX_RELEASE_IDS = 1024;
/** The most pads (NYX pads, CALLIOPE chord pads), numbered from 1. */
export const MAX_PAD = 16;
/** The MIDI note of pad 1 when a pad hit travels as a note (pads 1–16 are notes 36–51, as on drum machines). */
export const PAD_NOTE_BASE = 36;
/** The highest slice index a pad hit may name (slices are numbered from 0). */
export const MAX_SLICE = 255;

const TARGET_ROLES: readonly TargetRole[] = ['chord', 'root', 'top'];
const NOTE_ROLES: readonly NoteRole[] = ['chord', 'root', 'top', 'arp', 'note'];

/** One note event on the wire: a NoteEvent with the id that makes it idempotent and the source it came from. */
export interface WireNote extends NoteEvent {
  /** Unique per source and run; the same event resent has the same id. */
  id: string;
  /** The source's id ("calliope", "calliope#2", "studio-dev"). */
  source: string;
  /**
   * For a pad hit (0.6.0): which slice of the pad plays (from 0). Absent: the whole pad. A receiver that doesn't play
   * pads ignores it.
   */
  slice?: number;
}

/** A pad (1–16) as the MIDI note its hit travels as (36–51). */
export const padNote = (pad: number): number => PAD_NOTE_BASE + pad - 1;
/** The pad (1–16) a MIDI note stands for, or null when it isn't a pad note. */
export function padOfNote(note: number): number | null {
  const pad = note - PAD_NOTE_BASE + 1;
  return Number.isInteger(pad) && pad >= 1 && pad <= MAX_PAD ? pad : null;
}

/** A slot recalled by hand (PETRA, OLIVE, NYX: the number keys), at a beat on the Studio clock. */
export interface SlotEvent {
  type: 'slot';
  /** Unique per source and run, as a note's id. */
  id: string;
  beat: number;
  /** As labelled, 1–MAX_SLOT. */
  slot: number;
}

/** A CALLIOPE chord pad latched (1–16) or let go (null), at a beat on the Studio clock. */
export interface ChordPadEvent {
  type: 'chordPad';
  id: string;
  beat: number;
  pad: number | null;
}

/**
 * A take of audio (0.7.0, LUPA's voice laps: LUCY records the mic one lap at a time). Played (LUCY → the Studio): lap
 * `take` was kept, recorded from `beat` for `lengthBeats`. As a control (LUPA → LUCY): play `take` from `beat`, at
 * `gain`, starting `offsetBeats` into it (a resend after a change mid-take) and playing to its end: `lengthBeats` is the
 * whole take, so it sounds for lengthBeats − offsetBeats. `take` names the audio
 * in the recorder's own store.
 */
export interface TakeEvent {
  type: 'take';
  id: string;
  beat: number;
  take: string;
  /** Above 0, at most MAX_TAKE_BEATS. */
  lengthBeats: number;
  /** Linear, 0–MAX_TAKE_GAIN; absent: 1. Controls only. */
  gain?: number;
  /** From 0, below lengthBeats; absent: 0. Controls only. */
  offsetBeats?: number;
  /**
   * The take's loudness across it, each 0–1, at most MAX_TAKE_PEAKS values (0.9.0); played only. For display (LUPA's
   * voice pass rows draw it); nothing needs it to play.
   */
  peaks?: number[];
}

/**
 * A lap (0.7.0): LUPA announces each lap ahead, from `beat` for `lengthBeats`, so a recorder armed for it (LUCY) takes
 * the lap. Sent as a control to that recorder only; an `off` drops the laps not begun.
 */
export interface LapEvent {
  type: 'lap';
  id: string;
  beat: number;
  /** Above 0, at most MAX_TAKE_BEATS. */
  lengthBeats: number;
}

/** The longest take in beats (LUPA's longest lap: 16 bars at 240 BPM caps at a minute, 64 bars of headroom). */
export const MAX_TAKE_BEATS = 256;
/** The most a take's gain may be (+6 dB). */
export const MAX_TAKE_GAIN = 2;
/** The most peak values a take may carry (0.9.0). */
export const MAX_TAKE_PEAKS = 128;

/** A recorded change that is not a note: what `controls` carries. */
export type ControlEvent = SlotEvent | ChordPadEvent | TakeEvent | LapEvent;

/**
 * A key or pad played by hand, reported by the instrument (0.6.0). `on` starts the note and `off` ends it; both carry
 * the same id. `beat` is the beat the player heard when they pressed: press time minus the output latency, from the
 * audio clock (AudioContext.getOutputTimestamp), so a replay at that beat sounds when the key went down.
 */
export interface PlayedNote {
  type: 'note';
  /** The same for a note's on and off; unique per instrument while the page lives. */
  id: string;
  beat: number;
  on: boolean;
  /** MIDI 0–127 (a pad: padNote(pad)). */
  note: number;
  /** 0–1, above 0; on only. */
  velocity?: number;
  /** A pad hit's slice (from 0); on only. */
  slice?: number;
  /**
   * The sound's name as the player sees it (0.8.0): a NYX pad's sample, 1–MAX_SOUND_NAME characters; on only. For
   * display (LUPA's pass rows); a receiver never needs it to play the note.
   */
  name?: string;
}

/** What `played` carries: notes, slot changes and chord-pad changes. */
export type PlayedEvent = PlayedNote | ControlEvent;


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
  /**
   * The source adds to what the instrument plays (0.6.0: the Song Looper's replay): the instrument's own generator and
   * its keys keep playing. Absent or false: the generator stands aside while this route lasts. A receiver from before
   * 0.6.0 ignores it and stands aside.
   */
  layer?: boolean;
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
  | { v: typeof NOTES_VERSION; kind: 'routes'; routes: NotesRoute[] }
  /**
   * Play now, once (0.5.0: CALLIOPE's pad clicked while the Studio is stopped, so the player hears the chord; Peter,
   * 2026-11-05). Not on the clock: each note starts now (plus its `offsetSec`) and is held `holdSec`, then released;
   * `startBeat` and the gate are not read. A newer audition from the same source releases the one before; an `off`
   * from the source releases it too. Routed per target like `notes` (role, octave, transpose). A receiver from
   * before 0.5.0 drops it as an unknown kind, so nothing plays there and nothing else changes.
   */
  | { v: typeof NOTES_VERSION; kind: 'audition'; source: string; events: WireNote[]; holdSec: number }
  /**
   * What was played on an instrument by hand (0.6.0), from the instrument to the Studio. `source` is the instrument's
   * instance id ("astrid-synth", "nyx#2"). Not routed to other instruments.
   */
  | { v: typeof NOTES_VERSION; kind: 'played'; source: string; events: PlayedEvent[] }
  /**
   * Slot and chord-pad changes to make at their beats (0.6.0: the Song Looper replaying them), sent ahead like `notes`
   * and idempotent by id. An `off` from the source drops the ones waiting. A receiver from before 0.6.0 drops it as an
   * unknown kind.
   */
  | { v: typeof NOTES_VERSION; kind: 'controls'; source: string; events: ControlEvent[] }
  /**
   * Release these notes now, by event id (0.10.0: LUPA muting or soloing a pass whose notes still ring, a long
   * sample). The instrument fades each sounding note it started from one of these ids, and drops any still waiting.
   * Other notes from the source keep playing. A receiver from before 0.10.0 drops it as an unknown kind.
   */
  | { v: typeof NOTES_VERSION; kind: 'release'; source: string; ids: string[] };

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
  if (x.slice !== undefined && !isSlice(x.slice)) return `slice must be a whole number 0–${MAX_SLICE}`;
  return null;
}

const isSlice = (x: unknown): boolean => Number.isInteger(x) && (x as number) >= 0 && (x as number) <= MAX_SLICE;
const isPad = (x: unknown): boolean => Number.isInteger(x) && (x as number) >= 1 && (x as number) <= MAX_PAD;

/** Why `x` is not a valid control event (slot or chord pad), or null when it is. */
export function controlEventError(x: unknown): string | null {
  if (!isObject(x)) return 'not an object';
  if (!isId(x.id)) return 'bad id';
  if (!finite(x.beat)) return 'bad beat';
  if (x.type === 'slot') {
    if (!Number.isInteger(x.slot) || (x.slot as number) < 1 || (x.slot as number) > MAX_SLOT) return `slot must be a whole number 1–${MAX_SLOT}`;
    return null;
  }
  if (x.type === 'chordPad') {
    if (x.pad !== null && !isPad(x.pad)) return `pad must be a whole number 1–${MAX_PAD}, or null`;
    return null;
  }
  if (x.type === 'take') {
    if (!isId(x.take)) return 'bad take';
    if (!finite(x.lengthBeats) || x.lengthBeats <= 0 || x.lengthBeats > MAX_TAKE_BEATS) return `lengthBeats must be above 0, at most ${MAX_TAKE_BEATS}`;
    if (x.gain !== undefined && (!finite(x.gain) || x.gain < 0 || x.gain > MAX_TAKE_GAIN)) return `gain must be 0–${MAX_TAKE_GAIN}`;
    if (x.offsetBeats !== undefined && (!finite(x.offsetBeats) || x.offsetBeats < 0 || x.offsetBeats >= x.lengthBeats)) return 'offsetBeats must be from 0, below lengthBeats';
    if (x.peaks !== undefined && !(Array.isArray(x.peaks) && x.peaks.length <= MAX_TAKE_PEAKS && x.peaks.every((v) => finite(v) && v >= 0 && v <= 1)))
      return `peaks must be at most ${MAX_TAKE_PEAKS} values 0–1`;
    return null;
  }
  if (x.type === 'lap') {
    if (!finite(x.lengthBeats) || x.lengthBeats <= 0 || x.lengthBeats > MAX_TAKE_BEATS) return `lengthBeats must be above 0, at most ${MAX_TAKE_BEATS}`;
    return null;
  }
  return 'bad type';
}

/** Why `x` is not a valid played event, or null when it is. */
export function playedEventError(x: unknown): string | null {
  if (!isObject(x)) return 'not an object';
  if (x.type !== 'note') return controlEventError(x);
  if (!isId(x.id)) return 'bad id';
  if (!finite(x.beat)) return 'bad beat';
  if (typeof x.on !== 'boolean') return 'on must be true or false';
  if (!Number.isInteger(x.note) || (x.note as number) < 0 || (x.note as number) > 127) return 'note must be a whole number 0–127';
  if (x.on) {
    if (!finite(x.velocity) || x.velocity <= 0 || x.velocity > 1) return 'velocity must be above 0, at most 1';
    if (x.slice !== undefined && !isSlice(x.slice)) return `slice must be a whole number 0–${MAX_SLICE}`;
    if (x.name !== undefined && (typeof x.name !== 'string' || !x.name.length || x.name.length > MAX_SOUND_NAME))
      return `name must be 1–${MAX_SOUND_NAME} characters`;
  } else if (x.velocity !== undefined || x.slice !== undefined || x.name !== undefined)
    return 'an off has no velocity, slice or name';
  return null;
}

/** Check a list of events with `error` (at most MAX_EVENTS_PER_MESSAGE); the first problem, or null. */
function eventsError(events: unknown, error: (x: unknown) => string | null): string | null {
  if (!Array.isArray(events)) return 'events must be a list';
  if (events.length > MAX_EVENTS_PER_MESSAGE) return `more than ${MAX_EVENTS_PER_MESSAGE} events`;
  for (let i = 0; i < events.length; i++) {
    const e = error(events[i]);
    if (e) return `event ${i}: ${e}`;
  }
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
  if (x.kind === 'audition') {
    if (!isId(x.source)) return 'bad source';
    if (!Array.isArray(x.events)) return 'events must be a list';
    if (x.events.length > MAX_AUDITION_NOTES) return `more than ${MAX_AUDITION_NOTES} notes`;
    if (!finite(x.holdSec) || x.holdSec <= 0 || x.holdSec > MAX_AUDITION_HOLD_SEC) return `holdSec must be above 0, at most ${MAX_AUDITION_HOLD_SEC}`;
    for (let i = 0; i < x.events.length; i++) {
      const error = wireNoteError(x.events[i]);
      if (error) return `event ${i}: ${error}`;
      if ((x.events[i] as WireNote).source !== x.source) return `event ${i}: from another source`;
    }
    return null;
  }
  if (x.kind === 'played') {
    if (!isId(x.source)) return 'bad source';
    return eventsError(x.events, playedEventError);
  }
  if (x.kind === 'controls') {
    if (!isId(x.source)) return 'bad source';
    return eventsError(x.events, controlEventError);
  }
  if (x.kind === 'off') {
    if (!isId(x.source)) return 'bad source';
    if (!['stop', 'removed', 'off', 'restart'].includes(x.reason as string)) return 'bad reason';
    if (x.atBeat !== undefined && !finite(x.atBeat)) return 'bad atBeat';
    return null;
  }
  if (x.kind === 'release') {
    if (!isId(x.source)) return 'bad source';
    if (!Array.isArray(x.ids)) return 'ids must be a list';
    if (x.ids.length > MAX_RELEASE_IDS) return `more than ${MAX_RELEASE_IDS} ids`;
    for (let i = 0; i < x.ids.length; i++) if (!isId(x.ids[i])) return `id ${i}: bad id`;
    return null;
  }
  if (x.kind === 'routes') {
    if (!Array.isArray(x.routes) || x.routes.length > 64) return 'routes must be a list (at most 64)';
    for (const r of x.routes) {
      if (!isObject(r) || !isId(r.source) || typeof r.name !== 'string' || r.name.length > MAX_ID_LENGTH) return 'bad route';
      if (!TARGET_ROLES.includes(r.role as TargetRole)) return 'bad route role';
      if (r.octave !== undefined && !(Number.isInteger(r.octave) && (r.octave as number) >= -1 && (r.octave as number) <= 9)) return 'bad route octave';
      if (r.transpose !== undefined && !(Number.isInteger(r.transpose) && Math.abs(r.transpose as number) <= MAX_TRANSPOSE)) return 'bad route transpose';
      if (r.layer !== undefined && typeof r.layer !== 'boolean') return 'bad route layer';
    }
    return null;
  }
  return 'unknown kind';
}

const copyNote = (e: WireNote): WireNote => ({
  id: e.id, source: e.source, note: e.note, velocity: e.velocity, startBeat: e.startBeat, lengthBeats: e.lengthBeats,
  role: e.role, offsetSec: e.offsetSec, spanBeats: e.spanBeats, gate: e.gate, hit: e.hit, root: e.root,
  ...(e.slice === undefined ? {} : { slice: e.slice }),
});

const copyControl = (e: ControlEvent): ControlEvent =>
  e.type === 'slot' ? { type: 'slot', id: e.id, beat: e.beat, slot: e.slot }
  : e.type === 'take' ? {
    type: 'take', id: e.id, beat: e.beat, take: e.take, lengthBeats: e.lengthBeats,
    ...(e.gain === undefined ? {} : { gain: e.gain }),
    ...(e.offsetBeats === undefined ? {} : { offsetBeats: e.offsetBeats }),
    ...(e.peaks === undefined ? {} : { peaks: [...e.peaks] }),
  }
  : e.type === 'lap' ? { type: 'lap', id: e.id, beat: e.beat, lengthBeats: e.lengthBeats }
  : { type: 'chordPad', id: e.id, beat: e.beat, pad: e.pad };

const copyPlayed = (e: PlayedEvent): PlayedEvent =>
  e.type !== 'note' ? copyControl(e) : {
    type: 'note', id: e.id, beat: e.beat, on: e.on, note: e.note,
    ...(e.on ? { velocity: e.velocity } : {}),
    ...(e.on && e.slice !== undefined ? { slice: e.slice } : {}),
    ...(e.on && e.name !== undefined ? { name: e.name } : {}),
  };

/**
 * A checked copy of a notes message (fresh objects, unknown fields dropped), or null when it isn't valid. Receivers
 * call this on everything they get.
 */
export function parseNotesMessage(x: unknown): NotesMessage | null {
  if (notesMessageError(x)) return null;
  const m = x as NotesMessage;
  if (m.kind === 'notes') return { v: NOTES_VERSION, kind: 'notes', source: m.source, events: m.events.map(copyNote) };
  if (m.kind === 'audition') return { v: NOTES_VERSION, kind: 'audition', source: m.source, events: m.events.map(copyNote), holdSec: m.holdSec };
  if (m.kind === 'played') return { v: NOTES_VERSION, kind: 'played', source: m.source, events: m.events.map(copyPlayed) };
  if (m.kind === 'controls') return { v: NOTES_VERSION, kind: 'controls', source: m.source, events: m.events.map(copyControl) };
  if (m.kind === 'off') return { v: NOTES_VERSION, kind: 'off', source: m.source, reason: m.reason, ...(m.atBeat === undefined ? {} : { atBeat: m.atBeat }) };
  if (m.kind === 'release') return { v: NOTES_VERSION, kind: 'release', source: m.source, ids: [...m.ids] };
  return {
    v: NOTES_VERSION, kind: 'routes',
    routes: m.routes.map(r => ({
      source: r.source, name: r.name, role: r.role,
      ...(r.octave === undefined ? {} : { octave: r.octave }),
      ...(r.transpose === undefined ? {} : { transpose: r.transpose }),
      ...(r.layer === undefined ? {} : { layer: r.layer }),
    })),
  };
}

/** Message builders (the sender side), so every source writes the same shape. */
export const notesMessage = (source: string, events: WireNote[]): NotesMessage => ({ v: NOTES_VERSION, kind: 'notes', source, events });
export const offMessage = (source: string, reason: NotesOffReason, atBeat?: number): NotesMessage =>
  ({ v: NOTES_VERSION, kind: 'off', source, reason, ...(atBeat === undefined ? {} : { atBeat }) });
/** Release these sounding notes now (0.10.0), by event id. */
export const releaseMessage = (source: string, ids: string[]): NotesMessage => ({ v: NOTES_VERSION, kind: 'release', source, ids });
export const routesMessage = (routes: NotesRoute[]): NotesMessage => ({ v: NOTES_VERSION, kind: 'routes', routes });
/** An audition (0.5.0): `events` routed for the target, played now and held `holdSec`. */
export const auditionMessage = (source: string, events: WireNote[], holdSec: number): NotesMessage =>
  ({ v: NOTES_VERSION, kind: 'audition', source, events, holdSec });
/** What an instrument played by hand (0.6.0). */
export const playedMessage = (source: string, events: PlayedEvent[]): NotesMessage => ({ v: NOTES_VERSION, kind: 'played', source, events });
/** Slot and chord-pad changes to make at their beats (0.6.0). */
export const controlsMessage = (source: string, events: ControlEvent[]): NotesMessage => ({ v: NOTES_VERSION, kind: 'controls', source, events });

/**
 * An instrument's side of the contract (its Notes in), in beats: it takes messages, keeps the events not played yet in
 * start order, forgets ids it has seen only once they are long past, and hands out what is due. The instrument maps
 * beats to its audio time itself.
 */
export class NotesInbox {
  private pending: WireNote[] = [];
  /** Slot and chord-pad changes not made yet, in beat order, with the source that sent them. */
  private pendingControls: { source: string; event: ControlEvent }[] = [];
  /** Every id taken (pending or played), with its end beat, so a resend is a no-op. */
  private seen = new Map<string, number>();
  private current: NotesRoute[] = [];
  /** Events refused (invalid messages) and resends ignored, for tests and diagnostics. */
  readonly stats = { accepted: 0, duplicates: 0, invalid: 0, dropped: 0 };

  /** The sources playing this instrument now. */
  get routes(): readonly NotesRoute[] { return this.current; }
  /** Whether any source plays this instrument now. */
  get active(): boolean { return this.current.length > 0; }
  /**
   * Whether the instrument's own generator stands aside now (0.6.0): some source plays it that is not a `layer`. A
   * host that knows layers reads this instead of `active`.
   */
  get standsAside(): boolean { return this.current.some(r => !r.layer); }
  /** How many slot and chord-pad changes wait to be made. */
  get controlsSize(): number { return this.pendingControls.length; }
  /** How many events wait to be played. */
  get size(): number { return this.pending.length; }

  /**
   * Take a message (checked with parseNotesMessage). Returns what it was: the parsed message, or null when it was
   * invalid. `notes` adds the events it doesn't already have; `controls` adds the changes it doesn't already have;
   * `off` drops a source's waiting events and changes (from `atBeat` on, when given); `release` drops the waiting
   * events with those ids (the host fades the sounding ones); `routes` replaces the routes;
   * `audition` and `played` change nothing here.
   */
  receive(raw: unknown): NotesMessage | null {
    const m = parseNotesMessage(raw);
    if (!m) { this.stats.invalid++; return null; }
    if (m.kind === 'notes') this.add(m.events);
    else if (m.kind === 'controls') this.addControls(m.source, m.events);
    else if (m.kind === 'off') this.off(m.source, m.atBeat);
    else if (m.kind === 'release') { const ids = new Set(m.ids); this.pending = this.pending.filter(e => !ids.has(e.id)); }
    else if (m.kind === 'routes') this.current = m.routes;
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

  /** Add slot and chord-pad changes from `source` (already checked); ids already taken are ignored. Returns the ones added. */
  addControls(source: string, events: readonly ControlEvent[]): ControlEvent[] {
    const added: ControlEvent[] = [];
    for (const e of events) {
      const key = `${source}\u0000${e.id}`;
      if (this.seen.has(key)) { this.stats.duplicates++; continue; }
      this.seen.set(key, e.beat);
      added.push(e);
      this.pendingControls.push({ source, event: e });
    }
    if (added.length) {
      this.stats.accepted += added.length;
      this.pendingControls = this.pendingControls.map((c, i) => ({ c, i }))
        .sort((a, b) => a.c.event.beat - b.c.event.beat || a.i - b.i).map(x => x.c);
    }
    return added;
  }

  /** Hand out (and remove) every waiting slot or chord-pad change whose beat `due(beat)` accepts, in beat order. */
  takeControls(due: (beat: number) => boolean): ControlEvent[] {
    let n = 0;
    while (n < this.pendingControls.length && due(this.pendingControls[n].event.beat)) n++;
    return n ? this.pendingControls.splice(0, n).map(c => c.event) : [];
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
    const keepControls: { source: string; event: ControlEvent }[] = [];
    for (const c of this.pendingControls) {
      if (c.source !== source || (atBeat !== undefined && c.event.beat < atBeat - 1e-9)) keepControls.push(c);
      else { this.seen.delete(`${source}\u0000${c.event.id}`); dropped++; }
    }
    this.pendingControls = keepControls;
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
    let c = 0;
    while (c < this.pendingControls.length && this.pendingControls[c].event.beat < beat - 1e-9) c++;
    if (c) { this.pendingControls.splice(0, c); this.stats.dropped += c; }
    for (const [id, end] of this.seen) if (end < beat - keepBeats) this.seen.delete(id);
  }

  /** Forget everything (events, ids, routes stay). */
  clear(): void { this.pending = []; this.pendingControls = []; this.seen.clear(); }
}

function stableSort(events: WireNote[]): WireNote[] {
  return events.map((e, i) => ({ e, i })).sort((a, b) => a.e.startBeat - b.e.startBeat || a.i - b.i).map(x => x.e);
}
