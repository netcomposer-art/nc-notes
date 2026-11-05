/**
 * Chord mode: Style, Progression, Voice leading, Strum and Tension (Peter's approved mockup, 2026-10-31).
 *
 * Everything here is pure: the engine asks it which chord is playing at a beat, how to voice it and which hits a
 * bar (or one generator step) makes; the UI asks the same for the readouts and the 1-bar preview. Steps are 16ths
 * of a 4/4 bar (step 4 = beat 2). The defaults (Block, Fixed, Strum 0, Tension 0, Progression off) play exactly
 * what Chord mode always played.
 */
import { fitVoicing, getChord, type ArpSpread } from './chords.js';
import { NOTE_NAMES } from './note-names.js';

// ---------------------------------------------------------------- styles

export type ChordStyleId = 'block' | 'walk-up' | 'walk-down' | 'walk-up-down' | 'walk-random' | 'oom-pah' | 'alberti'
  | 'pulse' | 'charleston' | 'skank' | 'house' | 'montuno' | 'push' | 'strum' | 'drift';
/** `repeat`: one hit per generator step, at the Interval. `bar`: a fixed rhythm that follows the bar. */
export type ChordStyleKind = 'repeat' | 'bar';
export interface ChordStyleInfo { id: ChordStyleId; label: string; kind: ChordStyleKind }
export const CHORD_STYLES: readonly ChordStyleInfo[] = [
  { id: 'block', label: 'Block', kind: 'repeat' },
  { id: 'walk-up', label: 'Inversion walk · up', kind: 'repeat' },
  { id: 'walk-down', label: 'Inversion walk · down', kind: 'repeat' },
  { id: 'walk-up-down', label: 'Inversion walk · up-down', kind: 'repeat' },
  { id: 'walk-random', label: 'Inversion walk · random', kind: 'repeat' },
  { id: 'oom-pah', label: 'Oom-pah', kind: 'bar' },
  { id: 'alberti', label: 'Alberti', kind: 'repeat' },
  { id: 'pulse', label: 'Pulse + accents', kind: 'repeat' },
  { id: 'charleston', label: 'Charleston', kind: 'bar' },
  { id: 'skank', label: 'Skank', kind: 'bar' },
  { id: 'house', label: 'House stab', kind: 'bar' },
  { id: 'montuno', label: 'Montuno', kind: 'bar' },
  { id: 'push', label: 'Push', kind: 'bar' },
  { id: 'strum', label: 'Strum', kind: 'bar' },
  { id: 'drift', label: 'Voicing drift', kind: 'repeat' },
];
export const CHORD_STYLE_IDS = CHORD_STYLES.map(s => s.id);
export const chordStyleKind = (id: string): ChordStyleKind => CHORD_STYLES.find(s => s.id === id)?.kind ?? 'repeat';
/** Strum style with the Strum slider at 0: this gap between notes, ms. */
export const STRUM_STYLE_DEFAULT_MS = 15;
export const MAX_STRUM_MS = 40;

/** One hit. `step`/`len` in 16ths from the bar line; `next`: plays the next bar's chord (Push). */
export interface CompHit { step: number; len: number; notes: number[]; velocity: number; strum?: 'down' | 'up'; next?: boolean }

