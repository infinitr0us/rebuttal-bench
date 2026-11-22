'use strict';
// Earlier versions of a draft (parseHistory, historyAdd, historyDue,
// mergeHistory) and the export file (draftsFile). The page keeps versions in
// this browser only; these are the rules it applies to them.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAnalyzer } = require('./lib/page');

const A = loadAnalyzer();
const plain = (x) => JSON.parse(JSON.stringify(x)); // VM-realm objects to plain ones

test('stored history: garbage gives an empty list, entries are cleaned and sorted newest first', () => {
  for (const raw of [null, undefined, '', '{', '{}', '"x"', 42, '[1, null, {"text": 5}, {"at": 1}]']) {
    assert.deepEqual(plain(A.parseHistory(raw)), [], JSON.stringify(raw));
  }
  const list = plain(A.parseHistory(JSON.stringify([
    { at: 1, why: 'old', text: 'a' },
    { at: 3, why: 'x'.repeat(60), text: 'c', extra: true },
    { at: 2, text: 'b' },
  ])));
  assert.deepEqual(list, [
    { at: 3, why: 'x'.repeat(40), text: 'c' },
    { at: 2, why: '', text: 'b' },
    { at: 1, why: 'old', text: 'a' },
  ]);
});

test('a version is added unless it is blank or the same as the newest', () => {
  let list = [];
  list = A.historyAdd(list, 'first', 'before Fix all', 10);
  assert.equal(list.length, 1);
  assert.equal(A.historyAdd(list, 'first', 'again', 20), list, 'same text: the list itself');
  assert.equal(A.historyAdd(list, '  \n ', 'blank', 20), list);
  list = A.historyAdd(list, 'second', 'while editing', 20);
  assert.deepEqual(plain(list).map((v) => v.text), ['second', 'first']);
  // The same text as an older version is a revert worth keeping.
  assert.deepEqual(plain(A.historyAdd(list, 'first', 'before Clear', 30)).map((v) => v.text), ['first', 'second', 'first']);
});

test('history is capped by count and by characters, and always keeps the newest', () => {
  let list = [];
  for (let i = 0; i < 30; i++) list = A.historyAdd(list, 'v' + i, '', i);
  assert.equal(list.length, A.HISTORY_MAX);
  assert.equal(list[0].text, 'v29');
  const big = 'x'.repeat(A.HISTORY_CHARS / 2 + 1);
  list = A.historyAdd(A.historyAdd([], big + '1', '', 1), big + '2', '', 2);
  assert.deepEqual(plain(list).map((v) => v.text.slice(-1)), ['2'], 'two would exceed HISTORY_CHARS');
  const huge = 'y'.repeat(A.HISTORY_CHARS * 2);
  assert.equal(A.historyAdd([], huge, '', 1).length, 1, 'a single huge version is still kept');
});

test('versions waiting in memory merge with the stored ones, each once', () => {
  const stored = [{ at: 3, why: 'b', text: 'three' }, { at: 1, why: 'a', text: 'one' }];
  const waiting = [{ at: 4, why: 'c', text: 'four' }, { at: 3, why: 'b', text: 'three' }];
  assert.deepEqual(plain(A.mergeHistory(waiting, stored)).map((v) => v.text), ['four', 'three', 'one']);
});

test('while editing, a version is due every HISTORY_EVERY', () => {
  assert.equal(A.historyDue(0, 1000), true);
  assert.equal(A.historyDue(1000, 1000 + A.HISTORY_EVERY - 1), false);
  assert.equal(A.historyDue(1000, 1000 + A.HISTORY_EVERY), true);
});

test('an export holds every draft, by name and exact text, in tab order', () => {
  const drafts = [{ name: 'Reviewer aBcD', text: 'Thanks $x$!\n\n| a |\n|-|\n| 1 |' }, { name: 'General', text: '' }];
  const file = A.draftsFile(drafts, Date.UTC(2026, 10, 21));
  assert.ok(file.endsWith('\n'));
  assert.deepEqual(JSON.parse(file), {
    format: 'rebuttal-bench-drafts', version: 1, exported: '2026-11-21T00:00:00.000Z', drafts,
  });
  // Control characters and lone surrogates survive the JSON round trip.
  const odd = [{ name: 'x', text: '\u0000\u001b\ud800 end' }];
  assert.deepEqual(JSON.parse(A.draftsFile(odd, 0)).drafts, odd);
});
