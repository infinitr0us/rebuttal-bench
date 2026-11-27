'use strict';
// Checks 19 and 20: text a draft brings along from where it was written.
// Commented-out LaTeX from Overleaf, which OpenReview prints as typed, and
// what a chat assistant leaves around its answer (citation markers, its
// address to the user, its self-description). Only what is unmistakable:
// a Codex review ran a broader version on 310 real author responses
// (reviews/2026-11-27/codex-review-310) and found 49 false cards, whose
// shapes are the quiet cases below.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAnalyzer } = require('./lib/page');
const { renderHtml } = require('./lib/pipeline');

const A = loadAnalyzer();
const COMMENT = 'LaTeX comment is shown to the reviewers';
const CHAT = 'Text left over from a chat assistant';
const PLACEHOLDER = 'Placeholder left in the text';
const cards = (src, title) => [...A.analyze(src).issues].filter((i) => i.title === title)
  .map((i) => src.slice(i.start, i.end));
const fixed = (src, title) => {
  const iss = [...A.analyze(src).issues].find((i) => i.title === title);
  assert.ok(iss && iss.fix && iss.fix.manual, 'a manual fix for ' + JSON.stringify(src));
  return A.applyEditsToText(src, iss.fix.edits);
};

test('commented-out LaTeX and notes to self are caught; deleting the line leaves no blank line', () => {
  const row = 'Results below.\n%Ours, $h=100$ & 71.2 & 80.1 \\\\\nOther rows follow.';
  assert.deepEqual(cards(row, COMMENT), ['%Ours, $h=100$ & 71.2 & 80.1 \\\\']);
  assert.equal(fixed(row, COMMENT), 'Results below.\nOther rows follow.');
  const cmd = 'We added the ablation.\n% \\vspace{-2mm}\nIt uses five seeds.';
  assert.deepEqual(cards(cmd, COMMENT), ['% \\vspace{-2mm}']);
  assert.equal(renderHtml(fixed(cmd, COMMENT)), '<p>We added the ablation.\nIt uses five seeds.</p>\n');
  assert.deepEqual(cards('Thanks.\n\n% TODO ask Alice about the seeds', COMMENT), ['% TODO ask Alice about the seeds']);
  assert.equal(fixed('Thanks.\n\n% TODO ask Alice about the seeds', COMMENT), 'Thanks.\n');
  // Indentation does not matter outside code, so compaction cannot create a card.
  assert.deepEqual(cards('A line\n      % \\label{tab:x}\nmore.', COMMENT), ['% \\label{tab:x}']);
});

test('a line break other than LF never takes the author\u2019s previous sentence along', () => {
  const src = 'Our result.\u2028% TODO remove this sentence.\nWe measured the gain.';
  assert.equal(fixed(src, COMMENT), 'Our result.\u2028We measured the gain.');
  const crlf = 'Our result.\r\n% TODO remove\r\nWe measured the gain.';
  assert.equal(fixed(crlf, COMMENT), 'Our result.\r\nWe measured the gain.');
});

test('lines authors write with a leading % stay quiet', () => {
  for (const src of [
    '%%% Relationship with prior work %%%\n\n> We clarify that ...',
    '%%% Figure 1: What is the x-axis here?',
    '% Qs answered within budget: 41 (82%)',
    '% of runs that converge: 95',
    'Accuracy was 94.7\n% (Table 2).',
    'Accuracy improves by 5\n% on average across seeds.',
    '95% of the runs converge.',
    '$$\na = b % the identity \\label{x}\n$$',
    '```tex\n% \\vspace{2mm}\n```',
    'Text.\n\n    % \\vspace{2mm} in an indented code block',
    '| % change | value |\n| --- | --- |\n| +3 | 71 |',
  ]) assert.deepEqual(cards(src, COMMENT), [], src);
  const src = 'Text.\n% TODO note';
  assert.equal(A.fixAllText(src).text, src, 'Fix all leaves it to the author');
});