const sorted = (v: readonly number[]) => [...v].sort((a, b) => a - b);
/** Move the lowest note up an octave `times` times. */
export function invertVoicing(v: readonly number[], times: number): number[] {
  const out = sorted(v);
  for (let i = 0; i < times; i++) { const low = out.shift()!; const high = out[out.length - 1] ?? low; out.push(low + Math.ceil((high - low + 1) / 12) * 12); }
  return out;
}
/** The chord over its lowest note: the bottom note moves up an octave (E G B C for Cmaj7). */
const upper = (v: readonly number[]) => invertVoicing(v, 1);
/** The chord's root at or below the voicing's lowest note. */
function rootBelow(v: readonly number[], rootPc: number) {
  const low = v[0];
  return low - (((low - rootPc) % 12) + 12) % 12;
}
/** Voicing drift's four shapes: close, open (2nd note up an octave), wider (2nd and 3rd up), spread over two octaves. */
export function driftVoicing(v: readonly number[], k: number): number[] {
  const s = sorted(v), n = s.length;
  if (n < 3) return s;
  switch (((k % 4) + 4) % 4) {
    case 1: return sorted([s[0], ...s.slice(2), s[1] + 12]);
    case 2: return sorted([s[0], ...s.slice(3), s[1] + 12, s[2] + 12]);
    case 3: return sorted([s[0] - 12, s[2], s[1] + 12, ...s.slice(3).map(m => m + 12)]);
    default: return s;
  }
}
/** Which inversion an Inversion walk plays at step k (root, 1st, 2nd: three positions at most). */
export function walkPosition(style: ChordStyleId, n: number, k: number, random: () => number = Math.random): number {
  const p = Math.max(1, Math.min(n, 3)), i = Math.max(0, Math.floor(k));
  switch (style) {
    case 'walk-down': return (p - (i % p)) % p;
    case 'walk-up-down': { if (p < 2) return 0; const period = 2 * p - 2, j = i % period; return j < p ? j : period - j; }
    case 'walk-random': return Math.min(p - 1, Math.floor(random() * p));
    default: return i % p;
  }
}

/**
 * One hit of a repeating style at generator step `k` (counted from Play), `beatInBar` beats after the bar line.
 * Null for a bar style (those come from barHits).
 */
export function repeatHit(style: ChordStyleId, voicing: readonly number[], k: number, beatInBar: number, random: () => number = Math.random): { notes: number[]; velocity: number } | null {
  const v = sorted(voicing);
  if (!v.length) return { notes: [], velocity: 1 };
  switch (style) {
    case 'block': return { notes: v, velocity: 1 };
    case 'walk-up': case 'walk-down': case 'walk-up-down': case 'walk-random':
      return { notes: invertVoicing(v, walkPosition(style, v.length, k, random)), velocity: 0.9 };
    case 'alberti': {
      const order = [v[0], v[2] ?? v[v.length - 1], v[1] ?? v[0], v[2] ?? v[v.length - 1]];
      return { notes: [order[((Math.floor(k) % 4) + 4) % 4]], velocity: 0.85 };
    }
    case 'pulse': {
      const accent = Math.abs(beatInBar / 2 - Math.round(beatInBar / 2)) < 1e-6;
      return { notes: v, velocity: accent ? 1 : 0.45 };
    }
    case 'drift': return { notes: driftVoicing(v, k), velocity: 0.9 };
    default: return null;
  }
}

/** The hits of one bar of a bar style, at full length (Gate applies on top). `next` is the next bar's voicing (Push). */
export function barHits(style: ChordStyleId, voicing: readonly number[], rootPc: number, intervals: readonly number[], nextVoicing: readonly number[] = voicing): CompHit[] {
  const v = sorted(voicing);
  if (!v.length) return [];
  const block = (steps: number[], len: number, notes: number[], velocity: number): CompHit[] => steps.map(step => ({ step, len, notes, velocity }));
  const r = rootBelow(v, rootPc);
  switch (style) {
    case 'oom-pah': return [...block([0], 3, [r - 12], 1), ...block([4], 2, upper(v), 0.75), ...block([8], 3, [r - 12], 1), ...block([12], 2, upper(v), 0.75)];
    case 'charleston': return block([0, 6], 2, v, 0.9);
    case 'skank': return block([4, 12], 1, upper(v), 0.9);
    case 'house': return block([2, 6, 10, 14], 1, upper(v), 0.9);
    case 'montuno': {
      const t3 = r + (intervals[1] ?? 4), t5 = r + (intervals[2] ?? 7);
      const t7 = intervals[3] !== undefined && intervals[3] < 12 ? r + intervals[3] : r + 12;
      const oct = [r, r + 12], mid = [t3, t5];
      return ([[0, oct], [3, mid], [5, oct], [6, mid], [8, [t5, t7]], [10, oct], [13, mid], [14, [t5, r + 12]]] as [number, number[]][])
        .map(([step, notes]) => ({ step, len: 1, notes: sorted(notes), velocity: 0.85 }));
    }
    case 'push': return [...block([0], 6, v, 0.9), ...block([6], 2, v, 0.9), { step: 14, len: 2, notes: sorted(nextVoicing), velocity: 0.9, next: true }];
    case 'strum': {
      const notes = [...v, v[0] + 12];
      return [{ step: 0, len: 3.5, notes, velocity: 0.95, strum: 'down' }, { step: 8, len: 3.5, notes, velocity: 0.75, strum: 'up' }];
    }
    default: return [];
  }
}

