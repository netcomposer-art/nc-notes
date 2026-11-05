/**
 * The Note Generator: what ASTRID's generator plays, as a clock-free state machine on beats.
 *
 * It owns the step counter, the step grid (Interval), Chord mode's progression position, voicing memory, bar-style
 * rhythms, Strum and Tension, and asks the pure modules (notes.ts, chords.ts, comp.ts) for the notes. It never reads a
 * clock: the host says which beat to start on and asks for the next steps; times stay in beats. Randomness comes
 * from the two functions you pass in, so a seeded host replays exactly (see random.ts).
 *
 * Two ways to drive it:
 *  - window(toBeat): every note event from where it is up to `toBeat`, as NoteEvents (CALLIOPE, Studio routing).
 *  - Step by step, as ASTRID's scheduler does (nextBeat / stepHit / advance, and barHits): the host maps each beat
 *    to its own audio time and keeps its own lookahead, so ASTRID's timing arithmetic is unchanged.
 */
import { generateNotes } from './notes.js';
import { getChord } from './chords.js';
import {
  barHits, chordStart, chordStyleKind, colourTone, progressionAt, repeatHit, resolveProgression, smoothVoicing, strumDirection,
  voiceChord, STRUM_STYLE_DEFAULT_MS, type ChordStyleId, type CompHit, type ResolvedChord,
} from './comp.js';
import { isGeneratorMode, type GeneratorSettings } from './settings.js';
import { hitEvents, type NoteEvent } from './events.js';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const EPS = 1e-9;
/** The first multiple of `grid` at or after `beat` (nc-clock's nextGridBeat, copied so nc-notes has no dependency). */
export function nextGridBeat(beat: number, grid: number): number {
  if (!(grid > 0)) return beat;
  return Math.ceil(beat / grid - EPS) * grid;
}

/**
 * One chord or note the generator decided to play: a grid step, or a bar style's hit. The host turns it into
 * voices (ASTRID) or NoteEvents (hitEvents).
 */
export interface GeneratorHit {
  /** Start, in beats on the host's clock. */
  beat: number;
  /** The span the gate applies to: one step, or a bar style's written length (a Push tied over the bar line). */
  spanBeats: number;
  /** Gate as a fraction (0.1–1): a note lasts spanBeats × gate. */
  gate: number;
  velocity: number;
  /** MIDI notes, in the order chosen (a Tension tone last). */
  notes: number[];
  /** 'plain': Off/Single/Random and plain Chord mode (Block, no progression, strum or tension) as they always were.
   *  'comp': Chord mode with a Style, Progression, Strum or Tension (comp.ts). */
  kind: 'plain' | 'comp';
  /** Strum: the direction of this hit (null: together) and the gap between notes (ms). */
  direction: 'down' | 'up' | null;
  strumMs: number;
  /** The chord this hit plays (Chord mode), or null (Single, Random). */
  chord: ResolvedChord | null;
  /** MIDI root: the chord's root, or the note itself (Single, Random, one arp note: the chord root when known). */
  root: number;
  /** What the notes are: the whole chord, one arp note, or a single note. */
  role: 'chord' | 'arp' | 'note';
}

export interface NoteGeneratorOptions {
  /** Random mode and the random arp orders. Default Math.random. */
  random?: () => number;
  /** Chord mode's random (Inversion walk random, Tension). Default Math.random. */
  chordRandom?: () => number;
  /** The meter: beats in a bar (bar styles and progressions follow it). Default 4. */
  beatsPerBar?: () => number;
}

interface CompState {
  /** The next beat a bar style may play from. */
  from: number;
  /** The beat the progression's chord 1 starts on. */
  origin: number;
  /** A chord jump (a progression strip click) taking effect on a bar line. */
  jump: { at: number; origin: number } | null;
  /** The voicing played last (Smooth) and its key. */
  last: number[] | null; lastKey: string;
  pushedTo: number;
  bar: { bar: number; settings: GeneratorSettings | null; hits: CompHit[] };
}
const freshComp = (from: number, origin: number): CompState =>
  ({ from, origin, jump: null, last: null, lastKey: '', pushedTo: -1, bar: { bar: NaN, settings: null, hits: [] } });

export class NoteGenerator {
  /** Pattern step counter (the arp's and the styles' position). */
  step = 0;
  /** Grid: step k sounds at beat `origin + k * 4 / interval`. */
  private grid = { origin: 0, index: 0, interval: 16 };
  private comp: CompState = freshComp(0, 0);
  private readonly read: () => GeneratorSettings;
  private readonly random: () => number;
  private readonly chordRandom: () => number;
  private readonly bpb: () => number;
  private serial = 0;

