'use strict';
// Checks 19 and 20: text a draft brings along from where it was written.
// LaTeX comment lines from Overleaf, which OpenReview prints as typed, and
// what a chat assistant leaves around its answer (citation markers, its own
// lines and phrases). Advice with a manual fix where one is safe; Fix all
// never applies them. Both directions: what is caught, and nearby text a
// careful author writes that must stay quiet.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAnalyzer } = require('./lib/page');
const { renderHtml } = require('./lib/pipeline');

const A = loadAnalyzer();
const COMMENT = 'LaTeX comment is shown to the reviewers';
const CHAT = 'Text left over from a chat assistant';
const cards = (src, title) => [...A.analyze(src).issues].filter((i) => i.title === title)
  .map((i) => src.slice(i.start, i.end));
const fixed = (src, title) => {
  const iss = [...A.analyze(src).issues].find((i) => i.title === title);
  assert.ok(iss && iss.fix && iss.fix.manual, 'a manual fix');
  return A.applyEditsToText(src, iss.fix.edits);
};

test('a % line in prose is a LaTeX comment posted as typed; deleting it leaves no blank line', () => {
  const src = 'We added the ablation.\n% TODO: ask Alice about seeds\nIt uses five seeds.';
  assert.deepEqual(cards(src, COMMENT), ['% TODO: ask Alice about seeds']);
  const out = fixed(src, COMMENT);
  assert.equal(out, 'We added the ablation.\nIt uses five seeds.');
  assert.equal(renderHtml(out), '<p>We added the ablation.\nIt uses five seeds.</p>\n');
  // The last line, and an indented one.
  assert.equal(fixed('Thanks.\n\n  %% old wording', COMMENT), 'Thanks.\n');
  assert.deepEqual(cards('Thanks.\n\n  %% old wording', COMMENT), ['%% old wording']);
});

test('percentages, TeX comments inside math, code and a wrapped percentage stay quiet', () => {
  for (const src of [
    'Accuracy rose by 95% on all runs.',
    '95% of the runs converge.',
    'Accuracy improves by 5\n% on average across seeds.',
    '$$\na = b % the identity\n$$',
    '```tex\n% a comment in code\n```',
    'Text.\n\n    % indented code',
    '`% inline`',
    'A 50 % drop.',
  ]) assert.deepEqual(cards(src, COMMENT), [], src);
  // Fix all leaves the line alone: it is the author's call.
  const src = 'Text.\n% note';
  assert.equal(A.fixAllText(src).text, src);
});

test('citation markers a chat assistant leaves behind are caught and can be deleted', () => {
  const oai = 'The gain holds on all datasets.:contentReference[oaicite:0]{index=0} We report it.';
  assert.deepEqual(cards(oai, CHAT), [':contentReference[oaicite:0]{index=0}']);
  assert.equal(fixed(oai, CHAT), 'The gain holds on all datasets. We report it.');
  const turn = 'Prior work reports 71%. citeturn0search1turn0search4 Ours is higher.';
  assert.equal(cards(turn, CHAT).length, 1);
  assert.equal(fixed(turn, CHAT), 'Prior work reports 71%. Ours is higher.');
  const src = 'As shown in [1]【4†source】, the bound is tight.';
  assert.deepEqual(cards(src, CHAT), ['【4†source】']);
  assert.equal(fixed(src, CHAT), 'As shown in [1], the bound is tight.');
});

test('an assistant’s own opening line or phrase is caught; an author’s similar sentences are not', () => {
  const opening = 'Certainly! Here is a revised version of your rebuttal:\n\nWe thank the reviewer.';
  assert.deepEqual(cards(opening, CHAT), ['Certainly! Here is a revised version of your rebuttal:']);
  assert.equal(fixed(opening, CHAT), '\nWe thank the reviewer.');
  assert.equal(cards('Here is a polished version of your response:\n\nThanks.', CHAT).length, 1);
  for (const s of ['We thank the reviewer.\n\nI hope this helps!', 'As an AI language model, I cannot run code.',
    'Let me know if you’d like me to shorten it further.', 'Would you like me to shorten the second paragraph?']) {
    assert.equal(cards(s, CHAT).length, 1, s);
  }
  for (const s of [
    'Here is the revised proof:\n\n$$a=b$$',
    'Here is our response to your comments:',
    'Here is a revised version of Table 2:',
    'We hope this clarifies the question.',
    'Please let us know if you have further questions.',
    'Sure, we will add this experiment.',
    'Of course, the bound depends on $n$.',
    'The prior method (cite: Smith et al.) uses five seeds.',
    '`:contentReference[oaicite:0]{index=0}` is what the export showed.',
  ]) assert.deepEqual(cards(s, CHAT), [], s);
});

test('"[Your Name]" and kin are placeholders; a link label is not', () => {
  const ph = (src) => [...A.analyze(src).issues].filter((i) => i.title === 'Placeholder left in the text').map((i) => src.slice(i.start, i.end));
  assert.deepEqual(ph('Best regards,\n[Your Name]'), ['[Your Name]']);
  assert.deepEqual(ph('Signed, [Authors’ names]'), ['[Authors’ names]']);
  assert.deepEqual(ph('See [your code](https://example.org) and [Your point][1].\n\n[1]: https://example.org'), []);
});

test('the example and the fixtures get no card from these checks', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { readExample } = require('./lib/page');
  const dir = path.join(__dirname, 'fixtures');
  for (const text of [readExample(), ...fs.readdirSync(dir).map((n) => fs.readFileSync(path.join(dir, n), 'utf8'))]) {
    assert.deepEqual(cards(text, COMMENT), []);
    assert.deepEqual(cards(text, CHAT), []);
  }
});
