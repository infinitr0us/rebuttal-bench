'use strict';
// Regression cases for the hazard analyzer and its autofixes.
//
//   issues: the exact multiset of hazard titles the analyzer must report
//           ([] means correct input that must stay silent).
//   fixed:  what OpenReview's MathJax must typeset after "Fix all"
//           (null means Fix all must leave the text untouched).
//
// Every change to a check or an autofix should add a case here, in both
// directions: the broken input it repairs, and nearby correct input it must
// leave alone. Fix all runs unattended, so the second kind matters most.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAnalyzer } = require('./lib/page');
const { typeset } = require('./lib/pipeline');

const A = loadAnalyzer();

const CASES = {
  // ---- correct input: silent, and Fix all must not touch it ----
  'numbers typeset on purpose': { src: 'Mean over $5$ seeds and $10$ runs.', issues: [], fixed: null },
  'math that starts with a number': { src: 'We get $2x $ and $2+3 $ here.', issues: [], fixed: null },
  'escaped citation brackets': { src: 'As shown in \\[12\\] and \\[3, 4\\], this works.', issues: [], fixed: null },
  'bracket shields inside math': { src: '$f\\[x\\](y)$', issues: [], fixed: null },
  'subscripts': { src: 'We use $x_i$ and $\\mathbf{W}_t$ here.', issues: [], fixed: null },
  'aligned with four-slash row breaks': { src: '$$\n\\begin{aligned}\na &= b \\\\\\\\\nc &= d\n\\end{aligned}\n$$', issues: [], fixed: null },
  'control word after two slashes in a matrix': { src: '$$\\begin{pmatrix} \\\\alpha & b \\\\\\\\ c & d \\end{pmatrix}$$', issues: [], fixed: null },
  'escaped currency': { src: 'Costs \\\\$5 and \\\\$10 in total.', issues: [], fixed: null },
  'two-space hard break inside display math': { src: '$$\na = b  \nc = d\n$$', issues: [], fixed: null },
  'shielded pipes in a table': { src: '| a | b |\n| --- | --- |\n| $\\|x\\|$ | 2 |', issues: [], fixed: null },
  'fenced shell code': { src: '```\nexport PATH=$HOME/bin:$PATH\n```', issues: [], fixed: null },
  'repeated code spans in table cells': { src: '| A | B |\n| - | - |\n| `$\\{x\\}$` | `$\\{x\\}$` |', issues: [], fixed: null },
  'bare environment': { src: '\\begin{aligned}\na &= b \\\\\\\\\nc &= d\n\\end{aligned}', issues: [], fixed: null },
  'adjacent inline formulas': { src: 'Then $x$$y$ end.', issues: [], fixed: null },
  'math in a block quote': { src: '> The bound $\\epsilon_t$ holds\n> for all $t$.', issues: [], fixed: null },
  'math in a list': { src: '- first $a_1$\n- second $b_2$ and\n  more $c$', issues: [], fixed: null },
  'literal braces typed correctly': { src: 'The set $\\\\{x_i\\\\}_{i=1}^N$ is fixed.', issues: [], fixed: null },
  'text-mode accent inside \\text': { src: '$\\text{Se\\\\~{n}or}$', issues: [], fixed: null },
  'control space in \\text next to a matrix': { src: '$\\text{a\\\\ b}+\\begin{matrix}x\\end{matrix}$', issues: [], fixed: null },
  'norm with a subscript in a table cell': { src: '| a | b |\n| --- | --- |\n| $\\|\\theta\\|_{2}$ | 0.1 |', issues: [], fixed: null },
  'code span with a shielded pipe in a table cell': { src: '| A |\n| - |\n| `$\\{x\\}\\|y$` |', issues: [], fixed: null },

  // ---- broken input: Fix all must produce the intended TeX ----
  'currency in one paragraph, math in the next': { src: 'It costs $5 per run.\n\nWe define $x$ as the input.', issues: ['Unpaired $'], fixed: ['I:x'] },
  'currency before display math': { src: 'costs $5 and $$x$$ done', issues: ['Currency dollars pair into a formula', 'Unpaired $'], fixed: ['D:x'] },
  'currency range': { src: 'Budget between $5-$10 per run.', issues: ['Currency dollars pair into a formula'], fixed: [] },
  'currency escaped with one slash': {
    src: 'costs \\$5 and \\$10 total',
    issues: ['Backslash does not protect this $', 'Backslash does not protect this $', 'Currency dollars pair into a formula'],
    fixed: [],
  },
  'currency around inline code': { src: 'costs $5 in `run.sh` and $3 total', issues: ['Unpaired $', 'Unpaired $'], fixed: [] },
  'row break before a space': {
    src: '$$\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}$$',
    issues: ['TeX row break collapses to one backslash'],
    fixed: ['D:\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}'],
  },
  'row break before a trailing space': {
    src: '$$\n\\begin{aligned}\na &= b \\\\ \nc &= d\n\\end{aligned}\n$$',
    issues: ['TeX row break collapses to one backslash'],
    fixed: ['D:\n\\begin{aligned}\na &= b \\\\ \nc &= d\n\\end{aligned}\n'],
  },
  'single slash at line end in aligned': { src: '$$\\begin{aligned} a &= b \\\nc &= d\\end{aligned}$$', issues: ['Line-end backslash becomes a Markdown line break'], fixed: null },
  'tilde accent': { src: '$\\~{a}$', issues: ['\\~{…} is not a math accent'], fixed: ['I:\\tilde{a}'] },
  'one-slash text accent inside \\text': { src: '$\\text{Se\\~{n}or}$', issues: ['\\~ is consumed by Markdown'], fixed: ['I:\\text{Se\\~{n}or}'] },
  'digit-leading formula with a bare pipe in a table': {
    src: '| a | b |\n| - | - |\n| $2x|y$ | z |',
    issues: ['Table cell separator inside math', 'Table row has more cells than its header'],
    fixed: ['I:2x|y'],
  },
  'bare pipes in a table': {
    src: '| a | b |\n| --- | --- |\n| $|x|$ | 2 |',
    issues: ['Table cell separator inside math', 'Table cell separator inside math', 'Table row has more cells than its header'],
    fixed: ['I:|x|'],
  },
  'math in a cell beyond the header width': {
    src: '| a | b |\n| - | - |\n| 1 | 2 | $x$ |',
    issues: ['Table row has more cells than its header'],
    fixed: null,
  },
  'currency in two table cells': { src: '| a | b |\n| --- | --- |\n| $5 | $10 |', issues: ['Unpaired $', 'Unpaired $'], fixed: [] },
  'thin space in nested dollars': { src: '$\\text{$x\\,y$}$', issues: ['\\, is consumed by Markdown'], fixed: ['I:\\text{$x\\,y$}'] },
  'thin space in a bare environment': {
    src: '\\begin{equation} x\\,y \\end{equation}',
    issues: ['\\, is consumed by Markdown'],
    fixed: ['D:\\begin{equation} x\\,y \\end{equation}'],
  },
  'list marker splits a formula': { src: 'we have $a\n+ b$ here', issues: ['Markdown block structure splits this formula'], fixed: null },
  'blank line in display math': { src: '$$\na = b\n\nc = d\n$$', issues: ['Blank line splits a math span into separate blocks'], fixed: ['D:\na = b\nc = d\n'] },
  'blank line inside an environment in display math': {
    src: '$$\n\\begin{aligned}\na &= b \\\\\\\\\n\nc &= d\n\\end{aligned}\n$$',
    issues: ['Blank line splits a math span into separate blocks'],
    fixed: ['D:\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\n'],
  },
  'one-slash \\[ … \\] split by a blank line': { src: '\\[x^2\n\ny^2\\]', issues: ['\\[ … \\] loses its MathJax delimiters'], fixed: ['D:x^2\ny^2'] },
  'one-slash \\( … \\)': { src: 'Let \\(x + y\\) be.', issues: ['\\( … \\) loses its MathJax delimiters'], fixed: ['I:x + y'] },
  'emphasis inside math': { src: 'Here $a*b*c$ is bad.', issues: ['Markdown emphasis splits this formula'], fixed: ['I:a*b*c'] },
  'emphasis across shielded-bar formulas in a table cell': {
    src: '| Reg. | Value |\n| --- | --- |\n| $\\|\\theta\\|_{2}$ vs $\\|\\theta\\|_{1}$ | 0.1 |',
    issues: ['Markdown emphasis splits this formula'],
    fixed: ['I:|\\theta|_{2}', 'I:|\\theta|_{1}'],
  },
  'inline code inside math': { src: 'We have $x + `y`$ here.', issues: ['Inline code interrupts this formula'], fixed: null },
  'unbalanced brace from \\{': {
    src: '$\\{x$ and more text $y$',
    issues: ['MathJax cannot find the end of this formula', '\\{ is consumed by Markdown', 'Unpaired $'],
    fixed: ['I:\\{x', 'I:y'],
  },
  'multiplication asterisks': { src: 'Used 8*A100 for 30 h, i.e. a*b*c.', issues: ['Multiplication asterisks became Markdown emphasis'], fixed: [] },
  'indented shell snippet': { src: 'Run:\n\n    export PATH=$HOME/bin:$PATH\n\nDone.', issues: ['Indented text became a code block'], fixed: null },
  'indented TeX': { src: 'Proof:\n\n    where $\\alpha_t \\le 1$ holds\n\nDone.', issues: ['Indented text became a code block'], fixed: ['I:\\alpha_t \\le 1'] },
};

for (const [name, c] of Object.entries(CASES)) {
  test(name, () => {
    // Spread first: arrays made inside the VM belong to another realm, which
    // deepStrictEqual rejects even when the contents match.
    const titles = [...A.analyze(c.src).issues].map((i) => i.title).sort();
    assert.deepEqual(titles, c.issues.slice().sort(), 'hazards reported');
    const out = A.fixAllText(c.src).text;
    if (c.fixed === null) assert.equal(out, c.src, 'Fix all must leave this text alone');
    else assert.deepEqual(typeset(out), c.fixed, 'MathJax output after Fix all of ' + JSON.stringify(out));
  });
}