  /**
   * `settings`: the settings object, or a function returning the current one (ASTRID passes its live settings; a
   * bar style's hits are cached per bar for one settings object, so pass a new object when settings change).
   */
  constructor(settings: GeneratorSettings | (() => GeneratorSettings), options: NoteGeneratorOptions = {}) {
    this.read = typeof settings === 'function' ? settings : () => settings;
    this.random = options.random ?? Math.random;
    this.chordRandom = options.chordRandom ?? Math.random;
    this.bpb = options.beatsPerBar ?? (() => 4);
  }

  get settings(): GeneratorSettings { return this.read(); }
  private beatsPerBar() { return Math.max(1, this.bpb()); }
  private beatInBar(beat: number) { const bpb = this.beatsPerBar(); return ((beat % bpb) + bpb) % bpb; }

  // ------------------------------------------------------------------ transport

  /**
   * Start at `beat` (Play). `join`: entering a clock already running, so the first step is the next grid line, the
   * step counter matches the beat, and the progression counts from absolute bar 0 (so every copy agrees). Returns the
   * first step's beat.
   */
  start(beat: number, { join = false }: { join?: boolean } = {}): number {
    const interval = this.settings.interval, grid = 4 / interval;
    const origin = join ? nextGridBeat(beat, grid) : beat;
    this.grid = { origin, index: 0, interval };
    this.step = Math.max(0, Math.round(origin / grid));
    const bpb = this.beatsPerBar();
    this.comp = freshComp(origin, join ? 0 : Math.floor(beat / bpb + 1e-9) * bpb);
    return origin;
  }
  /** Put the grid back to beat 0 (the step counter keeps counting). */
  resetGrid(): void { this.grid = { origin: 0, index: 0, interval: this.settings.interval }; }
  /** Beat of the next grid step. */
  nextBeat(): number { return this.grid.origin + this.grid.index * 4 / this.grid.interval; }
  /** One grid step, in beats. */
  stepBeats(): number { return 4 / this.grid.interval; }
  /** The Interval changed: the new grid starts where the next step would have been. */
  followInterval(): void {
    const interval = this.settings.interval;
    if (interval !== this.grid.interval) this.grid = { origin: this.nextBeat(), index: 0, interval };
  }
  /** After a stall: skip the grid steps before `beat` instead of playing a burst. Returns how many were skipped. */
  skipTo(beat: number): number {
    const skip = Math.max(0, Math.ceil((beat - this.nextBeat()) / this.stepBeats() - 1e-9));
    this.grid.index += skip; this.step += skip;
    return skip;
  }
  /** Move to the next grid step (after stepHit, or after a step the host played itself). */
  advance(): void { this.grid.index++; }
  /** Count a step the host played (or muted) itself, so the pattern keeps its place. */
  advanceStep(): void { this.step++; }
  /** A pending chord jump takes over once `beat` reaches its bar line. */
  applyJump(beat: number): void {
    const jump = this.comp.jump;
    if (jump && beat >= jump.at - 1e-9) { this.comp.origin = jump.origin; this.comp.jump = null; }
  }

  // ------------------------------------------------------------------ grid steps

  /** Chord mode as it always was: Block, no progression, no strum or tension. That path stays untouched. */
  plainChord(): boolean {
    const s = this.settings;
    return s.chordStyle === 'block' && s.chordProgression === 'off' && !(s.strum > 0) && !(s.tension > 0);
  }
  /** A bar style (Charleston, Push…) plays from barHits, not from the grid. */
  barStyleActive(): boolean {
    const s = this.settings;
    return s.mode === 'chord' && s.arp === 'off' && !this.plainChord() && chordStyleKind(s.chordStyle) === 'bar';
  }

  /**
   * The grid step at `beat` (the host's nextBeat()): what it plays, or null for a rest. Counts the step. Call
   * advance() after. A mode the generator doesn't know rests.
   */
  stepHit(beat: number): GeneratorHit | null {
    const s = this.settings, span = this.stepBeats();
    if (s.mode === 'chord' && !this.plainChord()) {
      if (s.arp !== 'off') {
        // The arp plays as always (it overrides Style), on the progression's chord at this beat.
        const ch = this.chordAt(beat);
        const at = { ...s, chord: ch.chord, note: ch.rootPc, octave: Math.floor(ch.root / 12) - 1, ...(ch.inversion !== undefined ? { inversion: ch.inversion } : {}) };
        const notes = generateNotes(at, this.step, this.random);
        this.step++;
        if (!notes.length) return null;
        return this.hit(beat, span, notes, 1, null, ch, false, 'arp');
      }
      if (chordStyleKind(s.chordStyle) === 'bar') { this.step++; return null; } // barHits plays these
      const ch = this.chordAt(beat), voicing = this.voicingFor(ch);
      const hit = repeatHit(s.chordStyle, voicing, this.step, this.beatInBar(beat), this.chordRandom);
      this.step++;
      if (!hit || !hit.notes.length) return null;
      return this.hit(beat, span, hit.notes, hit.velocity, strumDirection(this.beatInBar(beat)), ch, true, 'chord');
    }
    if (!isGeneratorMode(s.mode)) { this.step++; return null; }
    const notes = generateNotes(s, this.step, this.random);
    this.step++;
    if (!notes.length) return null; // off, or a Euclidean rest
    const chordMode = s.mode === 'chord';
    const root = chordMode ? Math.min(127, Math.max(0, (s.octave + 1) * 12 + s.note)) : notes[0];
    return { beat, spanBeats: span, gate: clamp(s.gate / 100, 0.1, 1), velocity: 1, notes, kind: 'plain', direction: null, strumMs: 0,
      chord: chordMode ? this.plainChordAt() : null, root, role: chordMode ? (s.arp === 'off' ? 'chord' : 'arp') : 'note' };
  }

