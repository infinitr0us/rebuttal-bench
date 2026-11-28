'use strict';
// Check 21: the author's private anonymity word list. Exact matches on the
// author's own words anywhere in the posted text (prose, code, math, link
// destinations and definitions, image syntax and alt text, HTML comments),
// since OpenReview posts and e-mails the comment as typed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAnalyzer } = require('./lib/page');

const A = loadAnalyzer();
const TITLE = 'Words that name the authors';

const anonIssues = (src, identity) => [...A.analyze(src, identity === undefined ? undefined : { identity }).issues]
  .filter((i) => i.title === TITLE);
const hits = (src, identity) => anonIssues(src, identity).map((i) => src.slice(i.start, i.end));

const parse = (s) => [...A.identityTerms(s)];

test('identityTerms normalizes lines, drops blanks, short entries and duplicates, and enforces caps', () => {
  assert.deepEqual(
    parse('  Jane   Doe  \n\n  \t \nX\njane doe\nJANE\tDOE\r\nAcme   Lab\r  a  \n'),
    ['Jane Doe', 'Acme Lab'],
  );
  // Non-string inputs return an empty list.
  for (const bad of [null, undefined, 42, {}, [], true]) {
    assert.deepEqual(parse(bad), []);
  }
  // 100-character cap per entry (and deduping after cutting, without leaving a trailing space).
  const longA = 'a'.repeat(99) + ' ' + 'b'.repeat(20);
  const longB = 'A'.repeat(99) + ' ' + 'c'.repeat(20);
  assert.deepEqual(parse(longA + '\n' + longB), ['a'.repeat(99)]);
  const exact120 = 'x'.repeat(120);
  assert.deepEqual(parse(exact120), ['x'.repeat(100)]);
  // 50-entry cap (blanks, short entries and duplicates do not consume slots).
  const many = [' ', 'a', 'Term 0', 'term 0']
    .concat(Array.from({ length: 65 }, (_, i) => 'Term ' + i))
    .join('\n');
  const parsed = parse(many);
  assert.equal(parsed.length, 50);
  assert.equal(parsed[0], 'Term 0');
  assert.equal(parsed[49], 'Term 49');
});

test('case-insensitive matching and line-wrap handling (one line break yes, blank line no)', () => {
  const terms = A.identityTerms('Jane Doe');
  assert.deepEqual(hits('Written by JANE DOE and jane   \t doe.', terms), ['JANE DOE', 'jane   \t doe']);
  assert.deepEqual(hits('Contact Jane\nDoe or Jane \r\n  Doe for details.', terms), ['Jane\nDoe', 'Jane \r\n  Doe']);
  assert.deepEqual(hits('Paragraph ends with Jane.\n\nDoe starts the next.', terms), []);
  assert.deepEqual(hits('Line one Jane\n\nDoe line three.', terms), []);
  assert.deepEqual(hits('Line one Jane \n \n Doe line three.', terms), []);
  // No-break spaces, as a copy from a PDF or Word brings them, count as spaces.
  assert.deepEqual(hits('By Jane Doe and Jane \nDoe.', terms), ['Jane Doe', 'Jane \nDoe']);
});

test('word boundaries: Li does not match inside other words or digits, but matches beside punctuation and edges', () => {
  const terms = ['Li'];
  for (const quiet of ['Lin', 'Lisa', 'ELi', 'Li2', '2Li', 'abLicd']) {
    assert.deepEqual(hits('See ' + quiet + ' for details.', terms), [], quiet);
  }
  assert.deepEqual(hits('Li, (Li), Li. and _Li_!', terms), ['Li', 'Li', 'Li', 'Li']);
  assert.deepEqual(hits('Li', terms), ['Li']);
  assert.deepEqual(hits('Li starts and ends with Li', terms), ['Li', 'Li']);
  // A boundary-rejected match must not hide an overlapping-prefix valid match right after it.
  assert.deepEqual(hits('ba a a', ['a a']), ['a a']);
});

test('terms with punctuation and regex metacharacters are matched literally', () => {
  const terms = A.identityTerms('jane.doe@uni.edu\ngithub.com/janedoe\n@janedoe\nC++\n(Acme)\nlab/');
  assert.deepEqual(
    hits('Email mailto:jane.doe@uni.edu, see https://github.com/janedoe/repo, ping foo@janedoe, use C++17 at (Acme) and /lab/page.', terms),
    ['jane.doe@uni.edu', 'github.com/janedoe', '@janedoe', 'C++', '(Acme)', 'lab/'],
  );
  // Dots, pluses and parentheses must not act as regex wildcards or groups.
  assert.deepEqual(hits('janexdoe@unix.edu and C and Acme', terms), []);
  // Trailing word char on @janedoe still requires a right boundary.
  assert.deepEqual(hits('Ping @janedoe2 here.', ['@janedoe']), []);
});

