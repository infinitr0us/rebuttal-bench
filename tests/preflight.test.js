'use strict';
// Checks 16-18 (the comment as posted, placeholders, characters from a PDF)
// and the cards for what MathJax cannot typeset (texProblemIssues).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAnalyzer } = require('./lib/page');
const { renderHtml, renderLikeOpenReview } = require('./lib/pipeline');
const { texReports } = require('./lib/mathml');

const A = loadAnalyzer();
const issues = (src) => [...A.analyze(src).issues];
const titled = (src, title) => issues(src).filter((i) => i.title === title);
const applyFix = (src, iss) => A.applyEditsToText(src, iss.fix.edits);

// ---- 16. the comment as posted ----

const TRIM = 'Posting removes the leading whitespace';

test('an indented first line is code in the editor but text once posted', () => {
  const src = '    python eval.py --seed 1\n\nMore text.';
  const [iss] = titled(src, TRIM);
  assert.ok(iss, 'reported');
  assert.match(iss.detail, /not a code block there/);
  assert.equal(iss.fix.manual, true);
  assert.equal(A.fixAllText(src).text, src, 'not part of Fix all');
  const fixed = applyFix(src, iss);
  assert.equal(fixed, 'python eval.py --seed 1\n\nMore text.');
  // The posted comment is the same before and after: only the editor changes.
  assert.equal(renderHtml(fixed.trim()), renderHtml(src.trim()));
  assert.equal(titled(fixed, TRIM).length, 0);
});

test('other starts that posting reads differently', () => {
  // A no-break space keeps "#" from starting a heading until it is trimmed.
  assert.equal(titled('\u00a0# Summary\n\nText.', TRIM).length, 1);
  // An indented fence strips its indentation from the content; trimmed, it does not.
  assert.equal(titled('  ```\n  code\n  ```', TRIM).length, 1);
  // Blank lines before an indented block.
  assert.equal(titled('\n\n    $x$ is the input', TRIM).length, 1);
});

test('starts that read the same without the whitespace stay silent', () => {
  for (const src of ['\n\n# Summary', '  # Summary', '   > quoted', '  - item', '\ufeffHello there.',
    '\u00a0Hello there.', ' | a | b |\n |---|---|\n | 1 | 2 |', 'No whitespace at all.', '   ', '']) {
    assert.deepEqual(titled(src, TRIM), [], JSON.stringify(src));
  }
});

test('check 7 leaves a first block that posting turns into text to check 16', () => {
  const first = '    $\\alpha$ is the \\textbf{rate}\n\nMore.';
  assert.deepEqual(issues(first).map((i) => i.title).filter((t) => /Indented|leading/.test(t)), [TRIM]);
  // Further down, the same block is still a code block on OpenReview.
  const later = 'Intro.\n\n    $\\alpha$ is the \\textbf{rate}\n\nMore.';
  assert.deepEqual(issues(later).map((i) => i.title).filter((t) => /Indented|leading/.test(t)), ['Indented text became a code block']);
});

// ---- 17. placeholders ----

const PH = 'Placeholder left in the text';
const placeholders = (src) => titled(src, PH).map((i) => src.slice(i.start, i.end));

test('placeholders are reported where they are unmistakable', () => {
  assert.deepEqual(placeholders('Accuracy improves to XX.X% (Table X).'), ['XX.X', 'Table X']);
  assert.deepEqual(placeholders('TODO: add the ablation. FIXME later.'), ['TODO', 'FIXME']);
  assert.deepEqual(placeholders('As shown in [cite] and [citation needed], see [add numbers].'),
    ['[cite]', '[citation needed]', '[add numbers]']);
  assert.deepEqual(placeholders('Thanks, Reviewer X! See Fig.~?? and Section XX.'), ['Reviewer X', 'Fig.~??', 'Section XX']);
  assert.deepEqual(placeholders('| Ours | $XX.X \\pm X.X$ | XX\\% |\n|-|-|-|'), ['XX.X', 'X.X', 'XX']);
  assert.deepEqual(placeholders('Gains of xx.x points. Why?? Lorem ipsum dolor. XXX'), ['xx.x', '??', 'Lorem ipsum', 'XXX']);
  const [iss] = titled('TODO', PH);
  assert.equal(iss.sev, 'warn');
  assert.equal(iss.fix, null);
});

