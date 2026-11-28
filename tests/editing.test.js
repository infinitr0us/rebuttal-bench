'use strict';
// Tracing the preview back to the source (blockSources): one entry per
// element OpenReview renders at the top level, in order, with its tag.
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { loadAnalyzer, readExample } = require('./lib/page');
const { renderHtml } = require('./lib/pipeline');

const A = loadAnalyzer();
const plain = (x) => JSON.parse(JSON.stringify(x)); // VM-realm objects to plain ones
const renderedTags = (text) =>
  [...new JSDOM('<body>' + renderHtml(text) + '</body>').window.document.body.children].map((e) => e.tagName);

test('the blocks line up with the elements the preview shows', () => {
  for (const text of [
    readExample(),
    '# A\n\npara\n\n## B\nSetext\n===\n\n- a\n- b\n\n1. one\n\n> quote\n\n    code\n\n```\nfence\n```\n\n| a |\n|-|\n| 1 |\n\n---\n\n$$\nx\n$$',
    '<div>html block</div>\n\npara\n\n<!-- comment -->\n\n[a]: https://x.org\n\nafter [a]',
    'para\nlazy line\n> quote\nlazy\n\n- item\n\n  same item\n\n* other list',
    '![i](/images/a.png)\n\n<details>\n<summary>s</summary>\n\nbody\n</details>\n\nend',
  ]) {
    assert.deepEqual(plain(A.blockSources(text)).map((b) => b.tag), renderedTags(text), JSON.stringify(text.slice(0, 40)));
  }
});

test('each block is located at its own source, in order', () => {
  const text = 'Intro text.\n\n## Reviewer A\n\n- **W1.** answer\n- **W2.** answer\n\nIntro text.';
  const blocks = plain(A.blockSources(text));
  assert.deepEqual(blocks.map((b) => [b.tag, text.slice(b.start, b.end).trim()]), [
    ['P', 'Intro text.'],
    ['H2', '## Reviewer A'],
    ['UL', '- **W1.** answer\n- **W2.** answer'],
    ['P', 'Intro text.'],
  ]);
  // The repeated paragraph is found at its second place, not the first.
  assert.equal(blocks[3].start, text.lastIndexOf('Intro text.'));
  // Nor inside a link definition's title that repeats it.
  const def = '[a]: https://x.org "Same words"\n\nSame words';
  assert.deepEqual(plain(A.blockSources(def)).map((b) => b.start), [def.lastIndexOf('Same words')]);
  for (const odd of [null, undefined, 7, '']) assert.deepEqual(plain(A.blockSources(odd)), []);
  assert.doesNotThrow(() => A.blockSources('\u0000'));
});

test('findInText matches case sensitivity, non-overlapping and adjacent occurrences, and literal regex characters', () => {
  assert.deepEqual(plain(A.findInText('Alpha alpha ALPHA', 'alpha', false)), [
    { start: 0, end: 5 },
    { start: 6, end: 11 },
    { start: 12, end: 17 },
  ]);
  assert.deepEqual(plain(A.findInText('Alpha alpha ALPHA', 'alpha', true)), [
    { start: 6, end: 11 },
  ]);
  // Overlapping candidates do not overlap (matches replaceAll semantics); adjacent ones both match.
  assert.deepEqual(plain(A.findInText('aaa', 'aa', false)), [{ start: 0, end: 2 }]);
  assert.deepEqual(plain(A.findInText('aaaa', 'aa', false)), [
    { start: 0, end: 2 },
    { start: 2, end: 4 },
  ]);
  // Regex metacharacters are matched literally.
  const tex = 'Cost is $a+b$ (or [a.b]*?) and $a+b$.';
  assert.deepEqual(plain(A.findInText(tex, '$a+b$', false)), [
    { start: 8, end: 13 },
    { start: 31, end: 36 },
  ]);
  assert.deepEqual(plain(A.findInText(tex, '[a.b]*?', true)), [
    { start: 18, end: 25 },
  ]);
  for (const odd of [null, undefined, 7, '']) {
    assert.deepEqual(plain(A.findInText(odd, 'a', false)), []);
    assert.deepEqual(plain(A.findInText('abc', odd, false)), []);
  }
});
