'use strict';
// The stored list of drafts: whatever is in storage, the page must get a
// usable list back, and never reuse a deleted draft's id (its storage key).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAnalyzer } = require('./lib/page');

const A = loadAnalyzer();
const plain = (x) => JSON.parse(JSON.stringify(x)); // VM-realm objects to plain ones

test('nothing stored, or garbage: the single draft older versions had', () => {
  const one = { active: 'd1', list: [{ id: 'd1', name: 'Draft 1' }], next: 2 };
  for (const raw of [null, undefined, '', '{', '[]', '{"list": 5}', '{"list": [{"id": "x"}]}', 42]) {
    assert.deepEqual(plain(A.parseDraftMeta(raw)), one, JSON.stringify(raw));
  }
});

test('a stored list is kept, cleaned, and keeps growing ids', () => {
  const raw = JSON.stringify({
    active: 'd3', next: 7,
    list: [
      { id: 'd1', name: '  Reviewer   aBcD ' },
      { id: 'd3', name: 'General' },
      { id: 'd3', name: 'duplicate id' },
      { id: 'd0', name: 'bad id' },
      { id: 'd2', name: '' },
      { id: 'd4', name: 'x'.repeat(80) },
    ],
  });
  const meta = plain(A.parseDraftMeta(raw));
  assert.deepEqual(meta.list.map((d) => d.id), ['d1', 'd3', 'd2', 'd4']);
  assert.equal(meta.list[0].name, 'Reviewer aBcD');
  assert.equal(meta.list[2].name, 'Draft 2');
  assert.equal(meta.list[3].name.length, 40);
  assert.equal(meta.active, 'd3');
  assert.equal(meta.next, 7); // ids of deleted drafts (d5, d6) are not reused
});

test('an active id that is gone falls back to the first draft', () => {
  const meta = plain(A.parseDraftMeta({ active: 'd9', list: [{ id: 'd2', name: 'B' }, { id: 'd5', name: 'C' }] }));
  assert.equal(meta.active, 'd2');
  assert.equal(meta.next, 6);
});

test('new drafts get a free name', () => {
  assert.equal(A.newDraftName([{ name: 'Draft 1' }]), 'Draft 2');
  assert.equal(A.newDraftName([{ name: 'Draft 1' }, { name: 'draft 3' }]), 'Draft 4');
  assert.equal(A.newDraftName([{ name: 'aBcD' }, { name: 'Draft 2' }]), 'Draft 3');
});
