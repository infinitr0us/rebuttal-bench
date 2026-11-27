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

test('NeurIPS and AAAI: every link is an error, ARR: every external one; a labelled link can keep its words', () => {
  for (const venue of ['neurips', 'aaai', 'arr']) {
    const name = A.venueById(venue).name.replace(/ \(.*\)$/, '');
    const title = (venue === 'arr' ? 'External links are' : 'Links are') + ' not allowed at ' + name;
    assert.deepEqual(hazards('See [the logs](https://example.org/logs) and https://example.org/b.', venue),
      ['err ' + title, 'err ' + title]);
  }
  // ARR forbids external links: one into the forum is not external, however it is written;
  // a protocol-relative //host leaves OpenReview.
  assert.deepEqual(hazards('As in [our reply](/forum?id=abc&noteId=def), [this](?id=abc&noteId=x), [that](./forum?id=abc), ' +
    '[above](#reply) and https://openreview.net/forum?id=abc.', 'arr'), []);
  assert.deepEqual(hazards('See [results](//example.org/results).', 'arr'), ['err External links are not allowed at ACL ARR']);
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

test('ICLR, the OpenReview defaults and no venue leave ordinary links alone; Fix all never removes a link', () => {
  for (const venue of ['iclr', 'or-comment', 'or-rebuttal', undefined]) {
    assert.deepEqual(hazards('[data](https://example.org/data)', venue), [], venue);
  }
  const src = 'See [the logs](https://example.org/logs).';
  assert.equal(A.fixAllText(src).text, src);
});

test('ICLR: links must be anonymous; a shortener, which can track visitors, gets a warning (only ICML names them)', () => {
  assert.deepEqual(hazards('https://bit.ly/3abc', 'iclr'), ['warn Shortened URL']);
  assert.deepEqual(hazards('[repo](https://github.com/alice/method)', 'iclr'), ['warn This link may reveal who the authors are']);
  assert.deepEqual(hazards('[repo](https://anonymous.4open.science/r/method-1234)', 'iclr'), []);
});

test('the NeurIPS link card names the one exception, a code link for the AC', () => {
  const iss = [...A.analyze('See [code](https://example.org/c).', { venue: 'neurips' }).issues]
    .find((i) => /not allowed/.test(i.title));
  assert.match(iss.detail, /Official Comment/);
  // A link into the forum: a warning, and no promise that it may be tolerated.
  for (const venue of ['neurips', 'aaai']) {
    const own = [...A.analyze('See [our reply](/forum?id=abc).', { venue }).issues].find((i) => /not allowed/.test(i.title));
    assert.equal(own.sev, 'warn', venue);
    assert.doesNotMatch(own.detail, /tolerated|makes no exception/, venue);
  }
});

test('every venue preset names its rule, the year of its rules and an official source', () => {
  assert.match(A.VENUES_CHECKED, /^\d{4}-\d{2}-\d{2}$/);
  const ids = new Set();
  for (const v of A.VENUES) {
    assert.ok(!ids.has(v.id), v.id);
    ids.add(v.id);
    assert.ok(/^https:\/\//.test(v.source), v.id);
    assert.ok(v.rule.length > 20, v.id);
    assert.ok(typeof v.label === 'string' && v.label.length > 2, v.id);
    assert.ok(['none', 'external', 'anon', 'any'].includes(v.links), v.id);
    assert.equal(typeof v.linksBrief, 'string', v.id);
    assert.ok(!v.also || v.also.every((u) => /^https:\/\//.test(u)), v.id);
    assert.ok(v.limit === null || (Number.isInteger(v.limit) && v.limit > 0), v.id);
    // A preset with a number says what it counts; one without has no unit.
    assert.ok(v.limit === null ? v.unit === null : typeof v.unit === 'string' && v.unit.length > 2, v.id);
  }
  // The ids are stored in the preferences: renaming one would forget a choice.
  for (const id of ['neurips', 'icml', 'aaai', 'arr', 'iclr']) assert.ok(A.venueById(id), id);
});