test('look-alikes that are not placeholders stay silent', () => {
  for (const src of [
    'The Gram matrix $XX^\\top$ and $XXX$ are fine in math, as is $\\text{X}$.',
    'In code, `a ?? b` and `TODO` are left alone:\n\n```\nx = y ?? z  # TODO\n```',
    'We thank Reviewer 6Jx2 and Reviewer aB3d.',
    'See Table 3, Figure 2 and Appendix B.',
    '[Update] We added results. See [the reference](https://example.org) and [ref](https://example.org).',
    'Is it fine? Yes. XL and XXL models, TODOs aside.',
    'Version x.y and 1.x releases.',
  ]) {
    assert.deepEqual(placeholders(src), [], src);
  }
});

test('an HTML comment gets its own card, not a placeholder card too', () => {
  const titles = issues('Text <!-- TODO: ask Alice --> more.').map((i) => i.title);
  assert.deepEqual(titles, ['HTML comment is shown to the reviewers']);
});

test('Fix all leaves placeholders as they are', () => {
  const src = 'Accuracy is XX.X (Table X). TODO.';
  assert.equal(A.fixAllText(src).text, src);
});

// ---- 18. characters from a PDF ----

test('invisible characters: one card, a manual fix that removes them all', () => {
  const src = 'Our classi\u00adfication model\u200b works.';
  const [iss] = titled(src, 'Invisible characters from a copy');
  assert.ok(iss);
  assert.equal(iss.sev, 'note');
  assert.equal(src.slice(iss.start, iss.end), 'classi\u00adfication', 'marks the word, not the invisible character');
  assert.equal(iss.fix.manual, true);
  assert.equal(iss.fix.label, 'remove all 2');
  assert.match(iss.detail, /^2 invisible characters/);
  assert.equal(applyFix(src, iss), 'Our classification model works.');
  assert.equal(A.fixAllText(src).text, src, 'not part of Fix all');
});

test('ligatures: spelled out on request', () => {
  const src = 'We \ufb01ne-tune the e\ufb00ect.';
  const [iss] = titled(src, 'Ligature characters from a PDF');
  assert.equal(iss.fix.label, 'spell all 2 out');
  assert.equal(applyFix(src, iss), 'We fine-tune the effect.');
});

test('a BOM that posting trims away is not counted', () => {
  assert.deepEqual(titled('\ufeffHello.', 'Invisible characters from a copy'), []);
  assert.equal(titled('Hello\ufeff world.', 'Invisible characters from a copy').length, 1);
  // Joiners shape emoji and some scripts, and no-break spaces are typed on purpose.
  assert.deepEqual(issues('A \u{1F9D1}\u200d\u{1F4BB} and 5\u00a0GB.'), []);
});

// ---- TeX problems reported by MathJax ----

const problems = (src, reports = texReports(src)) => {
  const res = A.analyze(src);
  return [...A.texProblemIssues(src, res.spans, reports, res.issues)];
};
const errorsAfter = (src) => renderLikeOpenReview(src).items.filter((i) => i.err).map((i) => i.err);

test('an undefined macro gets one card for all its formulas, with a working substitute', () => {
  const src = 'Bold $\\bm{x}$ and $\\bm y$, and the space $\\R^d$.';
  const cards = problems(src);
  assert.deepEqual(cards.map((c) => c.title), ['\\bm is not defined in MathJax', '\\R is not defined in MathJax']);
  const [bm, R] = cards;
  assert.equal(src.slice(bm.start, bm.end), '\\bm');
  assert.match(bm.detail, /in 2 formulas/);
  assert.equal(bm.fix.label, 'use \\boldsymbol');
  assert.equal(bm.fix.manual, true);
  let fixed = applyFix(src, bm);
  assert.equal(fixed, 'Bold $\\boldsymbol{x}$ and $\\boldsymbol y$, and the space $\\R^d$.');
  fixed = A.applyEditsToText(fixed, problems(fixed)[0].fix.edits);
  assert.equal(fixed, 'Bold $\\boldsymbol{x}$ and $\\boldsymbol y$, and the space $\\mathbb{R}^d$.');
  assert.deepEqual(errorsAfter(fixed), []);
  assert.deepEqual(problems(fixed), []);
  assert.equal(R.sev, 'err');
});

test('every substitute typesets through the whole pipeline', () => {
  for (const [name, sub] of Object.entries(A.TEX_SUBSTITUTES)) {
    if (sub.hint) continue;
    const body = sub.open ? '\\' + name + '{x - y}' : '\\' + name + '{x} + 1';
    for (const src of ['Inline $' + body + '$ here.', '$$\n' + body + '\n$$', '| a |\n|-|\n| $' + body + '$ |']) {
      const [card] = problems(src);
      assert.ok(card && card.fix, name + ' has a fix in ' + JSON.stringify(src));
      const fixed = applyFix(src, card);
      assert.deepEqual(errorsAfter(fixed), [], name + ': ' + fixed);
      assert.deepEqual(problems(fixed), [], name + ': ' + fixed);
    }
  }
});