  /** A Chord-mode hit: Tension may add a colour tone (only when `tension`), Strum spreads the notes. */
  private hit(beat: number, spanBeats: number, input: number[], velocity: number, direction: 'down' | 'up' | null, ch: ResolvedChord,
    tension: boolean, role: GeneratorHit['role']): GeneratorHit {
    const s = this.settings;
    const notes = [...input];
    if (tension && s.tension > 0 && this.chordRandom() * 100 < s.tension) {
      const tone = colourTone(notes, ch.rootPc, ch.intervals, this.chordRandom);
      if (tone !== null) notes.push(tone);
    }
    const strumMs = s.chordStyle === 'strum' && direction ? (s.strum > 0 ? s.strum : STRUM_STYLE_DEFAULT_MS) : s.strum;
    return { beat, spanBeats, gate: clamp(s.gate / 100, 0.1, 1), velocity, notes, kind: 'comp', direction, strumMs, chord: ch, root: ch.root, role };
  }

  // ------------------------------------------------------------------ Chord mode: progression, voicing, bar styles

  /** The progression's start for a beat (a pending jump counts from its bar on). */
  private progressionOrigin(beat: number) {
    const jump = this.comp.jump;
    return jump && beat >= jump.at - 1e-9 ? jump.origin : this.comp.origin;
  }
  private plainChordAt(): ResolvedChord {
    const s = this.settings, def = getChord(s.chord), root = (s.octave + 1) * 12 + s.note;
    return { index: 0, root, rootPc: s.note, chord: def.id, intervals: def.intervals, name: '', numeral: '', bars: 1 };
  }
  /** The chord at `beat`: the progression's, or the Chord setting when there is none. */
  chordAt(beat: number): ResolvedChord {
    const s = this.settings;
    const chords = resolveProgression(s.chordProgression, s.note, s.octave, s.progressionBars);
    if (chords?.length) return progressionAt(chords, (beat + 1e-6 - this.progressionOrigin(beat)) / this.beatsPerBar()).chord;
    return this.plainChordAt();
  }
  /** Fixed: the Inversion setting (or a slash chord's own). Smooth: nearest the last voicing; it changes only with the chord. */
  private voicingFor(ch: ResolvedChord): number[] {
    const s = this.settings;
    const inversion = ch.inversion ?? Math.min(Math.max(0, s.inversion | 0), ch.intervals.length - 1);
    const key = `${ch.root}|${ch.intervals.join(',')}|${inversion}|${s.voiceLeading}|${s.arpSpread}`;
    if (this.comp.last && key === this.comp.lastKey) return this.comp.last;
    const v = s.voiceLeading === 'smooth'
      ? smoothVoicing(this.comp.last, ch.root, ch.intervals, (s.octave + 1) * 12 + s.note, inversion, s.arpSpread, ch.inversion)
      : voiceChord(ch.root, ch.intervals, inversion, s.arpSpread);
    this.comp.last = v; this.comp.lastKey = key;
    return v;
  }
  /** A bar style's hits for `bar`, voiced (cached per bar: the voicing state moves once per chord). */
  private compBar(bar: number): CompHit[] {
    const cache = this.comp.bar, settings = this.settings;
    if (cache.bar === bar && cache.settings === settings) return cache.hits;
    const s = settings, bpb = this.beatsPerBar(), style = s.chordStyle as ChordStyleId;
    const ch = this.chordAt(bar * bpb), voicing = this.voicingFor(ch);
    let next = voicing;
    if (style === 'push') {
      const nextChord = this.chordAt((bar + 1) * bpb);
      if (`${nextChord.root}|${nextChord.intervals.join(',')}` !== `${ch.root}|${ch.intervals.join(',')}`) {
        // Look ahead without disturbing this bar's voicing state.
        const keep = { last: this.comp.last, key: this.comp.lastKey };
        next = this.voicingFor(nextChord);
        this.comp.last = keep.last; this.comp.lastKey = keep.key;
      }
    }
    let hits = barHits(style, voicing, ch.rootPc, ch.intervals, next).filter(h => h.step / 4 < bpb - 1e-9);
    if (style === 'push' && this.comp.pushedTo === bar) {
      // The last bar's push already sounds this chord, tied over the bar line: no new hit on 1.
      hits = hits.filter(h => h.step !== 0);
    }
    this.comp.bar = { bar, settings, hits };
    return hits;
  }
  /** The next beat a bar style may play from. */
  barFrom(): number { return this.comp.from; }
  /** After a stall: bar styles skip to `beat` instead of a burst. */
  catchUpBars(beat: number): void { this.comp.from = beat; }
  /** No bar style playing: keep its position on the grid, so one switched on starts from the next step. */
  syncBars(): void { this.comp.from = this.nextBeat(); }
  /**
   * A bar style's hits from barFrom() while `before(beat)` holds (ASTRID: the beat's audio time is inside the
   * lookahead). `muted()`: a hit's time passes without playing (ASTRID's held keys or a locked sequence).
   */
  barHits(before: (beat: number) => boolean, muted: () => boolean = () => false): GeneratorHit[] {
    const s = this.settings, bpb = this.beatsPerBar(), out: GeneratorHit[] = [];
    for (let guard = 0; guard < 128; guard++) {
      const bar = Math.floor(this.comp.from / bpb + 1e-9);
      const hits = this.compBar(bar);
      const hit = hits.find(h => bar * bpb + h.step / 4 >= this.comp.from - 1e-9);
      if (!hit) { this.comp.from = (bar + 1) * bpb; continue; }
      const beat = bar * bpb + hit.step / 4;
      if (!before(beat)) break;
      this.comp.from = beat + 1e-6;
      if (muted()) continue;
      // A push is tied over the bar line: it lasts until the next bar's 8th-note hit.
      const len = hit.next && s.chordStyle === 'push' ? hit.len + 6 : hit.len;
      if (hit.next) this.comp.pushedTo = bar + 1;
      const ch = this.chordAt(hit.next ? (bar + 1) * bpb : beat);
      out.push(this.hit(beat, len / 4, hit.notes, hit.velocity, hit.strum ?? strumDirection(this.beatInBar(beat)), ch, true, 'chord'));
    }
    return out;
  }

