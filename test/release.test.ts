// 0.10.0: release — LUPA mutes a pass whose long sample still rings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_RELEASE_IDS, NOTES_VERSION, NotesInbox, notesMessage, notesMessageError, parseNotesMessage, releaseMessage,
  type WireNote,
} from '../src/index.js';

const note = (id: string, startBeat: number): WireNote => ({
  id, source: 'Lupa', note: 36, velocity: 1, startBeat, lengthBeats: 1, role: 'chord', offsetSec: 0, spanBeats: 1,
  gate: 1, hit: 0, root: 36,
});

test('release: checked and copied', () => {
  const m = releaseMessage('Lupa', ['a', 'b']);
  assert.equal(notesMessageError(m), null);
  const p = parseNotesMessage({ ...m, extra: 1 });
  assert.deepEqual(p, { v: NOTES_VERSION, kind: 'release', source: 'Lupa', ids: ['a', 'b'] });
  assert.notEqual((p as { ids: string[] }).ids, m.kind === 'release' ? m.ids : null);
  assert.equal(notesMessageError({ ...m, ids: 'a' }), 'ids must be a list');
  assert.equal(notesMessageError({ ...m, ids: [''] }), 'id 0: bad id');
  assert.equal(notesMessageError({ ...m, source: '' }), 'bad source');
  assert.match(notesMessageError(releaseMessage('Lupa', Array.from({ length: MAX_RELEASE_IDS + 1 }, (_, i) => `n${i}`))) ?? '', /more than/);
});

test('release: the inbox drops only the waiting notes with those ids', () => {
  const inbox = new NotesInbox();
  inbox.receive(notesMessage('Lupa', [note('a', 4), note('b', 5), note('c', 6)]));
  assert.equal(inbox.size, 3);
  inbox.receive(releaseMessage('Lupa', ['b', 'zz']));
  assert.deepEqual(inbox.take(b => b < 10).map(e => e.id), ['a', 'c']);
});
