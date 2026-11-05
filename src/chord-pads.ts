import { CHORD_LIBRARY, getChord, resolveChordId } from './chords.js';

/**
 * Chord pads (Peter, 2026-11-04): sixteen pads in the Note Generator's Chord section that play the favorite chords.
 * A pad holds a chord id (from CHORD_LIBRARY), its root (pitch class 0–11, used in Pad root mode) and its inversion.
 * Empty slots are null. The pads travel with the settings (state, presets, configuration files, Studio Scenes);
 * slots (snapshots) leave them alone, like the rest of the Note Generator.
 */
export interface ChordPad { chord: string; root: number; inversion: number }
export type ChordPads = (ChordPad | null)[];
/** 'pad': each pad plays its own root. 'follow': pads hold only the chord type and play on the Note Generator's Note. */
export type ChordPadMode = 'pad' | 'follow';
export const CHORD_PAD_COUNT = 16;
export const CHORD_PAD_MODES: readonly ChordPadMode[] = ['pad', 'follow'];

const known = (id: unknown): id is string => typeof id === 'string' && CHORD_LIBRARY.some(c => c.id === resolveChordId(id))
  && (resolveChordId(id) !== 'major' || id === 'major' || id === 'Major');
const pc = (n: unknown, fallback: number) => (typeof n === 'number' && Number.isFinite(n) ? ((Math.round(n) % 12) + 12) % 12 : fallback);
const inv = (n: unknown, chord: string) => {
  const max = getChord(chord).intervals.length - 1;
  return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(max, Math.round(n))) : 0;
};

export const emptyPads = (): ChordPads => Array.from({ length: CHORD_PAD_COUNT }, () => null);

/** The first sixteen favorites, in favorite order, on `root`; the rest empty. Old saves load like this. */
export function padsFromFavorites(favorites: readonly string[], root: number): ChordPads {
  const pads = emptyPads();
  favorites.filter(known).slice(0, CHORD_PAD_COUNT).forEach((id, i) => { pads[i] = { chord: resolveChordId(id), root: pc(root, 0), inversion: 0 }; });
  return pads;
}

/** A stored pad list made safe: always sixteen slots; unknown chords become empty; roots and inversions in range. */
export function sanitizePads(raw: unknown, root = 0): ChordPads {
  const pads = emptyPads();
  if (!Array.isArray(raw)) return pads;
  raw.slice(0, CHORD_PAD_COUNT).forEach((p, i) => {
    if (!p || typeof p !== 'object') return;
    const r = p as Partial<ChordPad>;
    if (!known(r.chord)) return;
    const chord = resolveChordId(r.chord);
    pads[i] = { chord, root: pc(r.root, pc(root, 0)), inversion: inv(r.inversion, chord) };
  });
  return pads;
}

/** Move pad `from` to slot `to`; the pads in between shift by one (a list reorder, as a drag drops it). */
export function movePad(pads: ChordPads, from: number, to: number): ChordPads {
  const n = pads.length;
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return pads;
  const next = [...pads];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Starring a chord: it fills the first empty pad, unless a pad already holds it or none is empty. */
export function padsAfterStar(pads: ChordPads, chord: string, root: number): ChordPads {
  if (pads.some(p => p?.chord === chord)) return pads;
  const i = pads.indexOf(null);
  if (i < 0) return pads;
  const next = [...pads];
  next[i] = { chord, root: pc(root, 0), inversion: 0 };
  return next;
}

/** Set (or clear, with null) one pad. */
export function setPad(pads: ChordPads, index: number, pad: ChordPad | null): ChordPads {
  if (index < 0 || index >= pads.length) return pads;
  const next = [...pads];
  next[index] = pad && known(pad.chord) ? { chord: resolveChordId(pad.chord), root: pc(pad.root, 0), inversion: inv(pad.inversion, pad.chord) } : null;
  return next;
}

/**
 * What a pad click sets on the Note Generator: the chord and inversion, and in Pad root mode the root (Note).
 * A progression playing gives way to the pad (it would override the chord), so the pad turns it off.
 */
export function padPatch(pad: ChordPad, mode: ChordPadMode, progression: string): { chord: string; inversion: number; note?: number; chordProgression?: string } {
  return {
    chord: pad.chord, inversion: inv(pad.inversion, pad.chord),
    ...(mode === 'pad' ? { note: pad.root } : {}),
    ...(progression && progression !== 'off' ? { chordProgression: 'off' } : {}),
  };
}

/** Does the Note Generator play this pad right now (chord, inversion, and the root in Pad root mode)? */
export function padMatches(pad: ChordPad | null, mode: ChordPadMode, s: { chord: string; note: number; inversion: number; chordProgression: string }): boolean {
  if (!pad || (s.chordProgression && s.chordProgression !== 'off')) return false;
  return pad.chord === s.chord && inv(pad.inversion, pad.chord) === inv(s.inversion, s.chord) && (mode === 'follow' || pad.root === s.note);
}

const ORDINAL = ['st', 'nd', 'rd'];
/** A pad's name: "Dm9" in Pad root mode, "m9" in Follow root mode (a plain major is "maj" there). */
export function padName(pad: ChordPad, mode: ChordPadMode, noteNames: readonly string[]): string {
  const c = getChord(pad.chord);
  return mode === 'pad' ? `${noteNames[pad.root]}${c.symbol}` : c.symbol.trim() || 'maj';
}
/** Its inversion, when it has one: "1st inv". */
export const padInversion = (pad: ChordPad) => (pad.inversion > 0 ? `${pad.inversion}${ORDINAL[pad.inversion - 1] ?? 'th'} inv` : '');
