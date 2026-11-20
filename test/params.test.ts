// 0.11.0: `param` — a knob or slider moved by hand (played), and set at a beat (controls): LUPA's knob passes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_LANE_POINTS, MAX_PARAM_GLIDE_BEATS, MAX_PARAM_ID, MAX_PARAM_LABEL, NotesInbox, ParamLanes, controlEventError,
  controlsMessage, notesMessageError, offMessage, parseNotesMessage, playedEventError, playedMessage,
  type ControlEvent, type ParamEvent, type PlayedEvent,
} from '../src/index.js';

const moved: ParamEvent = { type: 'param', id: 'p|1', beat: 12.5, param: 'cutoff', value: 0.42, label: 'Filter', text: '1.2 kHz', from: 0.3 };
const set: ParamEvent = { type: 'param', id: 'k|9', beat: 20, param: 'cutoff', value: 0.8, glide: 0.25 };
const pt = (id: string, beat: number, value: number, extra: Partial<ParamEvent> = {}): ParamEvent =>
  ({ type: 'param', id, beat, param: 'cutoff', value, ...extra });

test('param: played and as a control, round-trips as fresh copies, unknown fields dropped', () => {
  for (const m of [playedMessage('astrid-synth', [moved]), controlsMessage('looper', [set])]) {
    assert.equal(notesMessageError(m), null);
    const raw = { ...m, events: (m as { events: object[] }).events.map(e => ({ ...e, extra: 1 })) };
    const parsed = parseNotesMessage(raw);
    assert.ok(parsed);
    const events = (parsed as { events: ControlEvent[] }).events;
    assert.deepEqual(events, (m as { events: ControlEvent[] }).events);
    assert.notEqual(events[0], (m as { events: ControlEvent[] }).events[0], 'copied, not kept by reference');
    assert.equal('extra' in (events[0] as object), false);
  }
  // Absent optional fields stay absent.
  const p = parseNotesMessage(playedMessage('astrid-synth', [{ type: 'param', id: 'a', beat: 1, param: 'cutoff', value: 0 }]));
  const e = (p as { events: PlayedEvent[] }).events[0] as ParamEvent;
  for (const k of ['label', 'text', 'from', 'glide']) assert.equal(k in e, false, k);
});

test('param: each field checked, one line each', () => {
  const bad: [Record<string, unknown>, RegExp][] = [
    [{ param: '' }, /param must be/],
    [{ param: 'x'.repeat(MAX_PARAM_ID + 1) }, /param must be/],
    [{ param: 'filter cutoff' }, /param must be/],
    [{ param: 3 }, /param must be/],
    [{ value: -0.01 }, /value must be 0–1/],
    [{ value: 1.01 }, /value must be 0–1/],
    [{ value: Number.NaN }, /value must be 0–1/],
    [{ label: '' }, /label/],
    [{ label: 'x'.repeat(MAX_PARAM_LABEL + 1) }, /label/],
    [{ text: 7 }, /text/],
    [{ from: 2 }, /from/],
    [{ glide: 0 }, /glide/],
    [{ glide: MAX_PARAM_GLIDE_BEATS + 0.1 }, /glide/],
    [{ beat: Number.POSITIVE_INFINITY }, /bad beat/],
    [{ id: '' }, /bad id/],
  ];
  for (const [patch, re] of bad) {
    assert.match(controlEventError({ ...moved, ...patch }) ?? '', re, JSON.stringify(patch));
    assert.match(playedEventError({ ...moved, ...patch }) ?? '', re, JSON.stringify(patch));
  }
  assert.equal(controlEventError({ ...set, param: 'osc2.pulse-width_A' }), null);
  assert.equal(controlEventError({ ...set, glide: MAX_PARAM_GLIDE_BEATS, value: 1 }), null);
  // One bad param event refuses its whole message (a receiver from before 0.11.0 refuses any: 'bad type').
  assert.match(notesMessageError(playedMessage('astrid-synth', [{ ...moved, value: 3 }])) ?? '', /event 0: value/);
});

