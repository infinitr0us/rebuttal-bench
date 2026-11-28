'use strict';
// Fix all and checks 1, 3 and 4 on what real authors write. The field audit
// (reviews/2026-11-27/codex-field-audit, 1,300 public author responses) found
// Fix all "repairing" ten formulas that already showed what their authors
// meant. Each reduced case must now render exactly as posted after Fix all,
// and the near misses next to them must still be repaired. Rendering is
// compared with the independent oracle (actual MathJax FindTeX over the DOM).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAnalyzer } = require('./lib/page');
const { renderedWithMathML } = require('./lib/mathml');

const A = loadAnalyzer();
const raw = String.raw;
const cards = (src) => [...A.analyze(src).issues];
const titled = (src, re) => cards(src).filter((i) => re.test(i.title));
const fixAll = (src) => A.fixAllText(src).text;
// The oracle keeps MathJax's processEscapes items as typed; the page shows
// "\$" as "$".
const shown = (src) => renderedWithMathML(src).replace(/\\\$/g, '$');
const rendersAsPosted = (src) => assert.equal(shown(fixAll(src)), shown(src), src);

test('Fix all leaves the audit\'s ten formulas as their authors posted them', () => {
  const posted = [
    raw`The marginal approximation (\$\tilde{P}\$) is robust.`,
    raw`A ($\approx$ **$484**) vs. B ($\approx$ **$1,500**).`,
    raw`> **Q1**: It costs \$12 each.
> **S1:** Calculate the tip.
> **F1:**
> 1. Cost = \$? × ?`,
    raw`$\|\|h_u-h_v\|\|\_2^2$`,
    raw`$|\|\theta_0\|\|$`,
    raw`$R^\{P \times (T+K)\}$`,
    raw`$\mathbf{x\}_{j}$`,
    raw`$\frac{a}{\text{tokens generated **sequentially**}}$`,
    raw`$A \approx $ \$ 369.65 $ dollars`,
  ];
  for (const src of posted) rendersAsPosted(src);
});

test('both signs escaped around TeX are a formula, not two currency signs', () => {
  const src = raw`The approximation is (\$\tilde{P}\$), via \$(\varepsilon, \delta)\$-DP.`;
  assert.deepEqual(titled(src, /protect/), []);
  // Prose between escaped signs is still currency, fixed on both sides.
  const prices = raw`It costs \$5 and \$10 per run.`;
  assert.equal(fixAll(prices), raw`It costs \\$5 and \\$10 per run.`);
  assert.notEqual(shown(fixAll(prices)), shown(prices));
});

test('one escaped sign of a pair is the author\'s call; a price before a formula is not', () => {
  const [iss] = titled(raw`$A \approx $ \$ 369.65 $ dollars`, /Backslash does not protect/);
  assert.ok(iss && iss.fix && iss.fix.manual, 'reported with a manual fix');
  // The currency check still frees the formula after a price.
  assert.equal(fixAll(raw`It costs \$5 per run, and $x$ is the rate.`), raw`It costs \\$5 per run, and $x$ is the rate.`);
});

test('a lone escaped dollar shows as typed: a warning, and a fix that renders the same', () => {
  const src = raw`Cost is \$2.03 per run.`;
  const [iss] = titled(src, /not protected/);
  assert.equal(iss.sev, 'warn');
  assert.match(iss.detail, /for now it shows as typed/);
  assert.equal(fixAll(src), raw`Cost is \\$2.03 per run.`);
  rendersAsPosted(src);
});

test('bars composed into a double bar keep their escapes; a single \\| still becomes the norm', () => {
  for (const src of [raw`$\|\|h\|\|_2$`, raw`$|\|\theta\|\|$`, raw`$\||x\||$`]) {
    assert.deepEqual(titled(src, /\\\| is consumed/), [], src);
  }
  const norm = raw`the norm $\|x\|_2$ is small`;
  assert.equal(titled(norm, /\\\| is consumed/).length, 2);
  assert.equal(fixAll(norm), raw`the norm $\\|x\\|_2$ is small`);
});

