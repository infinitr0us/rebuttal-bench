'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAnalyzer } = require('./lib/page');

const { diffWords } = loadAnalyzer();
function diff(a, b, mode = 'words') {
  const details = {};
  const runs = Array.from(diffWords(a, b, details), ({ op, text }) => [op, text]);
  assert.equal(details.mode, mode);
  assert.equal(runs.filter(([op]) => op !== 'ins').map(([, s]) => s).join(''), a);
  assert.equal(runs.filter(([op]) => op !== 'del').map(([, s]) => s).join(''), b);
  runs.forEach(([op, text], i) => {
    assert.ok(['same', 'del', 'ins'].includes(op) && text.length > 0);
    if (i) assert.notEqual(runs[i - 1][0], op);
  });
  return runs;
}

test('word runs preserve empty inputs, punctuation, whitespace and entire TeX commands', () => {
  assert.deepEqual(diff('', ''), []);
  assert.deepEqual(diff('', '  x!'), [['ins', '  x!']]);
  assert.deepEqual(diff('x\t', ''), [['del', 'x\t']]);
  assert.deepEqual(diff('word', 'word'), [['same', 'word']]);
  assert.deepEqual(diff('A quick, brown fox.', 'A small, brown fox!'), [
    ['same', 'A '], ['del', 'quick'], ['ins', 'small'], ['same', ', brown fox'], ['del', '.'], ['ins', '!'],
  ]);
  assert.deepEqual(diff('$\\alpha$', '$\\beta$'), [
    ['same', '$'], ['del', '\\alpha'], ['ins', '\\beta'], ['same', '$'],
  ]);
  assert.deepEqual(diff('résumé\r\n  yes', 'résumer\n  yes'), [
    ['del', 'résumé\r\n  '], ['ins', 'résumer\n  '], ['same', 'yes'],
  ]);
  assert.deepEqual(diff('1🐈2', '1🐕2'), [
    ['same', '1'], ['del', '🐈'], ['ins', '🐕'], ['same', '2'],
  ]);
});

test('both originals survive random edits, including repeated words and unusual line endings', () => {
  const parts = ['yes', 'α', 'A2', '_', '$', '\\gamma', '\r\n', '\r', '\n', '\u2028', '\u2029',
    '    ', '\t', '1', '!', '🐈', '\ud800', '<ins>', 'é', 'e\u0301', ''];
  let seed = 137;
  function random(max) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % max;
  }
  function part() { return parts[random(parts.length)]; }
  for (let i = 0; i < 600; i++) {
    const before = Array.from({ length: random(60) }, part);
    const after = before.slice();
    for (let j = 0; j < 8; j++) after.splice(random(after.length + 1), random(5), part(), part());
    diff(before.join(''), after.join(''));
  }
});

test('20,000-character drafts hit bounded word and line fallbacks and local edits stay precise', () => {
  const start = performance.now();
  const x = 'a '.repeat(4900), y = 'b '.repeat(4900);
  assert.deepEqual(diff(x + '\r\nkeep\u2028' + x, y + '\r\nkeep\u2028' + y, 'lines'), [
    ['del', x + '\r\n'], ['ins', y + '\r\n'], ['same', 'keep\u2028'], ['del', x], ['ins', y],
  ]);
  const a = 'a\n'.repeat(10000), b = 'b\n'.repeat(10000);
  assert.deepEqual(diff(a, b, 'replacement'), [['del', a], ['ins', b]]);
  assert.deepEqual(diff(a + 'left', a + 'right'), [['same', a], ['del', 'left'], ['ins', 'right']]);
  assert.ok(performance.now() - start < 1500, 'bounded fallback should finish within 1.5 seconds');
});
