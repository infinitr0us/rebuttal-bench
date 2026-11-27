'use strict';
// Reviewer IDs across drafts (reviewerIssues): a draft named for one reviewer
// that greets another, an ID in other capitals than its tab, an ID no tab
// has, and a pointer to a point the other draft does not label. Advice only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAnalyzer } = require('./lib/page');

const A = loadAnalyzer();
const plain = (x) => JSON.parse(JSON.stringify(x)); // VM-realm objects to plain ones
const tabs = (...names) => names.map((n) => (typeof n === 'string' ? { name: n, labels: null } : n));
const cards = (text, self, others) => plain(A.reviewerIssues(text, self, others))
  .map((i) => [i.sev, i.title, text.slice(i.start, i.end)]);

test('whom a tab is for: an ID after "Reviewer", a bare ID-shaped word, or a number', () => {
  assert.deepEqual(plain(A.draftReviewer('Reviewer k9F2')), { ids: ['k9F2'], nums: [] });
  assert.deepEqual(plain(A.draftReviewer('Reviewer_abcd follow-up')), { ids: ['abcd'], nums: [] });
  assert.deepEqual(plain(A.draftReviewer('R1 (Ab12)')), { ids: ['Ab12'], nums: [1] });
  assert.deepEqual(plain(A.draftReviewer('Reviewer #3')), { ids: [], nums: [3] });
  // Ordinary words and years are nobody's ID.
  for (const name of ['General response', 'Plan', 'Draft 2026', 'Round 2', 'Answer to AC']) {
    assert.deepEqual(plain(A.draftReviewer(name)), { ids: [], nums: [] }, name);
  }
});

test('a draft named for one reviewer that thanks another gets a warning', () => {
  const others = tabs('Reviewer Ab12', 'Reviewer Cd34');
  assert.deepEqual(cards('We thank Reviewer Ab12 for the careful review.\n\nW1: fixed.', 'Reviewer k9F2', others),
    [['warn', 'This draft addresses another reviewer', 'Reviewer Ab12']]);
  assert.deepEqual(cards('## Response to Reviewer Cd34\n\nW1: fixed.', 'Reviewer k9F2', others),
    [['warn', 'This draft addresses another reviewer', 'Reviewer Cd34']]);
  // The closing counts too.
  assert.deepEqual(cards('W1: fixed.\n\nThanks again, Reviewer Ab12!', 'Reviewer k9F2', others),
    [['warn', 'This draft addresses another reviewer', 'Reviewer Ab12']]);
  // Numbered reviewers: the tab says R2, the greeting Reviewer 3.
  assert.deepEqual(cards('Dear Reviewer 3, thank you.', 'R2', tabs('R3')),
    [['warn', 'This draft addresses another reviewer', 'Reviewer 3']]);
});

test('greeting its own reviewer, a general response, and a cross-reference in the middle are fine', () => {
  const others = tabs('Reviewer Ab12', 'General');
  assert.deepEqual(cards('We thank Reviewer k9F2 for the review.\n\nW1: fixed.', 'Reviewer k9F2', others), []);
  assert.deepEqual(cards('We thank Reviewers k9F2 and Ab12 for their reviews.', 'General', tabs('Reviewer k9F2', 'Reviewer Ab12')), []);
  assert.deepEqual(cards('We thank the reviewer.\n\nW1: as Reviewer Ab12 also noted, we added seeds.\n\nThanks!', 'Reviewer k9F2', others), []);
  // "The reviewer also" names no one; nor does a mention in code or math.
  assert.deepEqual(cards('We thank the reviewer also for the typo.', 'Reviewer k9F2', others), []);
  assert.deepEqual(cards('Thanks, see `Reviewer Ab12` and $Reviewer$.', 'Reviewer k9F2', others), []);
  // A tab named for nobody, or a draft without the word, gets nothing.
  assert.deepEqual(cards('We thank Reviewer Ab12.', 'Draft 1', tabs('Reviewer k9F2')), []);
  assert.deepEqual(cards('Thanks for the review.', 'Reviewer k9F2', others), []);
});

test('an ID in other capitals than its tab is another ID to OpenReview', () => {
  assert.deepEqual(cards('W1: as for Reviewer k9f2, we agree.', 'Reviewer Ab12', tabs('Reviewer k9F2')),
    [['warn', 'Reviewer ID written differently from its tab', 'Reviewer k9f2']]);
});

test('an ID no tab has gets a note once tabs are named by ID', () => {
  const text = 'W1: as we told Reviewer Zz99 and Reviewer Zz99 again, yes.';
  assert.deepEqual(cards(text, 'Reviewer k9F2', tabs('Reviewer Ab12')),
    [['note', 'No draft is named for this reviewer', 'Reviewer Zz99']]);
  // With only one tab named by ID, the author may simply not have the others.
  assert.deepEqual(cards(text, 'Reviewer k9F2', tabs('General')), []);
});

test('a pointer to a point the other draft does not label gets a warning', () => {
  const ab = { name: 'Reviewer Ab12', labels: plain(A.pointLabels('**W1.** Seeds.\n\n**Q1:** Why?\n\nQuestion 2: More.')) };
  assert.deepEqual(ab.labels, ['W1', 'Q1', 'Q2']);
  const base = 'Thanks!\n\n';
  assert.deepEqual(cards(base + 'W2: see our answer to Reviewer Ab12, Q3.', 'Reviewer k9F2', [ab]),
    [['warn', 'Pointer to a point the other draft does not have', 'Reviewer Ab12']]);
  assert.deepEqual(cards(base + 'W2: see W3 of Reviewer Ab12 for this.', 'Reviewer k9F2', [ab]),
    [['warn', 'Pointer to a point the other draft does not have', 'Reviewer Ab12']]);
  // Points it has, in any spelling, are fine.
  assert.deepEqual(cards(base + 'W2: see Reviewer Ab12 (W1 and question 2).', 'Reviewer k9F2', [ab]), []);
  assert.deepEqual(cards(base + 'W2: see Reviewer Ab12’s Q1.', 'Reviewer k9F2', [ab]), []);
  // A draft not read yet, or one without labels, cannot be checked.
  assert.deepEqual(cards(base + 'W2: see Reviewer Ab12, Q3.', 'Reviewer k9F2', tabs('Reviewer Ab12')), []);
  assert.deepEqual(cards(base + 'W2: see Reviewer Ab12, Q3.', 'Reviewer k9F2', [{ name: 'Reviewer Ab12', labels: [] }]), []);
});

test('nothing throws, and empty or unrelated input has no cards', () => {
  for (const text of ['', '   ', 'Reviewer', 'reviewer reviewer reviewers', '$$\nReviewer Ab12\n$$', 'Reviewer\u0000Ab12', '> We thank Reviewer Ab12.']) {
    assert.deepEqual(cards(text, 'Reviewer k9F2', tabs('Reviewer Ab12')), [], JSON.stringify(text));
  }
  assert.deepEqual(plain(A.reviewerIssues('We thank Reviewer Ab12.', undefined, undefined)), []);
});
