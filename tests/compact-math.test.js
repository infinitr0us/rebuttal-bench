'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadAnalyzer, readExample } = require('./lib/page');
const { renderHtml } = require('./lib/pipeline');
const { mathml, renderedWithMathML } = require('./lib/mathml');
const A = loadAnalyzer();
const defaults = A.compactDefaults();
const compact = (src, options = { mathml }) => A.compactText(src, defaults, renderHtml, options);
const raw = String.raw;

function assertEquivalent(src, result) {
  assert.equal(renderedWithMathML(result), renderedWithMathML(src), JSON.stringify(src));
  if (result !== result.trim() || src !== src.trim()) {
    assert.equal(renderedWithMathML(result.trim()), renderedWithMathML(src.trim()), 'posted ' + JSON.stringify(src));
  }
}

const cases = [
  ['spaces and command terminators', raw`$ x + \alpha  b = 1 $`, raw`$x+\alpha b=1$`],
  ['numeric tokens', '$1 2$', null],
  ['control words as arguments keep token boundaries', '$\\frac{\\alpha}{b}+\\sqrt{\\beta}x$', '$\\frac\\alpha b+\\sqrt\\beta x$'],
  ['text-mode commands, nested braces and verb delimiters',
    raw`$\text{a {b c} d}+\mbox{e f}+\textrm{g h}+\operatorname*{arg max}+\verb |a b|$`, null],
  ['control spaces and TeX comments', '$x\\ y%   keep  \\leq and {1}\n+z$', null],
  ['command arguments', raw`$\frac{1}{2}+\frac{a}{b}+\hat{x}+\mathcal{L}+\sqrt{2}$`, raw`$\frac12+\frac ab+\hat x+\mathcal L+\sqrt2$`],
  ['grouped multi-token arguments', raw`$\frac{ab}{xy}+\sqrt{12}$`, null],
  ['aliases in context', raw`$a\leq b\neq c\geq d\leftarrow e\wedge f$`, raw`$a\le b\ne c\ge d\gets e\land f$`],
  ['bare matrix with a following letter', raw`\begin{pmatrix}x\\\\y\end{pmatrix}`, raw`\begin{pmatrix}x\cr y\end{pmatrix}`],
  ['row gap', raw`$\begin{matrix}a\\\\[2pt]b\end{matrix}$`, null],
  ['row command before a letter', raw`$\begin{matrix}a\cr b\end{matrix}$`, null],
  ['row break outside a row environment', raw`$a\\\\b$`, null],
  ['display wrapper', raw`$$\begin{align}a&=b\end{align}$$`, raw`\begin{align}a&=b\end{align}`],
  ['inline matrix remains inline', raw`$\begin{pmatrix}a\end{pmatrix}$`, null],
  ['two environments in one wrapper', raw`$$\begin{matrix}a\end{matrix}\begin{matrix}b\end{matrix}$$`, null],
  ['defined earlier in the comment', raw`$\newcommand{\le}{T}$ then $ a \leq b $`, raw`$\newcommand{\le}{T}$ then $a\leq b$`],
  ['label and references in either order', raw`See \ref{x}. $$\begin{align}a &= b\tag{q}\label{x}\end{align}$$ Again \eqref{x}.`, raw`See \ref{x}. \begin{align}a&=b\tag{q}\label{x}\end{align} Again \eqref{x}.`],
  ['emphasis splits a formula', raw`$ x *y* \leq z $`, null],
  ['trimming exposes a second input', '    $ x + y $\n\n$ a + b $  ', '    $ x + y $\n\n$a+b$  '],
  ['alias redefined only in the posted view', '    $\\def\\le{T}$\n\n$a\\leq b$', null],
  ['a decoded CR ends a TeX comment when the sanitized HTML is parsed again',
    '$x%comment&#13;\\def\\le{T}$ then $a\\leq b$', null],
  ['hard break in a formula', 'See $x +  \ny$ now.', 'See $x+y$ now.'],
];

for (const env of ['aligned', 'cases', 'array']) {
  const first = env === 'array' ? '{cc}' : '';
  cases.push([env + ' rows', '$\\begin{' + env + '}' + first + 'a&b' + '\\'.repeat(4) + '1&2\\end{' + env + '}$',
    '$\\begin{' + env + '}' + first + 'a&b\\cr1&2\\end{' + env + '}$']);
}

for (const [name, src, want] of cases) {
  test('math compaction: ' + name, () => {
    const r = compact(src);
    assert.equal(r.text, want === null ? src : want);
    assertEquivalent(src, r.text);
    assert.equal(compact(r.text).text, r.text);
  });
}

test('the MathML gate itself refuses different script structure and arrow attributes', () => {
  const src = raw`$x^{2}+a_{i}$ and $a\rightarrow b$`;
  const r = compact(src);
  assert.equal(r.text, src);
  assert.equal(r.tricks.find(t => t.id === 'mathArgs').kept, 2);
  assert.equal(r.tricks.find(t => t.id === 'mathAliases').kept, 1);
});

test('inline markup around a formula is eligible, but a split span proposes no math edits', () => {
  const r = compact('*$ a + b $* and $ x *y* z $');
  assert.equal(r.text, '*$a+b$* and $ x *y* z $');
  assert.equal(r.tricks.find(t => t.id === 'mathSpace').kept, 0);
});

