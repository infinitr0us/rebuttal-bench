'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { loadAnalyzer } = require('./lib/page');
const { renderHtml, typeset } = require('./lib/pipeline');

const { importTable, importHtmlTable, readHtmlTable, analyze } = loadAnalyzer();
const raw = String.raw;

// Check both source layouts and the independent pipeline. Counting formulas
// alone would miss a dropped backslash or a changed TeX control symbol.
function check(src, { format, padded, compact, cells, align, math = [], warnings = [], tags = {} }) {
  const doc = format === 'html' && new JSDOM(src).window.document;
  for (const [options, expected] of [[undefined, padded], [{ pad: false }, compact]]) {
    const result = doc ? importHtmlTable(doc, options) : importTable(src, options);
    assert.ok(result);
    assert.equal(result.format, format);
    assert.equal(result.markdown, expected);
    assert.deepEqual(Array.from(result.warnings, w => [doc ? w.row : w.line, w.message]), warnings);
    const dom = JSDOM.fragment(renderHtml(result.markdown));
    assert.equal(dom.querySelectorAll('table').length, 1);
    assert.deepEqual(Array.from(dom.querySelectorAll('thead th'), el => el.getAttribute('align')), align);
    assert.deepEqual(Array.from(dom.querySelectorAll('tr'), tr => Array.from(tr.cells, el => el.textContent)), cells);
    for (const [tag, texts] of Object.entries(tags)) {
      assert.deepEqual(Array.from(dom.querySelectorAll(tag), el => el.textContent), texts);
    }
    assert.deepEqual(typeset(result.markdown), math);
    assert.deepEqual(Array.from(analyze(result.markdown).issues, i => i.title), []);
  }
}

test('booktabs results preserve significance, percent escapes and both kinds of math pipe', () => {
  check(raw`% Ablation table
\begin{tabular}{@{}lccc@{}}
\toprule
Method & Top-1 (\%) & Change & 95\% CI \\
\midrule
Base\_A & 91.2 & $0.3 \pm 0.1$ & $95\%$ \\ % rounded
\textbf{Ours} & {\bf 93.1} & $1.2 \pm 0.2$ & $|x|+\|y\|$ \\
\bottomrule
\end{tabular}`, {
    format: 'latex',
    padded: raw`| Method   | Top-1 (%) | Change        | 95% CI            |
| :-       | :-:       | :-:           | :-:               |
| Base_A   | 91.2      | $0.3 \pm 0.1$ | $95\\%$           |
| **Ours** | **93.1**  | $1.2 \pm 0.2$ | $\|x\|+\\\|y\\\|$ |`,
    compact: raw`|Method|Top-1 (%)|Change|95% CI|
|:-|:-:|:-:|:-:|
|Base_A|91.2|$0.3 \pm 0.1$|$95\\%$|
|**Ours**|**93.1**|$1.2 \pm 0.2$|$\|x\|+\\\|y\\\|$|`,
    cells: [['Method', 'Top-1 (%)', 'Change', '95% CI'], ['Base_A', '91.2', raw`$0.3 \pm 0.1$`, raw`$95\%$`],
      ['Ours', '93.1', raw`$1.2 \pm 0.2$`, raw`$|x|+\|y\|$`]],
    math: [raw`I:0.3 \pm 0.1`, raw`I:95\%`, raw`I:1.2 \pm 0.2`, raw`I:|x|+\|y\|`],
    align: ['left', 'center', 'center', 'center'], tags: { strong: ['Ours', '93.1'] },
  });
});

test('spanning group headers, multirow labels and multiline makecells', () => {
  check(raw`\begin{tabular*}{\linewidth}{@{}l*{2}{r}@{}}
 & \multicolumn{2}{c}{Test sets} \\
 \cmidrule(lr){2-3}
Model & A & B \\
\midrule
\multirow{2}{*}{\makecell{Our \\ encoder}} & 10 & 11 \\
 & 12 & 13 \\
\end{tabular*}`, {
    format: 'latex',
    padded: '| Model       | Test sets A | B  |\n| :-          | -:          | -: |\n' +
      '| Our encoder | 10          | 11 |\n|             | 12          | 13 |',
    compact: '|Model|Test sets A|B|\n|:-|-:|-:|\n|Our encoder|10|11|\n||12|13|',
    cells: [['Model', 'Test sets A', 'B'], ['Our encoder', '10', '11'], ['', '12', '13']],
    align: ['left', 'right', 'right'],
    warnings: [[2, raw`Flattened \multicolumn into ordinary cells.`], [2, 'Joined 2 header rows into one.'],
      [6, raw`Flattened \multirow into ordinary cells.`]],
  });
});

