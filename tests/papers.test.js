'use strict';
// Papers: drafts grouped by the paper they answer. The record is a
// last-writer-wins map of single values with no deletions; these tests pin
// down what makes it safe: any order of merges converges, a later change is
// never undone by a stale one, values and fields this version does not know
// survive, and every draft lands in exactly one group. Design note and
// Fable's review: reviews/2026-11-28.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAnalyzer } = require('./lib/page');

const A = loadAnalyzer();
const ser = (r) => A.serializePapers(r);
// Copies out of the VM: its arrays and objects belong to another realm.
const plain = (x) => JSON.parse(JSON.stringify(x));
const parse = (x) => A.parsePapers(x);
const merge = (a, b) => A.mergePapers(a, b);

/* A small deterministic generator, so a failure reproduces. */
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
const pick = (r, xs) => xs[Math.floor(r() * xs.length)];
function randomRecord(r) {
  const o = { version: 1 };
  for (const map of ['name', 'venue', 'limit', 'member', 'future']) {
    if (r() < 0.2) continue;
    o[map] = {};
    const n = Math.floor(r() * 6);
    for (let i = 0; i < n; i++) {
      const id = map === 'member' ? pick(r, ['d1', 'd2', 'd3', 'd4']) : pick(r, ['pa', 'pb', 'pc']);
      const v = map === 'name' ? pick(r, ['ICML', 'ARR', 'NeurIPS', '']) : map === 'venue' ? pick(r, ['icml', '', 'arr', 'zz'])
        : map === 'limit' ? pick(r, [5000, 2500, null]) : map === 'member' ? pick(r, ['pa', 'pb', 'pc', ''])
        : { x: pick(r, [1, 2]), y: pick(r, ['a', 'b']) };
      // Few distinct stamps, so ties are common.
      o[map][id] = { v, at: pick(r, [1, 2, 3]) };
    }
  }
  return parse(JSON.stringify(o));
}

test('the merge is commutative, associative and idempotent on random records', () => {
  const r = rng(42);
  for (let i = 0; i < 400; i++) {
    const a = randomRecord(r), b = randomRecord(r), c = randomRecord(r);
    assert.equal(ser(merge(a, b)), ser(merge(b, a)), 'commutative');
    assert.equal(ser(merge(merge(a, b), c)), ser(merge(a, merge(b, c))), 'associative');
    assert.equal(ser(merge(a, a)), ser(a), 'idempotent');
    assert.equal(ser(merge(a, parse(ser(a)))), ser(a), 'a stored copy merges back to itself');
  }
});

test('the per-map cap keeps the merge convergent', () => {
  const kept = A.PAPERS_KEPT.member, other = A.PAPERS_KEPT_OTHER;
  A.PAPERS_KEPT.member = 2;
  A.PAPERS_KEPT_OTHER = 2;
  try {
    const r = rng(7);
    for (let i = 0; i < 400; i++) {
      const a = randomRecord(r), b = randomRecord(r), c = randomRecord(r);
      assert.equal(ser(merge(a, b)), ser(merge(b, a)));
      assert.equal(ser(merge(merge(a, b), c)), ser(merge(a, merge(b, c))));
      for (const map of Object.keys(merge(a, b).maps)) assert.ok(Object.keys(merge(a, b).maps[map]).length <= 2);
    }
  } finally {
    A.PAPERS_KEPT.member = kept;
    A.PAPERS_KEPT_OTHER = other;
  }
});

test('parsing tolerates garbage and keeps what it does not know', () => {
  for (const bad of [null, undefined, '', 'not json', '[]', '42', '{"version":1,"name":[]}']) {
    const p = parse(bad);
    assert.equal(p.newer, false);
    assert.equal(ser(p), ser(parse('{}')));
  }
  const p = parse(JSON.stringify({
    version: 1,
    name: { pa: { v: 'ICML', at: 5, by: 'device 2' }, 'bad id!': { v: 'x', at: 1 }, pb: { v: 'ARR', at: Infinity } },
    later: { pa: { v: { kind: 'round', n: 2 }, at: 3 } },
    member: { d1: { at: 2 } },
  }));
  assert.deepEqual(Object.keys(p.maps.name), ['pa'], 'bad ids and non-finite stamps are dropped');
  assert.equal(p.maps.name.pa.by, 'device 2', 'an unknown field of an entry is kept');
  assert.deepEqual(plain(p.maps.later.pa.v), { kind: 'round', n: 2 }, 'an unknown map is kept');
  assert.deepEqual(Object.keys(p.maps.member), [], 'an entry without a value is dropped');
  // Shuffled keys serialize alike.
  assert.equal(ser(parse('{"name":{"pa":{"at":1,"v":"X"}},"version":1}')), ser(parse('{"version":1,"name":{"pa":{"v":"X","at":1}}}')));
});

