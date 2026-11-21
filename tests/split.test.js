'use strict';
// Splitting a draft into several comments: parts under the limit, cut only
// where Markdown allows, nothing lost, and each part checked as the
// separate comment it will be (fresh TeX state, its own link definitions).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAnalyzer } = require('./lib/page');
const { renderHtml, typeset } = require('./lib/pipeline');

const A = loadAnalyzer();
const split = (src, limit, opts) => JSON.parse(JSON.stringify(A.splitComment(src, limit, opts)));
const body = (p) => p.text.replace(/^\(\d+\/\d+\)\n\n/, '');
// Every non-space character of the source, in order, across the parts.
const squash = (s) => s.replace(/\s+/g, '');

const sentence = (k) => `Sentence ${k} explains a point in enough words to take some room.`;
const para = (from, n) => Array.from({ length: n }, (_, i) => sentence(from + i)).join(' ');

test('a draft that fits stays one part, without a number', () => {
  const r = split('Short answer.\n\nAnother one.', 5000);
  assert.equal(r.parts.length, 1);
  assert.equal(r.parts[0].text, 'Short answer.\n\nAnother one.');
  assert.equal(r.over, 0);
});

test('parts are cut between blocks, numbered, and lose nothing', () => {
  const src = [para(1, 3), '## Q2', para(4, 3), '> A quoted reviewer point.', para(7, 3)].join('\n\n');
  const r = split(src, 450);
  assert.ok(r.parts.length >= 2, r.parts.length);
  r.parts.forEach((p, i) => {
    assert.ok(p.length <= 450, `part ${i + 1}: ${p.length}`);
    assert.ok(p.text.startsWith(`(${i + 1}/${r.parts.length})\n\n`));
  });
  assert.equal(squash(r.parts.map(body).join('')), squash(src));
  assert.equal(r.over, 0);
  assert.equal(split(src, 450, { label: false }).parts[0].text.startsWith('('), false);
});

test('a long table is cut between rows, with its header in every piece', () => {
  const rows = Array.from({ length: 30 }, (_, i) => `| Method ${i} | ${80 + i / 10} ± 0.${i % 10} |`);
  const src = '| Method | AUROC |\n| :--- | ---: |\n' + rows.join('\n');
  const r = split(src, 400);
  assert.ok(r.parts.length > 1);
  for (const p of r.parts) {
    assert.ok(p.length <= 400);
    assert.ok(body(p).startsWith('| Method | AUROC |\n| :--- | ---: |\n'));
    assert.match(renderHtml(p.text), /<table>[\s\S]*<th align="left">Method<\/th>/);
  }
  const allRows = r.parts.map((p) => body(p).split('\n').slice(2)).flat();
  assert.deepEqual(allRows, rows);
});

test('a long list is cut between items, and an ordered list keeps counting', () => {
  const items = Array.from({ length: 12 }, (_, i) => `${i + 1}. ${sentence(i)}`);
  const r = split(items.join('\n'), 300);
  assert.ok(r.parts.length > 1);
  const second = body(r.parts[1]);
  const n = parseInt(second, 10);
  assert.ok(n > 1, second.slice(0, 20));
  assert.match(renderHtml(second), new RegExp('<ol start="' + n + '">'));
  assert.equal(squash(r.parts.map(body).join('')), squash(items.join('\n')));
});

test('a long paragraph is cut between sentences, never inside a formula', () => {
  const src = para(1, 4) + ' We bound it by $a. B + c$ here. ' + para(5, 4);
  const r = split(src, 330);
  assert.ok(r.parts.length > 1);
  for (const p of r.parts) assert.doesNotMatch(body(p), /^B \+ c\$|\$a\.$/m);
  assert.deepEqual(r.parts.map((p) => typeset(p.text)).flat(), typeset(src));
});

test('a block that cannot be cut makes its part over the limit, and says so', () => {
  const code = '```\n' + 'x = 1\n'.repeat(80) + '```';
  const r = split('Intro.\n\n' + code, 300);
  assert.equal(r.over, 1);
  assert.ok(r.parts.some((p) => p.length > 300 && body(p).startsWith('```')));
});

test('macros and labels used across parts are reported', () => {
  const src = '$\\newcommand{\\E}{\\mathbb{E}}\\E[x]$ and $$x=1\\tag{1}\\label{eq:a}$$\n\n' + para(1, 6) +
    '\n\nSo $\\E[y]$ follows from \\eqref{eq:a}.';
  const r = split(src, 420);
  assert.ok(r.parts.length > 1);
  const msgs = r.warnings.map((w) => w.message).join('\n');
  assert.match(msgs, /uses \\E, defined in part 1/);
  assert.match(msgs, /refers to \\label\{eq:a\} in part 1/);
});

test('a link reference definition goes with every part that uses it', () => {
  const src = 'See [the logs][r]. ' + para(1, 5) + '\n\n' + para(6, 5) + ' Also [the logs][r].\n\n[r]: https://example.org/logs';
  const r = split(src, 450);
  assert.ok(r.parts.length > 1);
  for (const p of r.parts) {
    if (/\[r\]/.test(body(p).replace('[r]: ', ''))) assert.match(p.text, /\[r\]: https:\/\/example\.org\/logs/);
    assert.doesNotMatch(renderHtml(p.text), /\[r\]/); // every reference resolves
  }
});

test('no input makes it throw', () => {
  for (const src of ['', '\n\n', '| a |\n| - |', '- ', '```', '$$', 'a'.repeat(5000)]) {
    const r = split(src, 100);
    assert.ok(r && Array.isArray(r.parts) && r.parts.length >= 1, JSON.stringify(src));
  }
  assert.equal(A.splitComment('text', 0), null);
});
