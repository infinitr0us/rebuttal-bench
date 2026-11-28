'use strict';
// Precision and recall fixes from the 2026-11-27 field audit (checks 7, 9, 13, 14, 17).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAnalyzer } = require('./lib/page');

const A = loadAnalyzer();
const raw = String.raw;
const issues = (src) => [...A.analyze(src).issues];
const titled = (src, title) => issues(src).filter((i) => i.title === title);
const titles = (src) => issues(src).map((i) => i.title);

// ---- 1. Check 13: h4-h6 headings ----

const H4 = 'This heading looks like body text';

test('check 13: explicitly bold h4-h6 headings stay quiet', () => {
  for (const src of [
    '#### **Reviewer question**',
    '##### **Step 1: Substitute Eq. (4)**',
    '###### **Conclusion**',
    '#### **Q1.** ',
    '#### **Q1**:',
    '#### **Q1**.',
    '#### ***Bold italic heading***',
    '#### **[Linked heading](https://example.org)**',
    '#### [**Linked heading**](https://example.org)',
    '#### **Part 1** — **Part 2**',
    '> #### **Q5.2. around lines 228-230, the paper says “...”**',
    raw`##### **Step 2: Use invertibility of $\mathbf D^{-1/2}$**`,
  ]) {
    assert.deepEqual(titled(src, H4), [], src);
  }
});

test('check 13: plain and only partially bold h4-h6 headings keep their card', () => {
  for (const src of [
    '#### Reviewer question',
    '##### Notation',
    '###### Appendix note',
    '#### *Italic heading*',
    '#### **Q1**: What about the ablation?',
    '#### (A1) **Injectivity of the kernel embedding**',
    '#### **   **',
  ]) {
    const cards = titled(src, H4);
    assert.equal(cards.length, 1, src);
    assert.equal(cards[0].sev, 'note');
  }
});

// ---- 2. Check 9: raw HTML shown as text ----

const HTML = 'Raw HTML is shown as text';

test('check 9: invented angle-bracket tokens stay quiet; comments keep check 10', () => {
  for (const src of [
    'The tokens are <difference>.',
    'The tokens are <think> and </think>.',
    'The tokens are <Goal> … </Goal>.',
    'The tokens are <Conclusion> … </Conclusion>.',
    'Section 1 <INTRODUCTION>, Lines 50-82.',
  ]) {
    assert.deepEqual(titled(src, HTML), [], src);
  }
  assert.deepEqual(titles('Text <!-- private note --> more.'), ['HTML comment is shown to the reviewers']);
});

test('check 9: real HTML elements are still reported (case-insensitive)', () => {
  for (const src of [
    '<b>bold</b>',
    '<B>bold</B>',
    '<i>Proceedings of the 41st ICML</i>',
    'Line one<br>line two',
    '<span>text</span>',
    'H<sub>2</sub>O',
    '<div>block</div>',
    '<details>\n<summary>More</summary>\n</details>',
  ]) {
    assert.ok(titled(src, HTML).length >= 1, src);
  }
});

// ---- 3. Check 17: placeholders ----

const PH = 'Placeholder left in the text';
const placeholders = (src) => titled(src, PH).map((i) => src.slice(i.start, i.end));

test('check 17: question punctuation, hyphenated acronyms and quoted placeholders stay quiet', () => {
  for (const src of [
    'How does the set shrink to keep these updates feasible??',
    '**How does the set shrink to keep these updates feasible??**',
    'Why does Eq. 2??',
    'Two failure modes in TBD-based tracking.',
    'A TBA-style protocol and a TODO-driven schedule.',
    'We will correct "Figure ??" to "Figure 2".',
    'We will correct “Figure ??” to “Figure 2”.',
    "We will correct 'Figure ??' to 'Figure 2'.",
    'We will correct ‘Figure ??’ to ‘Figure 2’.',
    'The typo "Table X" was fixed.',
    'Replace "TODO" with the value.',
  ]) {
    assert.deepEqual(placeholders(src), [], src);
  }
});

test('check 17: real placeholders outside quotes keep their cards', () => {
  assert.deepEqual(placeholders('See Figure ?? and Table X.'), ['Figure ??', 'Table X']);
  assert.deepEqual(placeholders('This method is [citation].'), ['[citation]']);
  assert.deepEqual(placeholders('Score: ?? and TBD.'), ['??', 'TBD']);
  assert.deepEqual(placeholders('Results are TBD - will update.'), ['TBD']);
  assert.deepEqual(placeholders('We fixed "old" and left Figure ?? unfixed.'), ['Figure ??']);
  assert.deepEqual(placeholders('We fixed “old” and left Figure ?? unfixed.'), ['Figure ??']);
  assert.deepEqual(placeholders("It's in Figure ?? and we'll fix it."), ['Figure ??']);
  assert.deepEqual(placeholders('The authors’ draft still says Figure ??.'), ['Figure ??']);
});

