/** Authoritative definitions from the Expanded Chord Library brief.
 * Matching interval arrays under different names are intentional aliases. */
export const CHORD_CATEGORIES = ['Essential', 'Seventh', 'Extended', 'Altered', 'Experimental'] as const;
export type ChordCategory = typeof CHORD_CATEGORIES[number];
export type ArpSpread = 'compact' | 'wide' | 'wider' | 'maximum';
/** Arp pattern IDs. Stable: never rename one once shipped (see ARP_PATTERNS and docs/arp-patterns.md). */
export type ArpOrder = 'off' | 'up' | 'down' | 'up-down' | 'down-up' | 'up-down-repeat' | 'random' | 'as-played' | 'outside-in' | 'inside-out' | 'pendulum'
  | 'blossom-up' | 'blossom-down' | 'low-and-up' | 'low-and-down' | 'hi-and-up' | 'hi-and-down' | 'walk' | 'euclidean';
export interface ChordDefinition { id: string; name: string; category: ChordCategory; intervals: readonly number[]; symbol: string }
const group = (category: ChordCategory, rows: [string, string, number[], string][]): ChordDefinition[] =>
  rows.map(([id, name, intervals, symbol]) => ({ id, name, intervals, category, symbol }));
export const CHORD_LIBRARY: readonly ChordDefinition[] = [
  ...group('Essential', [
    ['major','Major',[0,4,7],''], ['minor','Minor',[0,3,7],'m'],
    ['diminished','Diminished',[0,3,6],'dim'], ['augmented','Augmented',[0,4,8],'aug'],
    ['sus2','Sus2',[0,2,7],'sus2'], ['sus4','Sus4',[0,5,7],'sus4'],
    ['power','Power Chord',[0,7,12],'5'], ['major-6','Major 6',[0,4,7,9],'6'], ['minor-6','Minor 6',[0,3,7,9],'m6'],
  ]),
  ...group('Seventh', [
    ['major-7','Major 7',[0,4,7,11],'maj7'], ['minor-7','Minor 7',[0,3,7,10],'m7'],
    ['dominant-7','Dominant 7',[0,4,7,10],'7'], ['minor-major-7','Minor-Major 7',[0,3,7,11],'m(maj7)'],
    ['half-diminished-7','Half-Diminished 7',[0,3,6,10],'m7b5'], ['diminished-7','Diminished 7',[0,3,6,9],'dim7'],
    ['augmented-major-7','Augmented Major 7',[0,4,8,11],'aug(maj7)'], ['augmented-7','Augmented 7',[0,4,8,10],'aug7'],
    ['7sus4','7sus4',[0,5,7,10],'7sus4'],
  ]),
  ...group('Extended', [
    // 9/11/13 sit above the octave (stacked thirds). Natural 11 omitted from maj13/13
    // (clashes with the major 3rd); kept in m13. #11 = 18, b9 = 13, #9 = 15, b13 = 20.
    ['add9','Add9',[0,4,7,14],'add9'], ['minor-add9','Minor Add9',[0,3,7,14],'m(add9)'],
    ['major-9','Major 9',[0,4,7,11,14],'maj9'], ['minor-9','Minor 9',[0,3,7,10,14],'m9'],
    ['dominant-9','Dominant 9',[0,4,7,10,14],'9'], ['6-9','6/9',[0,4,7,9,14],'6/9'],
    ['minor-6-9','Minor 6/9',[0,3,7,9,14],'m6/9'], ['major-7-sharp11','Major 7#11',[0,4,7,11,18],'maj7#11'],
    ['minor-11','Minor 11',[0,3,7,10,14,17],'m11'], ['dominant-11','Dominant 11',[0,4,7,10,14,17],'11'],
    ['9sus4','9sus4',[0,5,7,10,14],'9sus4'], ['major-13','Major 13',[0,4,7,11,14,21],'maj13'],
    ['minor-13','Minor 13',[0,3,7,10,14,17,21],'m13'], ['dominant-13','Dominant 13',[0,4,7,10,14,21],'13'],
  ]),
  ...group('Altered', [
    ['7b9','7b9',[0,4,7,10,13],'7b9'], ['7-sharp9','7#9',[0,4,7,10,15],'7#9'],
    ['7b5','7b5',[0,4,6,10],'7b5'], ['7-sharp5','7#5',[0,4,8,10],'7#5'],
    ['7b9-sharp5','7b9#5',[0,4,8,10,13],'7b9#5'], ['7-sharp9-b5','7#9b5',[0,4,6,10,15],'7#9b5'],
    ['7alt','7alt',[0,4,10,13,15,18,20],'7alt'], ['major-7b5','Major 7b5',[0,4,6,11],'maj7b5'],
    ['minor-7b9','Minor 7b9',[0,3,7,10,13],'m7b9'],
  ]),
  ...group('Experimental', [
    ['quartal-3','Quartal 3',[0,5,10],' Quartal 3'], ['quartal-4','Quartal 4',[0,5,10,15],' Quartal 4'],
    ['quartal-5','Quartal 5',[0,5,10,15,20],' Quartal 5'], ['quintal-3','Quintal 3',[0,7,14],' Quintal 3'],
    ['quintal-4','Quintal 4',[0,7,14,21],' Quintal 4'], ['chromatic-cluster','Chromatic Cluster',[0,1,2],' Chromatic Cluster'],
    ['whole-tone-cluster','Whole-Tone Cluster',[0,2,4,6],' Whole-Tone Cluster'],
    ['minor-second-cluster','Minor-Second Cluster',[0,1,5,7],' Minor-Second Cluster'],
    ['major-second-stack','Major-Second Stack',[0,2,4,7,9],' Major-Second Stack'],
    ['lydian-stack','Lydian Stack',[0,2,4,6,7,11],' Lydian Stack'],
    ['major-pentatonic','Major Pentatonic',[0,2,4,7,9],' Major Pentatonic'],
    ['minor-pentatonic','Minor Pentatonic',[0,3,5,7,10],' Minor Pentatonic'],
    ['in-sen','In-sen',[0,1,5,7,10],' In-sen'], ['whole-tone','Whole-Tone Collection',[0,2,4,6,8,10],' Whole-Tone'],
  ]),
];
const byId = new Map(CHORD_LIBRARY.map(chord => [chord.id, chord]));
const legacy: Record<string, string> = {
  Major:'major', Minor:'minor', Diminished:'diminished', Augmented:'augmented', Sus2:'sus2', Sus4:'sus4',
  'Major 7th':'major-7', 'Minor 7th':'minor-7', 'Dominant 7th':'dominant-7',
};
export function resolveChordId(value: unknown): string {
  if (typeof value !== 'string') return 'major';
  if (byId.has(value)) return value;
  if (legacy[value]) return legacy[value];
  // Preserve legacy display-name variants in imported files, including the
  // compact Major7th spelling, without changing canonical IDs or intervals.
  const normalize = (name: string) => name.trim().toLowerCase().replace(/[\s_-]+/g, '');
  const normalized = normalize(value);
  return Object.entries(legacy).find(([name]) => normalize(name) === normalized)?.[1]
    ?? CHORD_LIBRARY.find(c => normalize(c.name) === normalized || normalize(c.id) === normalized)?.id
    ?? 'major';
}
export function getChord(value: unknown): ChordDefinition { return byId.get(resolveChordId(value))!; }
const integer = (n: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(Number.isFinite(n) ? n : min)));
/** Translate the complete voicing by the smallest necessary whole-octave shift.
 * Every supplied library voicing fits; no pitch classes are clamped or folded. */
