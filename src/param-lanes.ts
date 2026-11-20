/**
 * Param lanes (0.11.0, LUPA's knob passes): an instrument's side of `param` controls. A source (LUPA) sends the points
 * of a knob's curve ahead, in beats; the instrument asks, as it plays, what each knob's value is at a beat
 * (`values(beat)`) and sets it. Pure: beats only, no clock.
 *
 *  - Idempotent by source and id, like notes: a resend is a no-op.
 *  - A point with `glide` is reached in a straight line from the point before, over its last `glide` beats; without,
 *    the value steps at its beat (the instrument smooths a step, as it does a hand move).
 *  - `off(source, atBeat)` drops that source's points from `atBeat` (all without): a change heard from a beat, or Stop.
 *  - Your hand wins: `hand(param)` drops every point waiting for that knob, from every source, and forgets where the
 *    lane was, so nothing glides from a value the hand has left. The source stops sending it (LUPA: until the lap ends)
 *    and what it sends after is taken as usual.
 *  - `values(beat)` returns only the knobs whose value changed since it last said, so the instrument does nothing when
 *    nothing moves.
 */
import type { ParamEvent } from './contract.js';

/** The most points one lane may hold waiting (more are dropped and counted). */
export const MAX_LANE_POINTS = 4096;

interface Point {
  source: string;
  id: string;
  beat: number;
  value: number;
  glide?: number;
}

interface Lane {
  /** Waiting points, in beat order. */
  points: Point[];
  /** The last point passed (the value now and where a glide starts), or null after a hand move. */
  at: { beat: number; value: number } | null;
  /** The value `values()` last returned for this lane. */
  said: number | null;
}

export class ParamLanes {
  private lanes = new Map<string, Lane>();
  /** Every id taken, `${source}\0${id}`, with its beat, so a resend is a no-op. */
  private seen = new Map<string, number>();
  readonly stats = { accepted: 0, duplicates: 0, dropped: 0, held: 0 };

  /** How many points wait, over every lane. */
  get size(): number {
    let n = 0;
    for (const l of this.lanes.values()) n += l.points.length;
    return n;
  }
  /** The params that have points waiting or a value set. */
  get params(): string[] {
    return [...this.lanes.keys()];
  }

  /** Add `source`'s param points (already checked). Ids already taken are ignored. Returns the ones added. */
  add(source: string, events: readonly ParamEvent[]): ParamEvent[] {
    const added: ParamEvent[] = [];
    const touched = new Set<Lane>();
    for (const e of events) {
      const key = `${source}\u0000${e.id}`;
      if (this.seen.has(key)) { this.stats.duplicates++; continue; }
      this.seen.set(key, e.beat);
      const lane = this.lane(e.param);
      if (lane.points.length >= MAX_LANE_POINTS) { this.stats.dropped++; continue; }
      lane.points.push({ source, id: e.id, beat: e.beat, value: e.value, ...(e.glide === undefined ? {} : { glide: e.glide }) });
      touched.add(lane);
      added.push(e);
    }
    for (const lane of touched) lane.points = sortByBeat(lane.points);
    this.stats.accepted += added.length;
    return added;
  }

  /**
   * Drop `source`'s waiting points from `atBeat` on (all without). Their ids are forgotten (they never played), so
   * the same points sent again are taken. Returns how many went.
   */
  off(source: string, atBeat?: number): number {
    let n = 0;
    for (const lane of this.lanes.values())
      lane.points = lane.points.filter(p => {
        if (p.source !== source || (atBeat !== undefined && p.beat < atBeat - 1e-9)) return true;
        this.seen.delete(`${p.source}\u0000${p.id}`);
        n++;
        return false;
      });
    return n;
  }

  /**
   * The player moved `param` by hand: every point waiting for it goes (from every source) and the lane forgets its
   * value. Returns how many points went.
   */
  hand(param: string): number {
    const lane = this.lanes.get(param);
    if (!lane) return 0;
    const n = lane.points.length;
    lane.points = [];
    lane.at = null;
    lane.said = null;
    this.stats.held += n;
    return n;
  }

  /**
   * Each knob's value at `beat` that changed since the last call: points at or before `beat` are passed (the last one
   * is the value), and a glide toward the next point is part-way along. Ids long past (16 beats) are forgotten.
   */
  values(beat: number): { param: string; value: number }[] {
    const out: { param: string; value: number }[] = [];
    for (const [param, lane] of this.lanes) {
      let n = 0;
      while (n < lane.points.length && (lane.points[n] as Point).beat <= beat + 1e-9) n++;
      if (n) {
        const last = lane.points[n - 1] as Point;
        lane.at = { beat: last.beat, value: last.value };
        lane.points.splice(0, n);
      }
      let value = lane.at?.value;
      const next = lane.points[0];
      if (lane.at && next?.glide !== undefined) {
        const start = Math.max(lane.at.beat, next.beat - next.glide);
        if (beat > start && next.beat > start) {
          const f = Math.min(1, (beat - start) / (next.beat - start));
          value = lane.at.value + (next.value - lane.at.value) * f;
        }
      }
      if (value === undefined) continue;
      if (lane.said !== null && Math.abs(lane.said - value) < 1e-6) continue;
      lane.said = value;
      out.push({ param, value });
    }
    for (const [key, b] of this.seen) if (b < beat - 16) this.seen.delete(key);
    return out;
  }

  /** Forget everything: points, values, ids. */
  clear(): void {
    this.lanes.clear();
    this.seen.clear();
  }

  private lane(param: string): Lane {
    let lane = this.lanes.get(param);
    if (!lane) {
      lane = { points: [], at: null, said: null };
      this.lanes.set(param, lane);
    }
    return lane;
  }
}

function sortByBeat(points: Point[]): Point[] {
  return points.map((p, i) => ({ p, i })).sort((a, b) => a.p.beat - b.p.beat || a.i - b.i).map(x => x.p);
}
