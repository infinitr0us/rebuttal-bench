'use strict';
// Regression cases for the hazard analyzer and its autofixes.
//
//   issues: the exact multiset of hazard titles the analyzer must report
//           ([] means correct input that must stay silent).
//   fixed:  what OpenReview's MathJax must typeset after "Fix all"
//           (null means Fix all must leave the text untouched).
//   text:   optionally, the exact source after Fix all, where the shape of the
//           rest (table cells, code, prose) matters as much as the math.
//
// Every change to a check or an autofix should add a case here, in both
// directions: the broken input it repairs, and nearby correct input it must
// leave alone. Fix all runs unattended, so the second kind matters most.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAnalyzer } = require('./lib/page');
const { renderLikeOpenReview, typeset } = require('./lib/pipeline');

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
  'escaped brackets around labels in prose': { src: 'See \\[A\\], issues \\[a\\] and \\[b\\], and \\[R1\\].', issues: [], fixed: null },
  'indented Windows commands': {
    src: 'Run:\n\n    dir C:\\data\n    copy \\\\srv\\share\\x.txt src\\utils\\run.py\n\nDone.',
    issues: [],
    fixed: null,
  },
  'block quote shield inside math': { src: '$a\n\\> b$', issues: [], fixed: null },
  'text accents typed correctly': { src: 'By $\\text{Schr\\\\"{o}dinger}$ and $\\text{Schrödinger}$.', issues: [], fixed: null },
  'intraword emphasis': { src: 'Our pre*training* stage.', issues: [], fixed: null },
  'character reference closing a formula': { src: 'So $5&#36; here.', issues: [], fixed: null },
  'dollar in a link destination': { src: 'See [the log](https://example.com/run?id=$5) and $y$ here.', issues: [], fixed: null },
  'references to a tagged equation': { src: '$$x=1\\tag{1}\\label{eq:bound}$$\n\nSee \\eqref{eq:bound} and $\\ref{eq:bound}$.', issues: [], fixed: null },
  'numbers with a unit inside math': {
    src: 'Latency is $50 ms$, memory $16 GB$, over $100 epochs$ and $3 seeds$, a $2 times$ speedup, and $2 xy$.',
    issues: [],
    fixed: null,
  },
  'number with a unit and a space before the closing $': { src: 'It needs $16 GB $ of memory.', issues: [], fixed: null },
  'norm with a subscript in a table cell': { src: '| a | b |\n| --- | --- |\n| $\\|\\theta\\|_{2}$ | 0.1 |', issues: [], fixed: null },
  'code span with a shielded pipe in a table cell': { src: '| A |\n| - |\n| `$\\{x\\}\\|y$` |', issues: [], fixed: null },
  'HTML and prose TeX in code': {
    src: '`<br> [^1] Table~1`\n\n```tex\n<!-- TODO --> #### ![fig](x) \\cite{paper} \\textbf{x} <br>\n```',
    issues: [], fixed: null,
  },
  'literal syntax inside real math': {
    src: '$\\textbf{x} + a<b$ and $x<sup>2</sup>$ and $\\text{et~al.}$',
    issues: [], fixed: null,
  },
  'image hosted by OpenReview': { src: '![Fig. 1](/images/fig.png)', issues: [], fixed: null },
  'links, URLs and home paths with tildes': {
    src: '[result](https://example.org/~user "[^1] \\textbf{x}") and <https://example.org/~user> or https://example.org/a~b and `~/data`.',
    issues: [], fixed: null,
  },
  'URL in a label and a scheme left as text': {
    src: '[https://site.org/query?key=a~b](page) and ssh://site.org/data~old', issues: [], fixed: null,
  },
  'ordinary strikethrough and escaped tilde': { src: '~~old~~ and a\\~b and ~/path and ~removed~.', issues: [], fixed: null },
  'footnote-like text in a reference destination and title': {
    src: '[log]: /logs/[^part]\n  "Only [^internal] Table~1"\n\n[log]', issues: [], fixed: null,
  },
  'multiline reference definition in a quote': { src: '> [log]:\n>   /logs/[^part]\n\n[log]', issues: [], fixed: null },
  'explicit links, escaped footnote, inline code': { src: '[^label](note) and \\[^label] and `[^1]: note`.', issues: [], fixed: null },
  'visible headings and heading-like prose': { src: '### Results\n\n######no space', issues: [], fixed: null },

  // ---- broken input: Fix all must produce the intended TeX ----
  'TeX inside literal HTML blocks is left alone': {
    src: '<div>$x\\,y$</div>\n\n<!-- TODO $\\{x\\}$ -->',
    issues: ['Raw HTML is shown as text', 'HTML comment is shown to the reviewers'], fixed: null,
  },
  'currency in one paragraph, math in the next': { src: 'It costs $5 per run.\n\nWe define $x$ as the input.', issues: ['Unpaired $'], fixed: ['I:x'] },
  'currency before display math': { src: 'costs $5 and $$x$$ done', issues: ['Currency dollars pair into a formula', 'Unpaired $'], fixed: ['D:x'] },
  'currency range': { src: 'Budget between $5-$10 per run.', issues: ['Currency dollars pair into a formula'], fixed: [] },
  'two prices in one sentence': { src: 'It costs $5 per hour and $10 per day.', issues: ['Currency dollars pair into a formula'], fixed: [] },
  'a price, then a formula in the same sentence': {
    src: 'It costs $5 per run, and $x$ is the input.',
    issues: ['Currency dollars pair into a formula', 'Unpaired $'],
    fixed: ['I:x'],
    text: 'It costs \\\\$5 per run, and $x$ is the input.',
  },
  'a price, then a control-word formula': {
    src: 'Each run costs $2 on average; we define $\\alpha$ as the rate.',
    issues: ['Currency dollars pair into a formula', 'Unpaired $'],
    fixed: ['I:\\alpha'],
  },
  'a price, then a formula that starts with a digit': {
    src: 'It costs $5 per run, and $2x$ is the bound.',
    issues: ['Currency dollars pair into a formula', 'Unpaired $'],
    fixed: ['I:2x'],
    text: 'It costs \\\\$5 per run, and $2x$ is the bound.',
  },
  'a price, then a formula that starts with a minus': {
    src: 'It costs $5 per run, and $-x$ is the bound.',
    issues: ['Currency dollars pair into a formula', 'Unpaired $'],
    fixed: ['I:-x'],
  },
  'three prices in one sentence': {
    src: 'It costs $5 per hour, $10 per day, and $50 per week.',
    issues: ['Currency dollars pair into a formula', 'Unpaired $'],
    fixed: [],
    text: 'It costs \\\\$5 per hour, \\\\$10 per day, and \\\\$50 per week.',
  },
  'a price typed as a character reference, then a formula': {
    src: 'It costs &#36;5 per run, and $x$ is the input.',
    issues: ['Currency dollars pair into a formula', 'Unpaired $'],
    fixed: ['I:x'],
    text: 'It costs \\\\$5 per run, and $x$ is the input.',
  },
  'negative amounts in two table cells': {
    src: '| A | B |\n| - | - |\n| $-5 | $-10 |',
    issues: ['Unpaired $', 'Unpaired $'],
    fixed: [],
    text: '| A | B |\n| - | - |\n| \\\\$-5 | \\\\$-10 |',
  },
  'digit-leading formula cut by inline code': { src: 'So $2 + `x`$ here.', issues: ['Inline code interrupts this formula'], fixed: null },
  'subtraction cut by inline code': { src: 'So $2 - `x`$ here.', issues: ['Inline code interrupts this formula'], fixed: null },
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
  'escaped brackets that may be prose: warning only': {
    src: 'Default setting \\[k=5\\] and a gain of \\[+2.1\\].',
    issues: ['\\[ … \\] loses its MathJax delimiters', '\\[ … \\] loses its MathJax delimiters'],
    fixed: null,
  },
  'escaped parentheses around one letter: warning only': { src: 'Item \\(a\\) comes first.', issues: ['\\( … \\) loses its MathJax delimiters'], fixed: null },
  'text accent consumed by Markdown': {
    src: 'By $\\text{Schr\\"{o}dinger}$.',
    issues: ['\\" is consumed by Markdown'],
    fixed: ['I:\\text{Schr\\"{o}dinger}'],
  },
  'more than twelve unpaired delimiters': {
    src: 'a \\\\) b\n\n'.repeat(13) + 'It costs $5 per run.',
    issues: Array(13).fill('Stray \\) delimiter').concat('Unpaired $'),
    fixed: [],
  },
  'thick space consumed by Markdown': { src: 'Here $a\\;b$ holds.', issues: ['\\; is consumed by Markdown'], fixed: ['I:a\\;b'] },
  'emphasis inside math': { src: 'Here $a*b*c$ is bad.', issues: ['Markdown emphasis splits this formula'], fixed: ['I:a*b*c'] },
  'emphasis across shielded-bar formulas in a table cell': {
    src: '| Reg. | Value |\n| --- | --- |\n| $\\|\\theta\\|_{2}$ vs $\\|\\theta\\|_{1}$ | 0.1 |',
    issues: ['Markdown emphasis splits this formula'],
    fixed: ['I:|\\theta|_{2}', 'I:|\\theta|_{1}'],
    text: '| Reg. | Value |\n| --- | --- |\n| $\\|\\theta\\|\\_{2}$ vs $\\|\\theta\\|\\_{1}$ | 0.1 |',
  },
  'consumed escape next to a code span in a link label': {
    src: '[`\\[x\\]` and $a\\,b$](https://example.com)',
    issues: ['\\, is consumed by Markdown'],
    fixed: ['I:a\\,b'],
    text: '[`\\[x\\]` and $a\\\\,b$](https://example.com)',
  },
  'inline code inside math': { src: 'We have $x + `y`$ here.', issues: ['Inline code interrupts this formula'], fixed: null },
  'equation reference copied from the paper': {
    src: 'As shown in Eq. \\eqref{eq:loss}, the bound $x$ holds by $\\ref{thm:1}$.',
    issues: ['\\eqref has no target: OpenReview shows (???)', '\\ref has no target: OpenReview shows ???'],
    fixed: null,
  },
  'reference to an untagged label': {
    src: '\\begin{equation}x\\label{a}\\end{equation}\n\nSee \\eqref{a}.',
    issues: ['\\eqref has no target: OpenReview shows (???)'],
    fixed: null,
  },
  'reference to the untagged row of an align': {
    src: '$$\n\\begin{align}\nx &= 1 \\label{a} \\\\\\\\\ny &= 2 \\tag{2}\\label{b}\n\\end{align}\n$$\n\nSee \\eqref{a} and \\eqref{b}.',
    issues: ['\\eqref has no target: OpenReview shows (???)'],
    fixed: null,
  },
  'indented relative path: a note, no fix': {
    src: 'Run:\n\n    dir src\\utils\n\nDone.',
    issues: ['Indented text became a code block'],
    fixed: null,
  },
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
    if (c.text !== undefined) assert.equal(out, c.text, 'source after Fix all');
  });
}

