// One pass per pattern (0.15.0): a pattern note may name the pattern as written (`form`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PATTERN_FORM, parseNotesMessage, playedEventError, playedMessage, type PlayedEvent } from '../src/index.js';

const on = (patch: Record<string, unknown> = {}) => ({ type: 'note', id: 'q|1', beat: 8, on: true, note: 36, velocity: 0.8, ...patch });
const off = (patch: Record<string, unknown> = {}) => ({ type: 'note', id: 'q|1', beat: 8.25, on: false, note: 36, ...patch });

test('a pattern note with a form round-trips (on and off)', () => {
  const events = [on({ pattern: true, form: 'p1a2b3c' }), off({ pattern: true, form: 'p1a2b3c' })] as PlayedEvent[];
  const parsed = parseNotesMessage(playedMessage('petra-rhythm', events));
  assert.ok(parsed && parsed.kind === 'played');
  assert.deepEqual(parsed.events, events);
});

test('form is 1–MAX_PATTERN_FORM characters, and only on a pattern note', () => {
  assert.equal(MAX_PATTERN_FORM, 64);
  assert.equal(playedEventError(on({ pattern: true, form: 'x'.repeat(64) })), null);
  assert.match(String(playedEventError(on({ pattern: true, form: 'x'.repeat(65) }))), /form/);
  assert.match(String(playedEventError(on({ pattern: true, form: '' }))), /form/);
  assert.match(String(playedEventError(on({ pattern: true, form: 7 }))), /form/);
  assert.match(String(playedEventError(on({ form: 'abc' }))), /form/);
});

test('a note without form parses as before (no form field appears)', () => {
  const parsed = parseNotesMessage(playedMessage('petra-rhythm', [on({ pattern: true })] as PlayedEvent[]));
  assert.ok(parsed && parsed.kind === 'played');
  assert.equal('form' in parsed.events[0]!, false);
});