test('Excel TSV keeps empty cells, explicit pipes and numeric uncertainty columns', () => {
  check('Method\tScore\tError\r\nA | B\t95.2%*\t1.0 ± 0.2\r\n\t96%\t±0.4\r\n', {
    format: 'tsv',
    padded: '| Method | Score  | Error     |\n| :-     | -:     | -:        |\n' +
      '| A \\| B | 95.2%* | 1.0 ± 0.2 |\n|        | 96%    | ±0.4      |',
    compact: '|Method|Score|Error|\n|:-|-:|-:|\n|A \\| B|95.2%*|1.0 ± 0.2|\n||96%|±0.4|',
    cells: [['Method', 'Score', 'Error'], ['A | B', '95.2%*', '1.0 ± 0.2'], ['', '96%', '±0.4']],
    align: ['left', 'right', 'right'],
  });
});

test('CSV quotes, doubled quotes and a line break inside a field', () => {
  check('Method,Note,Score\n"Base, small","called ""fast""",9\nOurs,"two\nlines",10', {
    format: 'csv',
    padded: '| Method      | Note          | Score |\n| :-          | :-            | -:    |\n' +
      '| Base, small | called "fast" | 9     |\n| Ours        | two lines     | 10    |',
    compact: '|Method|Note|Score|\n|:-|:-|-:|\n|Base, small|called "fast"|9|\n|Ours|two lines|10|',
    cells: [['Method', 'Note', 'Score'], ['Base, small', 'called "fast"', '9'], ['Ours', 'two lines', '10']],
    align: ['left', 'left', 'right'],
  });
});

test('bare LaTeX body keeps paper references legible and warns at the original source line', () => {
  check(raw`A & B \\
\color{red}\textit{R\&D} & \textcolor{blue}{\underline{\{x\}}} \\
% notes for the authors
\cite{ml} & \ref{sec:a} \\
\footnote{a {b}} & {\it fine} \\`, {
    format: 'latex',
    padded: '| A                  | B             |\n| :-                 | :-            |\n' +
      '| *R&D*              | {x}           |\n| `\\cite{ml}`        | `\\ref{sec:a}` |\n' +
      '| `\\footnote{a {b}}` | *fine*        |',
    compact: '|A|B|\n|:-|:-|\n|*R&D*|{x}|\n|`\\cite{ml}`|`\\ref{sec:a}`|\n|`\\footnote{a {b}}`|*fine*|',
    cells: [['A', 'B'], ['R&D', '{x}'], [raw`\cite{ml}`, raw`\ref{sec:a}`], [raw`\footnote{a {b}}`, 'fine']],
    tags: { em: ['R&D', 'fine'] }, align: ['left', 'left'],
    warnings: [[2, raw`Removed color formatting (\color).`], [2, raw`Removed color formatting (\textcolor).`],
      [2, 'Removed underline formatting.'], [4, raw`Kept \cite as literal text.`], [4, raw`Kept \ref as literal text.`],
      [5, raw`Kept \footnote as literal text.`]],
  });
});

test('tabularx width, paragraph and X columns, colors, rules and nested formatting', () => {
  check(raw`\begin{tabularx}{0.9\linewidth}{p{3cm}|Xr}
\hline
Run & Model & AP \\ \hline
\rowcolor{gray} A & \emph{Wide~net} & \cellcolor[RGB]{1,2,3} 15 \\
\cline{2-3}
B & \textbf{Deep {net}} & 16 \\ \hline
\end{tabularx}`, {
    format: 'latex',
    padded: '| Run | Model        | AP |\n| :-  | :-           | -: |\n' +
      '| A   | *Wide net*   | 15 |\n| B   | **Deep net** | 16 |',
    compact: '|Run|Model|AP|\n|:-|:-|-:|\n|A|*Wide net*|15|\n|B|**Deep net**|16|',
    cells: [['Run', 'Model', 'AP'], ['A', 'Wide net', '15'], ['B', 'Deep net', '16']],
    tags: { strong: ['Deep net'], em: ['Wide net'] }, align: ['left', 'left', 'right'],
    warnings: [[4, raw`Removed color formatting (\rowcolor).`], [4, raw`Removed color formatting (\cellcolor).`]],
  });
});

