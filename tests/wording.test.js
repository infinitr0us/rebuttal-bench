'use strict';
// Wording hints (wordingHints): advice on shorter phrasing for a draft over
// the limit. Never applied; only the author's own visible prose counts.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAnalyzer } = require('./lib/page');

const A = loadAnalyzer();
const plain = (x) => JSON.parse(JSON.stringify(x)); // VM-realm objects to plain ones
const hints = (text) => plain(A.wordingHints(text));
const texts = (text) => hints(text).hints.map((h) => h.kind + ':' + h.text + '>' + h.say);

test('filler phrases: one hint per phrase, every use located, savings counted', () => {
  const text = 'We would like to thank the reviewer. In order to answer, and in order to be brief, ' +
    'we note that due to the fact that the data is small, a large number of runs are able to finish.';
  const r = hints(text);
  const byText = Object.fromEntries(r.hints.map((h) => [h.text.toLowerCase(), h]));
  assert.deepEqual(byText['in order to'].at.map((x) => text.slice(x.start, x.end)), ['In order to', 'in order to']);
  assert.equal(byText['in order to'].saves, 2 * ('in order to'.length - 'to'.length));
  assert.equal(byText['due to the fact that'].say, 'because');
  assert.equal(byText['would like to'].say, '');
  assert.equal(byText['would like to'].saves, 'would like to '.length);
  assert.equal(byText['a large number of'].say, 'many');
  assert.equal(byText['are able to'].say, 'can');
  assert.equal(r.saves, r.hints.reduce((n, h) => n + h.saves, 0));
  // Biggest savings first.
  assert.deepEqual(r.hints.map((h) => h.saves), r.hints.map((h) => h.saves).slice().sort((a, b) => b - a));
});

test('only the author’s visible prose: not code, math, quotes, HTML or link syntax', () => {
  for (const text of [
    'Use `in order to` here.',
    '```\nin order to\n```',
    '$\\text{in order to}$ and $$\\text{due to the fact that}$$',
    '> In order to be fair, the reviewer wrote this.',
    '<div>in order to</div>',
    '[link](https://x.org/in-order-to "in order to")',
    '![in order to](/images/a.png)',
    '[ref]: https://x.org "in order to"',
  ]) {
    assert.deepEqual(texts(text).filter((t) => t.startsWith('filler')), [], text);
  }
  // Visible link text is the author's prose.
  assert.deepEqual(texts('See [in order to](https://x.org).'), ['filler:in order to>to']);
});

test('near misses are not fillers', () => {
  for (const text of [
    'We would like to-do lists.', // "would like to" before a non-letter
    'The order to the left.',
    'Gradients with respect to the input.', // deliberately not a hint
    'They are able-bodied.',
    'Whether or no.',
  ]) {
    assert.deepEqual(texts(text).filter((t) => t.startsWith('filler')), [], text);
  }
});

test('review 2026-11-25: no hint that changes the meaning, none in code a list indents with tabs', () => {
  for (const text of [
    'We would like to release the data, but the license prohibits it.',
    'We keep a validation set whether or not labels are available.',
  ]) {
    assert.deepEqual(texts(text), [], text);
  }
  assert.deepEqual(texts('We would like to clarify the setup.'), ['filler:would like to>']);
  // A fence in a list item indented with a tab: Marked expands the tab, so its token is not found.
  const tabbed = '- Reproduction steps:\n\n\t```python\n\t# in order to reproduce\n\t```\n\nWe ran it in order to test.';
  const h = hints(tabbed).hints.filter((x) => x.text.toLowerCase() === 'in order to');
  assert.equal(h.length, 1);
  assert.deepEqual(h[0].at.map((x) => x.start), [tabbed.lastIndexOf('in order to')]);
  // An abbreviation seen only in a link's address is not defined for the reader.
  const g = hints('Graph Neural Network a. Graph Neural Network b. Graph Neural Network c. [see](https://x.org/GNN)')
    .hints.find((x) => x.kind === 'name');
  assert.equal(g.defined, false);
});

test('a long name used three times or more: an abbreviation of its capitals', () => {
  const name = 'Contrastive Language-Image Pre-training';
  const text = `We compare with ${name}. Unlike ${name}, ours is small. ${name} is strong, and ${name} is slow.`;
  const r = hints(text);
  const h = r.hints.find((x) => x.kind === 'name');
  assert.equal(h.text, name);
  assert.equal(h.say, 'CLIP');
  assert.equal(h.at.length, 4);
  assert.equal(h.defined, false);
  assert.equal(h.saves, 3 * (name.length - 4) - (4 + 3));
  // Once the text defines it, no definition is counted.
  const d = hints(`${text} We call it CLIP.`).hints.find((x) => x.kind === 'name');
  assert.equal(d.defined, true);
  assert.equal(d.saves, 3 * (name.length - 4));
  // Connectors inside a name, and a sentence that starts with "The".
  const g = hints('The Graph Neural Network of Choice works. Graph Neural Network of Choice is good. We like Graph Neural Network of Choice.')
    .hints.find((x) => x.kind === 'name');
  assert.equal(g.text, 'Graph Neural Network of Choice');
  assert.equal(g.say, 'GNNC');
});

test('names: too short, too rare, part of a longer name, or hidden are not hints', () => {
  assert.deepEqual(texts('Deep Nets. Deep Nets. Deep Nets. Deep Nets.'), [], 'under 16 characters');
  assert.deepEqual(texts('Graph Neural Network here, Graph Neural Network there.'), [], 'twice only');
  // The shorter name inside the longer one, used as often, is the same advice.
  const long = 'Large Graph Neural Network';
  const both = texts(`${long} a. ${long} b. ${long} c. ${long} d.`).filter((t) => t.startsWith('name'));
  assert.deepEqual(both, [`name:${long}>LGNN`]);
  // In code or math it is not prose.
  assert.deepEqual(texts('`Graph Neural Network` `Graph Neural Network` `Graph Neural Network` `Graph Neural Network`'), []);
  // A whole-word use only.
  assert.equal(hints('Graph Neural Networks, Graph Neural Networks, Graph Neural Network, Graph Neural Network.')
    .hints.filter((h) => h.text === 'Graph Neural Network').length, 0);
});

test('nothing throws, and empty input has no hints', () => {
  for (const odd of [null, undefined, 42, '', '   ', '\u0000', '$', '**', 'A B C D E F G H I J K L M N O P']) {
    assert.doesNotThrow(() => A.wordingHints(odd));
  }
  assert.deepEqual(hints(''), { hints: [], saves: 0 });
});