test('every part of the posted text is searched: links, code, comments, math, images, definitions', () => {
  const terms = ['AcmeLab'];
  const src = [
    'Prose mentions AcmeLab once.',
    'See [the repo](https://example.org/AcmeLab/code) for scripts.',
    'Inline `run_AcmeLab_eval` code.',
    '```python\nauthor = "AcmeLab"\n```',
    '<!-- note for AcmeLab coauthors -->',
    'Inline math $\\text{AcmeLab}$ and display:',
    '$$\\mathrm{AcmeLab} = 1$$',
    '![AcmeLab architecture](/images/fig1.png)',
    'Reference link [here][ref].',
    '',
    '[ref]: https://example.org/AcmeLab-data',
  ].join('\n');
  const found = anonIssues(src, terms);
  assert.equal(found.length, 9);
  for (const iss of found) {
    assert.equal(iss.sev, 'err');
    assert.equal(iss.fix, null);
    assert.equal(iss.math, false);
    assert.equal(src.slice(iss.start, iss.end), 'AcmeLab');
    assert.match(iss.detail, /AcmeLab/);
    assert.match(iss.detail, /double-blind/);
    assert.match(iss.detail, /as typed/);
  }
});

test('overlapping terms report only the longer match and escape HTML in card detail', () => {
  const src = 'Thanks from Jane Doe and A<B>&C Lab.';
  const found = anonIssues(src, ['Doe', 'Jane Doe', 'Jane', 'A<B>&C']);
  assert.deepEqual(found.map((i) => src.slice(i.start, i.end)), ['Jane Doe', 'A<B>&C']);
  assert.match(found[0].detail, /Jane Doe/);
  assert.match(found[1].detail, /A&lt;B&gt;&amp;C/);
  assert.doesNotMatch(found[1].detail, /A<B>&C/);
  // Partial overlap also keeps the longer match.
  const partial = anonIssues('Jane Doe Lab', ['Jane Doe', 'Doe Lab']);
  assert.deepEqual(partial.map((i) => 'Jane Doe Lab'.slice(i.start, i.end)), ['Jane Doe']);
});

test('analyze shifts offsets back into the editor text past leading blank lines and indentation', () => {
  const src = '\n\n    Leading indent with Jane Doe.\nAnd Jane Doe again.\n  ';
  const found = anonIssues(src, ['Jane Doe']);
  assert.equal(found.length, 2);
  for (const iss of found) {
    assert.equal(src.slice(iss.start, iss.end), 'Jane Doe');
  }
  assert.equal(found[0].start, src.indexOf('Jane Doe'));
  assert.equal(found[1].start, src.lastIndexOf('Jane Doe'));
});

test('quiet when no identity list is passed, when empty, or when absent; Fix all ignores it', () => {
  const src = 'Written by Jane Doe at AcmeLab.';
  assert.deepEqual(anonIssues(src), []);
  assert.deepEqual(anonIssues(src, []), []);
  assert.deepEqual(anonIssues(src, ['Someone Else']), []);
  assert.equal(A.fixAllText(src).text, src);
  assert.equal(A.fixAllText(src).applied, 0);
});

test('caps cards at 30 and notes the remaining matches on the 30th card', () => {
  const src = Array.from({ length: 35 }, (_, i) => 'Mention ' + (i + 1) + ': AcmeLab.').join('\n');
  const res = A.analyze(src, { identity: ['AcmeLab'] });
  const found = [...res.issues].filter((i) => i.title === TITLE);
  assert.equal(found.length, 30);
  assert.equal(res.identityCount, 35);
  assert.doesNotMatch(found[0].detail, /more in this draft/);
  assert.doesNotMatch(found[28].detail, /more in this draft/);
  assert.match(found[29].detail, /and 5 more in this draft/);
  // Exactly 30 matches gets no "more" note.
  const exact = Array.from({ length: 30 }, () => 'AcmeLab').join(' ');
  const exactFound = anonIssues(exact, ['AcmeLab']);
  assert.equal(exactFound.length, 30);
  assert.doesNotMatch(exactFound[29].detail, /more in this draft/);
});