test('argument substitutes keep the argument; empty ones remove the command', () => {
  const abs = '$\\abs{x - \\frac{1}{2}}$';
  assert.equal(applyFix(abs, problems(abs)[0]), '$\\lvert x - \\frac{1}{2}\\rvert$');
  const ensure = 'Then $\\ensuremath{x}$.';
  const [card] = problems(ensure);
  assert.equal(card.fix.label, 'remove \\ensuremath');
  assert.equal(applyFix(ensure, card), 'Then ${x}$.');
  // Without a braced argument there is nothing safe to rewrite.
  assert.equal(problems('$\\abs x$')[0].fix, null);
});

test('escaped source and quoted formulas map back to the right characters', () => {
  // Markdown turns "\\" into "\", so MathJax receives \bm here.
  const escaped = 'Bold $\\\\bm x$.';
  const [card] = problems(escaped);
  const fixed = applyFix(escaped, card);
  assert.deepEqual(errorsAfter(fixed), []);
  assert.deepEqual(renderLikeOpenReview(fixed).items.map((i) => i.tex), ['\\boldsymbol x']);
  const quoted = '> The loss $\\E[\\ell]$\n> and $\\E[x]$ again.';
  assert.equal(applyFix(quoted, problems(quoted)[0]), '> The loss $\\mathbb{E}[\\ell]$\n> and $\\mathbb{E}[x]$ again.');
});

test('a macro defined after its first use: advice, no rewrite of the definition', () => {
  const src = 'First $\\R$, then $\\newcommand{\\R}{\\mathbb{R}}\\R^d$.';
  const cards = problems(src);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].fix, null);
  assert.match(cards[0].detail, /defined in this comment, but after a formula/);
  // Defined first, nothing to report.
  assert.deepEqual(problems('$\\newcommand{\\R}{\\mathbb{R}}$ Then $\\R^d$.'), []);
});

test('unknown macros get the \\newcommand advice', () => {
  const [card] = problems('The loss $\\Loss(\\theta)$.');
  assert.equal(card.fix, null);
  assert.match(card.detail, /newcommand\{\\Loss\}/);
  const [si] = problems('It takes $\\SI{5}{\\milli\\second}$.');
  assert.match(si.detail, /siunitx/);
});

test('a TeX error gets a card at its formula, unless the analyzer already explains it', () => {
  const src = 'Then $x^2^3$ holds.';
  const [card] = problems(src);
  assert.equal(card.title, 'MathJax cannot typeset this formula');
  assert.match(card.detail, /Double exponent: use braces to clarify/);
  assert.equal(src.slice(card.start, card.end), '$x^2^3$');
  const res = A.analyze(src);
  const other = { sev: 'warn', title: 'Something about this formula', start: 6, end: 9 };
  assert.deepEqual([...A.texProblemIssues(src, res.spans, texReports(src), [other])], []);
  // A placeholder inside the formula does not explain a TeX error.
  const ph = 'Then $XX.X^2^3$ holds.';
  const phRes = A.analyze(ph);
  assert.equal([...A.texProblemIssues(ph, phRes.spans, texReports(ph), phRes.issues)].length, 1);
});

test('reports from an older version of the text follow the formulas to their new place', () => {
  const old = 'Bold $\\bm{x}$.';
  const now = 'A new first sentence. ' + old;
  const [card] = problems(now, texReports(old));
  assert.equal(now.slice(card.start, card.end), '\\bm');
  // A formula edited since the typeset has no report yet.
  assert.deepEqual(problems('Bold $\\bm{y}$.', texReports(old)), []);
});

test('the k-th report of a TeX belongs to the k-th formula with that TeX', () => {
  const src = 'First $\\R$, again $\\R$.';
  const reports = [{ tex: '\\R', undef: [], errors: [] }, { tex: '\\R', undef: ['\\R'], errors: [] }];
  const [card] = problems(src, reports);
  assert.equal(card.start, src.lastIndexOf('\\R'));
  assert.match(card.detail, /in this formula/);
});

test('the preview reports what the posted comment typesets', () => {
  // texReports typesets the trimmed text, as the page's preview does.
  assert.deepEqual(texReports('    $\\bm x$ starts the comment').map((r) => r.undef), [['\\bm']]);
});
