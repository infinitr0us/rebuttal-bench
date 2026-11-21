'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { loadAnalyzer } = require('./lib/page');
const { renderHtml, typeset } = require('./lib/pipeline');

const { importTable, analyze } = loadAnalyzer();
const raw = String.raw;

// Check both source layouts and the independent pipeline. Counting formulas
// alone would miss a dropped backslash or a changed TeX control symbol.
function check(src, { format, padded, compact, cells, align, math = [], warnings = [], tags = {} }) {
  for (const [options, expected] of [[undefined, padded], [{ pad: false }, compact]]) {
    const result = importTable(src, options);
    assert.ok(result);
    assert.equal(result.format, format);
    assert.equal(result.markdown, expected);
    assert.deepEqual(Array.from(result.warnings, w => [w.line, w.message]), warnings);
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
