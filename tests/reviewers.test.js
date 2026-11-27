'use strict';
// Reviewer IDs across drafts (reviewerIssues): a draft named for one reviewer
// that addresses another, an ID in other capitals than its tab, and a pointer
// to a point the other draft never names. Advice only, and only where it is
// unmistakable: the "correct" cases come from the Codex review of 3.8
// (reviews/2026-11-27/codex-review-38), each a sentence a careful author writes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAnalyzer } = require('./lib/page');

const A = loadAnalyzer();
const plain = (x) => JSON.parse(JSON.stringify(x)); // VM-realm objects to plain ones
const tab = (name, text = '') => ({ name, text });
const AB = tab('Reviewer Ab12', '**W1.** We use five seeds.\n\n**Q2:** The backbone is frozen.');
const FOUR = [AB, tab('Reviewer Cd34'), tab('Reviewer x7Hz')];
const NUMBERED = ['R1', 'R3', 'R4'].map((n) => tab(n));
const SELF = 'Reviewer k9F2';
const cards = (text, self = SELF, others = FOUR) => plain(A.reviewerIssues(text, self, others))
  .map((i) => [i.title, text.slice(i.start, i.end)]);
const ADDRESS = 'This draft addresses another reviewer';
const CASE = 'Reviewer ID written differently from its tab';
const POINTER = 'Pointer to a point the other draft does not have';

test('whom a tab is for: an ID after "Reviewer", a bare ID-shaped word, or a whole-word number', () => {
  assert.deepEqual(plain(A.draftReviewer('Reviewer k9F2')), { ids: ['k9F2'], nums: [] });
  assert.deepEqual(plain(A.draftReviewer('Reviewer_abcd follow-up')), { ids: ['abcd'], nums: [] });
  assert.deepEqual(plain(A.draftReviewer('R1 (Ab12)')), { ids: ['Ab12'], nums: [1] });
  assert.deepEqual(plain(A.draftReviewer('Reviewer #3')), { ids: [], nums: [3] });
  // A digit-leading ID is no number, and an ID that starts with R and a digit is no R-number.
  assert.deepEqual(plain(A.draftReviewer('Reviewer 2AbC')), { ids: ['2AbC'], nums: [] });
  assert.deepEqual(plain(A.draftReviewer('R2bX')), { ids: ['R2bX'], nums: [] });
  for (const name of ['General response', 'Plan', 'Draft 2026', 'Round 2', 'Answer to AC', 'ICLR 2027 – General response']) {
    assert.deepEqual(plain(A.draftReviewer(name)), { ids: [], nums: [] }, name);
  }
});

test('a copied greeting, thanks or "Response to" line for another reviewer gets a warning', () => {
  assert.deepEqual(cards('We thank Reviewer Ab12 for the careful review.\n\nW1: fixed.'), [[ADDRESS, 'Reviewer Ab12']]);
  assert.deepEqual(cards('W1: fixed.\n\nThanks again, Reviewer Ab12!'), [[ADDRESS, 'Reviewer Ab12']]);
  // A salutation or a "Response to" line anywhere: after a title, between parts.
  assert.deepEqual(cards('Thanks for the detailed assessment.\n\n## Response to Reviewer Ab12\n\nWe include the per-seed numbers here.'),
    [[ADDRESS, 'Reviewer Ab12']]);
  assert.deepEqual(cards('# Author response\n\nDear Reviewer Ab12, thank you for the careful reading.\n\nWe now report the per-seed scores.'),
    [[ADDRESS, 'Reviewer Ab12']]);
  // A tab's ID on its own, emphasis, a soft line break.
  assert.deepEqual(cards('Dear Ab12, thank you for your review.'), [[ADDRESS, 'Ab12']]);
  assert.deepEqual(cards('Dear **Reviewer Ab12**, thank you.'), [[ADDRESS, 'Reviewer Ab12']]);
  assert.deepEqual(cards('Dear Reviewer **Ab12**, thank you.'), [[ADDRESS, 'Reviewer **Ab12']]);
  assert.deepEqual(cards('Thanks, Reviewer\nAb12, for the suggestion.'), [[ADDRESS, 'Reviewer\nAb12']]);
  // Numbered reviewers.
  for (const s of ['Dear R3, thank you for the review.', 'Dear Reviewer R3, thank you.', '## Reply to Rev. 3', 'Dear Reviewer 3, thank you.']) {
    assert.equal(cards(s, 'R2', NUMBERED).length, 1, s);
  }
});

