'use strict';
// Reviewer IDs across drafts (reviewerIssues): a draft named for one reviewer
// that addresses another, an ID in other capitals than every tab's, and an
// explicit pointer into our answer to another reviewer naming a point label
// that draft does not have. Advice only, and only where it is unmistakable:
// the quiet cases include those from the two Codex reviews of 3.8
// (reviews/2026-11-27/codex-review-38 and codex-recheck-38), each a sentence
// a careful author writes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAnalyzer } = require('./lib/page');

const A = loadAnalyzer();
const plain = (x) => JSON.parse(JSON.stringify(x)); // VM-realm objects to plain ones
const tab = (name, text) => (text === undefined ? { name } : { name, text });
const AB = tab('Reviewer Ab12', '**W1.** We use five seeds.\n\n### Q2\n\nThe backbone is frozen.');
const FOUR = [tab('Reviewer Ab12'), tab('Reviewer Cd34'), tab('Reviewer x7Hz')];
const NUMBERED = ['R1', 'R3', 'R4'].map((n) => tab(n));
const SELF = 'Reviewer k9F2';
const cards = (text, self = SELF, others = FOUR) => plain(A.reviewerIssues(text, self, others))
  .map((i) => [i.title, text.slice(i.start, i.end)]);
const ADDRESS = 'This draft addresses another reviewer';
const CASE = 'Reviewer ID written differently from its tab';
const POINTER = 'Pointer to a point the other draft does not have';

test('whom a tab is for: an ID-shaped word after "Reviewer" or alone, or a whole-word number', () => {
  assert.deepEqual(plain(A.draftReviewer('Reviewer k9F2')), { ids: ['k9F2'], nums: [] });
  assert.deepEqual(plain(A.draftReviewer('Reviewer_AB12 follow-up')), { ids: ['AB12'], nums: [] });
  assert.deepEqual(plain(A.draftReviewer('R1 (Ab12)')), { ids: ['Ab12'], nums: [1] });
  assert.deepEqual(plain(A.draftReviewer('Reviewer #3')), { ids: [], nums: [3] });
  // A digit-leading ID is no number, and an ID that starts with R and a digit is no R-number.
  assert.deepEqual(plain(A.draftReviewer('Reviewer 2AbC')), { ids: ['2AbC'], nums: [] });
  assert.deepEqual(plain(A.draftReviewer('R2bX')), { ids: ['R2bX'], nums: [] });
  for (const name of ['General response', 'Plan', 'Draft 2026', 'Round 2', 'Answer to AC', 'Reviewer list',
    'ICLR 2027 – General response', 'GPT4 experiments – general response']) {
    assert.deepEqual(plain(A.draftReviewer(name)), { ids: [], nums: [] }, name);
  }
});