test('citation markers are caught in every form seen in public text, and deleting one keeps words and structure', () => {
  const cases = [
    ['The gain holds on all datasets.:contentReference[oaicite:0]{index=0} We report it.', 'The gain holds on all datasets. We report it.'],
    ['The gain holds.:contentReference[oaicite:0]index=0 We report it.', 'The gain holds. We report it.'],
    ['Prior work reports 71%. \ue200cite\ue202turn0search1\ue202turn0search4\ue201 Ours is higher.', 'Prior work reports 71%. Ours is higher.'],
    ['As the paper states \ue200filecite\ue202turn0file0\ue201, the bound is tight.', 'As the paper states, the bound is tight.'],
    ['Prior work citeturn0search1 reports it.', 'Prior work reports it.'],
    ['As shown in [1]【4†source】, the bound is tight.', 'As shown in [1], the bound is tight.'],
    ['The 【4†source】bound holds.', 'The bound holds.'],
    ['The:contentReference[oaicite:0]{index=0}bound holds.', 'The bound holds.'],
    ['A claim.\n【4†source】\nMore evidence.', 'A claim.\nMore evidence.'],
    ['- 【4†source】Result', '- Result'],
    ['## :contentReference[oaicite:0]{index=0}Result', '## Result'],
  ];
  for (const [src, want] of cases) {
    assert.equal(cards(src, CHAT).length, 1, src);
    assert.equal(fixed(src, CHAT), want, src);
  }
  // A link labelled with a marker keeps its destination: advice, no fix.
  const link = 'See [oai_citation:5\u2021Bike East Bay](https://example.org/report) for details.';
  const iss = [...A.analyze(link).issues].filter((i) => i.title === CHAT);
  assert.equal(iss.length, 1);
  assert.equal(iss[0].fix, null);
});

test('an assistant\u2019s address to the user and its self-description are caught; only the opening is deleted', () => {
  const opening = 'Certainly! Here is a revised version of your rebuttal:\n\nWe thank the reviewer.';
  assert.deepEqual(cards(opening, CHAT), ['Certainly! Here is a revised version of your rebuttal:']);
  assert.equal(fixed(opening, CHAT), '\nWe thank the reviewer.');
  const shared = 'Here is a polished version of your response: We measured a 3% gain.';
  assert.equal(fixed(shared, CHAT), 'We measured a 3% gain.');
  assert.equal(cards('As an AI language model, I cannot verify the numbers.', CHAT).length, 1);
  assert.equal(cards('The answer was refused, as I am an AI language model.', CHAT).length, 1);
});

test('sentences authors write stay quiet', () => {
  for (const s of [
    'We thank the reviewer.\n\nI hope this helps!',
    'We hope this helps clarify our contribution.',
    'Sure! Here are the results:\n\n| A | B |\n| - | - |\n| 1 | 2 |',
    'Here is the revised proof:\n\n$$a=b$$',
    'Here is our response to your comments:',
    'Here is a revised version of Table 2:',
    'As an AI system, our agent must respect the user\u2019s privacy.',
    'The model answers as an AI language model would when asked.',
    'Let me know if you would like me to run the extra seeds.',
    'Please let us know if you have further questions.',
    'Of course, the bound depends on $n$.',
    '`:contentReference[oaicite:0]{index=0}` is what the export showed.',
  ]) assert.deepEqual(cards(s, CHAT), [], s);
});

test('"[Your Name]" and kin are placeholders; anonymous signatures, labels and prompts are not', () => {
  assert.deepEqual(cards('Best regards,\n[Your Name]', PLACEHOLDER), ['[Your Name]']);
  assert.deepEqual(cards('Signed, [Your affiliation]', PLACEHOLDER), ['[Your affiliation]']);
  for (const s of ['Best,\n[Authors]', 'Thanks, [Authors of Paper 236]', '[Authors:] We agree.', '[Author\u2019s Response] Yes.',
    'The prompt read: "Pick [Your Option] from the list."', 'See [your code](https://example.org).']) {
    assert.deepEqual(cards(s, PLACEHOLDER), [], s);
  }
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