export function fitVoicing(notes: number[]) {
  if (!notes.length) return [];
  const low = Math.min(...notes), high = Math.max(...notes);
  const lower = Math.ceil(-low / 12), upper = Math.floor((127 - high) / 12);
  if (lower > upper) throw new RangeError('Voicing spans more than the supported MIDI range.');
  const shift = Math.max(lower, Math.min(upper, 0)) * 12;
  return notes.map(n => n + shift);
}
export function chordVoicing(root: number, chord: string, inversion = 0, spread: ArpSpread = 'compact'): number[] {
  const definition = getChord(chord);
  const notes = definition.intervals.map(n => integer(root, 0, 127) + n);
  for (let i = 0; i < integer(inversion, 0, notes.length - 1); i++) {
    const low = notes.shift()!, highest = notes[notes.length - 1];
    notes.push(low + Math.ceil((highest - low + 1) / 12) * 12);
  }
  // Displacement grows by rank: floor(i * E / (N-1)) octaves,
  // with E=0/1/2/4 for Compact/Wide/Wider/Maximum.
  const extent = { compact:0, wide:1, wider:2, maximum:4 }[spread] ?? 0;
  return fitVoicing(notes.map((n, i) => n + 12 * Math.floor(i * extent / Math.max(1, notes.length - 1))));
}
/** Octave repetitions retain source order. Deduplicate exact MIDI values, not
 * pitch classes. Repetitions above MIDI 127 are omitted, as in the legacy arp. */
