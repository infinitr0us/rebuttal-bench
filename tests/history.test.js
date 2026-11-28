'use strict';
// Earlier versions of a draft (parseHistory, historyAdd, historyDue, the
// budget for all drafts: historySize, fitHistory) and drafts as files
// (draftsFile, readDraftsFile, importPlan). The page keeps versions in this
// browser only; these are the rules it applies to them.
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

test('all drafts together stay within a budget, the oldest versions going first, whichever draft has them', () => {
  const v = (at, text) => ({ at, why: 'w', text });
  const lists = {
    open: [v(50, 'open newest'), v(10, 'open oldest')],
    idle: [v(40, 'idle newer'), v(20, 'idle older'), v(5, 'idle oldest')],
    empty: [],
  };
  const size = A.historySize(lists);
  assert.equal(size, Object.values(lists).flat().reduce((n, x) => n + JSON.stringify(x).length + 1, 0));
  // Within the budget nothing goes, and the lists are the same objects.
  const same = A.fitHistory(lists, size);
  for (const id of Object.keys(lists)) assert.equal(same[id], lists[id], id);
  // Each step down drops the next oldest version: 5, then 10, then 20, ...
  const cost = (x) => JSON.stringify(x).length + 1;
  const order = Object.values(lists).flat().sort((a, b) => a.at - b.at);
  let budget = size;
  for (let k = 1; k <= order.length; k++) {
    budget -= cost(order[k - 1]);
    const fit = plain(A.fitHistory(lists, budget));
    const kept = Object.values(fit).flat().map((x) => x.at).sort((a, b) => a - b);
    assert.deepEqual(kept, order.slice(k).map((x) => x.at), 'budget ' + budget);
    assert.ok(A.historySize(fit) <= budget);
    // What goes is always the end of a list: each stays newest first.
    for (const id of Object.keys(fit)) assert.deepEqual(fit[id], plain(lists[id]).slice(0, fit[id].length), id);
  }
  assert.deepEqual(plain(A.fitHistory(lists, 0)), { open: [], idle: [], empty: [] });
  // One byte over drops the oldest one; versions of the same time go from the end of their list.
  const tie = { a: [v(7, 'x'), v(7, 'y')], b: [v(7, 'z')] };
  const fit = plain(A.fitHistory(tie, A.historySize(tie) - 1));
  assert.equal(fit.a.length + fit.b.length, 2);
  assert.deepEqual(fit.a, plain(tie.a).slice(0, fit.a.length));
  assert.ok(A.HISTORY_BUDGET >= 10 * A.HISTORY_CHARS, 'about ten drafts at their own cap');
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
  // An exported file reads back as the same drafts.
  assert.deepEqual(plain(A.readDraftsFile(file, 'rebuttal-drafts-2026-11-21.json')), { drafts, error: null });
});

test('reading files for import', () => {
  const md = plain(A.readDraftsFile('# Answer\r\n\r\nText.', 'C:\\Users\\me\\Reviewer   9xY2.md'));
  assert.deepEqual(md, { drafts: [{ name: 'Reviewer 9xY2', text: '# Answer\n\nText.' }], error: null });
  assert.equal(A.readDraftsFile('x', '').drafts[0].name, 'Imported');
  // A draft that starts with a brace is still a draft.
  assert.deepEqual(plain(A.readDraftsFile('{x} is the set.', 'set.txt')).drafts, [{ name: 'set', text: '{x} is the set.' }]);
  assert.match(A.readDraftsFile('{"a": 1}', 'other.json').error, /not exported by Rebuttal Bench/);
  assert.match(A.readDraftsFile('{"format": "rebuttal-bench-drafts", "drafts": []}', 'x.json').error, /no drafts/);
  assert.match(A.readDraftsFile('PK\u0003\u0004\u0000\u0000', 'paper.docx').error, /not a text file/);
  // Every draft Export wrote comes back, however many.
  const many = { format: 'rebuttal-bench-drafts', drafts: Array.from({ length: 80 }, (_, i) => ({ name: 'D' + i, text: 't' + i })) };
  assert.equal(A.readDraftsFile(JSON.stringify(many), 'x.json').drafts.length, 80);
  // A Markdown or text file is one draft, even when its text is JSON, or an export.
  for (const text of ['{"score": 4}', JSON.stringify(many)]) {
    assert.deepEqual(plain(A.readDraftsFile(text, 'A.md')), { drafts: [{ name: 'A', text }], error: null });
  }
  assert.match(A.readDraftsFile(JSON.stringify({ ...many, version: 2 }), 'x.json').error, /newer version/);
  const odd = { format: 'rebuttal-bench-drafts', drafts: [{ name: 7, text: 'kept' }, { name: 'no text' }, null, { name: ' Spaced\tname ', text: 'a\r\nb' }] };
  assert.deepEqual(plain(A.readDraftsFile(JSON.stringify(odd), 'x.json')).drafts,
    [{ name: 'Imported', text: 'kept' }, { name: 'Spaced name', text: 'a\nb' }]);
});

test('an import adds only new texts, under names no draft has, and replaces nothing', () => {
  const existing = [{ name: 'Draft 1', text: 'mine' }, { name: 'Reviewer aBcD', text: 'answer' }];
  const plan = plain(A.importPlan(existing, [
    { name: 'Reviewer aBcD', text: 'answer' },     // already here
    { name: 'Reviewer aBcD', text: 'other answer' }, // same name, new text
    { name: 'reviewer abcd', text: 'third' },       // names compare without case
    { name: 'General', text: 'g' },
    { name: 'General', text: 'g' },                  // twice in the file
  ]));
  assert.deepEqual(plan, {
    add: [
      { name: 'Reviewer aBcD (2)', text: 'other answer' },
      { name: 'reviewer abcd (3)', text: 'third' },
      { name: 'General', text: 'g' },
    ],
    same: 2,
    sameIn: ['', ''], // the paper (scope) each draft already here is in
  });
  // A draft whose text is not known here keeps its name but matches no text.
  assert.deepEqual(plain(A.importPlan([{ name: 'B', text: null }], [{ name: 'B', text: 'null' }, { name: 'X', text: '' }])),
    { add: [{ name: 'B (2)', text: 'null' }, { name: 'X', text: '' }], same: 0, sameIn: [] });
  // Texts that look like object keys are ordinary texts.
  assert.equal(A.importPlan([], [{ name: 'x', text: '__proto__' }, { name: 'y', text: 'constructor' }]).add.length, 2);
});
