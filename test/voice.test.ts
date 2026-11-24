// The voice pass (0.13.0): `voice` both ways between LUCY and LUPA, as a played event and as a control.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_TAKE_BEATS, MAX_TAKE_PEAKS, MAX_VOICE_PASS, VOICE_STATES, type ControlEvent, type VoiceEvent, controlEventError,
  controlsMessage, notesMessageError, parseNotesMessage, playedEventError, playedMessage, playedSound,
} from '../src/index.js';

const armed: VoiceEvent = { type: 'voice', id: 'vp|1', beat: 36, state: 'armed', lengthBeats: 16, pass: 3 };

test('armed: a control from LUPA, checked and copied (unknown fields dropped)', () => {
  const m = controlsMessage('looper', [armed]);
  assert.equal(notesMessageError(m), null);
  const parsed = parseNotesMessage({ ...m, events: [{ ...armed, extra: 1 }] }) as { events: ControlEvent[] };
  assert.deepEqual(parsed.events, [armed]);
  assert.notEqual(parsed.events[0], armed);
});

test('ask, cancel, quiet: played from LUCY with no more than a beat', () => {
  for (const state of ['ask', 'cancel', 'quiet'] as const) {
    const e: VoiceEvent = { type: 'voice', id: `vp|${state}`, beat: 0, state };
    assert.equal(playedEventError(e), null, state);
    const parsed = parseNotesMessage(playedMessage('lucy', [e])) as { events: VoiceEvent[] };
    assert.deepEqual(parsed.events, [e]);
  }
});

test('recording carries peaks across the loop (a fresh copy); added, undo and undone carry the take', () => {
  const rec: VoiceEvent = { type: 'voice', id: 'vp|r', beat: 36, state: 'recording', peaks: [0, 0.5, 1] };
  const parsed = parseNotesMessage(playedMessage('lucy', [rec])) as { events: VoiceEvent[] };
  assert.deepEqual(parsed.events[0]?.peaks, [0, 0.5, 1]);
  assert.notEqual(parsed.events[0]?.peaks, rec.peaks);
  for (const state of ['added', 'undo', 'undone'] as const)
    assert.equal(controlEventError({ type: 'voice', id: 'vp|t', beat: 36, state, take: 'v4', pass: 3 }), null, state);
});

test('what is refused', () => {
  assert.equal(VOICE_STATES.length, 8);
  assert.match(controlEventError({ ...armed, state: 'maybe' }) ?? '', /voice state/);
  assert.match(controlEventError({ ...armed, lengthBeats: undefined }) ?? '', /needs lengthBeats/);
  assert.match(controlEventError({ ...armed, lengthBeats: 0 }) ?? '', /lengthBeats/);
  assert.match(controlEventError({ ...armed, lengthBeats: MAX_TAKE_BEATS + 1 }) ?? '', /lengthBeats/);
  assert.match(controlEventError({ ...armed, pass: 0 }) ?? '', /pass/);
  assert.match(controlEventError({ ...armed, pass: MAX_VOICE_PASS + 1 }) ?? '', /pass/);
  assert.match(controlEventError({ ...armed, pass: 1.5 }) ?? '', /pass/);
  assert.match(controlEventError({ type: 'voice', id: 'u', beat: 0, state: 'undo' }) ?? '', /take/);
  assert.match(controlEventError({ type: 'voice', id: 'u', beat: 0, state: 'added', take: '' }) ?? '', /bad take/);
  assert.match(
    playedEventError({ type: 'voice', id: 'r', beat: 0, state: 'recording', peaks: Array(MAX_TAKE_PEAKS + 1).fill(0) }) ?? '',
    /peaks/,
  );
  assert.match(playedEventError({ type: 'voice', id: 'r', beat: 0, state: 'recording', peaks: [2] }) ?? '', /peaks/);
  assert.match(controlEventError({ ...armed, beat: Number.NaN }) ?? '', /bad beat/);
});

test('a voice event is no sound (LUPA\'s Wait never starts from it)', () => {
  assert.equal(playedSound([{ type: 'voice', id: 'vp|1', beat: 4, state: 'ask' }]), null);
});
