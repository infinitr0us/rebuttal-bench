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
    ['W1', 'Strengths And Weaknesses', 'Clarity: the construction of the distractor set in Section 4 is never explained in enough detail.'],
    ['W2', 'Strengths And Weaknesses', 'The evaluation uses only two model families.'],
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

const { JSDOM } = require('jsdom');
const rows = (text) => plain(A.reviewPoints(text).points).map(p => p.label + ' ' + p.text);

test('forum HTML keeps fields, item order, nested lists and paragraphs, including a selection without the outer div', () => {
  const field = (name, content) => '<div><strong class="note-content-field disable-tex-rendering">' + name +
    ':</strong><span style="display:inline"> </span><div class="note-content-value markdown-rendered">' + content + '</div></div>';
  const html = '<h4>Official Review by Reviewer g4H2</h4>' +
    field('Weaknesses', '<p>Two concerns:</p><ol><li>Missing <em>units</em>.<ul><li>Time axis</li></ul></li><li>Labels overlap.</li></ol>') +
    field('Questions', '<ul><li>Which run?</li><li>Why stop?</li></ul>') +
    field('Comments', '<p>Check the legend.</p><p>Show the axes.</p>');
  const text = A.readHtmlReview(new JSDOM(html).window.document);
  assert.equal(text, 'Official Review by Reviewer g4H2\nWeaknesses:\nTwo concerns:\n\n1. Missing units.\n  - Time axis\n2. Labels overlap.\n\nQuestions:\n- Which run?\n- Why stop?\n\nComments:\nCheck the legend.\n\nShow the axes.');
  assert.deepEqual(rows(text), ['W1 Missing units.\n  - Time axis', 'W2 Labels overlap.', 'Q1 Which run?', 'Q2 Why stop?', 'C1 Check the legend.', 'C2 Show the axes.']);
  assert.equal(A.readHtmlReview(new JSDOM('<ul><li>Clipboard from another app</li></ul>').window.document), null);
});

test('a plain forum selection separates items, drops list introductions, and keeps wrapped prose', () => {
  assert.deepEqual(rows('Questions:\nI have two questions:\nWhich axis shows time?\nHow many bins were used?\n\nWeaknesses:\nThe mask had a\nsharp edge.\nThe unit is missing.'), [
    'Q1 Which axis shows time?', 'Q2 How many bins were used?', 'W1 The mask had a\nsharp edge.', 'W2 The unit is missing.'
  ]);
});

test('fragmentary items, an independent paragraph before a list, and a nested list introduction', () => {
  assert.deepEqual(rows('Weaknesses:\nMissing units\nUnclear axes\n\nThis observation also needs an answer.\n1. Check the timing.\n- Check the indexing.'), [
    'W1 Missing units', 'W2 Unclear axes', 'W3 This observation also needs an answer.', 'W4 Check the timing.', 'W5 Check the indexing.'
  ]);
  assert.deepEqual(rows('Questions:\n- Please clarify:\n  - Which map?\n  - Which grid?'), ['Q1 Which map?', 'Q2 Which grid?']);
});

test('score and administrative fields bound concerns even with a long inline value or an unfamiliar field name', () => {
  assert.deepEqual(rows(['Weaknesses:', 'Minor: The axis has no unit.', 'Clarity: Which unit?', 'Rating: Borderline because this needs a better estimate of the error in the appendix.',
    'Questions: Why five bins?', 'Flag For Ethics Review: The committee has received a separate report covering the use of personal records.',
    'Limitations: Only one site.', 'Paper Formatting Concerns: None', 'Code Of Conduct Acknowledgement: Affirmed', 'Final Justification:', 'I retained my score.',
    'Comments: Add the table.', 'Dataset Access Declaration:', 'The form was signed.', 'Questions: Which fold?', 'Resource Availability Declaration: A full statement follows in the record.'].join('\n')), [
    'W1 Minor: The axis has no unit.', 'W2 Clarity: Which unit?', 'Q1 Why five bins?', 'L1 Only one site.', 'C1 Add the table.', 'Q2 Which fold?'
  ]);
});

test('EMNLP and ARR form fields preserve the requests in each category', () => {
  assert.deepEqual(rows(['Paper Topic And Main Contributions: A filter.', 'Reasons To Accept: Fast.', 'Reasons To Reject:', '1) No memory bound.', '2) Incomplete timing data.',
    'Questions For The Authors: Which clock?', 'Missing References: Cite the estimator.', 'Typos Grammar Style And Presentation Improvements: Fix column B.', 'Excitement: 4'].join('\n')), [
    'W1 No memory bound.', 'W2 Incomplete timing data.', 'Q1 Which clock?', 'C1 Cite the estimator.', 'C2 Fix column B.'
  ]);
});

test('TMLR form questions and impact answers bound the requested changes', () => {
  assert.deepEqual(rows(['Summary Of Contributions:', 'Weaknesses:', '- No timing data.',
    'Are the claims made in the submission supported by accurate, convincing and clear evidence?: No', 'Explain your answer above: This was discussed.',
    "Would at least some individuals in TMLR's audience be interested in knowing the findings of this paper?: Yes", 'Explain your answer above: Simulation researchers.',
    'Requested Changes:', 'Critical:', '1. Add a clock.', 'Would strengthen the work:', '2. Plot memory use.', 'Broader Impact Concerns: No concerns.'].join('\n')), [
    'W1 No timing data.', 'W2 Add a clock.', 'W3 Plot memory use.'
  ]);
});