test('a copied salutation, "Response to" line or thanks for another reviewer gets a warning on the ID', () => {
  assert.deepEqual(cards('We thank Reviewer Ab12 for the careful review.\n\nW1: fixed.'), [[ADDRESS, 'Ab12']]);
  assert.deepEqual(cards('W1: fixed.\n\nThanks again, Reviewer Ab12!'), [[ADDRESS, 'Ab12']]);
  assert.deepEqual(cards('Thanks for the detailed assessment.\n\n## Response to Reviewer Ab12\n\nWe include the per-seed numbers here.'),
    [[ADDRESS, 'Ab12']]);
  assert.deepEqual(cards('Thanks.\n\n**Our response to Reviewer Ab12:**\n\nMore seeds.'), [[ADDRESS, 'Ab12']]);
  assert.deepEqual(cards('# Author response\n\nDear Reviewer Ab12, thank you for the careful reading.\n\nWe now report the per-seed scores.'),
    [[ADDRESS, 'Ab12']]);
  assert.deepEqual(cards('Dear Ab12, thank you for your review.'), [[ADDRESS, 'Ab12']]);
  // The selection covers the ID alone, so emphasis around it stays whole.
  assert.deepEqual(cards('Dear **Reviewer Ab12**, thank you.'), [[ADDRESS, 'Ab12']]);
  assert.deepEqual(cards('Dear Reviewer **Ab12**, thank you.'), [[ADDRESS, 'Ab12']]);
  assert.deepEqual(cards('Thanks, Reviewer\nAb12, for the suggestion.'), [[ADDRESS, 'Ab12']]);
  // Final recheck: a heading names its addressee whatever follows; a salutation followed by
  // another reviewer as the subject of the next clause still greets the first; thanks to one.
  for (const s of ['Thanks.\n\n## Reply to Reviewer Ab12: Calibration\n\nMore seeds.',
    'Thanks.\n\n## Response to Reviewer Ab12 ##\n\nMore seeds.',
    'Dear Reviewer Ab12, Reviewer k9F2 raised a related concern.',
    'We thank Reviewer Ab12 and appreciate the suggestion.']) {
    assert.deepEqual(cards(s), [[ADDRESS, 'Ab12']], s);
  }
  for (const [s, hit] of [['Dear R3, thank you for the review.', 'R3'], ['Dear Reviewer R3, thank you.', 'R3'],
    ['## Reply to Rev. 3', '3'], ['Dear Reviewer 3, thank you.', '3']]) {
    assert.deepEqual(cards(s, 'R2', NUMBERED), [[ADDRESS, hit]], s);
  }
});

test('the sentences of the two 3.8 reviews stay quiet', () => {
  for (const s of [
    'Thank you for raising the same concern as Reviewer Ab12.',
    'As Reviewer Ab12 also noted, we appreciate the importance of calibration.',
    'We thank Reviewers k9F2 and Ab12 for independently suggesting the same baseline.',
    'We thank Reviewer Ab12 and Reviewer k9F2 for independently identifying the same issue.',
    'We thank Reviewer Ab12, Reviewer Cd34 and Reviewer k9F2.',
    'The review reads, “We thank Reviewer Ab12 for sharing the scores.”',
    'The review reads, "We thank Reviewer Ab12 for sharing the scores."',
    'The review reads, ‘We thank Reviewer Ab12 for sharing the scores.’',
    'The review reads, "We thank the reviewers,\nespecially Reviewer Ab12, for the scores."',
    'Reviewer Ab12 reports an effect for the gene `HI`.',
    'Dear Reviewer k9F2, as suggested by Reviewer Ab12 we now report per-site AUC.',
    'As requested by Reviewer Ab12, BERT is now included as a baseline.',
    'As we explained to Reviewer Ab12, Q1 2025 was the first held-out quarter.',
    'We see no contradiction between Reviewer Ab12’s Q9 and your assessment.',
    'Dear Reviewer k9F2,\n\nOur response to Reviewer Ab12 contains the full ablation table.\n\nBest regards.',
    '| Contributor | Comment |\n| --- | --- |\n| Reviewer Ab12 | We appreciate the baseline. |',
    '> We thank Reviewer Ab12 for the baseline suggestion.',
    'We thank the reviewer also for the typo.',
    'One concern was also raised by Reviewer Cd34, and Reviewer Zz99 agreed.',
    'Dear Reviewer k9F2, thank you.\n\nW1: as Reviewer Ab12 noted, we thank them as well.\n\nW2: more seeds.\n\nBest.',
    // From the final recheck (codex-final-38): joint thanks across a soft break or with
    // "as well as", quotes after an apostrophe or in straight single quotes, a wrapped pointer.
    'We thank Reviewer Ab12\nand Reviewer k9F2 for independently suggesting the same baseline.',
    'We thank Reviewer Ab12 as well as Reviewer k9F2 for suggesting the same baseline.',
    'We thank Reviewer Ab12 and the other reviewers for their constructive feedback.',
    'Following the reviewers’ suggestion, we changed the example to ‘We thank Reviewer Ab12 for the feedback.’',
    'The example now reads, \'We thank Reviewer Ab12 for the feedback.\'',
    'Dear Reviewer k9F2,\n\nOur response to Reviewer Ab12\ncontains the full ablation table.\n\nBest regards.',
    'Dear Reviewer k9F2,\n\nFor the complete calculation, see our\nresponse to Reviewer Ab12.\n\nBest regards.',
  ]) assert.deepEqual(cards(s), [], s);
  assert.deepEqual(cards('We thank Reviewer 3 and 2 for independently suggesting this baseline.', 'R2', NUMBERED), []);
  // General tabs, whatever they name; numbering schemes are not compared with IDs.
  for (const name of ['ICLR 2027 – General response', 'GPT4 experiments – general response', 'Reviewer list']) {
    assert.deepEqual(cards('Dear Reviewer Ab12, we thank all four reviewers.', name), [], name);
  }
  assert.deepEqual(cards('Dear Reviewer 1, thank you for the suggestion.', SELF, [tab('R1'), tab('R2')]), []);
  assert.deepEqual(cards('Dear Reviewer 2, we appreciate the review.', 'Reviewer 2AbC', [tab('R2')]), []);
  assert.deepEqual(cards('Dear Reviewer 2, we reply with the requested table.', 'R2bX', [tab('Reviewer 2')]), []);
  assert.deepEqual(cards('Thank you, Reviewer 2.\n\nThe R2 score improves from 0.78 to 0.84. Reviewer 1 suggested it.', 'R2', NUMBERED), []);
  assert.deepEqual(cards('We thank Reviewers 2 and 4 for their time.', 'R2', NUMBERED), []);
});