test('array entries use their implicit math mode', () => {
  check(raw`\[\begin{array}{lr} x_i & y \\ \hline \alpha & 2 \end{array}\]`, {
    format: 'latex', padded: '| $x_i$    | $y$ |\n| :-       | -:  |\n| $\\alpha$ | $2$ |',
    compact: '|$x_i$|$y$|\n|:-|-:|\n|$\\alpha$|$2$|',
    cells: [['$x_i$', '$y$'], ['$\\alpha$', '$2$']], align: ['left', 'right'],
    math: ['I:x_i', 'I:y', 'I:\\alpha', 'I:2'],
  });
});

test('ragged spreadsheet rows preserve their text within the header width', () => {
  check('A,B,C\n1,2\n3,4,5,6', {
    format: 'csv', padded: '| A  | B  | C   |\n| -: | -: | :-  |\n| 1  | 2  |     |\n| 3  | 4  | 5 6 |',
    compact: '|A|B|C|\n|-:|-:|:-|\n|1|2||\n|3|4|5 6|',
    cells: [['A', 'B', 'C'], ['1', '2', ''], ['3', '4', '5 6']], align: ['right', 'right', 'left'],
    warnings: [[3, 'Joined extra cells in the last column.']],
  });
});

test('spreadsheet and bare tabular cells can contain a whole LaTeX array', () => {
  const formula = raw`\begin{array}{cc}1&0\\0&1\end{array}`;
  const cell = raw`$\begin{array}{cc}1&0\\\\0&1\end{array}$`;
  for (const format of ['csv', 'tsv', 'latex']) {
    const src = format === 'csv' ? 'Model,Projection,Count\nBase,"$' + formula + '$","1,234"'
      : format === 'tsv' ? 'Model\tProjection\tCount\nBase\t$' + formula + '$\t1,234'
      : raw`Model & Projection & Count \\` + '\nBase & $' + formula + '$ & 1,234';
    const lastAlign = format === 'latex' ? ':-' : '-:';
    check(src, {
      format, padded: '| Model | Projection                               | Count |\n' +
        '| :-    | :-                                       | ' + lastAlign + '    |\n| Base  | ' + cell + ' | 1,234 |',
      compact: '|Model|Projection|Count|\n|:-|:-|' + lastAlign + '|\n|Base|' + cell + '|1,234|',
      cells: [['Model', 'Projection', 'Count'], ['Base', '$' + formula + '$', '1,234']],
      math: ['I:' + formula], align: ['left', 'left', format === 'latex' ? 'left' : 'right'],
    });
  }
});

test('a formatting command in an array preserves the math mode of its argument', () => {
  check(raw`\begin{array}{lr}\text{Model}&\text{Score}\\\hline\textcolor{red}{\alpha} & \underline{x_1}\end{array}`, {
    format: 'latex',
    padded: raw`| $\text{Model}$ | $\text{Score}$ |
| :-             | -:             |
| $\alpha$       | $x_1$          |`,
    compact: raw`|$\text{Model}$|$\text{Score}$|
|:-|-:|
|$\alpha$|$x_1$|`,
    cells: [[raw`$\text{Model}$`, raw`$\text{Score}$`], [raw`$\alpha$`, '$x_1$']],
    math: [raw`I:\text{Model}`, raw`I:\text{Score}`, raw`I:\alpha`, 'I:x_1'], align: ['left', 'right'],
    warnings: [[1, raw`Removed color formatting (\textcolor).`], [1, 'Removed underline formatting.']],
  });
});