/**
 * One bar of a style as the preview draws it (and as the engine plays it on a held chord): repeating styles at the
 * Interval (steps per whole note), Gate applied to every length.
 */
export function stylePreview(style: ChordStyleId, voicing: readonly number[], rootPc: number, intervals: readonly number[], interval: number, gate: number, random: () => number = () => 0): CompHit[] {
  const g = Math.max(0.1, Math.min(1, gate / 100));
  if (chordStyleKind(style) === 'bar')
    return barHits(style, voicing, rootPc, intervals).map(h => ({ ...h, len: h.len * g }));
  const len = 16 / interval, out: CompHit[] = [];
  for (let k = 0; k * len < 16 - 1e-9; k++) {
    const hit = repeatHit(style, voicing, k, (k * len) / 4, random);
    if (hit && hit.notes.length) out.push({ step: k * len, len: len * g, notes: hit.notes, velocity: hit.velocity });
  }
  return out;
}

// ---------------------------------------------------------------- strum and tension

/** Note start offsets (seconds) for a strum: `ms` between notes, low→high down, high→low up. */
export function strumOffsets(notes: readonly number[], ms: number, direction: 'down' | 'up'): { midi: number; offset: number }[] {
  const order = direction === 'down' ? sorted(notes) : sorted(notes).reverse();
  const gap = Math.max(0, Math.min(MAX_STRUM_MS, ms)) / 1000;
  return order.map((midi, i) => ({ midi, offset: i * gap }));
}
/** Down on a beat, up off it. */
export const strumDirection = (beatInBar: number): 'down' | 'up' => Math.abs(beatInBar - Math.round(beatInBar)) < 1e-6 ? 'down' : 'up';

/**
 * Colour tones that suit a chord, as intervals above the root: 9 (14), 11 (17), #11 (18), 13 (21).
 * Major chords never get the natural 11 (it clashes with the 3rd): #11 or nothing. No ♭9 or ♭13 anywhere.
 * Tones already in the chord are skipped.
 */
export function colourTones(intervals: readonly number[]): number[] {
  const pcs = new Set(intervals.map(i => ((i % 12) + 12) % 12));
  const has = (pc: number) => pcs.has(pc);
  let options: number[];
  const minor = has(3) && !has(4); // a #9 (7#9) is still a major chord
  if (minor && has(6) && has(9)) options = [14];             // diminished 7: the 9
  else if (minor && has(6)) options = [17];                  // half-diminished / diminished: the 11
  else if (has(4) && has(8) && !has(7)) options = [14];      // augmented: the 9
  else if (has(4) && has(10)) options = [14, 21];            // dominant: 9, 13
  else if (has(4)) options = [14, 18, 21];                   // major: 9, #11, 13
  else if (has(3)) options = [14, 17];                       // minor: 9, 11
  else if (has(5) || has(2)) options = [14, 21];             // sus: 9, 13
  else options = [14];                                       // power chord and the rest
  return options.filter(i => !has(i % 12));
}
/** The colour tone to add above `voicing` (its MIDI note), or null when the chord takes none. */
export function colourTone(voicing: readonly number[], rootPc: number, intervals: readonly number[], random: () => number = Math.random): number | null {
  const options = colourTones(intervals);
  if (!options.length || !voicing.length) return null;
  const pc = (rootPc + options[Math.min(options.length - 1, Math.floor(random() * options.length))]) % 12;
  const top = Math.max(...voicing);
  const midi = top + 1 + (((pc - (top + 1)) % 12) + 12) % 12;
  return midi <= 127 ? midi : null;
}

// ---------------------------------------------------------------- voicing and voice leading