test('a record written by a later version is read but marked, also through a merge', () => {
  const newer = parse(JSON.stringify({ version: 2, name: { pa: { v: 'ICML', at: 1 } } }));
  assert.equal(newer.newer, true);
  assert.equal(A.paperName(newer, 'pa'), 'ICML');
  assert.equal(merge(parse('{}'), newer).newer, true);
  assert.equal(merge(newer, parse('{}')).version, 2);
});

test('a change is stamped after the entry it replaces, and setting the same value changes nothing', () => {
  let rec = parse('{}');
  rec = A.setPaperEntry(rec, 'member', 'd1', 'pa', 1000);
  // A clock five minutes behind cannot undo it.
  const later = A.setPaperEntry(rec, 'member', 'd1', 'pb', 1000 - 300000);
  assert.equal(later.maps.member.d1.at, 1001);
  assert.equal(merge(rec, later).maps.member.d1.v, 'pb');
  assert.equal(A.setPaperEntry(later, 'member', 'd1', 'pb', 5000), later);
  // One value per entry: a stale device's venue change keeps a newer rename.
  let base = A.setPaperEntry(parse('{}'), 'name', 'pa', 'ICML', 1);
  base = A.setPaperEntry(base, 'venue', 'pa', 'icml', 1);
  const renamed = A.setPaperEntry(base, 'name', 'pa', 'ICML #1234', 10);
  const venued = A.setPaperEntry(base, 'venue', 'pa', 'arr', 20);
  const both = merge(renamed, venued);
  assert.equal(A.paperName(both, 'pa'), 'ICML #1234');
  assert.equal(both.maps.venue.pa.v, 'arr');
});

test('the view puts every listed draft in exactly one group', () => {
  const r = rng(3);
  for (let i = 0; i < 300; i++) {
    const rec = randomRecord(r);
    const list = ['d1', 'd2', 'd3', 'd4', 'd5'].filter(() => r() < 0.8).map((id) => ({ id }));
    const view = A.papersView(list, rec);
    const seen = view.none.concat(...view.papers.map((p) => p.drafts));
    assert.deepEqual([...seen].sort(), list.map((d) => d.id).sort());
    for (const p of view.papers) {
      assert.ok(p.name, 'a shown paper has a name');
      for (const d of p.drafts) assert.equal(view.paperOf[d], p.id);
    }
  }
});

test('memberships of drafts the list lacks are inert, and come back with the draft', () => {
  let rec = A.setPaperEntry(parse('{}'), 'name', 'pa', 'ICML', 1);
  rec = A.setPaperEntry(rec, 'member', 'd5', 'pa', 2);
  rec = A.setPaperEntry(rec, 'member', 'd1', 'pa', 2);
  // d5 deleted here (not listed): inert, and no paper shows without drafts.
  let view = A.papersView([{ id: 'd1' }], rec);
  assert.deepEqual(plain(view.papers.map((p) => p.drafts)), [['d1']]);
  assert.deepEqual(plain(A.papersView([{ id: 'd2' }], rec).papers), []);
  // Re-created with the same id elsewhere: still in its paper.
  view = A.papersView([{ id: 'd1' }, { id: 'd5' }], rec);
  assert.deepEqual(plain(view.papers[0].drafts), ['d1', 'd5']);
  // A membership naming no paper counts as none.
  rec = A.setPaperEntry(rec, 'member', 'd2', 'pz', 3);
  assert.deepEqual(plain(A.papersView([{ id: 'd2' }], rec).none), ['d2']);
});

test('papers appear in the order of their first draft, drafts in tab order', () => {
  let rec = parse('{}');
  rec = A.setPaperEntry(rec, 'name', 'pa', 'ICML', 1);
  rec = A.setPaperEntry(rec, 'name', 'pb', 'ARR', 1);
  for (const [d, p] of [['d1', 'pb'], ['d2', 'pa'], ['d3', 'pb'], ['d5', 'pa']]) rec = A.setPaperEntry(rec, 'member', d, p, 2);
  const view = A.papersView(['d1', 'd2', 'd3', 'd4', 'd5'].map((id) => ({ id })), rec);
  assert.deepEqual(plain(view.papers.map((p) => [p.name, p.drafts])), [['ARR', ['d1', 'd3']], ['ICML', ['d2', 'd5']]]);
  assert.deepEqual(plain(view.none), ['d4']);
});