test('the sentences of the 3.8 review stay quiet', () => {
  for (const s of [
    'Thank you for raising the same concern as Reviewer Ab12.',
    'As Reviewer Ab12 also noted, we appreciate the importance of calibration.',
    'We thank Reviewers k9F2 and Ab12 for independently suggesting the same baseline.',
    'The review reads, “We thank Reviewer Ab12 for sharing the scores.”',
    'The review reads, "We thank Reviewer Ab12 for sharing the scores."',
    'Reviewer Ab12 reports an effect for the gene `HI`.',
    'Dear Reviewer k9F2, as suggested by Reviewer Ab12 we now report per-site AUC.',
    'As requested by Reviewer Ab12, BERT is now included as a baseline.',
    'As we explained to Reviewer Ab12, Q1 2025 was the first held-out quarter.',
    'As we explained to Reviewer Ab12, W2V is our word embedding baseline.',
    'Unlike Reviewer Ab12’s W2, your W1 concerns calibration.',
    'Reviewer Ab12: Q1 2025 was held out.',
    '| Contributor | Comment |\n| --- | --- |\n| Reviewer Ab12 | We appreciate the baseline. |',
    '> We thank Reviewer Ab12 for the baseline suggestion.',
    'We thank the reviewer also for the typo.',
    'One concern was also raised by Reviewer Cd34, and Reviewer Zz99 agreed.',
  ]) assert.deepEqual(cards(s), [], s);
  // A general tab, whatever it names; different numbering schemes are not compared.
  assert.deepEqual(cards('We thank all four reviewers, especially Reviewer Ab12 for locating the missing baseline.',
    'ICLR 2027 – General response'), []);
  assert.deepEqual(cards('We thank Reviewers k9F2, Ab12, Cd34 and x7Hz for their feedback.', 'General response', [tab(SELF), AB]), []);
  assert.deepEqual(cards('Dear Reviewer 1, thank you for the suggestion.', SELF, [tab('R1'), tab('R2')]), []);
  assert.deepEqual(cards('Dear Reviewer 2, we appreciate the review.', 'Reviewer 2AbC', [tab('R2')]), []);
  assert.deepEqual(cards('Dear Reviewer 2, we reply with the requested table.', 'R2bX', [tab('Reviewer 2')]), []);
  assert.deepEqual(cards('Thank you, Reviewer 2.\n\nThe R2 score improves from 0.78 to 0.84. Reviewer 1 suggested it.', 'R2', NUMBERED), []);
  assert.deepEqual(cards('We thank Reviewers 2 and 4 for their time.', 'R2', NUMBERED), []);
});

test('an ID in other capitals than its tab is another ID to OpenReview', () => {
  assert.deepEqual(cards('W1: as for Reviewer k9f2, we agree.', 'Reviewer Ab12', [tab(SELF)]), [[CASE, 'Reviewer k9f2']]);
  assert.deepEqual(cards('We thank Reviewers Ab12 and cd34.', 'General', FOUR), [[CASE, 'cd34']]);
  assert.deepEqual(cards('Dear Reviewer k9f2, thank you.'), [[CASE, 'Reviewer k9f2']]);
});

test('a pointer to a point the other draft never names gets a warning on that point', () => {
  assert.deepEqual(cards('For calibration see Reviewer Ab12 (W1 and Q9).'), [[POINTER, 'Q9']]);
  assert.deepEqual(cards('See W9 and W1 of Reviewer Ab12 for the full ablation.'), [[POINTER, 'W9']]);
  assert.deepEqual(cards('See Reviewer Ab12, questions 2 and 9, for our ablations.'), [[POINTER, '9']]);
  assert.deepEqual(cards('See Reviewer Ab12, **Q9**, for our ablations.'), [[POINTER, 'Q9']]);
  assert.deepEqual(cards('For the ablation see Reviewer Ab12, W9.', SELF, [tab('Reviewer Ab12', '**W1:** Five seeds.')]), [[POINTER, 'W9']]);
  assert.deepEqual(cards('See concern 1 of Reviewer Ab12.', SELF, [tab('Reviewer Ab12', 'Comment 1: Baselines.\n\nConcern 2: Seeds.')]),
    [[POINTER, 'concern 1']]);
});

test('pointers to points the other draft names, in any spelling or place, and unreadable drafts, are fine', () => {
  assert.deepEqual(cards('See our answer to Reviewer Ab12, Q2.'), []);
  assert.deepEqual(cards('See Reviewer Ab12 (weakness 1 and question 2).'), []);
  assert.deepEqual(cards('For the seed sweep see Reviewer Ab12, W2.', SELF,
    [tab('Reviewer Ab12', '## W1 and W2: seed sweep\n\nAll baselines were rerun.')]), []);
  assert.deepEqual(cards('For the seed sweep see Reviewer Ab12, W2.', SELF,
    [tab('Reviewer Ab12', 'Thank you.\n\nW1: see Table 1.\nW2: we used five seeds.')]), []);
  // Another draft for the same reviewer not read yet: no claim.
  assert.deepEqual(cards('For the ablation see Reviewer Ab12, Q7.', SELF,
    [tab('Reviewer Ab12', 'W1: first.'), { name: 'Reviewer Ab12 (follow-up)', text: null }]), []);
  // No draft for that reviewer, or a pointer into this draft's own reviewer.
  assert.deepEqual(cards('See Reviewer Zz99, Q2.'), []);
  assert.deepEqual(cards('See Reviewer k9F2, Q9.'), []);
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
  const atoms = ['Reviewer', ' Reviewers ', 'Ab12', '\r\n', '\n\n', '[', ']', '(', ')', '<', '>', 'Q9', ' thanks ', 'Dear ', ' see ',
    '🧪', '\u0000', '\ud800', '$', '`', '|', '*', '#', '  ', '_', ' and ', '::', '“', '"'];
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
});
