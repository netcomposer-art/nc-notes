// The notes contract (v1) and the Bass rule (ChordTrack): CALLIOPE stage 2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ChordTrack, DEFAULT_GENERATOR_SETTINGS, MAX_EVENTS_PER_MESSAGE, NOTES_VERSION, NoteGenerator, NotesInbox, chordAt, inOctave,
  noteId, notesMessage, notesMessageError, offMessage, parseNotesMessage, pitchAt, routeForTarget, routesMessage,
  type GeneratorSettings, type NoteEvent, type WireNote,
} from '../src/index.js';

const chordSettings: GeneratorSettings = {
  ...DEFAULT_GENERATOR_SETTINGS, mode: 'chord', chord: 'Major', chordProgression: 'pop-1-5-6-4', progressionBars: 1, interval: 4, gate: 50,
} as GeneratorSettings;

function run(settings: GeneratorSettings, toBeat: number): NoteEvent[] {
  const gen = new NoteGenerator(settings, { random: () => 0.5, chordRandom: () => 0.5 });
  gen.start(0);
  return gen.window(toBeat);
}

test('routeForTarget: ids are stable, per role, and unique within a run', () => {
  const events = run(chordSettings, 16);
  const a = routeForTarget('src', 1, events, 'chord');
  const b = routeForTarget('src', 1, events, 'chord');
  assert.deepEqual(a.map(e => e.id), b.map(e => e.id), 'routing again gives the same ids');
  assert.equal(new Set(a.map(e => e.id)).size, a.length, 'unique');
  const root = routeForTarget('src', 1, events, 'root', { octave: 2 });
  assert.equal(root.length, new Set(events.map(e => e.hit)).size, 'one root per hit');
  assert.ok(root.every(e => e.note >= 36 && e.note < 48 && e.role === 'root'));
  assert.ok(root.every(e => !a.some(x => x.id === e.id)), 'a role change makes new ids');
  const nextRun = routeForTarget('src', 2, events, 'chord');
  assert.ok(nextRun.every(e => !a.some(x => x.id === e.id)), 'a new run makes new ids');
  assert.equal(a[0].id, noteId('src', 1, 'chord', a[0].hit, 0));
  assert.ok(a.every(e => e.source === 'src'));
});

test('messages round-trip through parseNotesMessage as fresh copies', () => {
  const events = routeForTarget('src', 1, run(chordSettings, 4), 'chord');
  const m = notesMessage('src', events);
  assert.equal(notesMessageError(m), null);
  const parsed = parseNotesMessage({ ...m, extra: 1 });
  assert.ok(parsed && parsed.kind === 'notes');
  assert.deepEqual(parsed.events, events);
  assert.notEqual(parsed.events[0], events[0], 'copied, not kept by reference');
  assert.deepEqual(parseNotesMessage(offMessage('src', 'stop', 8)), { v: NOTES_VERSION, kind: 'off', source: 'src', reason: 'stop', atBeat: 8 });
  assert.deepEqual(parseNotesMessage(offMessage('src', 'off')), { v: NOTES_VERSION, kind: 'off', source: 'src', reason: 'off' });
  const routes = routesMessage([{ source: 'src', name: 'CALLIOPE 1', role: 'root', octave: 2 }]);
  assert.deepEqual(parseNotesMessage(routes), routes);
});

test('invalid messages are refused with a reason', () => {
  const good = routeForTarget('src', 1, run(chordSettings, 4), 'chord');
  const bad = (patch: Partial<WireNote>) => notesMessage('src', [{ ...good[0], ...patch }]);
  assert.match(String(notesMessageError(null)), /not an object/);
  assert.match(String(notesMessageError({ ...notesMessage('src', good), v: 2 })), /version 2/);
  assert.match(String(notesMessageError({ v: 1, kind: 'play-now', source: 'src' })), /unknown kind/);
  assert.match(String(notesMessageError(bad({ note: 128 }))), /note/);
  assert.match(String(notesMessageError(bad({ note: 60.5 }))), /note/);
  assert.match(String(notesMessageError(bad({ velocity: 2 }))), /velocity/);
  assert.match(String(notesMessageError(bad({ startBeat: NaN }))), /startBeat/);
  assert.match(String(notesMessageError(bad({ gate: 0 }))), /gate/);
  assert.match(String(notesMessageError(bad({ spanBeats: 0 }))), /spanBeats/);
  assert.match(String(notesMessageError(bad({ id: '' }))), /id/);
  assert.match(String(notesMessageError(bad({ source: 'other' }))), /another source/);
  assert.match(String(notesMessageError(bad({ role: 'drum' as never }))), /role/);
  const many = Array.from({ length: MAX_EVENTS_PER_MESSAGE + 1 }, (_, i) => ({ ...good[0], id: `x${i}` }));
  assert.match(String(notesMessageError(notesMessage('src', many))), /more than/);
  assert.match(String(notesMessageError({ v: 1, kind: 'off', source: 'src', reason: 'whatever' })), /reason/);
  assert.match(String(notesMessageError(routesMessage([{ source: 'src', name: 'x', role: 'arp' as never }]))), /role/);
  assert.equal(parseNotesMessage(bad({ note: -1 })), null);
});

