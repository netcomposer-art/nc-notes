// The Song Looper's part of the notes contract (0.6.0): `played` (what an instrument played by hand), `controls`
// (recorded slot and chord-pad changes sent back), the `layer` route flag and pad hits as notes (with a slice).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_EVENTS_PER_MESSAGE, MAX_SLICE, MAX_SLOT, NOTES_VERSION, NotesInbox, PAD_NOTE_BASE, controlEventError, controlsMessage,
  notesMessage, notesMessageError, offMessage, padNote, padOfNote, parseNotesMessage, playedEventError, playedMessage,
  routesMessage, type ControlEvent, type PlayedEvent, type WireNote,
} from '../src/index.js';

const played: PlayedEvent[] = [
  { type: 'note', id: 'k|1', beat: 36.0021, on: true, note: 60, velocity: 0.82 },
  { type: 'note', id: 'k|1', beat: 36.9395, on: false, note: 60 },
  { type: 'note', id: 'p|2', beat: 37.5, on: true, note: padNote(3), velocity: 0.8, slice: 2 },
  { type: 'slot', id: 's|3', beat: 40, slot: 3 },
  { type: 'chordPad', id: 'c|4', beat: 44, pad: 5 },
  { type: 'chordPad', id: 'c|5', beat: 48, pad: null },
];

const wire = (patch: Partial<WireNote> = {}): WireNote => ({
  id: 'looper|1|chord|1|0', source: 'looper', note: 60, velocity: 0.8, startBeat: 8, lengthBeats: 0.5, spanBeats: 0.5,
  gate: 1, role: 'chord', offsetSec: 0, hit: 1, root: 60, ...patch,
});

test('pads travel as notes 36–51', () => {
  assert.equal(PAD_NOTE_BASE, 36);
  assert.equal(padNote(1), 36);
  assert.equal(padNote(16), 51);
  assert.equal(padOfNote(36), 1);
  assert.equal(padOfNote(51), 16);
  assert.equal(padOfNote(35), null);
  assert.equal(padOfNote(52), null);
  for (let pad = 1; pad <= 16; pad++) assert.equal(padOfNote(padNote(pad)), pad);
});

test('played: round-trips as fresh copies, unknown fields dropped', () => {
  const m = playedMessage('astrid-synth', played);
  assert.equal(notesMessageError(m), null);
  const raw = { ...m, extra: 1, events: m.kind === 'played' ? m.events.map(e => ({ ...e, extra: 2 })) : [] };
  const parsed = parseNotesMessage(raw);
  assert.ok(parsed && parsed.kind === 'played');
  assert.deepEqual(parsed, m);
  assert.notEqual(parsed.events[0], played[0], 'copied, not kept by reference');
  assert.equal(parsed.source, 'astrid-synth');
});

test('played: invalid events are refused with a reason', () => {
  const bad = (e: unknown) => playedEventError(e);
  assert.match(String(bad(null)), /not an object/);
  assert.match(String(bad({ ...played[0], id: '' })), /id/);
  assert.match(String(bad({ ...played[0], beat: NaN })), /beat/);
  assert.match(String(bad({ ...played[0], on: 1 })), /on/);
  assert.match(String(bad({ ...played[0], note: 128 })), /note/);
  assert.match(String(bad({ ...played[0], note: 60.5 })), /note/);
  assert.match(String(bad({ ...played[0], velocity: 0 })), /velocity/, 'an on needs a velocity above 0');
  assert.match(String(bad({ ...played[0], velocity: undefined })), /velocity/);
  assert.match(String(bad({ ...played[0], velocity: 1.1 })), /velocity/);
  assert.match(String(bad({ ...played[2], slice: -1 })), /slice/);
  assert.match(String(bad({ ...played[2], slice: MAX_SLICE + 1 })), /slice/);
  assert.match(String(bad({ ...played[1], velocity: 0.5 })), /off has no velocity/);
  assert.match(String(bad({ ...played[3], slot: 0 })), /slot/);
  assert.match(String(bad({ ...played[3], slot: MAX_SLOT + 1 })), /slot/);
  assert.match(String(bad({ ...played[4], pad: 17 })), /pad/);
  assert.match(String(bad({ ...played[4], pad: 0 })), /pad/);
  assert.match(String(bad({ type: 'knob', id: 'x', beat: 1 })), /bad type/);
  assert.equal(bad(played[5]), null, 'a chord pad let go (null) is fine');
  const many = Array.from({ length: MAX_EVENTS_PER_MESSAGE + 1 }, (_, i) => ({ ...played[3], id: `s|${i}` }));
  assert.match(String(notesMessageError(playedMessage('nyx', many as PlayedEvent[]))), /more than/);
  assert.match(String(notesMessageError(playedMessage('', played))), /source/);
  assert.match(String(notesMessageError({ v: NOTES_VERSION, kind: 'played', source: 'nyx', events: [played[0], { ...played[0], note: -1 }] })), /event 1: note/);
});

test('controls: round-trip, and notes and other kinds are refused inside', () => {
  const controls: ControlEvent[] = [played[3], played[4], played[5]] as ControlEvent[];
  const m = controlsMessage('looper', controls);
  assert.equal(notesMessageError(m), null);
  assert.deepEqual(parseNotesMessage(m), m);
  assert.match(String(controlEventError(played[0])), /bad type/, 'a note is not a control');
  assert.match(String(notesMessageError(controlsMessage('looper', [{ ...controls[0], beat: Infinity }]))), /event 0: bad beat/);
});