  /**
   * Where the progression is at `beat`: chord index, the bar (1-based) and the length in bars. Null outside Chord
   * mode or without a progression.
   */
  chordPosition(beat: number): { index: number; bar: number; bars: number } | null {
    const s = this.settings;
    if (s.mode !== 'chord') return null;
    const chords = resolveProgression(s.chordProgression, s.note, s.octave, s.progressionBars);
    if (!chords?.length) return null;
    const at = progressionAt(chords, (beat + 1e-6 - this.progressionOrigin(beat)) / this.beatsPerBar());
    return { index: at.index, bar: Math.floor(at.position + 1e-9) + 1, bars: at.total };
  }
  /**
   * Jump to chord `index` of the progression on the first bar line at or after `earliest` (and after anything already
   * generated). False without a progression or for a bad index.
   */
  jumpToChord(index: number, earliest: number): boolean {
    const s = this.settings;
    const chords = resolveProgression(s.chordProgression, s.note, s.octave, s.progressionBars);
    if (!chords?.length || index < 0 || index >= chords.length) return false;
    const bpb = this.beatsPerBar();
    const from = Math.max(earliest, this.nextBeat(), this.comp.from);
    const at = Math.ceil(from / bpb - 1e-9) * bpb;
    this.comp.jump = { at, origin: at - chordStart(chords, index) * bpb };
    return true;
  }

  // ------------------------------------------------------------------ the window API

  /**
   * Every note event from where the generator is up to (not including) `toBeat`, in start order. Call start() first,
   * then window() with increasing beats (a little ahead of the clock, as a scheduler would). `muted()`: steps pass
   * silently (the pattern keeps its place). If `toBeat` is far behind what was asked for before, nothing happens.
   */
  window(toBeat: number, { muted = () => false }: { muted?: () => boolean } = {}): NoteEvent[] {
    const hits: GeneratorHit[] = [];
    this.followInterval();
    this.applyJump(this.nextBeat());
    for (let guard = 0; guard < 4096; guard++) {
      const beat = this.nextBeat();
      if (!(beat < toBeat)) break;
      if (muted()) this.advanceStep();
      else { const hit = this.stepHit(beat); if (hit) hits.push(hit); }
      this.advance();
    }
    if (this.barStyleActive()) hits.push(...this.barHits(beat => beat < toBeat, muted));
    else this.syncBars();
    const events: NoteEvent[] = [];
    for (const hit of hits) events.push(...hitEvents(hit, ++this.serial));
    return events.sort((a, b) => a.startBeat - b.startBeat);
  }
}