// ---- 4. Check 7: indented text that becomes a code block ----

const INDENT = 'Indented text became a code block';

test('check 7: indented price examples stay quiet', () => {
  for (const src of [
    'Example:\n\n    It costs $7.50 each and $5.00 for delivery.',
    'Trace:\n\n    Cost of subs = 2 × $7.50 = $15.00\n    Subtotal = $15.00 + $3.00 + $2.00 = $20.00',
    'Budget:\n\n    Estimated cost is $5-$10 per run.',
  ]) {
    assert.deepEqual(titled(src, INDENT), [], src);
  }
});

test('check 7: indented text with real TeX keeps its card', () => {
  for (const src of [
    raw`Proof:` + '\n\n' + raw`    where $\alpha_t \le 1$ holds`,
    'Example:\n\n    Let $x + y = 1$ hold here.',
    'Example:\n\n    It costs $5 and $x$ is the bound.',
  ]) {
    assert.equal(titled(src, INDENT).length, 1, src);
  }
});

// ---- 5. Check 14: LaTeX ties ----

const TIE = 'LaTeX tie is shown as a tilde';

test('check 14 ties: approximations, ranges and slots stay quiet', () => {
  for (const src of [
    '- I need~,',
    'graph dataset (~2GB), Python 3.10',
    raw`incurs only **~1$\times$** additional cost`,
    'while delivering **~10%** average gain',
    '| Value | Units |\n|-|-|\n|~1|s|',
    raw`moderate (~10\%) due to hardware`,
    'performance degradation (~7-12% EV loss)',
    'model (~59% vs. ~53%, see Table 1)',
    'Our method (0.55~0.65) outperforms baseline.',
    'A modest size of 2K~4K proportional to batch size.',
    'Size of 2KB~4KB per sample.',
    'retrained for **~128M tokens**',
    'Lines 105~107 on the left.',
    'a 60%~80% reduction in cost.',
    'We retract "~75% lower compute".',
    'a~b',
  ]) {
    assert.deepEqual(titled(src, TIE), [], src);
  }
});

test('check 14 ties: ties between a reference word and label keep their card', () => {
  for (const src of [
    'See Table~1 for details.',
    'Shown in Fig.~2 above.',
    'Discussed in Section~3.',
    raw`Following Smith et al.~\cite{smith2024}.`,
    'As in Appendix~B.',
    'Shown in Eq.~(4).',
    'See Ref.~[1].',
    'Shown in Tab.~7.',
    raw`Refer to Fig.~\ref{fig:main}.`,
  ]) {
    assert.ok(titled(src, TIE).length >= 1, src);
  }
  // Strikethrough from paired single tildes is unchanged.
  assert.deepEqual(titles('Table~1 and Fig.~2'), ['LaTeX tie became strikethrough', 'LaTeX tie became strikethrough']);
});

// ---- 6. Check 14: \footnote ----

test('check 14: \\footnote outside math is reported with inline-note advice', () => {
  const withArg = raw`Our runs agree.\footnote{All runs used the same seed.}`;
  const [c1] = titled(withArg, raw`\footnote is shown outside math`);
  assert.ok(c1);
  assert.equal(c1.sev, 'warn');
  assert.equal(c1.fix, null);
  assert.match(c1.detail, /inline/i);
  assert.equal(withArg.slice(c1.start, c1.end), raw`\footnote{All runs used the same seed.}`);

  const bare = raw`The neighbors of node $i$, \footnote{In GTDL, $i$ is a feature.}`;
  const [c2] = titled(bare, raw`\footnote is shown outside math`);
  assert.ok(c2);
  assert.equal(c2.fix, null);

  assert.deepEqual(titled('Use `\\footnote{x}` in LaTeX.', raw`\footnote is shown outside math`), []);
});

// ---- 7. Check 14: undelimited math commands ----