// Click the same edits as the card, then check the result against the
// independent renderer. Every one of these drafts must survive Fix all intact.
const HTML = 'Raw HTML is shown as text';
const COMMENT = 'HTML comment is shown to the reviewers';
const TIE = 'LaTeX tie is shown as a tilde';
const manualCases = [
  ...[['b', '**', 'strong'], ['strong', '**', 'strong'], ['i', '*', 'em'], ['em', '*', 'em'], ['code', '`', 'code']].map(([tag, delimiter, element]) => [
    HTML, '<' + tag + '>ours</' + tag + '>', delimiter + 'ours' + delimiter,
    new RegExp('<' + element + '>ours</' + element + '>'),
  ]),
  [HTML, 'H<sub>2</sub>O', 'H$_{2}$O', ['I:_{2}']],
  [HTML, 'x<sup>-2</sup>', 'x$^{-2}$', ['I:^{-2}']],
  [COMMENT, 'Done. <!-- TODO: ask co-author -->', 'Done.', /<p>Done\.<\/p>/],
  [COMMENT, 'a <!--private--> b', 'a b', /<p>a b<\/p>/],
  [COMMENT, '<!--private--> x', 'x', /<p>x<\/p>/],
  [COMMENT, 'one<!--private--> two', 'one two', /<p>one two<\/p>/],
  ['\\textbf is shown outside math', '\\textbf{our {main} result}', '**our {main} result**', /<strong>our \{main\} result<\/strong>/],
  ['\\textbf is shown outside math', '\\textbf{our\nresult}', '**our\nresult**', /<strong>our\nresult<\/strong>/],
  ['\\textit is shown outside math', '\\textit{important}', '*important*', /<em>important<\/em>/],
  ['\\emph is shown outside math', '\\emph{this}', '*this*', /<em>this<\/em>/],
  ['\\texttt is shown outside math', '\\texttt{fmt}', '`fmt`', /<code>fmt<\/code>/],
  ['\\url is shown outside math', '\\url{https://example.org/~user}', 'https://example.org/~user', /<a href="https:\/\/example.org\/~user"/],
  ['\\href is shown outside math', '\\href{https://example.org/~user}{our {code}}', '[our {code}](https://example.org/~user)',
    /<a href="https:\/\/example.org\/~user"[^>]*>our \{code\}<\/a>/],
  ['\\href is shown outside math', '\\href{foo~bar}{log}', '[log](foo~bar)', /<a href="foo~bar"[^>]*>log<\/a>/],
  ['LaTeX quotation marks are shown as text', "It is ``better''.", 'It is "better".', /<p>It is "better"\.<\/p>/],
  [TIE, 'Table~1', 'Table 1', /<p>Table 1<\/p>/],
  [TIE, 'et~al.', 'et al.', /<p>et al\.<\/p>/],
];

