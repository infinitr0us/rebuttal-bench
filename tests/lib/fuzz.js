'use strict';
// Differential fuzzing: the page's model of what MathJax will typeset (leaf
// regions -> Markdown-aware "MathJax view" -> FindTeX port) against the real
// pipeline in ./pipeline.js, on random documents built from tricky atoms.
//
// CLI:  npm run fuzz -- [iterations] [seed] [alphabet: inline|blocks]
const { renderLikeOpenReview } = require('./pipeline');
const { loadAnalyzer } = require('./page');

const ALPHABETS = {
  // escapes, delimiters, environments, paragraphs, hard breaks, headings, code spans
  inline: ['$', '$', '$$', '\\', '\\', '\\\\', '{', '}', '(', ')', '[', ']', 'a', 'b', 'x1', ' ', ' ', '\n',
    '\n\n', '\\begin{m}', '\\end{m}', '\\(', '\\)', '\\[', '\\]', '|', '- ', '# ', '`c`', '> ', '  \n', '&', '\\{', '\\}',
    '\\ref{a}', '\\eqref{', '\\end{'],
  // tables, nested lists, block quotes, indented code
  blocks: ['$', '$', '$$', '\\', '\\\\', '{', '}', 'a', 'x', ' ', '\n', '| ', ' |', '|', '\n| --- | --- |\n',
    '\n\n| h | k |\n| - | - |\n', '\n- ', '\n  - ', '\n1. ', '\n    ', '\n> ', '\n\n', '\\|', '\\(', '\\)',
    '\\\\(', '\\\\)', '`q`', '\\begin{m}', '\\end{m}'],
};

// Inline Markdown elements (emphasis, links) split MathJax's strings for reasons
// the analyzer reports as separate hazards, so those documents are skipped.
const SKIP_HTML = /<(em|strong|del|a|img)\b/;

function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
}

// What analyze() believes MathJax will typeset: its real (non-recovered) spans.
function modelTypeset(A, src) {
  return [...A.analyze(src).spans].filter((s) => !s.recovered).map((s) => (s.display ? 'D:' : 'I:') + s.tex);
}

// Leading whitespace on continuation lines differs by container type and never
// affects delimiter pairing, so results are compared modulo that.
const norm = (xs) => JSON.stringify(xs.map((s) => s.replace(/\n[ \t]+/g, '\n')));

function runFuzz({ n = 1000, seed = 1, alphabet = 'inline', A = loadAnalyzer() } = {}) {
  const atoms = ALPHABETS[alphabet];
  if (!atoms) throw new Error('unknown alphabet ' + alphabet);
  const rnd = makeRng(seed);
  const mismatches = [];
  let skipped = 0;
  for (let it = 0; it < n; it++) {
    let src = '';
    const len = 1 + Math.floor(rnd() * 14);
    for (let k = 0; k < len; k++) src += atoms[Math.floor(rnd() * atoms.length)];
    const t = renderLikeOpenReview(src);
    if (SKIP_HTML.test(t.html)) { skipped++; continue; }
    const want = t.items.map((i) => (i.display ? 'D:' : 'I:') + i.tex);
    let got;
    try { got = modelTypeset(A, src); } catch (e) { got = ['THREW ' + e.message]; }
    if (norm(want) !== norm(got)) mismatches.push({ src, html: t.html, want, got });
  }
  return { n, skipped, mismatches };
}

module.exports = { runFuzz, ALPHABETS };

if (require.main === module) {
  const [n = '5000', seed = String(Date.now() % 100000), alphabet = 'inline'] = process.argv.slice(2);
  const r = runFuzz({ n: +n, seed: +seed, alphabet });
  r.mismatches.slice(0, 15).forEach((m) => {
    console.log('MISMATCH ' + JSON.stringify(m.src));
    console.log('  html:  ' + JSON.stringify(m.html));
    console.log('  truth: ' + JSON.stringify(m.want));
    console.log('  model: ' + JSON.stringify(m.got));
  });
  console.log(`${alphabet} seed=${seed}: ${r.n} cases, ${r.skipped} skipped, ${r.mismatches.length} mismatches`);
  process.exitCode = r.mismatches.length ? 1 : 0;
}