/** chordVoicing on raw intervals (same inversion and spread rules), so progression chords outside the library work. */
export function voiceChord(root: number, intervals: readonly number[], inversion = 0, spread: ArpSpread = 'compact'): number[] {
  const notes = intervals.map(n => Math.max(0, Math.min(127, Math.round(root))) + n);
  const inv = Math.max(0, Math.min(notes.length - 1, Math.round(inversion) || 0));
  for (let i = 0; i < inv; i++) {
    const low = notes.shift()!, highest = notes[notes.length - 1];
    notes.push(low + Math.ceil((highest - low + 1) / 12) * 12);
  }
  const extent = { compact: 0, wide: 1, wider: 2, maximum: 4 }[spread] ?? 0;
  return fitVoicing(notes.map((n, i) => n + 12 * Math.floor(i * extent / Math.max(1, notes.length - 1))));
}
/** How far a voicing moves from the last one: paired lowest-to-highest when sizes match, else nearest notes both ways. */
export function voicingDistance(a: readonly number[], b: readonly number[]): number {
  const x = sorted(a), y = sorted(b);
  if (x.length === y.length) return x.reduce((sum, n, i) => sum + Math.abs(n - y[i]), 0);
  const near = (n: number, set: number[]) => Math.min(...set.map(m => Math.abs(m - n)));
  return x.reduce((s, n) => s + near(n, y), 0) + y.reduce((s, n) => s + near(n, x), 0);
}
/**
 * Smooth voice leading: of every inversion and octave placement whose lowest note stays within a fifth below to an
 * octave above `home` (the Note Generator's key note at its Octave), the one that moves least from `previous`.
 * No previous chord (the first one): the Fixed voicing. `only` restricts to one inversion (a slash chord).
 */
export function smoothVoicing(previous: readonly number[] | null, root: number, intervals: readonly number[], home: number, fixedInversion: number, spread: ArpSpread = 'compact', only?: number): number[] {
  const fixed = voiceChord(root, intervals, only ?? fixedInversion, spread);
  if (!previous || !previous.length) return fixed;
  let best = fixed, bestCost = Infinity, bestTie = Infinity;
  const inversions = only !== undefined ? [only] : intervals.map((_, i) => i);
  for (const inv of inversions) for (const shift of [-24, -12, 0, 12]) {
    const v = voiceChord(root, intervals, inv, spread).map(n => n + shift);
    if (v[0] < home - 7 || v[0] > home + 12 || v[0] < 0 || v[v.length - 1] > 127) continue;
    const cost = voicingDistance(v, previous);
    const tie = Math.abs(v.reduce((a, b) => a + b, 0) / v.length - previous.reduce((a, b) => a + b, 0) / previous.length);
    if (cost < bestCost - 1e-9 || (Math.abs(cost - bestCost) < 1e-9 && tie < bestTie - 1e-9)) { best = v; bestCost = cost; bestTie = tie; }
  }
  return best;
}

// ---------------------------------------------------------------- progressions

export type Tonality = 'major' | 'minor' | 'blues' | 'dorian' | 'mixolydian' | 'phrygian' | 'lydian';
/** A chord in a progression: semitones above the key, a CHORD_LIBRARY id, its numeral and its length in bars. */
export interface ProgressionChord {
  degree: number; chord: string; numeral: string; bars: number;
  /** Exact notes when the library has no such chord (V13sus); `chord` is then the nearest library chord (for the arp). */
  intervals?: readonly number[]; symbol?: string;
  /** A slash chord's inversion (I/V = 2). */
  inversion?: number;
}
export interface Progression { id: string; name: string; group: string; short: string; level: 1 | 2 | 3; tonality: Tonality; chords: readonly ProgressionChord[] }
export const PROGRESSION_GROUPS = ['Pop / Rock', 'Blues', 'Jazz', 'Soul / R&B / Neo-soul', 'Gospel', 'EDM / House / Trance',
  'Cinematic / Ambient', 'Latin / Flamenco', 'Lo-fi / Chill', 'Modal'] as const;
