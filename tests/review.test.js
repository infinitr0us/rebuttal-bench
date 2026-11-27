'use strict';
// A review's points (reviewPoints) and how a draft covers them
// (reviewCoverage): reviews as copied from the OpenReview forum of several
// venues, the reviewer's own labels, and texts with no field names.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAnalyzer } = require('./lib/page');

const A = loadAnalyzer();
const plain = (x) => JSON.parse(JSON.stringify(x)); // VM-realm objects to plain ones
const points = (text) => plain(A.reviewPoints(text).points).map((p) => [p.label, p.field, p.excerpt]);

const ICLR = [
  'Official Review of Submission4127 by Reviewer k9F2',
  'Official Review by Reviewer k9F2 05 Nov 2026, 10:12',
  'Summary:',
  'The paper proposes a routing method for mixture-of-experts models.',
  'Soundness: 3: good',
  'Presentation: 2: fair',
  'Contribution: 2: fair',
  'Strengths:',
  '1. Clear writing.',
  '2. Strong results on two benchmarks.',
  'Weaknesses:',
  'The paper has the following weaknesses:',
  '1. The method lacks ablations on the number of experts. In particular, Table 2 only uses 8.',
  '2. Missing comparison with Switch Transformer.',
  '   - especially at the 1B scale',
  '3. The notation in Section 3 is inconsistent.',
  'Questions:',
  '- How does the router behave with 64 experts?',
  '- Why is the load-balancing loss weighted by 0.01?',
  'Flag For Ethics Review: No ethics review needed.',
  'Rating: 4: marginally below the acceptance threshold',
  'Confidence: 4: You are confident in your assessment.',
  'Code Of Conduct: Yes',
].join('\n');

test('an ICLR review copied from the forum: weaknesses and questions become W and Q points', () => {
  const r = plain(A.reviewPoints(ICLR));
  assert.equal(r.reviewer, 'k9F2');
  assert.deepEqual(r.points.map((p) => [p.label, p.field, p.excerpt]), [
    ['W1', 'Weaknesses', 'The method lacks ablations on the number of experts.'],
    ['W2', 'Weaknesses', 'Missing comparison with Switch Transformer.'],
    ['W3', 'Weaknesses', 'The notation in Section 3 is inconsistent.'],
    ['Q1', 'Questions', 'How does the router behave with 64 experts?'],
    ['Q2', 'Questions', 'Why is the load-balancing loss weighted by 0.01?'],
  ]);
  // A nested bullet belongs to its item; offsets point at the point's text.
  const w2 = r.points[1];
  assert.equal(ICLR.slice(w2.start, w2.end), 'Missing comparison with Switch Transformer.\n   - especially at the 1B scale');
});

test('NeurIPS: score fields are skipped, a "Clarity:" paragraph inside the weaknesses stays a point', () => {
  const text = [
    'Summary: A new benchmark for long-context retrieval.',
    'Strengths And Weaknesses:',
    'The benchmark is useful.',
    '',
    'Clarity: the construction of the distractor set in Section 4 is never explained in enough detail.',
    '',
    'The evaluation uses only two model families.',
    'Quality: 2: fair',
    'Clarity: 3: good',
    'Questions:',
    'Could you report variance over seeds? Also, which tokenizer was used?',
    'Limitations: yes',
    'Rating: 4: Borderline accept',
  ].join('\n');
  assert.deepEqual(points(text), [
    ['W1', 'Strengths And Weaknesses', 'The benchmark is useful.'],
    ['W2', 'Strengths And Weaknesses', 'Clarity: the construction of the distractor set in Section 4 is never explained in enough detail.'],
    ['W3', 'Strengths And Weaknesses', 'The evaluation uses only two model families.'],
    ['Q1', 'Questions', 'Could you report variance over seeds?'],
  ]);
});

test('ICML and ARR field names, the reviewer’s own labels, and bold field names', () => {
  const icml = [
    '**Claims And Evidence:** The claim of linear scaling rests on three points only.',
    '**Experimental Designs Or Analyses:**',
    'W2: No confidence intervals.',
    'W5. The baselines are untuned.',
    'W5. Duplicate label from the reviewer.',
    '**Questions For Authors:**',
    'Q1) Does it work for vision?',
    '**Other Comments Or Suggestions:** Typo in Eq. 3.',
    '**Overall Recommendation:** 3',
  ].join('\n');
  assert.deepEqual(points(icml).map((p) => p.slice(0, 2)), [
    ['W1', 'Claims And Evidence'], ['W2', 'Experimental Designs Or Analyses'], ['W5', 'Experimental Designs Or Analyses'],
    ['W6', 'Experimental Designs Or Analyses'], ['Q1', 'Questions For Authors'], ['C1', 'Other Comments Or Suggestions'],
  ]);
  const arr = 'Paper Summary:\nA parser.\n\nSummary Of Weaknesses:\n- Small data.\n- No human evaluation.\n\nComments Suggestions And Typos:\nNone.';
  assert.deepEqual(points(arr).map((p) => p[0] + ' ' + p[2]), ['W1 Small data.', 'W2 No human evaluation.']);
});

test('a text with no field names is one field of weaknesses, cut at its items or paragraphs', () => {
  assert.deepEqual(points('1. No ablation.\n2. Unclear notation.').map((p) => p[0] + ' ' + p[2]),
    ['W1 No ablation.', 'W2 Unclear notation.']);
  assert.deepEqual(points('The idea is nice.\n\nBut the experiments are small.').map((p) => p[0]),
    ['W1', 'W2']);
  // "Summary" in a sentence is no field name.
  assert.deepEqual(points('Summary of my concerns is below.\n\n1. Small data.').map((p) => p[0] + ' ' + p[2]),
    ['W1 Small data.']);
});

test('empty, odd and huge inputs do not throw', () => {
  for (const text of ['', '   ', 'Weaknesses:', 'Weaknesses:\n\n', 'Rating: 3', '-\n*\n1.', '\u0000', 'Questions:\nN/A']) {
    assert.deepEqual(points(text), [], JSON.stringify(text));
  }
  assert.equal(points('Weaknesses:\n' + '- point number x.\n'.repeat(400)).length, 400);
  assert.deepEqual(plain(A.reviewPoints(undefined)), { reviewer: null, points: [] });
});

test('coverage: a labelled part, a quote of the point, or nothing', () => {
  const ps = A.reviewPoints(ICLR).points;
  const draft = [
    'We thank the reviewer.',
    '',
    '**W1.** We added the ablation (Table 5).',
    '',
    '> Missing comparison with Switch Transformer, especially at 1B.',
    '',
    'We now compare with it.',
    '',
    '**Q2:** It keeps the experts balanced.',
  ].join('\n');
  const cov = plain(A.reviewCoverage(ps, draft));
  assert.deepEqual(cov.map((c) => c.label + ' ' + c.status), ['W1 labelled', 'W2 quoted', 'W3 missing', 'Q1 missing', 'Q2 labelled']);
  assert.match(draft.slice(cov[0].start, cov[0].end), /^\*\*W1\.\*\* We added the ablation/);
  assert.match(draft.slice(cov[1].start, cov[1].end), /^Missing comparison with Switch Transf/);
  // "Weakness 3" in the draft is W3; one labelled part alone counts too.
  assert.deepEqual(plain(A.reviewCoverage(ps, 'Weakness 3: fixed.')).map((c) => c.status),
    ['missing', 'missing', 'labelled', 'missing', 'missing']);
  assert.deepEqual(plain(A.reviewCoverage(ps, '')).map((c) => c.status), ['missing', 'missing', 'missing', 'missing', 'missing']);
});
