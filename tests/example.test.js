'use strict';
// The built-in example is the first thing a new user sees: it must show real
// hazards, and Fix all must turn it into a clean comment with every formula
// typeset without TeX errors.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAnalyzer, readExample } = require('./lib/page');
const { renderLikeOpenReview } = require('./lib/pipeline');

const A = loadAnalyzer();
const EXAMPLE = readExample();

test('example demonstrates hazards', () => {
  const res = A.analyze(EXAMPLE);
  assert.ok(res.issues.length >= 10, 'expected a dozen deliberate hazards, got ' + res.issues.length);
  assert.ok(res.issues.every((i) => i.fix), 'every example hazard should be fixable in one click');
});

test('Fix all leaves the example hazard-free and fully typeset', () => {
  const { text } = A.fixAllText(EXAMPLE);
  assert.deepEqual([...A.analyze(text).issues].map((i) => i.title), []); // spread: VM-realm array
  const items = renderLikeOpenReview(text).items;
  assert.equal(items.length, 6, 'six formulas: ' + JSON.stringify(items.map((i) => i.tex)));
  assert.deepEqual(items.filter((i) => i.err), [], 'no TeX errors');
  assert.equal(items.filter((i) => i.display).length, 2, 'two display formulas');
});
