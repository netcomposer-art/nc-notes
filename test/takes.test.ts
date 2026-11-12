// LUPA's voice laps (0.7.0): a `take` event, played by LUCY (a lap kept) and sent back as a control (play it at a beat).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_TAKE_BEATS, MAX_TAKE_GAIN, MAX_TAKE_PEAKS, NotesInbox, controlEventError, controlsMessage, notesMessageError,
  parseNotesMessage, playedEventError, playedMessage, type ControlEvent, type LapEvent, type TakeEvent,
} from '../src/index.js';

const kept: TakeEvent = { type: 'take', id: 'lap|3', beat: 36, take: 'lupa-12', lengthBeats: 32 };
const play: TakeEvent = { type: 'take', id: 'r|7', beat: 68, take: 'lupa-12', lengthBeats: 32, gain: 0.708, offsetBeats: 0 };

test('take: played and as a control, round-trips as fresh copies, unknown fields dropped', () => {
  for (const m of [playedMessage('lucy', [kept]), controlsMessage('looper', [play])]) {
    assert.equal(notesMessageError(m), null);
    const raw = { ...m, events: (m as { events: object[] }).events.map(e => ({ ...e, extra: 1 })) };
    const parsed = parseNotesMessage(raw);
    assert.ok(parsed);
    const events = (parsed as { events: ControlEvent[] }).events;
    assert.deepEqual(events, (m as { events: ControlEvent[] }).events);
    assert.notEqual(events[0], (m as { events: ControlEvent[] }).events[0]);
    assert.equal('extra' in (events[0] as object), false);
  }
  // Absent gain and offset stay absent.
  const p = parseNotesMessage(controlsMessage('looper', [{ ...play, gain: undefined, offsetBeats: undefined } as TakeEvent]));
  const e = (p as { events: TakeEvent[] }).events[0];
  assert.equal('gain' in (e as object), false);
  assert.equal('offsetBeats' in (e as object), false);
});

test('take: each field checked, one line each', () => {
  const bad: [Partial<TakeEvent> & Record<string, unknown>, RegExp][] = [
    [{ take: '' }, /bad take/],
    [{ take: 'x'.repeat(200) }, /bad take/],
    [{ lengthBeats: 0 }, /lengthBeats/],
    [{ lengthBeats: MAX_TAKE_BEATS + 1 }, /lengthBeats/],
    [{ gain: -0.1 }, /gain/],
    [{ gain: MAX_TAKE_GAIN + 0.01 }, /gain/],
    [{ offsetBeats: -1 }, /offsetBeats/],
    [{ offsetBeats: 32 }, /offsetBeats/],
    [{ beat: Number.NaN }, /bad beat/],
    [{ peaks: [1.01] }, /peaks/],
    [{ peaks: [Number.NaN] }, /peaks/],
    [{ peaks: Array(MAX_TAKE_PEAKS + 1).fill(0) }, /peaks/],
    [{ peaks: 'x' as unknown as number[] }, /peaks/],
  ];
  for (const [patch, re] of bad) assert.match(controlEventError({ ...play, ...patch }) ?? '', re, JSON.stringify(patch));
  assert.equal(controlEventError(play), null);
  assert.equal(playedEventError(kept), null);
  assert.equal(controlEventError({ ...play, gain: MAX_TAKE_GAIN, offsetBeats: 31.99 }), null);
});

test('take controls wait in the inbox until due, once by id; an off drops the waiting ones', () => {
  const inbox = new NotesInbox();
  inbox.addControls('looper', [play, { ...play, id: 'r|8', beat: 100 }]);
  inbox.addControls('looper', [play]);
  assert.equal(inbox.controlsSize, 2);
  assert.deepEqual(inbox.takeControls((b) => b <= 70).map((e) => e.id), ['r|7']);
  inbox.off('looper', 90);
  assert.equal(inbox.controlsSize, 0);
});

test('lap: announced ahead as a control, checked and copied', () => {
  const lap: LapEvent = { type: 'lap', id: 'lap|4', beat: 36, lengthBeats: 32 };
  const m = controlsMessage('looper', [lap]);
  assert.equal(notesMessageError(m), null);
  const parsed = parseNotesMessage({ ...m, events: [{ ...lap, extra: 1 }] });
  assert.deepEqual((parsed as { events: ControlEvent[] }).events, [lap]);
  assert.match(controlEventError({ ...lap, lengthBeats: 0 }) ?? '', /lengthBeats/);
  assert.match(controlEventError({ ...lap, lengthBeats: MAX_TAKE_BEATS + 1 }) ?? '', /lengthBeats/);
  assert.match(controlEventError({ ...lap, beat: 'x' }) ?? '', /bad beat/);
});

test('take peaks (0.9.0): a kept take may carry its loudness for display; kept as a fresh copy', () => {
  const withPeaks: TakeEvent = { ...kept, peaks: [0, 0.25, 1] };
  assert.equal(playedEventError(withPeaks), null);
  const parsed = parseNotesMessage(playedMessage('lucy', [withPeaks])) as { events: TakeEvent[] };
  assert.deepEqual(parsed.events[0]?.peaks, [0, 0.25, 1]);
  assert.notEqual(parsed.events[0]?.peaks, withPeaks.peaks);
  assert.equal(playedEventError({ ...kept, peaks: Array(MAX_TAKE_PEAKS).fill(0.5) }), null);
});