test('NotesInbox: a resend is a no-op, events come out in start order, off drops a source', () => {
  const inbox = new NotesInbox();
  const events = routeForTarget('src', 1, run(chordSettings, 8), 'chord');
  inbox.receive(notesMessage('src', events.slice(0, 6)));
  inbox.receive(notesMessage('src', events)); // overlaps: the first six again
  assert.equal(inbox.size, events.length);
  assert.equal(inbox.stats.duplicates, 6);
  const due = inbox.take(beat => beat < 4);
  assert.deepEqual(due.map(e => e.id), events.filter(e => e.startBeat < 4).map(e => e.id), 'in order, the hit order kept');
  inbox.receive(notesMessage('src', events)); // all seen: nothing comes back
  assert.equal(inbox.size, events.length - due.length);
  // A second source, out of order: merged by start.
  const other = routeForTarget('b', 1, run({ ...chordSettings, chordProgression: 'off' } as GeneratorSettings, 8), 'top');
  inbox.receive(notesMessage('b', [...other].reverse()));
  const all = inbox.take(() => true);
  assert.ok(all.every((e, i) => i === 0 || e.startBeat >= all[i - 1].startBeat));
  inbox.receive(notesMessage('src', routeForTarget('src', 2, run(chordSettings, 8), 'chord')));
  inbox.receive(notesMessage('b', routeForTarget('b', 2, run(chordSettings, 8), 'chord')));
  const src2 = routeForTarget('src', 2, run(chordSettings, 8), 'chord');
  assert.equal(inbox.off('src', 4), src2.filter(e => e.startBeat >= 4).length);
  assert.ok(inbox.take(() => true).every(e => e.source === 'b' || e.startBeat < 4));
  inbox.receive(offMessage('b', 'stop'));
  assert.equal(inbox.size, 0);
  // Events dropped by an off never played: sent again (the target back on), they are taken.
  const again = routeForTarget('b', 3, run(chordSettings, 8), 'chord');
  inbox.receive(notesMessage('b', again));
  inbox.receive(offMessage('b', 'off'));
  assert.equal(inbox.size, 0);
  assert.equal(inbox.add(again).length, again.length);
});

test('NotesInbox: routes make it active; invalid messages are counted, not taken; prune forgets the past', () => {
  const inbox = new NotesInbox();
  assert.equal(inbox.active, false);
  inbox.receive(routesMessage([{ source: 'src', name: 'CALLIOPE 1', role: 'chord' }]));
  assert.equal(inbox.active, true);
  assert.equal(inbox.receive({ v: 1, kind: 'notes', source: 'src', events: [{ note: 60 }] }), null);
  assert.equal(inbox.stats.invalid, 1);
  const events = routeForTarget('src', 1, run(chordSettings, 32), 'chord');
  inbox.receive(notesMessage('src', events));
  inbox.prune(8);
  assert.ok(inbox.take(() => true).every(e => e.startBeat >= 8));
  assert.ok(inbox.stats.dropped > 0);
  inbox.prune(64); // ids long past are forgotten: the same events would be new again
  inbox.receive(notesMessage('src', events));
  assert.equal(inbox.size, events.length);
  inbox.receive(routesMessage([]));
  assert.equal(inbox.active, false);
});

test('Bass rule: the root of whatever chord is sounding at each Bass step', () => {
  // pop-1-5-6-4, one bar each, quarter-note chords at gate 50 %: C G Am F.
  const events = run(chordSettings, 16);
  const track = new ChordTrack();
  track.add(events);
  const roots = [0, 4, 8, 12].map(bar => track.pitchAt(bar)! % 12);
  assert.deepEqual(roots, [0, 7, 9, 5], 'C G A F');
  // A Bass 16th between two chord hits (inside the gap after a 50 % gate): the chord still in effect.
  const gap = track.chordAt(4.75)!;
  assert.equal(gap.root % 12, 7);
  assert.equal(gap.sounding, false, 'its notes stopped, its harmony holds');
  assert.equal(track.chordAt(4.25)!.sounding, true);
  // Exactly on the change: the new chord.
  assert.equal(track.pitchAt(8)! % 12, 9);
  assert.equal(track.pitchAt(8 - 1e-3)! % 12, 7);
  // Octave choice.
  assert.equal(track.pitchAt(0, { octave: 1 }), 24);
  assert.equal(inOctave(61, 2), 37);
  // Before any chord, none.
  assert.equal(track.pitchAt(-1), null);
  // The free functions agree.
  assert.equal(pitchAt(events, 13), track.pitchAt(13));
  assert.deepEqual(chordAt(events, 13)?.notes, track.chordAt(13)?.notes);
});

test('Bass rule: an arp stream gives the chord root, not the arp note; off ends the chord', () => {
  const arp = run({ ...chordSettings, arp: 'up', interval: 16 } as GeneratorSettings, 8);
  const track = new ChordTrack();
  track.add(arp);
  const at = [0, 0.25, 0.5, 0.75].map(b => track.pitchAt(b));
  assert.ok(at.every(p => p === at[0]), 'every arp note of a chord gives its root');
  assert.equal(track.pitchAt(4.5)! % 12, 7, 'bar 2: G');
  track.off(6);
  assert.equal(track.pitchAt(6.5), null, 'after an off, no chord');
  assert.equal(track.pitchAt(5)! % 12, 7, 'before it, still G');
  // A new run after the off (its hits numbered again from 1): it takes over from its own start.
  const again = run(chordSettings, 4).map(e => ({ ...e, startBeat: e.startBeat + 8 }));
  track.add(again);
  assert.equal(track.pitchAt(8)! % 12, 0);
  track.prune(9);
  assert.equal(track.pitchAt(9)! % 12, 0, 'pruning keeps the chord in effect');
  assert.ok(track.size <= 4);
  track.off();
  assert.equal(track.pitchAt(9), null);
});

test('the window stream routed as chord is exactly the generator\'s own notes (what ASTRID plays from the window)', () => {
  const events = run(chordSettings, 32);
  const wired = routeForTarget('src', 1, events, 'chord');
  assert.deepEqual(wired.map(({ id: _id, source: _s, ...rest }) => rest), events.map(e => ({ ...e, role: 'chord' })));
});