test('missing, throwing or incomplete converters report unchecked edits as skipped', () => {
  for (const converter of [undefined, () => null, () => { throw Error(); }, () => [], () => [false]]) {
    const r = compact('## Title ##\n\n$ x $', { mathml: converter });
    assert.equal(r.text, '## Title\n\n$ x $');
    const s = r.tricks.find(t => t.id === 'mathSpace');
    assert.ok(s.unavailable);
    assert.equal(s.kept, 0);
    assert.equal(s.skipped, 2);
  }
});

test('identical elementary inputs use one conversion across formulas, views and tricks', () => {
  const seen = [];
  const r = compact(raw` $ x $ $\frac{1}{2}$ $ x $ `, { mathml(batch) {
    seen.push(...batch.map(f => JSON.stringify([f.display, f.tex])));
    return mathml(batch);
  } });
  assert.ok(r.saved > 0);
  assert.ok(seen.length > 0);
  assert.equal(new Set(seen).size, seen.length);
});

test('a disabled formula trick only reports what it could save', () => {
  const r = A.compactText('$ a\\leq b $', { ...defaults, mathAliases: false }, renderHtml, { mathml });
  assert.equal(r.text, '$a\\leq b$');
  const s = r.tricks.find(t => t.id === 'mathAliases');
  assert.equal(s.on, false);
  assert.equal(s.saved, 1);
});

test('a deadline during conversion leaves unchecked edits for a later run', () => {
  const a = loadAnalyzer();
  let ms = 0;
  a.Date = { now: () => ms };
  const r = a.compactText('$ x $', defaults, renderHtml, { ms: 10, mathml(batch, expired) {
    ms = 20;
    assert.ok(expired());
    return null;
  } });
  const spaces = r.tricks.find(t => t.id === 'mathSpace');
  assert.equal(r.text, '$ x $');
  assert.equal(r.complete, false);
  assert.equal(spaces.kept, 0);
  assert.equal(spaces.skipped, 2);
});

test('the math gate checks delimiter kind and every intervening HTML fragment', () => {
  const a = loadAnalyzer();
  let proposal;
  a.COMPACT_TRICKS.push({ id: 'probe', math: true, find(src) {
    return src === proposal[0] ? [a.compactEdit(src, 0, src.length, proposal[1])] : [];
  } });
  for (proposal of [
    ['\\\\(x\\\\)', '$x$'], ['$$x$$', '$x$'], ['$x$ and $y$', '$y$ and $x$'],
    ['$x$ and $x$', '$x$$x$ and '], ['a $x$ b', 'a $x$ c'], ['*x* $y$', 'x $y$'],
  ]) {
    const r = a.compactText(proposal[0], { probe: true }, renderHtml, { mathml });
    assert.equal(r.text, proposal[0]);
    assert.equal(r.tricks.find(t => t.id === 'probe').kept, 1);
  }
});

test('rendered formula offsets span entities and HTML line endings and omit literal nulls', () => {
  const v = A.renderedMath('<p>&lt; &#36;a\0b\r\nc<br>d&amp;e&#36; &gt;</p>', true);
  assert.deepEqual(Array.from(v.outside), ['<p>&lt; ', ' &gt;</p>']);
  assert.equal(v.formulas[0].tex, 'ab\nc\nd&e');
});

test('the two fixtures and the built-in example have reproducible math savings', () => {
  for (const [file, savings] of [
    ['padded-tables.md', [0, 11, 4, 1, 4]], ['example', [0, 4, 0, 0, 0]],
    ['theory-response.md', [2, 52, 20, 3, 8]],
  ]) {
    const src = file === 'example' ? readExample() : fs.readFileSync(path.join(__dirname, 'fixtures', file), 'utf8');
    const r = compact(src);
    assert.deepEqual(Array.from(r.tricks).filter(t => t.id.startsWith('math')).map(t => t.saved), savings);
    assertEquivalent(src, r.text);
    assert.equal(compact(r.text).text, r.text);
  }
});

test('generated mixed documents agree with real DOM FindTeX and document-order MathML', () => {
  let seed = 75491;
  const next = n => Math.floor(((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000) * n);
  const formulas = [raw`a \leq b`, raw`\frac{1}{2}`, raw`\text{b c}`, raw`\verb|d e|`, raw`a^{2}`, raw`\hat{x}`,
    '1 2', 'x *z* y', ' a &lt; b ', 'x  \ny', raw`\begin{matrix}1\\\\2\end{matrix}`, raw`\eqref{foo}`];
  const prefixes = ['', '  ', raw`$\def\le{w}$ Then `, raw`\begin{equation}x\tag{Q}\label{foo}\end{equation} `];
  const delims = [['$', '$'], ['$$', '$$'], [raw`\\(`, raw`\\)`], ['&#36;', '&#36;']];
  const enabled = Object.fromEntries(Array.from(A.COMPACT_TRICKS).map(t => [t.id, !!t.math]));
  for (let i = 0; i < 60; i++) {
    let src = prefixes[next(prefixes.length)];
    const n = 2 + next(6);
    for (let j = 0; j < n; j++) {
      const [l, r] = delims[next(delims.length)];
      src += l + formulas[next(formulas.length)] + r + [' ', '\n\n', ' and ', ' / '][next(4)];
    }
    const result = A.compactText(src, enabled, renderHtml, { mathml });
    assertEquivalent(src, result.text);
    const before = A.issueCounts(A.analyze(src).issues);
    for (const [kind, count] of Object.entries(A.issueCounts(A.analyze(result.text).issues))) {
      assert.ok(count <= (before[kind] || 0), kind + ' in ' + src);
    }
    assert.equal(A.compactText(result.text, enabled, renderHtml, { mathml }).text, result.text, JSON.stringify(src));
  }
});