test('a pad hit as a wire note may name a slice; the slice is copied and checked', () => {
  const m = notesMessage('looper', [wire({ note: padNote(2), slice: 4 })]);
  const parsed = parseNotesMessage(m);
  assert.ok(parsed && parsed.kind === 'notes');
  assert.equal(parsed.events[0].slice, 4);
  assert.equal('slice' in (parseNotesMessage(notesMessage('looper', [wire()])) as { events: WireNote[] }).events[0], false,
    'no slice: absent, not undefined');
  assert.match(String(notesMessageError(notesMessage('looper', [wire({ slice: 1.5 })]))), /slice/);
});

test('layer: a route that adds keeps the generator playing; any other route makes it stand aside', () => {
  const inbox = new NotesInbox();
  assert.equal(inbox.standsAside, false);
  inbox.receive(routesMessage([{ source: 'looper', name: 'Looper', role: 'chord', layer: true }]));
  assert.equal(inbox.active, true, 'a source plays it');
  assert.equal(inbox.standsAside, false, 'but only as a layer');
  inbox.receive(routesMessage([
    { source: 'looper', name: 'Looper', role: 'chord', layer: true },
    { source: 'calliope', name: 'CALLIOPE 1', role: 'chord' },
  ]));
  assert.equal(inbox.standsAside, true, 'CALLIOPE plays it: the generator stands aside');
  inbox.receive(routesMessage([{ source: 'looper', name: 'Looper', role: 'chord', layer: false }]));
  assert.equal(inbox.standsAside, true, 'layer false is the same as absent');
  const parsed = parseNotesMessage(routesMessage([{ source: 'looper', name: 'Looper', role: 'chord', layer: true }]));
  assert.deepEqual(parsed, routesMessage([{ source: 'looper', name: 'Looper', role: 'chord', layer: true }]));
  assert.match(String(notesMessageError(routesMessage([{ source: 'l', name: 'L', role: 'chord', layer: 'yes' as unknown as boolean }]))), /layer/);
});

test('NotesInbox keeps controls in beat order, ignores resends, drops them on off, and prunes the past', () => {
  const inbox = new NotesInbox();
  const slot = (id: string, beat: number, n: number): ControlEvent => ({ type: 'slot', id, beat, slot: n });
  inbox.receive(controlsMessage('looper', [slot('a', 16, 2), slot('b', 8, 1)]));
  inbox.receive(controlsMessage('looper', [slot('a', 16, 2)]));
  assert.equal(inbox.controlsSize, 2, 'a resend is a no-op');
  assert.equal(inbox.stats.duplicates, 1);
  inbox.receive(controlsMessage('other', [slot('a', 12, 3)]));
  assert.equal(inbox.controlsSize, 3, 'the same id from another source is another change');
  assert.deepEqual(inbox.takeControls(b => b < 13).map(e => e.id), ['b', 'a'], 'in beat order, up to the due beat');
  assert.equal(inbox.controlsSize, 1);
  inbox.receive(offMessage('looper', 'off', 20));
  assert.equal(inbox.controlsSize, 1, 'an off from beat 20 leaves beat 16');
  inbox.receive(offMessage('looper', 'off'));
  assert.equal(inbox.controlsSize, 0, 'an off without a beat drops them all');
  inbox.receive(controlsMessage('looper', [slot('a', 16, 2)]));
  assert.equal(inbox.controlsSize, 1, 'dropped by an off: the same change is taken again');
  inbox.prune(17);
  assert.equal(inbox.controlsSize, 0, 'past changes are dropped');
  assert.equal(inbox.stats.dropped, 1);
  assert.equal(inbox.size, 0, 'notes untouched');
});

test('played and controls change nothing a note receiver keeps', () => {
  const inbox = new NotesInbox();
  inbox.receive(notesMessage('looper', [wire()]));
  inbox.receive(playedMessage('astrid-synth', played));
  assert.equal(inbox.size, 1);
  assert.equal(inbox.controlsSize, 0, 'played is a report, not something to play');
  assert.equal(inbox.stats.invalid, 0);
});

test('a v1 receiver from before 0.6.0 refuses the new kinds as unknown (nothing plays, nothing else changes)', () => {
  // What 0.5.0 did with any kind it didn't know: notesMessageError said "unknown kind". The new kinds are new names,
  // so an old receiver drops them; the old kinds keep their exact shape.
  for (const kind of ['played', 'controls']) assert.ok(!['notes', 'off', 'routes', 'audition'].includes(kind));
  const old = parseNotesMessage(notesMessage('looper', [wire()]));
  assert.deepEqual(Object.keys((old as { events: WireNote[] }).events[0]).sort(),
    ['gate', 'hit', 'id', 'lengthBeats', 'note', 'offsetSec', 'role', 'root', 'source', 'spanBeats', 'startBeat', 'velocity']);
});

test('a pitch follower ignores played and controls, even from the source it follows', async () => {
  const { PitchFollower } = await import('../src/index.js');
  const f = new PitchFollower();
  f.receive(routesMessage([{ source: 'looper', name: 'Looper', role: 'root' }]));
  const before = f.version;
  f.receive(controlsMessage('looper', [{ type: 'slot', id: 's', beat: 4, slot: 2 }]));
  f.receive(playedMessage('looper', [played[0]]));
  assert.equal(f.version, before, 'the timeline did not change');
  assert.equal(f.rootAt(5), null);
});
