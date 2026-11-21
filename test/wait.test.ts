// LUPA's Wait (0.12.0): pattern notes, notes played while the clock is stopped, and `sound` events in `played`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PATTERN_AHEAD_BEATS, controlsMessage, notesMessageError, parseNotesMessage, playedEventError, playedMessage, playedSound,
  type PlayedEvent,
} from '../src/index.js';

const on = (patch: Record<string, unknown> = {}) => ({ type: 'note', id: 'q|1', beat: 8, on: true, note: 36, velocity: 0.8, ...patch });
const off = (patch: Record<string, unknown> = {}) => ({ type: 'note', id: 'q|1', beat: 8.25, on: false, note: 36, ...patch });

test('a pattern note: on and off carry pattern, and it round-trips', () => {
  const events = [on({ pattern: true }), off({ pattern: true })] as PlayedEvent[];
  const m = playedMessage('petra-rhythm', events);
  assert.equal(notesMessageError(m), null);
  const parsed = parseNotesMessage(m);
  assert.ok(parsed && parsed.kind === 'played');
  assert.deepEqual(parsed.events, events);
  assert.equal(PATTERN_AHEAD_BEATS, 2);
});

test('a note played while stopped carries stopped, and it round-trips', () => {
  const events = [on({ stopped: true }), off({ stopped: true })] as PlayedEvent[];
  const parsed = parseNotesMessage(playedMessage('astrid-synth', events));
  assert.ok(parsed && parsed.kind === 'played');
  assert.deepEqual(parsed.events, events);
});

test('pattern and stopped are true or absent; a pattern note is never stopped', () => {
  assert.match(String(playedEventError(on({ pattern: false }))), /pattern/);
  assert.match(String(playedEventError(on({ pattern: 1 }))), /pattern/);
  assert.match(String(playedEventError(off({ stopped: 'yes' }))), /stopped/);
  assert.match(String(playedEventError(on({ pattern: true, stopped: true }))), /running clock/);
  assert.equal(playedEventError(on()), null, 'a plain hand note as before');
});

test('a sound event: id, beat, optional stopped; played only', () => {
  const sound = { type: 'sound', id: 'mic|1', beat: 3.2 };
  assert.equal(playedEventError(sound), null);
  assert.equal(playedEventError({ ...sound, stopped: true }), null);
  assert.match(String(playedEventError({ ...sound, id: '' })), /id/);
  assert.match(String(playedEventError({ ...sound, beat: Infinity })), /beat/);
  assert.match(String(playedEventError({ ...sound, stopped: false })), /stopped/);
  const parsed = parseNotesMessage({ ...playedMessage('lucy', [{ ...sound, extra: 1 } as PlayedEvent]) });
  assert.ok(parsed && parsed.kind === 'played');
  assert.deepEqual(parsed.events, [sound], 'unknown fields dropped');
  assert.match(String(notesMessageError(controlsMessage('looper', [sound as never]))), /bad type/, 'never a control');
});

test('playedSound: the earliest note-on or sound; offs, knobs, slots, takes are not a sound', () => {
  assert.equal(playedSound([]), null);
  assert.equal(playedSound([off() as PlayedEvent]), null);
  assert.equal(playedSound([{ type: 'param', id: 'k', beat: 1, param: 'cutoff', value: 0.5 }, { type: 'slot', id: 's', beat: 1, slot: 2 },
    { type: 'take', id: 't', beat: 1, take: 'v1', lengthBeats: 4 }, { type: 'chordPad', id: 'c', beat: 1, pad: 3 }]), null);
  assert.deepEqual(playedSound([off() as PlayedEvent, on({ beat: 9, pattern: true }) as PlayedEvent, on({ id: 'q|2', beat: 8.5 }) as PlayedEvent]),
    { beat: 8.5, stopped: false, pattern: false });
  assert.deepEqual(playedSound([{ type: 'sound', id: 'm', beat: 2, stopped: true }]), { beat: 2, stopped: true, pattern: false });
  assert.deepEqual(playedSound([on({ pattern: true }) as PlayedEvent]), { beat: 8, stopped: false, pattern: true });
});