export function arpeggioPool(voicing: readonly number[], octaves = 1) {
  return [...new Set(Array.from({ length: integer(octaves, 1, 4) }, (_, octave) =>
    voicing.map(n => n + octave * 12)).flat().filter(n => n >= 0 && n <= 127))];
}
export function arpeggioSequence(pool: readonly number[], order: ArpOrder): number[] {
  const notes = [...new Set(pool)].sort((a, b) => a - b), n = notes.length;
  if (n < 2) return notes;
  const bounce = [...notes, ...notes.slice(1, -1).reverse()];
  switch (order) {
    case 'down': return notes.reverse();
    case 'up-down': return bounce;
    case 'down-up': return bounce.map(note => notes[n - 1 - notes.indexOf(note)]);
    case 'up-down-repeat': return [...notes, ...[...notes].reverse()];
    case 'as-played': return [...new Set(pool)];
    case 'outside-in': {
      const result: number[] = [];
      for (let low = 0, high = n - 1; low <= high; low++, high--) {
        result.push(notes[low]); if (low !== high) result.push(notes[high]);
      }
      return result;
    }
    case 'inside-out': return notes.map((note, i) => ({ note, i }))
      .sort((a, b) => Math.abs(a.i - (n - 1) / 2) - Math.abs(b.i - (n - 1) / 2) || a.i - b.i).map(x => x.note);
    case 'pendulum': {
      // Same endpoint-safe swing, starting at the lower middle toward the top.
      const middle = Math.floor((n - 1) / 2);
      return [...bounce.slice(middle), ...bounce.slice(0, middle)];
    }
    case 'blossom-up': case 'blossom-down': {
      // From the centre (lower middle for an even count), spiral out: +1, -1, +2, -2… (Down: -1, +1…).
      const centre = Math.floor((n - 1) / 2), sign = order === 'blossom-up' ? 1 : -1, result = [notes[centre]];
      for (let d = 1; result.length < n; d++) for (const i of [centre + sign * d, centre - sign * d])
        if (i >= 0 && i < n) result.push(notes[i]);
      return result;
    }
    case 'low-and-up': case 'low-and-down': case 'hi-and-up': case 'hi-and-down': {
      // A pedal note (lowest or highest) alternating with the others, pedal first.
      const low = order.startsWith('low'), pedal = low ? notes[0] : notes[n - 1];
      const others = low ? notes.slice(1) : notes.slice(0, -1);
      if (order.endsWith('down')) others.reverse();
      return others.flatMap(note => [pedal, note]);
    }
    // Walk and Euclidean step through the Up order; arpIndex picks the step.
    default: return notes;
  }
}

