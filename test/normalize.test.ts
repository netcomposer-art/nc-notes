// LUPA's Normalize (0.14.0, Peter 2026-11-26): a take control may ask for the take at its Normalize level; a played take
// says the Normalize gain the recorder measured.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_TAKE_NORMALIZE_DB, MIN_TAKE_NORMALIZE_DB, controlEventError, controlsMessage, parseNotesMessage, playedEventError,
  playedMessage, type TakeEvent,
} from '../src/index.js';

const kept: TakeEvent = { type: 'take', id: 'lap|3', beat: 36, take: 'lupa-12', lengthBeats: 32, normalizeDb: 9.4 };
const play: TakeEvent = { type: 'take', id: 'r|7', beat: 68, take: 'lupa-12', lengthBeats: 32, gain: 0.708, normalize: true };

test('normalize and normalizeDb round-trip, and stay absent when absent', () => {
  for (const m of [playedMessage('lucy', [kept]), controlsMessage('looper', [play])]) {
    const parsed = parseNotesMessage(m) as { events: TakeEvent[] } | null;
    assert.ok(parsed);
    assert.deepEqual(parsed.events, (m as { events: TakeEvent[] }).events);
  }
  const bare = parseNotesMessage(controlsMessage('looper', [{ ...play, normalize: undefined } as TakeEvent])) as { events: TakeEvent[] };
  assert.equal('normalize' in (bare.events[0] as object), false);
  assert.equal('normalizeDb' in (bare.events[0] as object), false);
  const off = parseNotesMessage(controlsMessage('looper', [{ ...play, normalize: false }])) as { events: TakeEvent[] };
  assert.equal(off.events[0]?.normalize, false);
});

test('normalize must be a boolean, normalizeDb in range', () => {
  const bad: [Record<string, unknown>, RegExp][] = [
    [{ normalize: 1 }, /normalize must be true or false/],
    [{ normalize: 'yes' }, /normalize must be true or false/],
    [{ normalizeDb: MAX_TAKE_NORMALIZE_DB + 0.1 }, /normalizeDb/],
    [{ normalizeDb: MIN_TAKE_NORMALIZE_DB - 0.1 }, /normalizeDb/],
    [{ normalizeDb: Number.NaN }, /normalizeDb/],
  ];
  for (const [patch, re] of bad) {
    assert.match(controlEventError({ ...play, ...patch }) ?? '', re, JSON.stringify(patch));
    assert.match(playedEventError({ ...kept, ...patch }) ?? '', re, JSON.stringify(patch));
  }
  assert.equal(controlEventError({ ...play, normalizeDb: MAX_TAKE_NORMALIZE_DB }), null);
  assert.equal(playedEventError({ ...kept, normalizeDb: MIN_TAKE_NORMALIZE_DB }), null);
});
