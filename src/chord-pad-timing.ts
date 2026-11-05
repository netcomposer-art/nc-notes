/**
 * When a chord pad's chord reaches the Note Generator (components/chord-pads.tsx). While the transport plays, a pad
 * click takes effect on the next beat: the engine queues notes `ahead` seconds early, so the settings go in just
 * before that beat's notes are queued, through the usual settings path (engine.update). Stopped: at once.
 */
export type BeatClock = { beatAt(time: number): number; timeAt(beat: number): number };

/** Time the settings need to reach the engine (a React commit plus one 20 ms scheduler tick), in seconds. */
export const PAD_MARGIN = 0.05;

/**
 * The next beat a pad can still change (a whole beat whose notes are not queued yet, with the margin), its audio
 * time, and the audio time to hand the settings over.
 */
export function nextBeatChange(clock: BeatClock, now: number, ahead: number, margin = PAD_MARGIN) {
  const beat = Math.ceil(clock.beatAt(now + ahead + margin) - 1e-9);
  const beatTime = clock.timeAt(beat);
  return { beat, beatTime, applyAt: Math.max(now, beatTime - ahead - margin) };
}

type EngineLike = {
  getStatus(): { playing: boolean };
  audioContext: { currentTime: number } | null;
  clock: { transport: BeatClock };
  getTimingStats(): { lookaheadMs: number };
};

/** Milliseconds from now until a pad's change should be applied: 0 when stopped (or not measurable). */
export function padChangeDelay(engine: EngineLike | null | undefined): { ms: number; beat: number | null } {
  try {
    if (!engine || !engine.getStatus().playing || !engine.audioContext) return { ms: 0, beat: null };
    const now = engine.audioContext.currentTime;
    const { beat, applyAt } = nextBeatChange(engine.clock.transport, now, engine.getTimingStats().lookaheadMs / 1000);
    return { ms: Math.max(0, (applyAt - now) * 1000), beat };
  } catch { return { ms: 0, beat: null }; }
}