test('a paper of the same name is found again, in any capitals', () => {
  let rec = A.setPaperEntry(parse('{}'), 'name', 'pa1', 'ICML #1234', 1);
  rec = A.setPaperEntry(rec, 'name', 'pb2', 'ARR', 1);
  assert.equal(A.paperNamed(rec, '  icml   #1234 '), 'pa1');
  assert.equal(A.paperNamed(rec, 'NeurIPS'), null);
  assert.equal(A.paperNamed(rec, ''), null);
});

test('a paper\'s venue and limit, inheriting the global ones until it has its own', () => {
  let rec = A.setPaperEntry(parse('{}'), 'name', 'pa', 'ICML', 1);
  // No entry: as under "No paper", so grouping changes no card.
  assert.equal(A.paperVenue(rec, 'pa', 'neurips'), 'neurips');
  assert.equal(A.paperLimit(rec, 'pa', 10000, 4200), 10000);
  assert.equal(A.paperVenue(rec, '', 'neurips'), 'neurips');
  assert.equal(A.paperLimit(rec, '', 10000, 4200), 10000);
  // A venue of its own, with a number, then without one (ICLR), then Custom.
  rec = A.setPaperEntry(rec, 'venue', 'pa', 'icml', 2);
  assert.equal(A.paperVenue(rec, 'pa', 'neurips'), 'icml');
  assert.equal(A.paperLimit(rec, 'pa', 10000, 4200), 5000);
  rec = A.setPaperEntry(rec, 'venue', 'pa', 'iclr', 3);
  assert.equal(A.paperLimit(rec, 'pa', 10000, 4200), 4200);
  rec = A.setPaperEntry(rec, 'venue', 'pa', '', 4);
  assert.equal(A.paperVenue(rec, 'pa', 'neurips'), '');
  assert.equal(A.paperLimit(rec, 'pa', 10000, 4200), 4200);
  // A limit typed in the paper wins until the venue changes (it is set to null then).
  rec = A.setPaperEntry(rec, 'limit', 'pa', 3000, 5);
  assert.equal(A.paperLimit(rec, 'pa', 10000, 4200), 3000);
  rec = A.setPaperEntry(rec, 'venue', 'pa', 'icml', 6);
  rec = A.setPaperEntry(rec, 'limit', 'pa', null, 6);
  assert.equal(A.paperLimit(rec, 'pa', 10000, 4200), 5000);
  // A venue id this version does not know counts as the global one.
  rec = A.setPaperEntry(rec, 'venue', 'pa', 'venue-of-2028', 7);
  assert.equal(A.paperVenue(rec, 'pa', 'arr'), 'arr');
  assert.equal(A.paperLimit(rec, 'pa', 5000, 4200), 5000);
});

test('tab names suggest papers by a shared first word, never by a reviewer', () => {
  const groups = (names) => [...A.prefixGroups(names.map((name, i) => ({ id: 'd' + i, name })))]
    .map((g) => [g.name, [...g.drafts]]);
  assert.deepEqual(groups(['P2 R1', 'P2 R2', 'P2 General', 'P3 R1', 'P3 R2', 'Notes']),
    [['P2', ['d0', 'd1', 'd2']], ['P3', ['d3', 'd4']]]);
  assert.deepEqual(groups(['ICML-R1', 'ICML - R2', 'NeurIPS: R1', 'NeurIPS: Ab12', '[ARR] R3', '[ARR] General']),
    [['ICML', ['d0', 'd1']], ['NeurIPS', ['d2', 'd3']], ['ARR', ['d4', 'd5']]]);
  // Near misses: reviewers, kinds of answers, a single draft.
  assert.deepEqual(groups(['R1', 'R2', 'R3']), []);
  assert.deepEqual(groups(['Reviewer Ab12', 'Reviewer Cd34']), []);
  assert.deepEqual(groups(['Ab12 W1', 'Ab12 Q2', 'k9F2 part 2', 'k9F2 follow-up']), []);
  assert.deepEqual(groups(['R1 follow-up', 'R1 final', 'Rev. 2 draft', 'Rev. 2 final']), []);
  assert.deepEqual(groups(['Response to R1', 'Response to R2', 'Draft 1', 'Draft 2', 'General response', 'General notes']), []);
  assert.deepEqual(groups(['ICML R1', 'ARR R1']), []);
});