test('a pipe following a literal backslash in a footnote stays in the same cell', () => {
  const src = raw`Method & Note \\ Base & \footnote{mesh \| x}`;
  const content = '`\\footnote{mesh \\`\\|` x}`';
  check(src, {
    format: 'latex', padded: '| Method | Note                      |\n| :-     | :-                        |\n| Base   | ' + content + ' |',
    compact: '|Method|Note|\n|:-|:-|\n|Base|' + content + '|',
    cells: [['Method', 'Note'], ['Base', raw`\footnote{mesh \| x}`]], align: ['left', 'left'],
    warnings: [[1, raw`Kept \footnote as literal text.`]],
  });
});

test('ordinary prose, a single tab and incomplete quoted CSV are not tables', () => {
  for (const text of ['', 'R&D', 'A & B\ncontinued', 'A\tB', '\t', 'a,b', 'A,B\n"unfinished,1']) {
    assert.equal(importTable(text), null, JSON.stringify(text));
  }
});

test('Google Sheets uses visible cell text, inline alignment and formatted numeric body cells', () => {
  check(`<google-sheets-html-origin><table><colgroup><col width="90"><col width="75"></colgroup>
    <tbody><tr><td style="text-align:center" data-sheets-value='{"1":2,"2":"Model"}'>Model</td><td>AP</td></tr>
    <tr><td style="font-weight:600">Ours</td><td style="font-weight:700" data-sheets-value='{"1":3,"3":0.92}'>92%</td></tr>
    <tr><td>Base</td><td>81%</td></tr></tbody></table></google-sheets-html-origin>`, {
    format: 'html',
    compact: '|Model|AP|\n|:-:|-:|\n|**Ours**|**92%**|\n|Base|81%|',
    padded: '| Model    | AP      |\n| :-:      | -:      |\n| **Ours** | **92%** |\n| Base     | 81%     |',
    cells: [['Model', 'AP'], ['Ours', '92%'], ['Base', '81%']],
    align: ['center', 'right'], tags: { strong: ['Ours', '92%'] },
  });
});

test('Google Docs normal weights cancel bold and nested inline styles survive its wrappers', () => {
  check(`<b style="font-weight:normal;" id="docs-internal-guid-123"><table>
    <tr><td>Name</td><td>Note</td></tr>
    <tr><td><span style="font-weight:700">Our<span>s</span> <span style="font-weight:400">only</span></span></td>
    <td><span style="font-style:italic"> best </span><strong style="font-weight:normal">fit</strong><i></i><b> </b></td></tr>
    </table></b>`, {
    format: 'html',
    compact: '|Name|Note|\n|:-|:-|\n|**Ours** only|*best* fit|',
    padded: '| Name          | Note       |\n| :-            | :-         |\n| **Ours** only | *best* fit |',
    cells: [['Name', 'Note'], ['Ours only', 'best fit']], align: ['left', 'left'],
    tags: { strong: ['Ours'], em: ['best'] },
  });
});

test('Word table paragraphs, conditional comments and nested spans keep the visible formatting', () => {
  check(`<table class="MsoTableGrid"><tr style="text-align:center"><td align="left">Method</td><td>Note</td></tr>
    <tr><td><p class="MsoNormal"><b><span lang="EN-US">Our</span> net</b></p></td>
    <td><p class="MsoNormal"><!--[if !supportLists]><span>1.</span><![endif]-->First</p>
    <div>second</div><ul><li>last <em>one</em></li></ul></td></tr></table>`, {
    format: 'html',
    compact: '|Method|Note|\n|:-|:-:|\n|**Our net**|First second last *one*|',
    padded: '| Method      | Note                    |\n| :-          | :-:                     |\n' +
      '| **Our net** | First second last *one* |',
    cells: [['Method', 'Note'], ['Our net', 'First second last one']], align: ['left', 'center'],
    tags: { strong: ['Our net'], em: ['one'] },
  });
});