test('ICML placeholders and unqualified endorsements do not become skeleton items', () => {
  assert.deepEqual(rows(['Claims And Evidence: The claims are well supported.', 'Methods And Evaluation Criteria: See below.',
    'Theoretical Claims: Does not apply.', 'Experimental Designs Or Analyses: N/A', 'Essential References Not Discussed: No', 'Other Strengths And Weaknesses:',
    'Strengths:', '- Well organized.', 'Weaknesses:', '- The paper is clear but the units are missing.',
    'Other Comments Or Suggestions: None.', 'Questions For Authors: See above.'].join('\n')), ['W1 The paper is clear but the units are missing.']);
});

test('limitations suppress whole acknowledgements while preserving qualified and short answers', () => {
  for (const value of ['Yes.', 'No', 'N/A', 'The limitations are discussed in the appendix.']) assert.deepEqual(rows('Limitations: ' + value), []);
  for (const value of ['Yes, but please move them into the main paper.', 'No results on human data.', 'One site.']) assert.deepEqual(rows('Limitations: ' + value), ['L1 ' + value]);
});

test('point offsets address the original CRLF review', () => {
  const text = 'Weaknesses:\r\n- Missing units.\r\n  In the map.\r\nQuestions: When exactly?';
  assert.deepEqual(plain(A.reviewPoints(text).points).map(p => text.slice(p.start, p.end)), ['Missing units.\r\n  In the map.', 'When exactly?']);
});

test('a question written entirely in Chinese is a point', () => {
  assert.deepEqual(rows('Questions:\n- 时间单位是什么？'), ['Q1 时间单位是什么？']);
});

test('review labels and skeleton labels use the same W/Q/L/C grammar', () => {
  const ps = A.reviewPoints('Weaknesses:\n(Weakness2) Small sample.\n**Q12.** Which year?\n[Limitation 4] One region.\nConcern #7: Fix the axis.\nC8. Adjust the key.\nL9: One season.').points;
  const names = ['W2', 'Q12', 'L4', 'C7', 'C8', 'L9'];
  assert.deepEqual(plain(ps.map(p => p.label)), names);
  for (const quotes of [true, false]) {
    const source = A.reviewSkeleton(ps, [], quotes).join('\n\n');
    const coverage = A.reviewCoverage(ps, source);
    assert.deepEqual(plain(coverage.map(c => c.status)), names.map(() => 'labelled'));
    assert.deepEqual(plain(A.reviewSkeleton(ps, coverage, quotes)), []);
  }
});

test('one heading may cover several labels and a subpart name never covers its parent', () => {
  const ps = A.reviewPoints('W2: Small sample.\nQuestion1: What unit?\nQ2: Which scale?').points;
  const heading = '### **(Weakness2, Question1)** Samples and units';
  const source = 'Opening\n\n' + heading + '\n\n### Q2a\nAn intermediate result.';
  const coverage = plain(A.reviewCoverage(ps, source));
  assert.deepEqual(coverage.map(c => c.status), ['labelled', 'labelled', 'missing']);
  assert.deepEqual(coverage.slice(0, 2).map(c => source.slice(c.start, c.end).trim()), [heading, heading]);
  for (const label of ['(Weakness2)', '[W2]', 'W2:', '**W2.**', 'Weakness 2']) {
    assert.equal(A.reviewCoverage(ps, label + '\n\nResponse.')[0].status, 'labelled', label);
  }
  for (const suffix of ['a', 'Budget', '三']) assert.equal(A.pointName('Q2' + suffix), null);
});

test('quote coverage disambiguates shared openings and accepts a complete short point', () => {
  const shared = 'Which sampling interval did the team use for ';
  const ps = A.reviewPoints('Questions:\n- ' + shared + 'the spring survey?\n- ' + shared + 'the autumn survey?\n- Any ice?').points;
  const draft = '> ' + shared + 'the autumn survey?\n\n> Any ice?';
  const cov = plain(A.reviewCoverage(ps, draft));
  assert.deepEqual(cov.map(c => c.status), ['missing', 'quoted', 'quoted']);
  assert.deepEqual(cov.slice(1).map(c => draft.slice(c.start, c.end)), [shared + 'the autumn survey?', 'Any ice?']);
});

test('only visible quote text counts, including the words of a link label', () => {
  const q = 'Where is the weather station located?', ps = A.reviewPoints('Questions: ' + q).points;
  for (const source of ['[site]: /unused "' + q + '"', '[site]: /somewhere "' + q + '"\n\n[Map][site]', '`' + q + '`',
    '~~~\n' + q + '\n~~~', '<!-- ' + q + ' -->', '[Answer](/map "' + q + '")']) {
    assert.equal(A.reviewCoverage(ps, source)[0].status, 'missing', source);
  }
  assert.equal(A.reviewCoverage(ps, '> [Where is](/map) the weather station located?')[0].status, 'quoted');
});

test('quote offsets survive case folding and CRLF before and inside the quote', () => {
  const ps = A.reviewPoints('Questions: Which location did you use?').points;
  const draft = 'İstanbul\r\n\r\n> Which location\r\n> did you use?';
  const c = A.reviewCoverage(ps, draft)[0];
  assert.equal(c.status, 'quoted');
  assert.equal(draft.slice(c.start, c.end), 'Which location\r\n> did you use?');
});