/** Euclidean rhythm settings: Hits spread as evenly as possible over Steps, turned by Rotate. */
export interface ArpEuclid { hits: number; steps: number; rotate: number }
export const EUCLID_MAX_STEPS = 16;
export const DEFAULT_EUCLID: ArpEuclid = { hits: 5, steps: 8, rotate: 0 };
/** Clamp to the natural ranges: Steps 1–16, Hits 0–Steps (0 = silent), Rotate 0–Steps-1. */
export function euclidOf(raw?: Partial<{ arpHits: number; arpSteps: number; arpRotate: number }> | null): ArpEuclid {
  const int = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : d);
  const steps = Math.max(1, Math.min(EUCLID_MAX_STEPS, int(raw?.arpSteps, DEFAULT_EUCLID.steps)));
  return { steps, hits: Math.max(0, Math.min(steps, int(raw?.arpHits, DEFAULT_EUCLID.hits))),
    rotate: ((int(raw?.arpRotate, 0) % steps) + steps) % steps };
}
/** Step `step` of the cycle is a hit. Even spread: step j hits when (j·hits) mod steps < hits (5/8 = x.x.xx.x). */
export function euclidHit(e: ArpEuclid, step: number) {
  const j = ((Math.floor(step) + e.rotate) % e.steps + e.steps) % e.steps;
  return (j * e.hits) % e.steps < e.hits;
}
/** One cycle as text, x = note, . = rest. */
export const euclidPattern = (e: ArpEuclid) => Array.from({ length: e.steps }, (_, i) => euclidHit(e, i) ? 'x' : '.').join('');
function hitsBefore(e: ArpEuclid, step: number) {
  let count = Math.floor(step / e.steps) * e.hits;
  for (let i = step - (step % e.steps); i < step; i++) if (euclidHit(e, i)) count++;
  return count;
}

/** Walk: a fixed-seed coin per step, so the same step always walks the same way (snapshots and locked sequences repeat). */
const WALK_SEED = 0x5eed2026;
function walkCoin(step: number) {
  let h = (Math.imul(step ^ WALK_SEED, 0x9e3779b1) ^ 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d); h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 2 ** 32;
}
const walkMemo = new Map<number, { step: number; pos: number }>();
/** Position after `step` walk moves from 0: next 50%, repeat 25%, back 25%, wrapping round the pool. */
export function walkIndex(n: number, step: number) {
  if (n < 2) return 0;
  const target = Math.max(0, Math.floor(step));
  let memo = walkMemo.get(n);
  if (!memo || memo.step > target) memo = { step: 0, pos: 0 };
  let { step: k, pos } = memo;
  for (; k < target; k++) { const r = walkCoin(k + 1); pos = (pos + (r < .5 ? 1 : r < .75 ? 0 : n - 1)) % n; }
  walkMemo.set(n, { step: k, pos });
  return pos;
}

/**
 * Which entry of an arpeggioSequence plays at `step`; null is a rest (Euclidean off-steps).
 * Random picks anything each step, Walk takes a seeded random walk, Euclidean advances Up on hits.
 */
export function arpIndex(order: ArpOrder, n: number, step: number, euclid: ArpEuclid = DEFAULT_EUCLID, random = Math.random): number | null {
  if (n < 1) return null;
  const wrap = (i: number) => ((Math.floor(i) % n) + n) % n;
  if (order === 'random') return Math.min(n - 1, Math.max(0, Math.floor(random() * n)));
  if (order === 'walk') return walkIndex(n, step);
  if (order === 'euclidean') {
    const e = euclidOf({ arpHits: euclid.hits, arpSteps: euclid.steps, arpRotate: euclid.rotate });
    const k = Math.max(0, Math.floor(step));
    return euclidHit(e, k) ? wrap(hitsBefore(e, k)) : null;
  }
  return wrap(step);
}

/**
 * Every arp pattern NetComposer knows, by stable ID. IDs are lowercase kebab-case and
 * never renamed once shipped (NC presets, Create's @synth and the network protocol use them).
 * Each also has a permanent number (`num`, off = 0) so NC can say Arp(5).
 * Names and descriptions for the Bitwig-style patterns follow Bitwig's.
 */