test('Excel clipboard fragment markers and stylesheet classes contribute no content or formatting', () => {
  check(`<html><head><style>.xl65 { font-weight:700; text-align:center }</style></head>
    <body><!--StartFragment--><table><tr><td class="xl65">Model</td><td class="xl65">Score</td></tr>
    <tr><td class="xl65">Base<img src="/ignored.png" alt="icon"><style>.x{}</style><script>ignore()</script></td>
    <td class="xl65">9.5</td></tr></table><!--EndFragment--></body></html>`, {
    format: 'html', compact: '|Model|Score|\n|:-|-:|\n|Baseicon|9.5|',
    padded: '| Model    | Score |\n| :-       | -:    |\n| Baseicon | 9.5   |',
    cells: [['Model', 'Score'], ['Baseicon', '9.5']], align: ['left', 'right'], tags: { strong: [], img: [] },
    warnings: [[2, 'Images and embedded equations cannot be converted. Check the pasted text for missing content.']],
  });
});

test('standalone HTML tables keep equation image alt text with the media warning', () => {
  check(`<table><tr><th>Metric</th><th>Definition</th></tr>
    <tr><td>Loss</td><td><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jk2cAAAAASUVORK5CYII=" alt="squared error"></td></tr></table>`, {
    format: 'html', compact: '|Metric|Definition|\n|:-|:-|\n|Loss|squared error|',
    padded: '| Metric | Definition    |\n| :-     | :-            |\n| Loss   | squared error |',
    cells: [['Metric', 'Definition'], ['Loss', 'squared error']], align: ['left', 'left'], tags: { img: [] },
    warnings: [[2, 'Images and embedded equations cannot be converted. Check the pasted text for missing content.']],
  });
});

test('HTML tables preserve vertical-align super/sub and significant spaces inside code', () => {
  check(`<table><tr><th>Item</th><th>Value</th></tr>
    <tr><td>10<span style="vertical-align:super">-3</span> / x<span style="vertical-align:sub">i</span></td><td><code>A  B</code></td></tr></table>`, {
    format: 'html', compact: '|Item|Value|\n|:-|:-|\n|10$^{-3}$ / x$_{i}$|`A  B`|',
    padded: '| Item                | Value  |\n| :-                  | :-     |\n| 10$^{-3}$ / x$_{i}$ | `A  B` |',
    cells: [['Item', 'Value'], ['10$^{-3}$ / x$_{i}$', 'A  B']], align: ['left', 'left'],
    math: ['I:^{-3}', 'I:_{i}'], tags: { code: ['A  B'] },
  });
});

test('web table spans occupy their grid, merged headers share one row, and literal punctuation stays visible', () => {
  check(`<table><thead><tr><td rowspan="2">Model</td><td colspan="2">Measures</td></tr>
    <tr><td>AP</td><td>Note</td></tr></thead><tbody>
    <tr><td rowspan="2">Base<br>net</td><td>10<sup>2</sup></td><td><a href="/paper">Read</a> | $5 * _</td></tr>
    <tr><td>8</td><td><a href="/again">Again</a></td></tr></tbody></table>`, {
    format: 'html',
    compact: raw`|Model|Measures AP|Note|
|:-|-:|:-|
|Base net|10$^{2}$|Read \| \\$5 \* \_|
||8|Again|`,
    padded: raw`| Model    | Measures AP | Note               |
| :-       | -:          | :-                 |
| Base net | 10$^{2}$    | Read \| \\$5 \* \_ |
|          | 8           | Again              |`,
    cells: [['Model', 'Measures AP', 'Note'], ['Base net', '10$^{2}$', raw`Read | \$5 * _`], ['', '8', 'Again']],
    align: ['left', 'right', 'left'], math: ['I:^{2}'], tags: { a: [] },
    warnings: [[1, 'Flattened merged cells into ordinary cells.'], [1, 'Flattened merged cells into ordinary cells.'],
      [1, 'Joined 2 header rows into one.'], [3, 'Kept link text only (venues often forbid links).']],
  });
});

test('leading th rows combine, code stays literal and only simple short sub/sup text becomes math', () => {
  check(`<table><tr><th>Group</th><th>Text</th></tr><tr><th>A</th><th>B</th></tr>
    <tr><th>x<sub>i+1</sub></th><td><code>*x*</code> <sup>see note</sup></td></tr></table>`, {
    format: 'html', compact: '|Group A|Text B|\n|:-|:-|\n|x$_{i+1}$|`*x*` see note|',
    padded: '| Group A   | Text B         |\n| :-        | :-             |\n| x$_{i+1}$ | `*x*` see note |',
    cells: [['Group A', 'Text B'], ['x$_{i+1}$', '*x* see note']], align: ['left', 'left'],
    math: ['I:_{i+1}'], tags: { code: ['*x*'] },
    warnings: [[1, 'Joined 2 header rows into one.'], [3, 'Kept complex superscript as text.']],
  });
});