const SHORT: Record<string, string> = { 'Pop / Rock': 'Pop', 'Blues': 'Blues', 'Jazz': 'Jazz', 'Soul / R&B / Neo-soul': 'Soul', 'Gospel': 'Gospel',
  'EDM / House / Trance': 'EDM', 'Cinematic / Ambient': 'Cinematic', 'Latin / Flamenco': 'Latin', 'Lo-fi / Chill': 'Lo-fi', 'Modal': 'Modal' };

const c = (degree: number, chord: string, numeral: string, bars = 1, extra: Partial<ProgressionChord> = {}): ProgressionChord => ({ degree, chord, numeral, bars, ...extra });
const MAJ = 'major', MIN = 'minor', DOM7 = 'dominant-7', MIN7 = 'minor-7', MAJ7 = 'major-7', HALF = 'half-diminished-7', DIM7 = 'diminished-7';
const p = (id: string, group: typeof PROGRESSION_GROUPS[number], name: string, level: 1 | 2 | 3, tonality: Tonality, chords: ProgressionChord[]): Progression =>
  ({ id, group, name, level, tonality, chords, short: SHORT[group] });
const blues12 = (bar2: string) => [c(0, DOM7, 'I7'), c(bar2 === 'IV7' ? 5 : 0, DOM7, bar2), c(0, DOM7, 'I7'), c(0, DOM7, 'I7'),
  c(5, DOM7, 'IV7'), c(5, DOM7, 'IV7'), c(0, DOM7, 'I7'), c(0, DOM7, 'I7'), c(7, DOM7, 'V7'), c(5, DOM7, 'IV7'), c(0, DOM7, 'I7'), c(7, DOM7, 'V7')];

