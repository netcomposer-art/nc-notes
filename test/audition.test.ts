// 0.5.0: the `audition` message (play now, once) and auditionEvents (a pad's chord as one hit).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDITION_HOLD_SEC, DEFAULT_GENERATOR_SETTINGS, MAX_AUDITION_HOLD_SEC, NotesInbox, auditionEvents, auditionMessage,
  notesMessageError, parseNotesMessage, routeForTarget, type GeneratorSettings,
} from '../src/index.js';

const s = (p: Partial<GeneratorSettings>): GeneratorSettings => ({ ...DEFAULT_GENERATOR_SETTINGS, ...p } as GeneratorSettings);

test('auditionEvents: the pad chord as one held hit, whatever the style, arp or progression', () => {
  const c = auditionEvents(s({ mode: 'chord', chord: 'Major', note: 0, octave: 3 }));
  assert.deepEqual(c.map(e => e.note), [48, 52, 55], 'C major at C3');
  assert.ok(c.every(e => e.startBeat === 0 && e.offsetSec === 0 && e.role === 'chord' && e.root === 48 && e.hit === 0));
  const busy = auditionEvents(s({ mode: 'chord', chord: 'Major', note: 0, octave: 3, arp: 'up', chordStyle: 'oom-pah', chordProgression: 'pop-1-5-6-4', strum: 60, tension: 100 }));
  assert.deepEqual(busy.map(e => e.note), [48, 52, 55], 'no arp, no progression, no strum, no colour tone');
  const minor = auditionEvents(s({ mode: 'off', chord: 'Minor', note: 9, octave: 3 }), 7);
  assert.deepEqual(minor.map(e => e.note), [57, 60, 64], 'a pad plays its chord even with the Mode off');
  assert.ok(minor.every(e => e.hit === 7));
  assert.ok(AUDITION_HOLD_SEC > 0 && AUDITION_HOLD_SEC <= MAX_AUDITION_HOLD_SEC);
});

test('audition message: routed per role, checked, copied; the inbox keeps nothing; old kinds unchanged', () => {
  const events = auditionEvents(s({ mode: 'chord', chord: 'Major', note: 2, octave: 3 }));
  const chord = routeForTarget('calliope', -1, events, 'chord');
  const root = routeForTarget('calliope', -1, events, 'root', { octave: 1 });
  assert.deepEqual(root.map(e => e.note), [26], 'Root: the root once, in its octave');
  const m = auditionMessage('calliope', chord, AUDITION_HOLD_SEC);
  assert.equal(notesMessageError(m), null);
  const parsed = parseNotesMessage(JSON.parse(JSON.stringify({ ...m, extra: 1 })));
  assert.deepEqual(parsed, m);
  assert.notEqual((parsed as { events: unknown[] }).events[0], chord[0], 'fresh objects');
  assert.match(notesMessageError({ ...m, holdSec: 0 }) ?? '', /holdSec/);
  assert.match(notesMessageError({ ...m, holdSec: MAX_AUDITION_HOLD_SEC + 1 }) ?? '', /holdSec/);
  assert.match(notesMessageError({ ...m, holdSec: Number.NaN }) ?? '', /holdSec/);
  assert.match(notesMessageError({ ...m, events: chord.map(e => ({ ...e, source: 'other' })) }) ?? '', /another source/);
  assert.match(notesMessageError({ ...m, events: Array(65).fill(chord[0]) }) ?? '', /more than 64/);
  const inbox = new NotesInbox();
  assert.ok(inbox.receive(m));
  assert.equal(inbox.size, 0, 'not kept: it plays now');
  assert.equal(inbox.routes.length, 0, 'routes untouched');
  assert.equal(inbox.stats.invalid, 0);
});
