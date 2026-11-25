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
  for (const odd of [null, undefined, 7, '']) assert.deepEqual(plain(A.blockSources(odd)), []);
  assert.doesNotThrow(() => A.blockSources('\u0000'));
});
