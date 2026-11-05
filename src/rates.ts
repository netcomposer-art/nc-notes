/**
 * Note Generator and arp rates (Peter, 2026-10-31: "more interesting intervals — dotted, 6/8").
 *
 * `interval` stays what it always was: steps per whole note, so one step is 4 / interval beats. Straight rates are
 * the old integers (1/4 = 4). A dotted note is 1.5× as long (1/8 dotted = 16/3 ≈ 5.33); a triplet fits three in the
 * time of two (1/8 triplet = 12). 6/8 is a metre rather than a rate: its pulse is the 1/8 triplet, three per beat,
 * and its dotted-quarter beat is 1/4 dotted, so both are here under those names.
 *
 * Dotted values are not integers, so stored values are matched to this table with a small tolerance and snapped to
 * the canonical number (a value that went through JSON or a text field still lands on its rate).
 */
export type RateKind = 'straight' | 'dotted' | 'triplet';
export interface Rate { value: number; label: string; short: string; kind: RateKind }

const straight = (d: number): Rate => ({ value: d, label: `1/${d}`, short: `1/${d}`, kind: 'straight' });
const dotted = (d: number): Rate => ({ value: (d * 2) / 3, label: `1/${d} dotted`, short: `1/${d}.`, kind: 'dotted' });
const triplet = (d: number): Rate => ({ value: (d * 3) / 2, label: `1/${d} triplet`, short: `1/${d}T`, kind: 'triplet' });

/** Every rate, slowest first (a dotted 1/4 is slower than a 1/2 triplet, so the kinds interleave). */
export const RATES: readonly Rate[] = [
  straight(1),
  dotted(2), straight(2), triplet(2),
  dotted(4), straight(4), triplet(4),
  dotted(8), straight(8), triplet(8),
  dotted(16), straight(16), triplet(16),
  straight(32), triplet(32),
].sort((a, b) => a.value - b.value);

/** The original six, for callers that only handle straight rates. */
export const STRAIGHT_RATES = RATES.filter(r => r.kind === 'straight').map(r => r.value);

/** The canonical rate for a stored interval, or null when it is not one of ours. */
export function findRate(interval: unknown): Rate | null {
  if (typeof interval !== 'number' || !Number.isFinite(interval)) return null;
  return RATES.find(r => Math.abs(r.value - interval) < 1e-6) ?? null;
}

/** A stored interval snapped to its canonical value, or `fallback` when it is not a supported rate. */
export const normalizeInterval = (interval: unknown, fallback = 4): number => findRate(interval)?.value ?? fallback;

/** "1/8", "1/8." (dotted) or "1/8T" (triplet), for compact readouts. */
export const rateShort = (interval: number): string => findRate(interval)?.short ?? `1/${Math.round(interval)}`;
