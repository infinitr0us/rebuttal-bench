'use strict';
// A short, deterministic slice of the differential fuzzer (see lib/fuzz.js).
// FUZZ_N raises the count; `npm run fuzz` runs long, random-seeded sessions.
const test = require('node:test');
const assert = require('node:assert/strict');
const { runFuzz } = require('./lib/fuzz');
const { loadAnalyzer } = require('./lib/page');

const A = loadAnalyzer();
const N = Number(process.env.FUZZ_N) || 600;

// Inputs the fuzzer once caught the model getting wrong. Keep adding to this.
const KNOWN = [
  // math in a table cell beyond the header's width: Marked drops the cell
  '\\\\$\\|\n    }\\begin{m}\n\n| h | k |\n| - | - |\n\\\\ || $\\)$a',
  // an indented continuation line: Marked's token raw gains an extra "\n"
  '\\)a$\n    \\\\($$\n| --- | --- |\n$$\n    `q`\n  - ',
  // a code span with a shielded pipe in a table cell: GFM unescapes \| first
  '| cmd | k |\n| - | - |\n| `echo $A \\| grep $B` | 1 |',
];
const { renderLikeOpenReview } = require('./lib/pipeline');
KNOWN.forEach((src, k) => {
  test(`known tricky input #${k + 1}`, () => {
    const want = renderLikeOpenReview(src).items.map((i) => (i.display ? 'D:' : 'I:') + i.tex);
    const got = [...A.analyze(src).spans].filter((s) => !s.recovered).map((s) => (s.display ? 'D:' : 'I:') + s.tex);
    const norm = (xs) => xs.map((s) => s.replace(/\n[ \t]+/g, '\n'));
    assert.deepEqual(norm(got), norm(want));
  });
});

for (const [alphabet, seed] of [['inline', 7], ['inline', 123], ['blocks', 5], ['blocks', 99]]) {
  test(`MathJax model matches the real pipeline (${alphabet}, seed ${seed})`, () => {
    const r = runFuzz({ n: N, seed, alphabet, A });
    const first = r.mismatches[0];
    assert.equal(r.mismatches.length, 0, first && 'e.g. ' + JSON.stringify(first.src) +
      '\n  truth: ' + JSON.stringify(first.want) + '\n  model: ' + JSON.stringify(first.got));
  });
}
