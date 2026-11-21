'use strict';
// Check 15: links under the chosen venue's rule, and links that may name the
// authors (noted at every venue: rebuttals are double-blind).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAnalyzer } = require('./lib/page');
const { renderHtml } = require('./lib/pipeline');

const A = loadAnalyzer();
const hazards = (src, venue) => [...A.analyze(src, venue ? { venue } : undefined).issues]
  .filter((i) => /link|URL/i.test(i.title))
  .map((i) => i.sev + ' ' + i.title);

test('no venue: links that may name the authors get a note, shorteners a warning', () => {
  assert.deepEqual(hazards('Code: [repo](https://github.com/alice/method).'), ['note This link may reveal who the authors are']);
  assert.deepEqual(hazards('Mail alice@uni.edu or see https://alice.github.io/x'),
    ['note This link may reveal who the authors are', 'note This link may reveal who the authors are']);
  assert.deepEqual(hazards('See https://bit.ly/3abc for the logs.'), ['warn Shortened URL']);
  assert.deepEqual(hazards('Code: https://anonymous.4open.science/r/method-1234 and https://github.com/ and [ours](/forum?id=x).'), []);
  assert.deepEqual(hazards('Ordinary https://example.org/data link.'), []);
});

test('no link hazards inside code', () => {
  assert.deepEqual(hazards('Run `git clone https://github.com/alice/method`.', 'neurips'), []);
  assert.deepEqual(hazards('```\nhttps://bit.ly/3abc\n```', 'icml'), []);
});

test('NeurIPS, AAAI and ARR: every link is an error; a labelled link can keep its words', () => {
  for (const venue of ['neurips', 'aaai', 'arr']) {
    const name = A.venueById(venue).name.replace(/ \(.*\)$/, '');
    assert.deepEqual(hazards('See [the logs](https://example.org/logs) and https://example.org/b.', venue),
      ['err Links are not allowed at ' + name, 'err Links are not allowed at ' + name]);
  }
  const res = A.analyze('See [the logs](https://example.org/logs).', { venue: 'neurips' });
  const iss = [...res.issues].find((i) => /not allowed/.test(i.title));
  assert.equal(iss.fix.manual, true);
  const fixed = A.applyEditsToText('See [the logs](https://example.org/logs).', iss.fix.edits);
  assert.equal(fixed, 'See the logs.');
  assert.equal(renderHtml(fixed), '<p>See the logs.</p>\n');
  // A link back into the forum is flagged more softly.
  assert.deepEqual(hazards('As in [our reply](/forum?id=abc&noteId=def).', 'neurips'), ['warn Links are not allowed at NeurIPS']);
});

test('ICML: shortened URLs are errors, identifying links warnings, others fine', () => {
  assert.deepEqual(hazards('https://bit.ly/3abc', 'icml'), ['err Shortened URL']);
  assert.deepEqual(hazards('[repo](https://github.com/alice/method)', 'icml'), ['warn This link may reveal who the authors are']);
  assert.deepEqual(hazards('[data](https://example.org/data)', 'icml'), []);
});

test('ICLR and no venue leave ordinary links alone; Fix all never removes a link', () => {
  assert.deepEqual(hazards('[data](https://example.org/data)', 'iclr'), []);
  const src = 'See [the logs](https://example.org/logs).';
  assert.equal(A.fixAllText(src).text, src);
});

test('every venue preset names its rule and an official source', () => {
  assert.match(A.VENUES_CHECKED, /^\d{4}-\d{2}-\d{2}$/);
  for (const v of A.VENUES) {
    assert.ok(/^https:\/\//.test(v.source), v.id);
    assert.ok(v.rule.length > 20, v.id);
    assert.ok(['none', 'anon', 'any'].includes(v.links), v.id);
    assert.ok(v.limit === null || (Number.isInteger(v.limit) && v.limit > 0), v.id);
  }
});