test('an export carries each draft\'s paper and venue, and 3.12 still reads the file', () => {
  const file = A.draftsFile([
    { name: 'R1', text: 'a', paper: 'ICML #1234', venue: 'icml' },
    { name: 'R1', text: 'b', paper: 'ARR', venue: '' },
    { name: 'Notes', text: 'c' },
  ], Date.UTC(2026, 10, 28));
  const v = JSON.parse(file);
  assert.equal(v.version, 1);
  assert.deepEqual(v.drafts, [
    { name: 'R1', text: 'a', paper: 'ICML #1234', venue: 'icml' },
    { name: 'R1', text: 'b', paper: 'ARR', venue: '' },
    { name: 'Notes', text: 'c' },
  ]);
  const got = A.readDraftsFile(file, 'drafts.json');
  assert.deepEqual(JSON.parse(JSON.stringify(got.drafts)), v.drafts);
  // An unknown venue id is dropped, a paper name is cleaned.
  const odd = A.readDraftsFile(JSON.stringify({ format: 'rebuttal-bench-drafts', version: 1,
    drafts: [{ name: 'R1', text: 'x', paper: '  ICML   #1 ', venue: 'nope' }] }), 'x.json');
  assert.deepEqual(JSON.parse(JSON.stringify(odd.drafts)), [{ name: 'R1', text: 'x', paper: 'ICML #1' }]);
});

test('import names are unique per paper, texts across papers', () => {
  const plan = A.importPlan(
    [{ name: 'R1', text: 'one', scope: 'pa' }, { name: 'R2', text: null, scope: 'pa' }, { name: 'R1', text: 'three', scope: 'pb' }],
    [{ name: 'R1', text: 'new', scope: 'pb', paper: 'ARR' }, { name: 'R1', text: 'new2', scope: 'pc' }, { name: 'Copy', text: 'one', scope: 'pc' }],
  );
  assert.deepEqual(JSON.parse(JSON.stringify(plan.add)), [
    { name: 'R1 (2)', text: 'new', scope: 'pb', paper: 'ARR' },
    { name: 'R1', text: 'new2', scope: 'pc' },
  ]);
  assert.equal(plan.same, 1);
  assert.deepEqual([...plan.sameIn], ['pa']);
  // Without scopes it behaves as before.
  const old = A.importPlan([{ name: 'R1', text: 'x' }], [{ name: 'R1', text: 'y' }, { name: 'R2', text: 'x' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(old.add)), [{ name: 'R1 (2)', text: 'y' }]);
  assert.equal(old.same, 1);
});

test('paperNameFromFile cleans a file base name and falls back when empty', () => {
  assert.equal(A.paperNameFromFile('ICML #1234.json'), 'ICML #1234');
  assert.equal(A.paperNameFromFile('C:\\Users\\a\\rebuttals\\neurips-2026.MD'), 'neurips-2026');
  assert.equal(A.paperNameFromFile('/tmp/dir/  My   Paper.txt'), 'My Paper');
  assert.equal(A.paperNameFromFile('notes.markdown'), 'notes');
  assert.equal(A.paperNameFromFile('.json'), 'Imported');
  assert.equal(A.paperNameFromFile(''), 'Imported');
});

test('formatSameIn names where skipped drafts live, deduplicated and bounded', () => {
  const names = { pa: 'ICML #1234', pb: 'ARR', pc: 'NeurIPS', pd: 'ICLR', '': 'No paper' };
  const label = (s) => names[s] || '';
  assert.equal(A.formatSameIn(['pa', 'pa'], label), ', in ICML #1234');
  assert.equal(A.formatSameIn(['pa', 'pb', 'pa'], label), ', in ICML #1234 and ARR');
  assert.equal(A.formatSameIn(['pa', 'pb', 'pc'], label), ', in ICML #1234, ARR and 1 other');
  assert.equal(A.formatSameIn(['pa', 'pb', 'pc', 'pd'], label), ', in ICML #1234, ARR and 2 others');
  assert.equal(A.formatSameIn([''], label), ', in No paper');
  assert.equal(A.formatSameIn([''], () => ''), '');
  assert.equal(A.formatSameIn([], label), '');
});