test('an ID in other capitals than every tab is another ID to OpenReview', () => {
  assert.deepEqual(cards('W1: as for Reviewer k9f2, we agree.', 'Reviewer Ab12', [tab(SELF)]), [[CASE, 'k9f2']]);
  assert.deepEqual(cards('We thank Reviewers Ab12 and cd34.', 'General', FOUR), [[CASE, 'cd34']]);
  assert.deepEqual(cards('Dear Reviewer k9f2, thank you.'), [[CASE, 'k9f2']]);
  // A spelling that one tab uses exactly is right, whatever another tab writes.
  assert.deepEqual(cards('Dear Reviewer Ab12, thank you.', 'Reviewer Ab12', [tab('Reviewer ab12 (follow-up)')]), []);
});

test('the fixtures as named and as general drafts, and mixed input, give no cards and never throw', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = path.join(__dirname, 'fixtures');
  for (const name of fs.readdirSync(dir)) {
    const text = fs.readFileSync(path.join(dir, name), 'utf8').trim();
    assert.deepEqual(cards(text), [], name);
    assert.deepEqual(cards(text, 'General', [tab(SELF), ...FOUR]), [], name);
  }
  const atoms = ['Reviewer', ' Reviewers ', 'Ab12', '\r\n', '\n\n', '[', ']', '(', ')', '<', '>', 'Q9', ' thanks ', 'Dear ', ' and ',
    '🧪', '\u0000', '\ud800', '$', '`', '|', '*', '#', '  ', '_', '::', '“', '‘', '"', 'Response to '];
  let seed = 2689;
  const pick = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  for (let i = 0; i < 500; i++) {
    let text = 'Reviewer Ab12 ';
    const n = 4 + pick(45);
    for (let j = 0; j < n; j++) text += atoms[pick(atoms.length)];
    text = text.trim();
    for (const c of A.reviewerIssues(text, SELF, FOUR)) {
      assert.ok(c.start >= 0 && c.end > c.start && c.end <= text.length, JSON.stringify(text));
      assert.equal(c.fix, null);
    }
  }
  for (const text of ['', '   ', 'Reviewer', 'reviewer reviewer reviewers', '$$\nReviewer Ab12\n$$', 'Reviewer\u0000Ab12']) {
    assert.deepEqual(cards(text), [], JSON.stringify(text));
  }
  assert.deepEqual(plain(A.reviewerIssues('We thank Reviewer Ab12.', undefined, undefined)), []);
  assert.deepEqual(cards('We thank Reviewer Ab12.', SELF, [null, {}]), [[ADDRESS, 'Ab12']]);
});

