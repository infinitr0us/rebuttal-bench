'use strict';
// Sections of a comment (commentSections): headings and labelled points, with
// the count of each the way the limit counts, for balancing a combined
// response.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAnalyzer } = require('./lib/page');

const A = loadAnalyzer();
const plain = (x) => JSON.parse(JSON.stringify(x)); // VM-realm objects to plain ones
const brief = (r) => r.sections.map((s) => [s.kind, s.level, s.title]);
const slice = (text, s) => text.slice(s.start, s.end).trim();

test('one heading per reviewer, points under each: nested counts that add up', () => {
  const text = [
    'We thank all reviewers.',
    '',
    '## Reviewer aBcD',
    '',
    '**W1.** The novelty is $x$.',
    '',
    'More on W1.',
    '',
    '**Q1:** Why?',
    '',
    '## Reviewer 9xY2',
    '',
    'Thanks.',
  ].join('\n');
  const r = plain(A.commentSections(text));
  assert.deepEqual(brief(r), [
    ['opening', 0, ''],
    ['heading', 0, 'Reviewer aBcD'],
    ['point', 1, 'W1. The novelty is $x$.'],
    ['point', 1, 'Q1: Why?'],
    ['heading', 0, 'Reviewer 9xY2'],
  ]);
  assert.equal(r.total, text.trim().length);
  for (const s of r.sections) assert.equal(s.chars, slice(text, s).length);
  // A point runs to the next section of any kind; a heading to the next of its level.
  assert.equal(slice(text, r.sections[2]), '**W1.** The novelty is $x$.\n\nMore on W1.');
  assert.ok(slice(text, r.sections[1]).endsWith('**Q1:** Why?'));
  assert.equal(slice(text, r.sections[4]), '## Reviewer 9xY2\n\nThanks.');
  // The opening and the top-level headings cover the comment.
  const top = r.sections.filter((s) => s.level === 0);
  assert.ok(top.reduce((n, s) => n + s.chars, 0) <= r.total);
});

test('deeper headings nest; a heading closes at its level or higher', () => {
  const text = '# A\n\n## A.1\n\ntext\n\n### A.1.a\n\nx\n\n## A.2\n\ny\n\n# B\n\nz';
  const r = plain(A.commentSections(text));
  assert.deepEqual(brief(r).map((b) => b.slice(1)), [[0, 'A'], [1, 'A.1'], [2, 'A.1.a'], [1, 'A.2'], [0, 'B']]);
  assert.equal(slice(text, r.sections[1]), '## A.1\n\ntext\n\n### A.1.a\n\nx');
  assert.equal(slice(text, r.sections[0]), text.slice(0, text.indexOf('# B')).trim());
  // Setext headings and closing hashes.
  const setext = plain(A.commentSections('Reviewer 1\n==========\n\na\n\nReviewer 2 ##\n---\n\nb\n\n## Reviewer 3 ##\n\nc'));
  assert.deepEqual(brief(setext).map((b) => b[2]), ['Reviewer 1', 'Reviewer 2 ##', 'Reviewer 3']);
});

test('labels: bold that ends in punctuation or stands alone, and point names', () => {
  const points = [
    '**W1.** Novelty.',
    '**Q2:** Why?',
    '**Reviewer aBcD**',
    '**W3** (novelty): answer.',
    '__Weakness 4.__ answer',
    'W5: answer.',
    'Q6. answer.',
    'Weakness 7: answer.',
    'Question 8) answer.',
    '[W9] answer.',
    '- **W10.** in a list item',
    '1. Comment 11: in an ordered list',
    '> **W12.** The reviewer wrote this.',
  ];
  const text = points.join('\n\n');
  const r = plain(A.commentSections(text));
  assert.equal(r.sections.length, points.length, JSON.stringify(brief(r)));
  assert.ok(r.sections.every((s) => s.kind === 'point' && s.level === 0));
  assert.equal(r.sections[10].title, 'W10. in a list item');
  assert.equal(r.sections[12].title, 'W12. The reviewer wrote this.');
});

test('not labels: bold that starts a sentence, words that only look like points, hidden headings', () => {
  for (const text of [
    '**We thank** the reviewer.\n\n**Our method** works well.',
    'Why 2: because.\n\nWhich: none.\n\nQuestions remain.',
    'One paragraph only.',
    '```\n# not a heading\n```\n\n    # indented code\n\n> # quoted heading',
    '',
  ]) {
    assert.equal(A.commentSections(text), null, JSON.stringify(text));
  }
  // A single section is no breakdown either; an opening before it makes two.
  assert.equal(A.commentSections('## Only one\n\ntext'), null);
  assert.equal(plain(A.commentSections('Hello.\n\n## Then one\n\ntext')).sections.length, 2);
});

test('list items each count, from their own start; blank text before is not an opening', () => {
  const text = '\n\n1. **W1.** first\n2. **W2.** second\n\n   more of the second\n3. plain third';
  const r = plain(A.commentSections(text));
  assert.deepEqual(brief(r).map((b) => b[2]), ['W1. first', 'W2. second']);
  assert.equal(slice(text, r.sections[1]), '2. **W2.** second\n\n   more of the second\n3. plain third');
  assert.equal(r.total, text.trim().length);
});

test('titles are short and plain; nothing throws on odd input', () => {
  const long = '## ' + 'Long heading '.repeat(10);
  const r = plain(A.commentSections(long + '\n\ntext\n\n## `code` and **bold** \\* title\n\nx'));
  assert.ok(r.sections[0].title.length <= 60 && r.sections[0].title.endsWith('…'));
  assert.equal(r.sections[1].title, 'code and bold \\* title');
  for (const odd of [null, undefined, 42, '\u0000', '#', '**', '**W1.**', '> ', '- ', '|a|\n|-|']) {
    assert.doesNotThrow(() => A.commentSections(odd));
  }
  // Counts are UTF-16 units, as OpenReview counts: an emoji is two.
  const emoji = plain(A.commentSections('**W1.** 😀\n\n**W2.** x'));
  assert.equal(emoji.sections[0].chars, '**W1.** 😀'.length);
});