test('ParamLanes: steps at each point, glides in a straight line, says only what changed', () => {
  const lanes = new ParamLanes();
  lanes.add('looper', [pt('a', 4, 0.2), pt('b', 5, 0.6, { glide: 1 }), pt('c', 8, 1)]);
  assert.deepEqual(lanes.values(3.9), [], 'nothing before the first point');
  assert.deepEqual(lanes.values(4), [{ param: 'cutoff', value: 0.2 }]);
  assert.deepEqual(lanes.values(4), [], 'unchanged: not said again');
  const mid = lanes.values(4.5)[0];
  assert.ok(mid && Math.abs(mid.value - 0.4) < 1e-9, 'half-way along the glide');
  assert.deepEqual(lanes.values(5), [{ param: 'cutoff', value: 0.6 }]);
  assert.deepEqual(lanes.values(7.99), [], 'no glide: holds until the next point');
  assert.deepEqual(lanes.values(8), [{ param: 'cutoff', value: 1 }]);
  assert.equal(lanes.size, 0);
});

test('ParamLanes: a glide starts no earlier than the point before; points out of order are sorted', () => {
  const lanes = new ParamLanes();
  lanes.add('looper', [pt('b', 4.1, 1, { glide: 2 }), pt('a', 4, 0)]);
  lanes.values(4);
  const v = lanes.values(4.05)[0];
  assert.ok(v && Math.abs(v.value - 0.5) < 1e-9, 'glides over 0.1 beat, from the point before');
});

test('ParamLanes: a resend is a no-op; an off drops from a beat and forgets those ids', () => {
  const lanes = new ParamLanes();
  assert.equal(lanes.add('looper', [pt('a', 1, 0.1), pt('b', 2, 0.2)]).length, 2);
  assert.equal(lanes.add('looper', [pt('a', 1, 0.1)]).length, 0);
  assert.equal(lanes.add('other', [pt('a', 1.5, 0.9)]).length, 1, 'ids are per source');
  assert.equal(lanes.off('looper', 2), 1);
  assert.equal(lanes.add('looper', [pt('b', 2, 0.25)]).length, 1, 'resent after the off: taken');
  lanes.off('other');
  assert.deepEqual(lanes.values(3), [{ param: 'cutoff', value: 0.25 }]);
});

test('ParamLanes: your hand wins — what waits for that knob goes, and nothing glides from where it was', () => {
  const lanes = new ParamLanes();
  lanes.add('looper', [pt('a', 1, 0.1), pt('b', 2, 0.5, { glide: 1 }), { ...pt('x', 2, 0.7), param: 'resonance' }]);
  lanes.values(1);
  assert.equal(lanes.hand('cutoff'), 1);
  assert.equal(lanes.hand('nothing'), 0);
  assert.deepEqual(lanes.values(2.5), [{ param: 'resonance', value: 0.7 }], 'cutoff left to the hand');
  // The source takes over again later (the next lap): a glide toward it has no start, so it arrives at its beat.
  lanes.add('looper', [pt('c', 6, 0.9, { glide: 1 })]);
  assert.deepEqual(lanes.values(5.5), []);
  assert.deepEqual(lanes.values(6), [{ param: 'cutoff', value: 0.9 }]);
});

test('ParamLanes: a lane holds at most MAX_LANE_POINTS waiting', () => {
  const lanes = new ParamLanes();
  const many = Array.from({ length: MAX_LANE_POINTS + 3 }, (_, i) => pt(`n${i}`, i, 0.5));
  assert.equal(lanes.add('looper', many).length, MAX_LANE_POINTS);
  assert.equal(lanes.stats.dropped, 3);
});

test('NotesInbox: param controls go to its lanes, not takeControls; off and clear reach them', () => {
  const inbox = new NotesInbox();
  inbox.receive(controlsMessage('looper', [pt('a', 4, 0.3), { type: 'slot', id: 's', beat: 4, slot: 2 }]));
  inbox.receive(controlsMessage('looper', [pt('a', 4, 0.3)]));
  assert.equal(inbox.controlsSize, 1, 'the slot change waits as before');
  assert.equal(inbox.params.size, 1);
  assert.equal(inbox.stats.accepted, 2);
  assert.equal(inbox.stats.duplicates, 1);
  assert.deepEqual(inbox.takeControls(() => true).map(e => e.type), ['slot']);
  inbox.receive(controlsMessage('looper', [pt('b', 8, 0.6)]));
  inbox.receive(offMessage('looper', 'restart', 6));
  assert.equal(inbox.params.size, 1, 'the off took the point from beat 6 on');
  assert.deepEqual(inbox.params.values(5), [{ param: 'cutoff', value: 0.3 }]);
  inbox.clear();
  assert.equal(inbox.params.size, 0);
});