test('explicit pointers to a missing point in our answer to another reviewer get one warn card on the label', () => {
  const others = [AB, tab('Reviewer Cd34', 'Weakness 1: seeds.\n\nComment 1: typo.')];
  for (const [s, hit] of [
    ['For calibration, see our answer to Reviewer Ab12, Q9.', 'Q9'],
    ['Please refer to our response to Reviewer Ab12, Q9 for more details.', 'Q9'],
    ['Please refer to the response to Reviewer Ab12, Q9 for more details.', 'Q9'],
    ['Cf. our reply to Reviewer Ab12, **Q9**.', 'Q9'],
    ['For the ablation, see our response to Reviewer Ab12 (W1 and Q3).', 'Q3'],
    ['See our answer to Reviewer Ab12\'s Q9 for the table.', 'Q9'],
    ['See our answer to Reviewer Ab12’s Limitation 2.', 'Limitation 2'],
    ['As answered in our response to Reviewer Ab12, Q9, we use five seeds.', 'Q9'],
    ['As we answered in our reply to Reviewer Ab12 (W1 and Q9), calibration improves.', 'Q9'],
    ['As discussed in our answer to Reviewer Ab12’s Q9, the backbone is frozen.', 'Q9'],
    ['See Q9 of our response to Reviewer Ab12 for the ablation.', 'Q9'],
    ['Refer to W1 and Q3 in our answer to Reviewer Ab12.', 'Q3'],
    ['See questions 2 and 9 of our reply to Reviewer Ab12.', '9'],
    ['See our answer to Reviewer Ab12, questions 2 and 9, for our ablations.', '9'],
    ['Please refer to our response to Q9 from Reviewer Ab12.', 'Q9'],
    ['See our response to Reviewer Cd34, Comment 2.', 'Comment 2'],
    ['See our response to Reviewer Ab12: L1.', 'L1'],
    ['See also our **response to Reviewer Ab12**, Q9.', 'Q9'],
  ]) {
    const res = plain(A.reviewerIssues(s, SELF, others));
    assert.deepEqual(res.map((i) => [i.sev, i.title, s.slice(i.start, i.end), i.fix]),
      [['warn', POINTER, hit, null]], s);
    assert.ok(res[0].detail.includes('Reviewer Ab12') || res[0].detail.includes('Reviewer Cd34'), s);
    if (res[0].detail.includes('Reviewer Ab12')) {
      assert.ok(res[0].detail.includes('W1, Q2'), res[0].detail);
    } else {
      assert.ok(res[0].detail.includes('W1, C1'), res[0].detail);
    }
  }
  // General response tabs and numbered reviewer tabs also check explicit pointers.
  assert.deepEqual(cards('See our response to Reviewer Ab12, Q9.', 'General response', others), [[POINTER, 'Q9']]);
  assert.deepEqual(cards('See our answer to Reviewer 3, Q9.', 'R2', [tab('R3', '**W1.** Seeds.\n\n**Q2:** Frozen.')]),
    [[POINTER, 'Q9']]);
  assert.deepEqual(cards('See Q9 of our reply to R3.', 'R2', [tab('Reviewer 3', '**W1.** Seeds.')]),
    [[POINTER, 'Q9']]);
});

