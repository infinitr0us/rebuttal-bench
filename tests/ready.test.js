'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAnalyzer } = require('./lib/page');

const A = loadAnalyzer();
const plain = (x) => JSON.parse(JSON.stringify(x));

const REVIEW = [
  'Official Review of Submission12 by Reviewer k9F2',
  '',
  'Weaknesses:',
  '- Missing ablation on batch size.',
  '- Unclear runtime overhead on large graphs.',
  '',
  'Questions:',
  '- Why is the loss weighted by 0.01?',
].join('\n');

test('draftReadiness marks a clean draft under the limit as ready', () => {
  const text = '  We thank the reviewer for the thoughtful comments. Our method achieves $x + y = 1$.  ';
  const r = plain(A.draftReadiness(text, { limit: 5000 }));
  assert.deepEqual(r, {
    chars: text.trim().length,
    limit: 5000,
    over: false,
    hazards: { err: 0, warn: 0, note: 0 },
    placeholders: 0,
    identity: 0,
    coverage: null,
    promises: { will: 0, done: 0 },
    ready: true,
  });
});

test('draftReadiness marks a draft over the limit as not ready, using trimmed length', () => {
  const padded = '   12345   ';
  const exact = plain(A.draftReadiness(padded, { limit: 5 }));
  assert.equal(exact.chars, 5);
  assert.equal(exact.over, false);
  assert.equal(exact.ready, true);

  const over = plain(A.draftReadiness('123456', { limit: 5 }));
  assert.equal(over.chars, 6);
  assert.equal(over.over, true);
  assert.equal(over.ready, false);

  const noLimit = plain(A.draftReadiness('123456', { limit: 0 }));
  assert.equal(noLimit.limit, 0);
  assert.equal(noLimit.over, false);
  assert.equal(noLimit.ready, true);
});

test('draftReadiness marks a draft with an error hazard as not ready, while warnings and notes still allow ready', () => {
  // A venue link ban produces an err hazard.
  const withErr = plain(A.draftReadiness('See https://example.org/code for results.', {
    limit: 5000,
    analyze: { venue: 'neurips' },
  }));
  assert.ok(withErr.hazards.err >= 1);
  assert.equal(withErr.ready, false);

  // LaTeX outside math produces a warn card, and h4 produces a note card; neither blocks ready.
  const withWarnAndNote = plain(A.draftReadiness('#### Small heading\n\nSee \\textbf{Table 1}.', { limit: 5000 }));
  assert.equal(withWarnAndNote.hazards.err, 0);
  assert.ok(withWarnAndNote.hazards.warn >= 1);
  assert.ok(withWarnAndNote.hazards.note >= 1);
  assert.equal(withWarnAndNote.placeholders, 0);
  assert.equal(withWarnAndNote.ready, true);
});

test('draftReadiness counts check 17 placeholders and marks the draft not ready', () => {
  const r = plain(A.draftReadiness('We will report TODO and value TBD shortly.', { limit: 5000 }));
  assert.equal(r.placeholders, 2);
  assert.ok(r.hazards.warn >= 2);
  assert.equal(r.ready, false);
});

test('draftReadiness counts check 21 identity matches and marks the draft not ready', () => {
  const opts = { limit: 5000, analyze: { identity: A.identityTerms('Jane Doe\nAcmeLab') } };
  const bad = plain(A.draftReadiness('Jane Doe ran the AcmeLab ablation.', opts));
  assert.equal(bad.identity, 2);
  assert.equal(bad.hazards.err, 2);
  assert.equal(bad.ready, false);

  const clean = plain(A.draftReadiness('We ran the ablation.', opts));
  assert.equal(clean.identity, 0);
  assert.equal(clean.ready, true);
});

test('draftReadiness computes review coverage and requires complete coverage when a review has points', () => {
  const partial = plain(A.draftReadiness('**W1.** We added the batch size ablation.\n\n**Q1.** Because 0.01 balances both terms.', {
    limit: 5000,
    review: REVIEW,
  }));
  assert.deepEqual(partial.coverage, { covered: 2, total: 3 });
  assert.equal(partial.ready, false);

  const full = plain(A.draftReadiness(
    '**W1.** We added the batch size ablation.\n\n> Unclear runtime overhead on large graphs.\n\nOverhead is 3%.\n\n**Q1.** Because 0.01 balances both terms.',
    { limit: 5000, review: REVIEW }
  ));
  assert.deepEqual(full.coverage, { covered: 3, total: 3 });
  assert.equal(full.ready, true);

  // A review without extractable points has null coverage and does not block readiness.
  const noPoints = plain(A.draftReadiness('Thank you for the positive review.', {
    limit: 5000,
    review: 'Summary:\nNice paper.\n\nWeaknesses:\nNone.',
  }));
  assert.equal(noPoints.coverage, null);
  assert.equal(noPoints.ready, true);
});

test('draftReadiness counts promises by kind without blocking readiness', () => {
  const text = 'We will add the seed sweep to the appendix. We will release our code and weights. We have revised Section 3 accordingly.';
  const r = plain(A.draftReadiness(text, { limit: 5000 }));
  assert.deepEqual(r.promises, { will: 2, done: 1 });
  assert.equal(r.ready, true);
});

test('draftReadiness tolerates empty and non-string inputs without throwing', () => {
  for (const v of [null, undefined, 42, '']) {
    const r = plain(A.draftReadiness(v));
    assert.equal(r.chars, 0);
    assert.equal(r.limit, 0);
    assert.equal(r.over, false);
    assert.equal(r.coverage, null);
    assert.equal(r.ready, true);
  }
});