test('grouping braces typed as \\{ \\} keep their escapes; set braces get the fix', () => {
  for (const src of [raw`$R^\{P \times (T+K)\}$`, raw`$x_\{i+1\}$`, raw`$\mathbf{x\}_{j}$`, raw`$e^ \{-t\}$`]) {
    assert.deepEqual(titled(src, /\\[{}] is consumed/), [], src);
    rendersAsPosted(src);
  }
  const sets = {
    [raw`Let $S = \{x_i\}_{i=1}^n$ be the set.`]: raw`Let $S = \\{x_i\\}_{i=1}^n$ be the set.`,
    [raw`with $x \in \{0, 1\}$ always`]: raw`with $x \in \\{0, 1\\}$ always`,
    [raw`$f = \left\{ a \right.$`]: raw`$f = \left\\{ a \right.$`,
  };
  for (const [src, fixed] of Object.entries(sets)) assert.equal(fixAll(src), fixed, src);
});

test('\\& in an alignment is the column separator; the row breaks are still repaired', () => {
  const src = '$$\\begin{align*} f(x)\\&=-x\\\\\n=-y\\end{align*}$$';
  assert.deepEqual(titled(src, /\\& is consumed/), []);
  assert.equal(fixAll(src), '$$\\begin{align*} f(x)\\&=-x\\\\\\\\\n=-y\\end{align*}$$');
  // Outside an alignment \& still means the TeX ampersand.
  assert.equal(titled(raw`$A \& B$`, /\\& is consumed/).length, 1);
});

test('emphasis "cutting" pairs of prices or escaped signs is no formula; real cuts stay', () => {
  assert.deepEqual(titled(raw`A ($\approx$ **$484**) vs. B ($\approx$ **$1,500**).`, /splits this formula/), []);
  assert.deepEqual(titled(raw`> **Q1**: It costs \$12 each.
> **S1:** Calculate the tip.
> **F1:**
> 1. Cost = \$? × ?`, /splits this formula|protect/).filter((i) => i.sev === 'err'), []);
  assert.equal(fixAll(raw`The first is $w^*$ and the second is $x^*$.`), raw`The first is $w^\*$ and the second is $x^\*$.`);
  assert.equal(fixAll(raw`so $a*b*c$ holds`), raw`so $a\*b\*c$ holds`);
  assert.equal(titled(raw`Here $p$ is **the** best and $q$ too.`, /splits this formula/).length, 0);
});

test('emphasis inside \\text{} is reported with a manual fix that names \\textbf', () => {
  const src = raw`$\frac{a}{\text{tokens generated **sequentially**}}$`;
  const [iss] = titled(src, /strong emphasis splits/);
  assert.ok(iss.fix && iss.fix.manual);
  assert.match(iss.detail, /textbf/);
  assert.equal(fixAll(src), src);
});

test('a bare % after a number is a TeX comment that eats the sign; comment lines are left alone', () => {
  const src = raw`Our accuracy was $78.1%$, and $50 %$ of runs.`;
  const found = titled(src, /bare % starts a TeX comment/);
  assert.equal(found.length, 2);
  assert.equal(fixAll(src), raw`Our accuracy was $78.1\\%$, and $50 \\%$ of runs.`);
  assert.match(shown(fixAll(src)), /%/);
  const display = '$$\\begin{aligned} y &= x\\\\\\\\\n % \\vspace{-1mm}\n z &= 1 \\end{aligned}$$';
  assert.deepEqual(titled(display, /bare %/), []);
  // An escaped percent is fine, and one Markdown consumed has its own card.
  assert.deepEqual(titled(raw`$5\\%$`, /%/), []);
  assert.equal(titled(raw`$5\%$`, /\\% is consumed/).length, 1);
});