test('pointers to labels the other draft has (in any labelledParts form), unread or unlabelled drafts stay quiet', () => {
  const combined = tab('Reviewer Ab12', [
    '## Questions 2 and 9',
    '',
    'Detailed answer.',
    '',
    '## W1 and W2: Seed sweep',
    '',
    'Five seeds.',
    '',
    '(Weakness3, Question1) Combined note.',
    '',
    'Weakness 4: Extra baseline.',
    '',
    '### Limitations 1 and 2',
    '',
    'Scope.',
    '',
    '**C1.** Typo fixed.',
  ].join('\n'));
  for (const s of [
    'See our answer to Reviewer Ab12, Q9.',
    'See our answer to Reviewer Ab12, questions 2 and 9, for the ablation.',
    'See our response to Reviewer Ab12 (W1 and W2).',
    'See our reply to Reviewer Ab12’s Weakness 3.',
    'See Q1 of our response to Reviewer Ab12.',
    'Refer to our answer to Reviewer Ab12, W4.',
    'See our answer to Reviewer Ab12 (L1 and L2).',
    'See C1 of our response to Reviewer Ab12.',
    'Please refer to our response to Q9 from Reviewer Ab12.',
  ]) {
    assert.deepEqual(cards(s, SELF, [combined]), [], s);
  }
  // Labels spread across multiple tabs for the same reviewer count together.
  const multi = [
    tab('Reviewer Ab12', '**W1.** Seeds.'),
    tab('Reviewer Ab12 (follow-up)', '### Q9\n\nFollow-up table.'),
  ];
  assert.deepEqual(cards('See our answer to Reviewer Ab12, Q9.', SELF, multi), []);
  assert.deepEqual(cards('See our answer to Reviewer Ab12, Q7.', SELF, multi), [[POINTER, 'Q7']]);
  // Unread other draft (text: null): even if another tab for the same reviewer is known, give nothing.
  assert.deepEqual(cards('See our answer to Reviewer Ab12, Q9.', SELF, [tab('Reviewer Ab12', null)]), []);
  assert.deepEqual(cards('See our answer to Reviewer Ab12, Q9.', SELF,
    [tab('Reviewer Ab12', '**W1.** Seeds.'), tab('Reviewer Ab12 (follow-up)', null)]), []);
  // Other draft has no labelled parts at all: no index to check against.
  assert.deepEqual(cards('See our answer to Reviewer Ab12, Q9.', SELF,
    [tab('Reviewer Ab12', 'Thank you for the helpful review. We added five seeds.')]), []);
  // No tab for that reviewer, or pointer into this draft's own reviewer.
  assert.deepEqual(cards('See our answer to Reviewer Zz99, Q9.', SELF, [AB]), []);
  assert.deepEqual(cards('See our answer to Reviewer k9F2, Q9.', SELF, [AB]), []);
});

test('non-pointers, technical terms, quarter-years, bare counts and quoted/code pointers stay quiet', () => {
  const others = [AB];
  for (const s of [
    // Mentions of the reviewer's own points without "our/the answer/response/reply".
    'Unlike Reviewer Ab12’s W2, your W1 concerns calibration.',
    'Unlike Reviewer Ab12\'s W2, your W1 concerns calibration.',
    'We see no contradiction between Reviewer Ab12’s Q9 and your assessment.',
    'We see no contradiction between Reviewer Ab12\'s Q9 and your assessment.',
    'See Reviewer Ab12’s Q9 for the reviewer’s original wording.',
    'Refer to Reviewer Ab12, Q9.',
    'See Q9 of Reviewer Ab12.',
    // Technical terms, counts, quarter-years and non-alphanumeric boundary checks.
    'In our answer to Reviewer Ab12, L2 regularization was removed.',
    'See our answer to Reviewer Ab12 on L2 regularization.',
    'See our answer to Reviewer Ab12, L2 regularization is discussed in detail.',
    'See our answer to Reviewer Ab12 (L2 regularization).',
    'See our answer to Reviewer Ab12, Q2 and L2 regularization.',
    'As discussed in our response to Reviewer Ab12, L2-norm clipping is stable.',
    'See our answer to Reviewer Ab12, 3 additional examples.',
    'See our answer to Reviewer Ab12, Q2 and 3 additional examples.',
    'As discussed in our answer to Reviewer Ab12, 3 additional examples were added.',
    'As we explained to Reviewer Ab12, Q1 2025 was the first held-out quarter.',
    'See our answer to Reviewer Ab12, Q1 2025.',
    'As discussed in our response to Reviewer Ab12, Q1 2025 was held out.',
    'As we explained to Reviewer Ab12, W2V is our word embedding baseline.',
    'See our answer to Reviewer Ab12, W2V.',
    'See our response to Reviewer Ab12 (W2V).',
    'As discussed in our response to Reviewer Ab12, Q9 is also addressed in Appendix A.',
    // Quoted, blockquoted, inline code, fenced code and math pointers.
    'The email read, "See our answer to Reviewer Ab12, Q9."',
    'The email read, “See our answer to Reviewer Ab12, Q9.”',
    '> See our answer to Reviewer Ab12, Q9.',
    'See our answer to Reviewer Ab12, `Q9`.',
    '```\nSee our answer to Reviewer Ab12, Q9.\n```',
    '$\\text{see our answer to Reviewer Ab12, Q9}$',
  ]) {
    assert.deepEqual(cards(s, SELF, others), [], s);
  }
  // Heading "W1 and 3 additional baselines" must not register W3 as a label.
  assert.deepEqual(plain(A.labelledParts('## W1 and 3 additional baselines\n\nText.')).map((p) => p.label), ['W1']);
  assert.deepEqual(plain(A.labelledParts('## Questions 2 and 9\n\nText.')).map((p) => p.label), ['Q2', 'Q9']);
});

