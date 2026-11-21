'use strict';
// The stored list of drafts: whatever is in storage, the page must get a
// usable list back; lists saved by two windows (or before a reload) must
// merge without losing a draft or bringing a deleted one back.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAnalyzer } = require('./lib/page');

const A = loadAnalyzer();
const plain = (x) => JSON.parse(JSON.stringify(x)); // VM-realm objects to plain ones
const parse = (raw) => plain(A.parseDraftMeta(raw));
const merge = (a, b, now) => plain(A.mergeDraftMeta(A.parseDraftMeta(a), A.parseDraftMeta(b), now));

test('nothing stored, or garbage: the single draft older versions had', () => {
  const one = { active: 'd1', list: [{ id: 'd1', name: 'Draft 1', at: 0 }], gone: {}, saved: 0 };
  for (const raw of [null, undefined, '', '{', '[]', '{"list": 5}', '{"list": [{"id": "x"}]}', 42]) {
    assert.deepEqual(parse(raw), one, JSON.stringify(raw));
  }
});

test('a stored list is kept and cleaned', () => {
  const meta = parse({
    active: 'dk3x9q2ab',
    list: [
      { id: 'd1', name: '  Reviewer   aBcD ', at: 5 },
      { id: 'dk3x9q2ab', name: 'General', at: 7 },
      { id: 'dk3x9q2ab', name: 'duplicate id' },
      { id: 'D2', name: 'bad id' },
      { id: 'dzz', name: '' },
      { id: 'dyy', name: 'x'.repeat(80) },
      { id: 'dold', name: 'deleted elsewhere' },
    ],
    gone: { dold: 9, 'not an id': 3, dnan: 'x' },
  });
  assert.deepEqual(meta.list.map((d) => d.id), ['d1', 'dk3x9q2ab', 'dzz', 'dyy']);
  assert.equal(meta.list[0].name, 'Reviewer aBcD');
  assert.equal(meta.list[2].name, 'Draft');
  assert.equal(meta.list[3].name.length, 40);
  assert.equal(meta.active, 'dk3x9q2ab');
  assert.deepEqual(meta.gone, { dold: 9 });
});

test('the active id is always one of the listed drafts', () => {
  for (const active of ['toString', '__proto__', 'constructor', 'd9', 42, null]) {
    const meta = parse({ active, list: [{ id: 'd2', name: 'B' }, { id: 'd5', name: 'C' }] });
    assert.equal(meta.active, 'd2', String(active));
  }
});

test('merging keeps every draft either window knows, with the newer name', () => {
  const mine = { active: 'd1', list: [{ id: 'd1', name: 'Draft 1', at: 1 }, { id: 'da', name: 'Old name', at: 2 }] };
  const theirs = { active: 'db', list: [{ id: 'd1', name: 'Draft 1', at: 1 }, { id: 'da', name: 'New name', at: 5 }, { id: 'db', name: 'Added there', at: 4 }] };
  const m = merge(mine, theirs);
  assert.deepEqual(m.list.map((d) => [d.id, d.name]), [['d1', 'Draft 1'], ['da', 'New name'], ['db', 'Added there']]);
  assert.equal(m.active, 'd1'); // each window keeps its own open draft
});

test('a deletion in one window is not undone by the other window\'s older list', () => {
  const deleter = { active: 'd1', list: [{ id: 'd1', name: 'Draft 1' }], gone: { da: 10 } };
  const stale = { active: 'd1', list: [{ id: 'd1', name: 'Renamed', at: 12 }, { id: 'da', name: 'B', at: 2 }] };
  for (const m of [merge(deleter, stale), merge(stale, deleter)]) {
    assert.deepEqual(m.list.map((d) => d.id), ['d1']);
    assert.equal(m.list[0].name, 'Renamed');
    assert.equal(m.gone.da, 10);
  }
});

test('a draft open in a live window is re-created after a deletion from elsewhere', () => {
  const mine = { active: 'da', list: [{ id: 'd1', name: 'A' }, { id: 'da', name: 'B', at: 3 }] };
  const theirs = { active: 'd1', list: [{ id: 'd1', name: 'A' }], gone: { da: 10 } };
  const live = merge(mine, theirs, 50);
  assert.deepEqual(live.list.map((d) => [d.id, d.at]), [['d1', 0], ['da', 50]]);
  assert.equal(live.gone.da, undefined);
  // On a cold start (no live editor) the deletion wins, and stays won in later merges.
  assert.deepEqual(merge(mine, theirs).list.map((d) => d.id), ['d1']);
  assert.deepEqual(merge(live, { list: [{ id: 'd1', name: 'A' }], gone: { da: 10 } }).list.map((d) => d.id), ['d1', 'da']);
});

test('a deletion wins over entries not newer than it; a newer entry is a re-creation', () => {
  const del = { list: [{ id: 'd1', name: 'A' }], gone: { da: 10 } };
  assert.deepEqual(merge(del, { list: [{ id: 'd1', name: 'A' }, { id: 'da', name: 'Old', at: 10 }] }).list.map((d) => d.id), ['d1']);
  const back = merge(del, { list: [{ id: 'd1', name: 'A' }, { id: 'da', name: 'Again', at: 11 }] });
  assert.deepEqual(back.list.map((d) => d.name), ['A', 'Again']);
  assert.equal(back.gone.da, undefined);
});

test('deletions are remembered long enough (the newest 2,000)', () => {
  const gone = Object.fromEntries(Array.from({ length: 2100 }, (_, i) => ['dg' + i, i]));
  const meta = parse({ list: [{ id: 'd1', name: 'A' }], gone });
  assert.equal(Object.keys(meta.gone).length, 2000);
  assert.ok(meta.gone.dg2099 === 2099 && meta.gone.dg99 === undefined && meta.gone.dg100 === 100);
});

test('new ids are random, valid, and new drafts get a free name', () => {
  // Generated within the same millisecond or two: the random part alone must keep them apart.
  const ids = new Set(Array.from({ length: 5000 }, () => A.newDraftId()));
  assert.equal(ids.size, 5000);
  for (const id of ids) assert.match(id, A.DRAFT_ID);
  assert.equal(A.newDraftName([{ name: 'Draft 1' }]), 'Draft 2');
  assert.equal(A.newDraftName([{ name: 'Draft 1' }, { name: 'draft 3' }]), 'Draft 4');
  assert.equal(A.newDraftName([{ name: 'aBcD' }, { name: 'Draft 2' }]), 'Draft 3');
});
