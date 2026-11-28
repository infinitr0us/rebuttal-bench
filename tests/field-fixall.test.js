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

test('bars composed into a double bar keep their escapes; other bars get a card', () => {
  for (const src of [raw`$\|\|h\|\|_2$`, raw`$|\|\theta\|\|$`, raw`$\||x\||$`]) {
    assert.deepEqual(titled(src, /\\\| is consumed/), [], src);
  }
  const norm = raw`the norm $\|x\|_2$ is small`;
  const found = titled(norm, /\\\| is consumed/);
  assert.equal(found.length, 2);
  // The card's fix gives the norm when clicked.
  assert.equal(A.applyEditsToText(norm, found[0].fix.edits.concat(found[1].fix.edits)), raw`the norm $\\|x\\|_2$ is small`);
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
  const src = raw`Our accuracy was $78.1%$ (and $(50%)$), and $\text{top 10%}$.`;
  const found = titled(src, /bare % starts a TeX comment/);
  assert.equal(found.length, 3);
  assert.equal(fixAll(src), raw`Our accuracy was $78.1\\%$ (and $(50\\%)$), and $\text{top 10\\%}$.`);
  assert.match(shown(fixAll(src)), /%/);
  // Comments their authors meant (codex-review-312, codex-recheck-312): a
  // comment line in a display, words or an addend switched off after the
  // sign, a spaced sign, \verb.
  for (const meant of [
    '$$\\begin{aligned} y &= x\\\\\\\\\n % \\vspace{-1mm}\n z &= 1 \\end{aligned}$$',
    '$$\nx=1 % baseline fixed in all runs\n+y\n$$',
    '$$\nx=1%\\quad + 2\n+y\n$$',
    '$$\nx=1% t=0\n+y\n$$',
    raw`About $50 %$ of runs.`,
    raw`The label is $\verb|95%|$.`,
  ]) {
    assert.deepEqual(titled(meant, /bare %/), [], meant);
    rendersAsPosted(meant);
  }
  // An escaped percent is fine, and one Markdown consumed has its own card.
  assert.deepEqual(titled(raw`$5\\%$`, /%/), []);
  assert.equal(titled(raw`$5\%$`, /\\% is consumed/).length, 1);
});

/* The release review (reviews/2026-11-27/codex-review-312) found more input
   that rendered as meant and that Fix all changed. */
test('escaped signs around any formula stay a formula; prices with prose or separators are currency', () => {
  for (const src of [raw`We set \$n=16\$ for all runs.`, raw`Each sample \$x\$ has unit norm.`, raw`We set \$n_0=16\$.`,
    raw`We fix the number of layers at \$16\$.`, raw`Note that \$2 - 1\$ is one.`]) {
    assert.deepEqual(titled(src, /protect/), [], src);
    rendersAsPosted(src);
  }
  assert.equal(fixAll(raw`It costs \$5, \$10 or \$20.`), raw`It costs \\$5, \\$10 or \\$20.`);
  assert.equal(fixAll(raw`The rates are \$5/hour and \$8/hour.`), raw`The rates are \\$5/hour and \\$8/hour.`);
});

test('a consumed brace is fixed unattended only as a set; elsewhere the author decides', () => {
  // Grouping: no card at all.
  for (const src of [raw`The bound is $\sqrt\{n+1\}$.`, raw`The bound is $\sqrt\{n+1}$.`, raw`$\mathbf\{v\}$`,
    raw`$$x=2\tag{1}\label\{eq:x\}$$ See $\eqref{eq:x}$.`, raw`$a \equiv b \pmod\{n+1\}$`]) {
    assert.deepEqual(titled(src, /\\[{}] is consumed/), [], src);
    rendersAsPosted(src);
  }
  // Not surely a set: a card with a manual fix, the formula left as posted.
  for (const src of [raw`The fraction is $\frac\{a+b\}\{c+d\}$.`, raw`$\sqrt[3]\{x\}$`,
    raw`The support is $S=\bigcup_{i=1}^{n}\{x_i\}$.`]) {
    assert.ok(titled(src, /\\[{}] is consumed/).every((i) => i.fix && i.fix.manual), src);
    rendersAsPosted(src);
  }
  // Surely a set, or a lone brace (broken TeX bare): the fix applies.
  assert.equal(fixAll(raw`We take $\sqrt\{n+1\}$ for $n\in \{1,2\}$.`), raw`We take $\sqrt\{n+1\}$ for $n\in \\{1,2\\}$.`);
  assert.equal(fixAll(raw`$x\in\{0,1\}$`), raw`$x\in\\{0,1\\}$`);
  assert.equal(fixAll(raw`$\{x_i\}_{i=1}^{N}$ and $f = \left\{ a \right.$`), raw`$\\{x_i\\}_{i=1}^{N}$ and $f = \left\\{ a \right.$`);
});

test('a \\| always waits for the author: no context makes the norm certain', () => {
  // A conditioning or evaluation bar, a KL separator, |x| as absolute value
  // or norm, a scalar's square: a card with a manual fix, and Fix all leaves
  // the formula as posted.
  for (const src of [raw`The conditional probability is $P(A \| B)$.`, raw`$\text{KL}[q\|p]$`,
    raw`For a scalar, its absolute value is $\|x\|$.`, raw`$\|\frac{a}{b}-1\|\leq\epsilon$`,
    raw`By Bayes' rule, $P(A \big\| B)P(B)=P(B \big\| A)P(A)$.`, raw`$\left\| x \right\|$`,
    raw`The endpoint change is $F(t)\big\|\_{t=b}-F(t)\big\|\_{t=a}$.`,
    raw`For a scalar residual we report its square $r^2=\|r\|^2$.`, raw`$\|v\|_2$`]) {
    const found = titled(src, /\\\| is consumed/);
    assert.ok(found.length && found.every((i) => i.fix && i.fix.manual), src);
    assert.equal(fixAll(src), src);
  }
});

test('bold prices are no formula, whatever the prose between them; emphasis inside one is', () => {
  for (const src of [raw`Cost per trial: __$5__ versus __$8__.`, raw`Cost per trial: **$5** / **$8**.`,
    raw`**$5** per GPU_hour or **$8** per GPU_hour.`]) {
    assert.deepEqual(titled(src, /splits this formula/), [], src);
    rendersAsPosted(src);
  }
  rendersAsPosted(raw`Each run costs **$5** for $n$ samples, or **$6** for $(n+1)$.`);
  assert.equal(fixAll(raw`We evaluate $2 + a*b*c$.`), raw`We evaluate $2 + a\*b\*c$.`);
  assert.equal(fixAll('We evaluate $α*β*γ$.'), 'We evaluate $α\\*β\\*γ$.');
  assert.equal(titled(raw`a **$5$-fold** gain and $x$ too`, /splits this formula/).length, 0);
});