test('leading whitespace and CRLF keep pointer and reviewer offsets exact', () => {
  const crlfOther = tab('Reviewer Ab12', '  \r\n## W1 and W2\r\n\r\nFive seeds.\r\n\r\n### Questions 2 and 9\r\n\r\nFrozen.\r\n');
  // Q9 exists in the CRLF + leading-whitespace other draft, so no card.
  assert.deepEqual(cards('    \r\n  See our answer to Reviewer Ab12,\r\n  Q9.\r\n', SELF, [crlfOther]), []);
  // Q7 is missing: offsets must slice out exactly "Q7" despite leading indentation and CRLF.
  const src = '    \r\n  See our answer to Reviewer Ab12,\r\n  Q7 for details.\r\n';
  const hits = plain(A.reviewerIssues(src, SELF, [crlfOther]));
  assert.equal(hits.length, 1);
  assert.equal(hits[0].title, POINTER);
  assert.equal(src.slice(hits[0].start, hits[0].end), 'Q7');
  // Pre-form with leading spaces and CRLF.
  const pre = '   \r\nSee Q7 of our\r\nresponse to Reviewer Ab12.\r\n';
  const preHits = plain(A.reviewerIssues(pre, SELF, [crlfOther]));
  assert.equal(preHits.length, 1);
  assert.equal(pre.slice(preHits[0].start, preHits[0].end), 'Q7');
  // Multiple missing labels in one pointer get one card per missing label,
  // and bold at end-of-string selects the label alone.
  assert.deepEqual(cards('See our answer to Reviewer Ab12 (W9 and Q9).', SELF, [AB]),
    [[POINTER, 'W9'], [POINTER, 'Q9']]);
  assert.deepEqual(cards('See our answer to Reviewer Ab12, **Q9**', SELF, [AB]),
    [[POINTER, 'Q9']]);
  // Mixed pointer fuzz: never throws and every offset stays in bounds.
  const patoms = ['See ', 'refer to ', 'cf. ', 'as discussed in ', 'our response to ', 'of our answer to ',
    'Reviewer Ab12', ', ', ' (', ') ', '’s ', 'Q9', 'W1', 'questions 2 and 9', ' and ', 'from ', '\r\n', '\n\n',
    '**', '`', '"', '🧪', '\u0000', '\ud800', '   '];
  let pseed = 4099;
  const ppick = (n) => { pseed = (Math.imul(pseed, 1664525) + 1013904223) >>> 0; return pseed % n; };
  for (let i = 0; i < 300; i++) {
    let text = '  ';
    const n = 4 + ppick(30);
    for (let j = 0; j < n; j++) text += patoms[ppick(patoms.length)];
    for (const c of A.reviewerIssues(text, SELF, [AB])) {
      assert.ok(c.start >= 0 && c.end > c.start && c.end <= text.length, JSON.stringify(text));
      assert.equal(c.fix, null);
    }
  }
});
