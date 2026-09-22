'use strict';
// Access to the page under test. The analyzer lives in rebuttal-bench.html
// between two banner comments and never touches the DOM, so it can run in a
// plain VM with the real Marked configured exactly as OpenReview configures it.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { marked } = require('marked');
require('./pipeline'); // applies OpenReview's marked.setOptions() before any lexing

// RB_PAGE points the suite at another copy, e.g. an older version from git:
//   git show 7501f14:rebuttal-bench_v2.html > old.html && RB_PAGE=old.html npm test
const PAGE = process.env.RB_PAGE
  ? path.resolve(process.env.RB_PAGE)
  : path.join(__dirname, '..', '..', 'rebuttal-bench.html');
const BANNER_START = '/* ================= pure analysis ================= */';
const BANNER_END = '/* ================= dom wiring ================= */';

function readPage(file = PAGE) {
  return fs.readFileSync(file, 'utf8');
}

/** The analyzer section's globals (analyze, fixAllText, mjFind, …) as one object. */
function loadAnalyzer(file = PAGE) {
  const html = readPage(file);
  const a = html.indexOf(BANNER_START);
  const b = html.indexOf(BANNER_END);
  if (a < 0 || b < 0 || b < a) throw new Error('analysis banners not found in ' + file);
  const ctx = { window: { marked } };
  vm.createContext(ctx);
  vm.runInContext(html.slice(a, b), ctx, { filename: 'rebuttal-bench.html#pure-analysis' });
  return ctx;
}

/** The built-in example draft (the EXAMPLE array in the DOM section). */
function readExample(file = PAGE) {
  const m = readPage(file).match(/var EXAMPLE = (\[[\s\S]*?\])\.join\('\\n'\);/);
  if (!m) throw new Error('EXAMPLE not found');
  return vm.runInNewContext(m[1]).join('\n');
}

/** Bodies of all inline <script> elements. */
function inlineScripts(file = PAGE) {
  return [...readPage(file).matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}

module.exports = { PAGE, BANNER_START, BANNER_END, readPage, loadAnalyzer, readExample, inlineScripts };