/** The 38 progressions, grouped by style. Ids are stable (saved in presets): never rename one once shipped. */
export const PROGRESSIONS: readonly Progression[] = [
  p('pop-1-5-6-4', 'Pop / Rock', 'I–V–vi–IV', 1, 'major', [c(0, MAJ, 'I'), c(7, MAJ, 'V'), c(9, MIN, 'vi'), c(5, MAJ, 'IV')]),
  p('pop-6-4-1-5', 'Pop / Rock', 'vi–IV–I–V', 1, 'major', [c(9, MIN, 'vi'), c(5, MAJ, 'IV'), c(0, MAJ, 'I'), c(7, MAJ, 'V')]),
  p('pop-50s', 'Pop / Rock', 'I–vi–IV–V · 50s', 1, 'major', [c(0, MAJ, 'I'), c(9, MIN, 'vi'), c(5, MAJ, 'IV'), c(7, MAJ, 'V')]),
  p('rock-1-b7-4', 'Pop / Rock', 'I–♭VII–IV', 2, 'mixolydian', [c(0, MAJ, 'I'), c(10, MAJ, '♭VII'), c(5, MAJ, 'IV', 2)]),
  p('pop-canon', 'Pop / Rock', 'Canon · 8 chords', 2, 'major', [c(0, MAJ, 'I', .5), c(7, MAJ, 'V', .5), c(9, MIN, 'vi', .5), c(4, MIN, 'iii', .5),
    c(5, MAJ, 'IV', .5), c(0, MAJ, 'I', .5), c(5, MAJ, 'IV', .5), c(7, MAJ, 'V', .5)]),

  p('blues-12', 'Blues', '12-bar', 1, 'blues', blues12('I7')),
  p('blues-12-quick', 'Blues', '12-bar quick change', 2, 'blues', blues12('IV7')),
  p('blues-minor', 'Blues', 'Minor blues', 2, 'minor', [c(0, MIN7, 'i7'), c(0, MIN7, 'i7'), c(0, MIN7, 'i7'), c(0, MIN7, 'i7'),
    c(5, MIN7, 'iv7'), c(5, MIN7, 'iv7'), c(0, MIN7, 'i7'), c(0, MIN7, 'i7'), c(8, DOM7, '♭VI7'), c(7, DOM7, 'V7'), c(0, MIN7, 'i7'), c(7, DOM7, 'V7')]),
  p('blues-jazz', 'Blues', 'Jazz blues', 3, 'blues', [c(0, DOM7, 'I7'), c(5, DOM7, 'IV7'), c(0, DOM7, 'I7'), c(7, MIN7, 'v7', .5), c(0, DOM7, 'I7', .5),
    c(5, DOM7, 'IV7'), c(6, DIM7, '♯iv°7'), c(0, DOM7, 'I7'), c(9, DOM7, 'VI7'), c(2, MIN7, 'ii7'), c(7, DOM7, 'V7'),
    c(0, DOM7, 'I7', .5), c(9, DOM7, 'VI7', .5), c(2, MIN7, 'ii7', .5), c(7, DOM7, 'V7', .5)]),

  p('jazz-2-5-1', 'Jazz', 'ii–V–I', 1, 'major', [c(2, MIN7, 'ii7'), c(7, DOM7, 'V7'), c(0, MAJ7, 'Imaj7', 2)]),
  p('jazz-2-5-1-minor', 'Jazz', 'ii–V–i minor', 2, 'minor', [c(2, HALF, 'iiø7'), c(7, '7b9', 'V7♭9'), c(0, 'minor-6', 'i6', 2)]),
  p('jazz-rhythm', 'Jazz', 'I–vi–ii–V · rhythm changes', 2, 'major', [c(0, MAJ7, 'Imaj7', .5), c(9, MIN7, 'vi7', .5), c(2, MIN7, 'ii7', .5), c(7, DOM7, 'V7', .5)]),
  p('jazz-turnaround', 'Jazz', 'iii–VI–ii–V turnaround', 2, 'major', [c(4, MIN7, 'iii7', .5), c(9, DOM7, 'VI7', .5), c(2, MIN7, 'ii7', .5), c(7, DOM7, 'V7', .5)]),
  // Autumn Leaves, in the minor key: iv7 ♭VII7 ♭IIImaj7 ♭VImaj7 iiø7 V7 i.
  p('jazz-autumn', 'Jazz', 'Autumn cycle', 3, 'minor', [c(5, MIN7, 'iv7'), c(10, DOM7, '♭VII7'), c(3, MAJ7, '♭IIImaj7'), c(8, MAJ7, '♭VImaj7'),
    c(2, HALF, 'iiø7'), c(7, '7b9', 'V7♭9'), c(0, MIN7, 'i7', 2)]),
  // Giant Steps, bars 1–8: three keys a major third apart (I, ♭VI, III), each reached by its V7.
  p('jazz-giant-steps', 'Jazz', 'Giant Steps cycle', 3, 'major', [c(0, MAJ7, 'Imaj7', .5), c(3, DOM7, '♭III7', .5), c(8, MAJ7, '♭VImaj7', .5), c(11, DOM7, 'VII7', .5),
    c(4, MAJ7, 'IIImaj7'), c(10, MIN7, '♭vii7', .5), c(3, DOM7, '♭III7', .5), c(8, MAJ7, '♭VImaj7', .5), c(11, DOM7, 'VII7', .5),
    c(4, MAJ7, 'IIImaj7', .5), c(7, DOM7, 'V7', .5), c(0, MAJ7, 'Imaj7'), c(6, MIN7, '♯iv7', .5), c(11, DOM7, 'VII7', .5)]),

  p('soul-dorian-vamp', 'Soul / R&B / Neo-soul', 'Dorian vamp i7–IV7', 1, 'dorian', [c(0, MIN7, 'i7'), c(5, DOM7, 'IV7')]),
  p('soul-4-3-2-1', 'Soul / R&B / Neo-soul', 'IVmaj7–iii7–ii7–Imaj7', 2, 'major', [c(5, MAJ7, 'IVmaj7'), c(4, MIN7, 'iii7'), c(2, MIN7, 'ii7'), c(0, MAJ7, 'Imaj7')]),
  // "Just the Two of Us" as commonly analysed: IVmaj7–III7–vi7–v7 I7.
  p('soul-two-of-us', 'Soul / R&B / Neo-soul', 'Just the Two of Us', 3, 'major', [c(5, MAJ7, 'IVmaj7'), c(4, DOM7, 'III7'), c(9, MIN7, 'vi7'), c(7, MIN7, 'v7', .5), c(0, DOM7, 'I7', .5)]),
  p('soul-2-5-1-ext', 'Soul / R&B / Neo-soul', 'ii9–V13sus–Imaj9', 3, 'major', [c(2, 'minor-9', 'ii9'),
    c(7, '9sus4', 'V13sus', 1, { intervals: [0, 5, 7, 10, 14, 21], symbol: '13sus4' }), c(0, 'major-9', 'Imaj9', 2)]),

  p('gospel-1-4-1-dim', 'Gospel', '1–4–1 passing dim', 2, 'major', [c(0, MAJ, 'I'), c(5, MAJ, 'IV', .5), c(6, DIM7, '♯iv°7', .5)]),
  p('gospel-7-3-6', 'Gospel', '7–3–6', 3, 'major', [c(11, HALF, 'viiø7'), c(4, DOM7, 'III7'), c(9, MIN7, 'vi7', 2)]),
  p('gospel-1-17-4-dim', 'Gospel', 'I–I7–IV–♯iv°–I/V', 3, 'major', [c(0, MAJ, 'I', .5), c(0, DOM7, 'I7', .5), c(5, MAJ, 'IV', .5), c(6, DIM7, '♯iv°7', .5),
    c(0, MAJ, 'I/V', 2, { inversion: 2 })]),

  p('edm-epic', 'EDM / House / Trance', 'i–VI–III–VII · epic', 1, 'minor', [c(0, MIN, 'i'), c(8, MAJ, 'VI'), c(3, MAJ, 'III'), c(10, MAJ, 'VII')]),
  p('edm-1-7-6-7', 'EDM / House / Trance', 'i–VII–VI–VII', 1, 'minor', [c(0, MIN, 'i'), c(10, MAJ, 'VII'), c(8, MAJ, 'VI'), c(10, MAJ, 'VII')]),
  p('house-organ', 'EDM / House / Trance', 'House organ i7–iv7', 1, 'minor', [c(0, MIN7, 'i7'), c(5, MIN7, 'iv7')]),
  p('trance-1-6-7-5', 'EDM / House / Trance', 'Trance i–VI–VII–v', 2, 'minor', [c(0, MIN, 'i'), c(8, MAJ, 'VI'), c(10, MAJ, 'VII'), c(7, MIN, 'v')]),

  p('cine-minor-plagal', 'Cinematic / Ambient', 'Minor plagal iv–i', 1, 'minor', [c(5, MIN, 'iv'), c(0, MIN, 'i')]),
  p('cine-hero', 'Cinematic / Ambient', 'Hero I–♭VI–♭VII–I', 2, 'major', [c(0, MAJ, 'I'), c(8, MAJ, '♭VI'), c(10, MAJ, '♭VII'), c(0, MAJ, 'I')]),
  p('cine-mediant', 'Cinematic / Ambient', 'Mediant I–III', 2, 'major', [c(0, MAJ, 'I'), c(4, MAJ, 'III')]),
  p('cine-lydian', 'Cinematic / Ambient', 'Lydian I–II', 2, 'lydian', [c(0, MAJ, 'I'), c(2, MAJ, 'II')]),

  p('latin-andalusian', 'Latin / Flamenco', 'Andalusian i–♭VII–♭VI–V', 1, 'minor', [c(0, MIN, 'i'), c(10, MAJ, '♭VII'), c(8, MAJ, '♭VI'), c(7, MAJ, 'V')]),
  p('latin-montuno', 'Latin / Flamenco', 'Montuno i–iv–V7', 1, 'minor', [c(0, MIN, 'i'), c(5, MIN, 'iv'), c(7, DOM7, 'V7', 2)]),
  p('latin-bossa', 'Latin / Flamenco', 'Bossa Imaj7–II7–ii7–V7', 2, 'major', [c(0, MAJ7, 'Imaj7', 2), c(2, DOM7, 'II7', 2), c(2, MIN7, 'ii7'), c(7, DOM7, 'V7')]),

  p('lofi-2-5-1-6', 'Lo-fi / Chill', 'ii9–V9–Imaj9–vi9', 2, 'major', [c(2, 'minor-9', 'ii9'), c(7, 'dominant-9', 'V9'), c(0, 'major-9', 'Imaj9'), c(9, 'minor-9', 'vi9')]),
  p('lofi-4-3-6', 'Lo-fi / Chill', 'IVmaj7–iii7–vi7', 2, 'major', [c(5, MAJ7, 'IVmaj7'), c(4, MIN7, 'iii7'), c(9, MIN7, 'vi7', 2)]),

  p('modal-dorian', 'Modal', 'Dorian i–IV', 1, 'dorian', [c(0, MIN, 'i'), c(5, MAJ, 'IV')]),
  p('modal-mixolydian', 'Modal', 'Mixolydian I–♭VII', 1, 'mixolydian', [c(0, MAJ, 'I'), c(10, MAJ, '♭VII')]),
  p('modal-phrygian', 'Modal', 'Phrygian i–♭II', 1, 'phrygian', [c(0, MIN, 'i'), c(1, MAJ, '♭II')]),
];
export const PROGRESSION_IDS = PROGRESSIONS.map(x => x.id);
export const getProgression = (id: unknown): Progression | null => PROGRESSIONS.find(x => x.id === id) ?? null;
/** ●○○ … ●●●: how hard it is on the ear. */
export const difficultyDots = (level: number) => '●'.repeat(level) + '○'.repeat(3 - level);
/** Bars per chord: 0 = as written. */
export const PROGRESSION_BARS = [0.5, 1, 2, 4, 0] as const;
export const barsLabel = (bars: number) => (bars === 0.5 ? '½' : String(bars));
/** "½ bar", "1 bar", "2 bars". */
export const barsText = (bars: number) => `${barsLabel(bars)} bar${bars > 1 ? 's' : ''}`;