test('the first qualifying table wins, including inside a one-cell layout table', () => {
  const good = '<table><tr><td>A</td><td>B</td></tr><tr><td>x</td><td>1</td></tr></table>';
  const doc = new JSDOM('<table><tr><td>' + good + '</td></tr></table>' + good.replace('A', 'C')).window.document;
  assert.equal(importHtmlTable(doc, { pad: false }).markdown, '|A|B|\n|:-|-:|\n|x|1|');
});

test('link labels that look like URLs or email addresses stay literal', () => {
  const doc = new JSDOM('<table><tr><td>A<td>B<tr><td><a href="/x">https://WWW.example.org</a>' +
    '<td><a href="/y">mail@example.org</a></table>').window.document;
  const result = importHtmlTable(doc);
  const fragment = JSDOM.fragment(renderHtml(result.markdown));
  assert.deepEqual(Array.from(fragment.querySelectorAll('td'), el => el.textContent), ['https://WWW.example.org', 'mail@example.org']);
  assert.equal(fragment.querySelector('a'), null);
  assert.deepEqual(Array.from(result.warnings, w => w.row), [2]);
});

test('adjacent and nested emphasis and significance stars stay with the characters they format', () => {
  const doc = new JSDOM('<table><tr><td>A<td>B<tr><td><b>A<i>B</i></b><i>C</i>' +
    '<td>a<b>!</b>b <b>95%*</b></table>').window.document;
  const result = importHtmlTable(doc);
  const [a, b] = JSDOM.fragment(renderHtml(result.markdown)).querySelectorAll('td');
  assert.equal(a.textContent, 'ABC');
  assert.equal(a.querySelector('strong').textContent, 'AB');
  assert.deepEqual(Array.from(a.querySelectorAll('em'), el => el.textContent), ['B', 'C']);
  assert.equal(b.textContent, 'a!b 95%*');
  assert.deepEqual(Array.from(b.querySelectorAll('strong'), el => el.textContent), ['!', '95%*']);
  doc.querySelectorAll('td')[2].innerHTML = '<strong><em>both</em></strong>';
  assert.match(importHtmlTable(doc, { pad: false }).markdown, /\|\*\*\*both\*\*\*\|/);
});

test('long, punctuated and nested scripts keep their text with a warning', () => {
  const long = 'x'.repeat(33);
  const doc = new JSDOM('<table><tr><td>A<td>B<tr><td>n<sub>' + long + '</sub> <sup>x/y</sup>' +
    '<td>x<sup>H<sub>2</sub></sup> <code>a</code></table>').window.document;
  const result = importHtmlTable(doc, { pad: false });
  assert.equal(result.markdown, '|A|B|\n|:-|:-|\n|n' + long + ' x/y|xH2 `a`|');
  assert.deepEqual(Array.from(result.warnings, w => [w.row, w.message]), [
    [2, 'Kept complex subscript as text.'], [2, 'Kept complex superscript as text.'],
  ]);
});

test('malformed fragments and inputs without a two-dimensional table are safe to ignore', () => {
  for (const src of ['', '<table', 'no table', '<table><td>a<td>b', '<table><tr><td>A<tr><td>B',
      '<table><tr><td colspan="999999999">layout</td></tr><tr><td>footer</td></tr>']) {
    assert.equal(importHtmlTable(new JSDOM(src).window.document), null, src);
  }
  for (const input of [null, undefined, 1, '', {}]) assert.equal(readHtmlTable(input), null);
  const repaired = new JSDOM('<table><td rowspan="oops">A<td>B<tr><td colspan="-7">C<td>D').window.document;
  assert.equal(importHtmlTable(repaired, { pad: false }).markdown, '|A|B|\n|:-|:-|\n|C|D|');
});