for (const [title, src, fixed, output] of manualCases) {
  test('manual fix for ' + src, () => {
    const issues = [...A.analyze(src).issues];
    assert.deepEqual(issues.map((i) => i.title), [title]);
    const [issue] = issues;
    assert.equal(issue.sev, title === COMMENT ? 'err' : 'warn');
    assert.equal(issue.fix.manual, true);
    assert.equal(A.fixAllText(src).applied, 0);
    assert.ok(A.editsStillValid(src, issue.fix.edits));
    assert.equal(A.applyEditsToText(src, issue.fix.edits), fixed);
    if (Array.isArray(output)) assert.deepEqual(typeset(fixed), output);
    else assert.match(renderLikeOpenReview(fixed).html, output);
    assert.equal(A.analyze(fixed).issues.length, 0);
  });
}

const warnings = [
  [HTML, '| A | B |\n| - | - |\n| x<br>y | 2 |', /x&lt;br&gt;y/, /split the row/i],
  [HTML, 'x<br />y', /x&lt;br \/&gt;y/, /two spaces/],
  [HTML, '<details>\n<summary>More</summary>\n</details>', /&lt;summary&gt;More/, null, 3],
  [HTML, 'A <b title="a>b">result</b>', /&lt;b title="a&gt;b"&gt;/],
  [HTML, '<code>a`b</code>', /&lt;code&gt;a`b/],
  [HTML, '<code>$x$</code>', /&lt;code&gt;\$x\$/],
  [HTML, 'x<sup>n + 1</sup>', /&lt;sup&gt;n \+ 1/],
  ['External image is shown as its HTML source', '![fig](https://i.imgur.com/abc.png)', /&lt;img src="https:\/\/i\.imgur\.com\/abc.png"/],
  ['External image is shown as its HTML source', '![fig][asset]\n\n[asset]: figs/a.png', /&lt;img src="figs\/a.png"/],
  ['Footnotes are not supported', 'claim[^1]\n\n[^1]: note', /<a href="note"[^>]*>\^1<\/a>/, null, 2],
  ['Footnotes are not supported', '[^1]: note\n\n[^1]', /<a href="note"[^>]*>\^1<\/a>/, null, 2],
  ['Footnotes are not supported', 'claim[^missing]', /claim\[\^missing\]/],
  ...[4, 5, 6].map((n) => ['This heading looks like body text', '> ' + '#'.repeat(n) + ' Small', new RegExp('<h' + n + '>Small</h' + n + '>')]),
  ...['cite', 'citep', 'citet', 'citeauthor', 'citeyear'].map((c) => ['\\' + c + ' is shown outside math', '\\' + c + '{smith2023}', /\\cite/, /bibliography/]),
  ['\\underline is shown outside math', '\\underline{ours}', /\\underline\{ours\}/, /underline syntax/],
  ['\\textbf is shown outside math', '\\textbf{our {result}', /\\textbf/, /balanced/],
  ['\\href is shown outside math', '\\href{a}{our {site}', /\\href/, /balanced/],
  ['\\href is shown outside math', '[\\href{a}{site}](other)', /<a href="other"[^>]*>\\href/],
];

for (const [title, src, rendered, detail, count = 1] of warnings) {
  test('diagnostic for ' + src, () => {
    assert.match(renderLikeOpenReview(src).html, rendered);
    const issues = [...A.analyze(src).issues];
    assert.deepEqual(issues.map((i) => i.title), Array(count).fill(title));
    for (const issue of issues) {
      assert.equal(issue.sev, title === 'This heading looks like body text' ? 'note' : 'warn');
      assert.equal(issue.fix, null);
      if (detail) assert.match(issue.detail, detail);
    }
  });
}

test('a manual fix edits the visible tag when a link definition contains the same text', () => {
  const def = '[asset]: /img "<b>ours</b>"\n\n';
  const src = def + '<b>ours</b>';
  const [issue] = A.analyze(src).issues;
  assert.equal(issue.start, def.length);
  assert.equal(A.applyEditsToText(src, issue.fix.edits), def + '**ours**');
  assert.match(renderLikeOpenReview(def + '**ours**').html, /<strong>ours<\/strong>/);
});

test('single LaTeX ties that actually produce GFM strikethrough', () => {
  const src = 'Table~1 and Fig.~2';
  assert.match(renderLikeOpenReview(src).html, /Table<del>1 and Fig\.<\/del>2/);
  const issues = [...A.analyze(src).issues];
  assert.deepEqual(issues.map((i) => [i.sev, i.title]), Array(2).fill(['err', 'LaTeX tie became strikethrough']));
  assert.equal(A.fixAllText(src).text, src);
  const first = A.applyEditsToText(src, issues[0].fix.edits);
  assert.equal(first, 'Table 1 and Fig.~2');
  const [left] = A.analyze(first).issues;
  assert.equal(left.title, TIE);
  const fixed = A.applyEditsToText(first, left.fix.edits);
  assert.equal(fixed, 'Table 1 and Fig. 2');
  assert.match(renderLikeOpenReview(fixed).html, /<p>Table 1 and Fig\. 2<\/p>/);
});

test('a tie before a MathJax reference belongs to the prose', () => {
  const src = 'Fig.~\\ref{fig:main}';
  const issues = [...A.analyze(src).issues];
  assert.deepEqual(issues.map((i) => i.title), [TIE, '\\ref has no target: OpenReview shows ???']);
  assert.equal(A.applyEditsToText(src, issues[0].fix.edits), 'Fig. \\ref{fig:main}');
});

test('Fix all applies mechanical fixes in a draft that also has manual ones', () => {
  const src = 'Set $a\\,b$. <!-- private --> <b>ours</b>';
  const { text, applied } = A.fixAllText(src);
  assert.equal(applied, 1);
  assert.equal(text, 'Set $a\\\\,b$. <!-- private --> <b>ours</b>');
  assert.deepEqual([...A.analyze(text).issues].map((i) => i.title), [COMMENT, HTML]);
});
