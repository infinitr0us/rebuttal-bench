'use strict';
// Checks 16-18 (the comment as posted, placeholders, characters from a PDF)
// and the cards for what MathJax cannot typeset (texProblemIssues).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAnalyzer } = require('./lib/page');
const { renderHtml, renderLikeOpenReview } = require('./lib/pipeline');
const { texReports, mathml } = require('./lib/mathml');

const A = loadAnalyzer();
const issues = (src) => [...A.analyze(src).issues];
const titled = (src, title) => issues(src).filter((i) => i.title === title);
// As the page's compileFormulas: ordered MathML from a fresh TeX state.
const compile = (formulas) => mathml(formulas);
// A TeX fix is checked when clicked, against the whole comment compiled.
const fixEdits = (iss) => (iss.fix.check ? iss.fix.check(compile) : iss.fix.edits);
const applyFix = (src, iss) => {
  const edits = fixEdits(iss);
  assert.ok(edits, 'the fix is refused when clicked');
  return A.applyEditsToText(src, edits);
};

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
  assert.deepEqual(placeholders('Gains of xx.x points. Score: ?? Lorem ipsum dolor. XXX'), ['xx.x', '??', 'Lorem ipsum', 'XXX']);
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

// `stale`: the reports come from another version of the text, as while the
// preview catches up with an edit.
const problems = (src, reports = texReports(src), stale = false) => {
  const res = A.analyze(src);
  return [...A.texProblemIssues(src, res.spans, reports, res.issues, { stale })];
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

test('a TeX error gets a card at its formula, which points to a math card on the same formula', () => {
  const src = 'Then $x^2^3$ holds.';
  const [card] = problems(src);
  assert.equal(card.title, 'MathJax cannot typeset this formula');
  assert.match(card.detail, /Double exponent: use braces to clarify/);
  assert.equal(src.slice(card.start, card.end), '$x^2^3$');
  const res = A.analyze(src);
  const other = { sev: 'warn', title: 'Something about this formula', start: 6, end: 9, math: true };
  const [withOther] = [...A.texProblemIssues(src, res.spans, texReports(src), [other])];
  assert.match(withOther.detail, /Another card on this formula may be the cause/);
  // A card that is not about Markdown damaging TeX is not mentioned.
  const [plainCard] = [...A.texProblemIssues(src, res.spans, texReports(src), [{ ...other, math: false }])];
  assert.doesNotMatch(plainCard.detail, /Another card/);
  // Nor is the posting-trim card on the same line, or a placeholder in the formula.
  for (const text of [' # Bound $x^2^3$', 'Then $XX.X^2^3$ holds.']) {
    const r = A.analyze(text);
    const cards = [...A.texProblemIssues(text, r.spans, texReports(text), r.issues)];
    assert.equal(cards.length, 1, text);
    assert.doesNotMatch(cards[0].detail, /Another card/, text);
  }
});

test('reports from an older version of the text follow the formulas to their new place, without a fix', () => {
  const old = 'Bold $\\bm{x}$.';
  const now = 'A new first sentence. ' + old;
  const [card] = problems(now, texReports(old), true);
  assert.equal(now.slice(card.start, card.end), '\\bm');
  assert.equal(card.fix, null, 'a fix waits for the typeset of this text');
  assert.match(card.detail, /once the preview has caught up/);
  // A formula edited since the typeset has no report yet.
  assert.deepEqual(problems('Bold $\\bm{y}$.', texReports(old), true), []);
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

// ---- findings of the Codex review of 2026-11-21 (reviews/2026-11-21/codex-review-preflight) ----

const errorsOf = (src) => texReports(src).flatMap((r) => r.undef.concat(r.errors));

test('H1: the analyzer reads the comment as posted, so Fix all leaves code that posting creates alone', () => {
  const src = '    ```text\n\nCost $5 to $10.\n\n```';
  assert.equal(A.fixAllText(src).text, src);
  assert.deepEqual(issues(src).map((i) => i.title), [TRIM]);
});

test('H2: a macro fix that would change another formula is refused when clicked', () => {
  for (const src of ['$\\R_i$ and $x_{j}$.', '$\\xspace$ then $$y$$.']) {
    const [card] = problems(src);
    assert.ok(card && card.fix, src);
    assert.equal(card.fix.check(compile), null, src);
    assert.equal(card.fix.check(null), null, src + ' (already by its Markdown)');
  }
});

test('M1: only the uses MathJax reported are rewritten', () => {
  // A \label key: two words, one reported use.
  assert.equal(problems('$$\\label{eq:\\R}\\tag{1}\\R$$ As in $\\ref{eq:\\R}$.')[0].fix, null);
  // A macro expanded from another: no word to rewrite in the first formula.
  assert.equal(problems('$\\def\\f{\\R}$ then $\\f$ and $\\R$')[0].fix, null);
  // \verb text and TeX comments are not uses.
  const verb = '$\\bm v + \\verb!\\bm!$';
  assert.equal(applyFix(verb, problems(verb)[0]), '$\\boldsymbol v + \\verb!\\bm!$');
  const comment = '$\\R + x % \\newcommand{\\R}{0}\n$';
  assert.equal(applyFix(comment, problems(comment)[0]), '$\\mathbb{R} + x % \\newcommand{\\R}{0}\n$');
});

test('M2: a formula that inline Markdown cuts apart is not where the report goes', () => {
  const src = '$\\bm{x}+a*b*c$\n\n$\\bm{x}+a\\*b\\*c$';
  const [card] = problems(src);
  assert.equal(card.start, src.lastIndexOf('\\bm'));
  assert.deepEqual([...card.fix.edits].map((e) => e.start), [src.lastIndexOf('\\bm')]);
});

test('M3: the posted first block keeps its math, placeholders and code checks', () => {
  const s = '    $\\bm{x}$ TODO';
  assert.equal(A.analyze(s).mathCount, 1);
  assert.deepEqual(placeholders(s), ['TODO']);
  assert.equal(problems(s)[0].start, s.indexOf('\\bm'));
  const t = '    # Results\n    $\\alpha$';
  const ts = issues(t);
  assert.ok(ts.some((i) => i.title === 'Indented text became a code block'));
  assert.match(ts.find((i) => i.title === TRIM).detail, /becomes a heading/);
  const u = '    $\\bm{x}$\n\n$\\newcommand{\\bm}[1]{(#1)}$ Later $\\bm{x}$.';
  const [card] = problems(u);
  assert.equal(card.start, u.indexOf('\\bm'));
  assert.equal(card.fix, null);
});

test('M4: reports match formulas in lists and with named references', () => {
  const list = '- $$\n  \\bm{x}\n  $$';
  const [card] = problems(list);
  assert.equal(list.slice(card.start, card.end), '\\bm');
  assert.deepEqual(errorsOf(applyFix(list, card)), []);
  // &alpha; reaches MathJax decoded: the card still appears, without a rewrite.
  const named = problems('$\\bm{x}+&alpha;$');
  assert.equal(named.length, 1);
  assert.equal(named[0].fix, null);
});

test('M5: substitutes keep TeX tokens, arguments and comments intact', () => {
  const cases = [
    ['$\\abs{x}y$', '$\\lvert x\\rvert y$'],
    ['$\\abs{x% }\n +y}$', '$\\lvert x% }\n +y\\rvert$'],
    ['$\\frac\\R2$', '$\\frac{\\mathbb{R}}2$'],
  ];
  for (const [src, want] of cases) {
    const fixed = applyFix(src, problems(src)[0]);
    assert.equal(fixed, want);
    assert.deepEqual(errorsOf(fixed), [], fixed);
  }
  assert.equal(problems('$\\bm$')[0].fix, null, 'no argument to make bold');
});

test('M6: an unrelated card does not hide a TeX error', () => {
  for (const src of ['$x^2^3+\\ref{missing}$', '<div>$x^2^3$</div>']) {
    assert.ok(problems(src).some((c) => c.title === 'MathJax cannot typeset this formula'), src);
  }
});

test('M9: red \\verb text is not an undefined macro', () => {
  assert.deepEqual(texReports('$\\color{red}\\verb!\\bm!$').map((r) => r.undef), [[]]);
});

test('M10: definitions count where MathJax executes them', () => {
  const later = problems('$\\abs{x}$ then $\\DeclarePairedDelimiter{\\abs}{\\lVert}{\\rVert}$ then $\\abs{x}$');
  assert.equal(later[0].fix, null);
  assert.match(later[0].detail, /defined in this comment, but after a formula/);
  const verb = '$\\verb!\\def\\R{x}!$ then $\\R$';
  assert.equal(problems(verb)[0].fix.label, 'use \\mathbb{R}');
});

test('M11, L2, L3: placeholders where they are visible, and only there', () => {
  for (const src of ['\\<!-- literal\n\nTODO: add results', '<!--> Done. TODO', '$\\verb!<!--!$ TODO']) {
    assert.deepEqual(placeholders(src), ['TODO'], src);
  }
  for (const src of ['[r]: https://example.org/TODO\n\nSee [r].', '![plot](/images/TODO.png)', '| x |\n|-|\n| 1 | TODO |']) {
    assert.deepEqual(placeholders(src), [], src);
  }
  assert.deepEqual(placeholders('Accuracy improves to XX.X.'), ['XX.X']);
  assert.deepEqual(placeholders('We evaluate TableX on R1/R2.'), []);
  assert.deepEqual(placeholders('See Fig.X and Fig.~??.'), ['Fig.X', 'Fig.~??']);
});

test('M12, L1: check 16 compares the whole comment as the note shows it', () => {
  assert.equal(titled('  ```python\n' + '#'.repeat(4000) + '\n  return 1\n```', TRIM).length, 1);
  assert.deepEqual(titled('  - a\n     - b', TRIM), []);
  assert.deepEqual(titled('  **Results**', TRIM), []);
});

test('L5: the invisible-character card never cuts a character in two', () => {
  const src = '\u{1F600}' + 'a'.repeat(39) + '\u200b' + 'b'.repeat(38) + '\u{1F600}';
  const [iss] = titled(src, 'Invisible characters from a copy');
  const marked = src.slice(iss.start, iss.end);
  assert.ok(!/^[\udc00-\udfff]|[\ud800-\udbff]$/.test(marked), JSON.stringify(marked));
});

// ---- findings of the Codex recheck of 2026-11-21 (reviews/2026-11-21/codex-recheck-preflight) ----

const macroCard = (src, name, opts) => {
  const res = A.analyze(src, opts);
  return [...A.texProblemIssues(src, res.spans, texReports(src), res.issues, { analyze: opts })]
    .find((c) => c.title === '\\' + name + ' is not defined in MathJax');
};

test('R1: reports align with the formulas MathJax typeset, past math it never sees', () => {
  const src = '$\\def\\chooseme#1{0}$\n\n![Curve $z$](/images/plot.png)\n\n' +
    '$\\chooseme{\\bm{x}}\\def\\chooseme#1{#1}$ then $\\chooseme{\\bm{x}}\\def\\chooseme#1{#1}$\n\n' +
    '![demo][r]\n\n[r]: https://example.org/p.png "$y$"';
  const card = macroCard(src, 'bm');
  const edits = fixEdits(card);
  assert.ok(edits);
  assert.deepEqual([...edits].map((e) => e.start), [src.lastIndexOf('\\bm')]);
  assert.deepEqual(errorsOf(A.applyEditsToText(src, edits)), []);
  const moved = '![plot](/images/$z$.png) then $x^2^3$ then $a+![x](plot.png)$';
  assert.equal(problems(moved).find((c) => c.title === 'MathJax cannot typeset this formula').start, moved.indexOf('$x^2^3$'));
  assert.equal(problems('![plot](/images/$z$.png) then $\\bm{x}+&alpha;$').length, 1);
});

test('R2, R3: a fix that changes a reference or another formula\'s value is refused', () => {
  for (const src of [
    '$\\def\\f{\\R}\\def\\see#1{\\ref{#1}}$ then $$\\label{eq:\\R}\\tag{1}\\f$$ see $\\see{eq:\\R}$.',
    '$\\def\\f{\\R}$ then $$\\label{eq:\\R}\\tag{1}\\f$$ see $\\ref{eq:\\R}$.',
    '$\\def\\q{1}\\def\\boldsymbol#1{\\def\\q{2}#1}$ then $\\bm{x}$ then $\\q$',
    '$\\def\\boldsymbol#1{\\Bad}$ then $\\bm{x}$.',
  ]) {
    const card = problems(src).find((c) => / is not defined in MathJax$/.test(c.title));
    assert.ok(card, src);
    assert.ok(!card.fix || card.fix.check(compile) === null, src);
  }
  // A card whose word is a \label key points at the formula, not the key.
  const label = '$$\\label{eq:\\R}\\tag{1}\\R$$ As in $\\ref{eq:\\R}$.';
  assert.equal(macroCard(label, 'R').start, 0);
});

test('R4, R5: arguments stay arguments, and a displayed operator keeps its limits below', () => {
  assert.equal(applyFix('$\\frac{1}\\R$', macroCard('$\\frac{1}\\R$', 'R')), '$\\frac{1}{\\mathbb{R}}$');
  for (const src of ['$\\nicefrac{1}$', '$\\frac\\bm{x}{y}$', '$\\bm+$']) {
    const card = problems(src)[0];
    assert.ok(!card.fix || card.fix.check(compile) === null, src);
  }
  const verb = '$\\abs{\\verb!}!+x}$';
  const fixed = applyFix(verb, macroCard(verb, 'abs'));
  assert.equal(fixed, '$\\lvert \\verb!}!+x\\rvert$');
  assert.deepEqual(errorsOf(fixed), []);
  const op = '$$\\quad \\argmax_{x} f(x)$$';
  assert.equal(applyFix(op, macroCard(op, 'argmax')), '$$\\quad \\mathop{\\mathrm{arg\\ max}}_{x} f(x)$$');
});

test('R6: a TeX error shows even when another math card covers its formula', () => {
  const cards = problems('$\\{x\\}+y^2^3$');
  assert.ok(cards.some((c) => c.title === 'MathJax cannot typeset this formula' && /Another card/.test(c.detail)));
});

test('R9: a definition in \\verb or in an unused macro body is not one', () => {
  for (const src of ['$\\verb !\\def\\R{x}!$ then $\\R$', '$\\def\\unused{\\def\\R{1}}$ then $\\R$']) {
    const card = macroCard(src, 'R');
    assert.doesNotMatch(card.detail, /defined in this comment/, src);
    assert.ok(fixEdits(card), src);
  }
});

test('R10: the venue does not cost a safe fix', () => {
  const src = '$\\bm{x}$ [code](https://github.com/alice/project)';
  for (const venue of ['neurips', 'icml']) {
    const opts = { venue };
    assert.ok(macroCard(src, 'bm', opts).fix.check(compile), venue);
  }
});

test('R12: an external image shows its syntax, placeholders included', () => {
  assert.deepEqual(placeholders('![TODO](https://example.org/TBD.png)'), ['TODO', 'TBD']);
});

test('R14: a no-break space before a quote does not cost a fix', () => {
  const src = '\u00a0> <div>$$\n> \\bm{x}\n> $$</div>';
  assert.deepEqual(errorsOf(applyFix(src, macroCard(src, 'bm'))), []);
});

test('R15: check 16 sees whitespace that only MathJax keeps', () => {
  assert.equal(titled('  - $\\verb!a\n    b!$', TRIM).length, 1);
});