/** A progression chord placed in the key: its root note, notes and length. */
export interface ResolvedChord {
  index: number; root: number; rootPc: number; chord: string; intervals: readonly number[];
  name: string; numeral: string; bars: number; inversion?: number;
}
/**
 * A progression in the Note Generator's key: roots rise from the key note at `octave` (0–11 semitones above).
 * `barsPerChord` 0 keeps each chord's written length; otherwise every chord gets that many bars.
 */
export function resolveProgression(id: unknown, key: number, octave: number, barsPerChord = 0): ResolvedChord[] | null {
  const prog = getProgression(id);
  if (!prog) return null;
  const home = (octave + 1) * 12 + key;
  return prog.chords.map((ch, index) => {
    const def = getChord(ch.chord), intervals = ch.intervals ?? def.intervals;
    const rootPc = (key + ch.degree) % 12;
    return { index, root: home + ch.degree, rootPc, chord: def.id, intervals, numeral: ch.numeral,
      name: `${NOTE_NAMES[rootPc]}${ch.symbol ?? def.symbol}`, bars: barsPerChord > 0 ? barsPerChord : ch.bars,
      ...(ch.inversion !== undefined ? { inversion: ch.inversion } : {}) };
  });
}
export const progressionBars = (chords: readonly { bars: number }[]) => chords.reduce((sum, ch) => sum + ch.bars, 0);
/** Where a chord starts, in bars from the progression's start. */
export const chordStart = (chords: readonly { bars: number }[], index: number) => chords.slice(0, index).reduce((sum, ch) => sum + ch.bars, 0);
/** The chord playing `bars` bars after the progression's start (it loops). */
export function progressionAt<T extends { bars: number }>(chords: readonly T[], bars: number): { chord: T; index: number; position: number; total: number } {
  const total = progressionBars(chords);
  const position = ((bars % total) + total) % total;
  let start = 0;
  for (let i = 0; i < chords.length; i++) {
    if (position < start + chords[i].bars - 1e-9) return { chord: chords[i], index: i, position, total };
    start += chords[i].bars;
  }
  return { chord: chords[chords.length - 1], index: chords.length - 1, position, total };
}
/** The key the readout names: "C major", "A minor", "D dorian". */
export const tonalityName = (key: number, tonality: Tonality) => `${NOTE_NAMES[key]} ${tonality}`;