/** `num` is permanent too (NC's Arp(5)): never renumbered or reused; a new pattern takes the next free number. */
export interface ArpPatternInfo { id: ArpOrder; num: number; name: string; description: string; legacy?: boolean }
export const ARP_PATTERNS: readonly ArpPatternInfo[] = [
  { id: 'off', num: 0, name: 'Off — chord', description: 'No arp: the chord plays together' },
  { id: 'up', num: 1, name: 'Up', description: 'Low to high, then again' },
  { id: 'down', num: 2, name: 'Down', description: 'High to low, then again' },
  { id: 'up-down', num: 3, name: 'Up/Down', description: 'Up then down, ends not repeated' },
  { id: 'up-down-repeat', num: 4, name: 'Up/Down Repeat', description: 'Up then down, ends repeated' },
  { id: 'random', num: 5, name: 'Random', description: 'Any note each step' },
  { id: 'as-played', num: 6, name: 'As Played', description: 'The order the keys were pressed' },
  { id: 'outside-in', num: 7, name: 'Outside-In', description: 'Lowest, highest, then inward' },
  { id: 'inside-out', num: 8, name: 'Inside-Out', description: 'From the middle outward, lower first' },
  { id: 'pendulum', num: 9, name: 'Pendulum', description: 'From the lower middle, swing between the ends' },
  { id: 'blossom-up', num: 10, name: 'Blossom Up', description: 'From center, spiral up' },
  { id: 'blossom-down', num: 11, name: 'Blossom Down', description: 'From center, spiral down' },
  { id: 'low-and-up', num: 12, name: 'Low&Up', description: 'Low pedal, others ascending' },
  { id: 'low-and-down', num: 13, name: 'Low&Down', description: 'Low pedal, others descending' },
  { id: 'hi-and-up', num: 14, name: 'Hi&Up', description: 'High pedal, others ascending' },
  { id: 'hi-and-down', num: 15, name: 'Hi&Down', description: 'High pedal, others descending' },
  { id: 'walk', num: 16, name: 'Walk', description: 'Next 50%, repeat 25%, back 25%' },
  { id: 'euclidean', num: 17, name: 'Euclidean', description: 'Hits spread evenly over Steps, rests between' },
  { id: 'down-up', num: 18, name: 'Down/Up (legacy)', description: 'Down then up, ends not repeated', legacy: true },
];
/** Other spellings that resolve to an ID (names, Thumb/Pinky, older or looser forms). */
export const ARP_ALIASES: Readonly<Record<string, ArpOrder>> = {
  'none': 'off', 'chord': 'off', 'updown': 'up-down', 'up-and-down': 'up-down', 'downup': 'down-up',
  'down-and-up': 'down-up', 'down-up-legacy': 'down-up', 'off-chord': 'off', 'rand': 'random',
  'played': 'as-played', 'order': 'as-played', 'converge': 'outside-in', 'diverge': 'inside-out',
  'thumb-up': 'low-and-up', 'thumb-down': 'low-and-down', 'pinky-up': 'hi-and-up', 'pinky-down': 'hi-and-down',
  'high-and-up': 'hi-and-up', 'high-and-down': 'hi-and-down', 'euclid': 'euclidean', 'drunk': 'walk',
};
const ARP_IDS = new Set<string>(ARP_PATTERNS.map(p => p.id));
const ARP_BY_NUM = new Map<number, ArpOrder>(ARP_PATTERNS.map(p => [p.num, p.id]));
/** A pattern's permanent number (Arp(5) in NC). */
export const arpNum = (id: ArpOrder) => ARP_PATTERNS.find(p => p.id === id)?.num ?? 0;
/** An ID, number (5 or "5"), display name or alias (any case, spaces, _ or &) to its ID; null when unknown. */
export function resolveArpId(raw: unknown): ArpOrder | null {
  if (typeof raw === 'number') return Number.isInteger(raw) ? ARP_BY_NUM.get(raw) ?? null : null;
  if (typeof raw !== 'string') return null;
  if (/^\s*\d+\s*$/.test(raw)) return ARP_BY_NUM.get(Number(raw)) ?? null;
  if (ARP_IDS.has(raw)) return raw as ArpOrder;
  const key = raw.trim().toLowerCase().replace(/\(legacy\)/g, '').replace(/&/g, '-and-').replace(/[\s_/]+/g, '-')
    .replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (ARP_IDS.has(key)) return key as ArpOrder;
  if (ARP_ALIASES[key]) return ARP_ALIASES[key];
  const byName = ARP_PATTERNS.find(p => p.name.toLowerCase().replace(/\s*\(legacy\)/, '') === raw.trim().toLowerCase());
  return byName?.id ?? null;
}
export const ARP_ORDERS: {value: ArpOrder; label: string}[] = ARP_PATTERNS.map(p => ({ value: p.id, label: p.name }));