test('check 14 math commands: undelimited math macros in prose fire with no fix', () => {
  const s1 = raw`We use \alpha=10 and the threshold \tau from Eq. 7.`;
  const c1 = issues(s1).filter((i) => /is shown outside math$/.test(i.title));
  assert.deepEqual(c1.map((i) => [i.sev, i.title, i.fix]), [
    ['warn', raw`\alpha is shown outside math`, null],
    ['warn', raw`\tau is shown outside math`, null],
  ]);
  assert.match(c1[0].detail, /\$…\$/);

  for (const [src, wantTitle] of [
    [raw`via [ Hx = I - 2 v v^\top x ]`, raw`\top is shown outside math`],
    [raw`where T\geq \exp [ c K]`, raw`\geq is shown outside math`],
    [raw`the pair \arg \max over all states`, raw`\arg is shown outside math`],
    [raw`the pair \arg\max_{i} p(i)`, raw`\arg is shown outside math`],
    [raw`complexity measure c_\phi and \Phi-best`, raw`\phi is shown outside math`],
    [raw`updated using \nabla_{\btheta} L`, raw`\nabla is shown outside math`],
    [raw`the \grad_\phi ELBO estimator`, raw`\phi is shown outside math`],
  ]) {
    const cards = issues(src).filter((i) => /is shown outside math$/.test(i.title));
    assert.ok(cards.length >= 1, src);
    assert.equal(cards[0].title, wantTitle, src);
    assert.equal(cards[0].sev, 'warn');
    assert.equal(cards[0].fix, null);
  }
});

test('check 14 math commands: adjacent commands of one expression produce one card', () => {
  for (const [src, wantTitle, wantSel] of [
    [raw`the quantity \sqrt{M\Tilde(R)^4/k} increases`, raw`\sqrt is shown outside math`, raw`\sqrt{M\Tilde(R)^4/k}`],
    [raw`the quantity \sqrt{M\tilde{R}^4/k} increases`, raw`\sqrt is shown outside math`, raw`\sqrt{M\tilde{R}^4/k}`],
    [raw`requires \Omega(d/\tilde{R^4}) examples`, raw`\Omega is shown outside math`, raw`\Omega(d/\tilde{R^4}`],
    [raw`pair \arg \max over states`, raw`\arg is shown outside math`, raw`\arg \max`],
    [raw`pair \arg\max_{(i,j)} p(i,j)`, raw`\arg is shown outside math`, raw`\arg\max_{(i,j)}`],
    [raw`read as \nabla_{\phi_1}.`, raw`\nabla is shown outside math`, raw`\nabla_{\phi_1}`],
    [raw`hyperparameters (\alpha, \beta, \gamma) in`, raw`\alpha is shown outside math`, raw`\alpha, \beta, \gamma`],
  ]) {
    const cards = issues(src).filter((i) => /is shown outside math$/.test(i.title));
    assert.equal(cards.length, 1, src);
    assert.equal(cards[0].title, wantTitle, src);
    assert.equal(src.slice(cards[0].start, cards[0].end), wantSel, src);
  }
});

test('check 14 math commands: math, code, paths, quoted names, HTML blocks and text commands stay quiet', () => {
  for (const src of [
    raw`We use $\alpha=10$ and $\arg\max_x f(x)$.`,
    'Use `\\alpha` and `\\frac{1}{2}` in TeX.',
    '```\n\\alpha = \\beta\n```',
    raw`See [the guide](https://example.org/\alpha) for details.`,
    raw`<!-- \alpha = 1 -->`,
    raw`<div>\alpha = 1</div>`,
    raw`Stored at C:\top and D:\data\min\run.py.`,
    raw`Path \theta\data and src\in\run.py.`,
    raw`UNC path \\server\share\top.`,
    raw`We define the macro "\alpha" and “\beta” and '\gamma'.`,
    raw`Not a prefix: \alphabet or \maximum or \into.`,
    raw`Escaped slash: \\alpha stays literal.`,
  ]) {
    const cards = issues(src).filter((i) => /is shown outside math$/.test(i.title));
    assert.deepEqual(cards, [], src);
  }
  // Text commands keep only their single check 14 card, never a second one.
  assert.deepEqual(titles(raw`\textbf{bold} and \underline{under}`), [
    raw`\textbf is shown outside math`,
    raw`\underline is shown outside math`,
  ]);
  // Degraded \(…\) already gets Check 2's card, not a duplicate math-command card.
  assert.deepEqual(titles(raw`The value \(\alpha + \beta\) holds.`), [
    raw`\( … \) loses its MathJax delimiters`,
  ]);
  // A math command inside a sentence that happens to be quoted still fires.
  assert.deepEqual(titles(raw`The reviewer wrote: "We use \alpha=10."`), [
    raw`\alpha is shown outside math`,
  ]);
});
