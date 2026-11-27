'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { loadAnalyzer } = require('./lib/page');
const { renderHtml, typeset } = require('./lib/pipeline');

const { htmlToMarkdown } = loadAnalyzer();
const parse = html => new JSDOM(html).window.document;
const imageWarning = 'Images and embedded equations cannot be converted. Check the pasted text for missing content.';

function check(source, markdown, html, warnings = []) {
  const result = htmlToMarkdown(parse(source), { pad: false });
  assert.ok(result);
  assert.equal(result.markdown, markdown);
  assert.deepEqual(Array.from(result.warnings, w => w.message), warnings);
  // Marked inserts newlines between block tags. Keep whitespace inside text,
  // including the space on either side of an inline formatting boundary.
  assert.equal(renderHtml(result.markdown).trim().replace(/>\n+</g, '><'), html);
}

test('Google Docs changes weight on runs inside a normal-weight b wrapper', () => {
  check('<b id="docs-internal-guid-f22" style="font-weight:normal"><p dir="ltr">' +
    '<span style="font-weight:700">Our <span>result</span></span><span style="font-weight:400">&nbsp;on </span>' +
    '<span style="font-style:italic">both</span> sets.</p><p>See below.</p></b>',
    '**Our result** on *both* sets.\n\nSee below.',
    '<p><strong>Our result</strong> on <em>both</em> sets.</p><p>See below.</p>');
});

test('flat Docs list items nest by aria level or margin and resume their parent numbering', () => {
  for (const attr of [['aria-level="1"', 'aria-level="2"'], ['style="margin-left:36pt"', 'style="margin-left:72pt"']]) {
    check('<ol start="9"><li ' + attr[0] + '>One</li><li ' + attr[1] + '>Two</li>' +
      '<li ' + attr[1] + '>Three</li><li ' + attr[0] + '>Four</li></ol>',
      '9. One\n   1. Two\n   2. Three\n10. Four',
      '<ol start="9"><li>One<ol><li>Two</li><li>Three</li></ol></li><li>Four</li></ol>');
  }
});

test('Word list paragraphs strip nested, plain and conditional markers and honor inline styles', () => {
  check('<p class="MsoListParagraphCxSpFirst" style="mso-list:l0 level1 lfo1">' +
    '<span style="mso-list:Ignore">2.<span>&nbsp;&nbsp;</span></span><b><span>Answer</span></b></p>' +
    '<p class="MsoListParagraph" style="mso-list:l0 level2 lfo1">' +
    '<!--[if !supportLists]><span style="font-family:Symbol">·&nbsp;</span><![endif]-->' +
    '<span style="mso-bidi-font-style:italic">Nested</span></p>' +
    '<p class="MsoListParagraph" style="mso-list:l0 level1 lfo1"><span>3.</span>Next</p>' +
    '<p class="MsoListParagraph" style="mso-list:l0 level1 lfo1">4.&nbsp;Last</p>',
    '2. **Answer**\n   - *Nested*\n3. Next\n4. Last',
    '<ol start="2"><li><strong>Answer</strong><ul><li><em>Nested</em></li></ul></li><li>Next</li><li>Last</li></ol>');
});

test('a paragraph splits lists and an ordinary nested list keeps its item and continuation line', () => {
  check('<ul><li>Parent<ol start="10"><li>Child<br>continued</li></ol></li><li>Next</li></ul>' +
    '<p>Revised answer.</p><ul><li>Separate</li></ul>',
    '- Parent\n  10. Child  \n      continued\n- Next\n\nRevised answer.\n\n- Separate',
    '<ul><li>Parent<ol start="10"><li>Child<br>continued</li></ol></li><li>Next</li></ul>' +
    '<p>Revised answer.</p><ul><li>Separate</li></ul>');
});

test('web headings, quotes, styled link labels, bare URLs and monospace runs', () => {
  check('<h1>One</h1><h2>Two</h2><h3>Three</h3><blockquote><p>See ' +
    '<a href="/paper"><b>the paper</b></a> or <a href="https://example.org">https://example.org</a>.</p>' +
    '<p><span style="font-family:Consolas">a|b</span> and <code>\x60x\x60</code>.</p></blockquote>' +
    '<h4>Four</h4><h5>Five</h5><h6>Six</h6>',
    '# One\n\n## Two\n\n### Three\n\n> See [**the paper**](/paper) or https://example.org.\n>\n' +
    '> \x60a|b\x60 and \x60\x60 \x60x\x60 \x60\x60.\n\n**Four**\n\n**Five**\n\n**Six**',
    '<h1>One</h1><h2>Two</h2><h3>Three</h3><blockquote><p>See ' +
    '<a href="/paper" target="_blank" rel="noopener noreferrer"><strong>the paper</strong></a> or ' +
    '<a href="https://example.org" target="_blank" rel="noopener noreferrer">https://example.org</a>.</p>' +
    '<p><code>a|b</code> and <code>\x60x\x60</code>.</p></blockquote><p><strong>Four</strong></p>' +
    '<p><strong>Five</strong></p><p><strong>Six</strong></p>');
});

test('a pasted TeX formula reaches MathJax with the original control sequences and subscript', () => {
  const tex = '$\\alpha_i + \\frac{1}{2}$';
  check('<p><em>Score</em> ' + tex + ' costs $5.</p>', '*Score* ' + tex + ' costs $5.',
    '<p><em>Score</em> ' + tex + ' costs $5.</p>');
  assert.deepEqual(typeset(htmlToMarkdown(parse('<b>Score</b> ' + tex)).markdown), ['I:' + tex.slice(1, -1)]);
});

test('Markdown escapes preserve TeX delimiters, control symbols and matrix row breaks through MathJax', () => {
  const matrix = '\\begin{pmatrix}0 & 1 \\\\ 1 & 0\\end{pmatrix}';
  const text = '\\(\\alpha\\) and $\\{x\\}$, then $' + matrix + '$.';
  const md = '**See** &#92;\\(\\alpha&#92;\\) and $&#92;\\{x&#92;\\}$, then $' +
    matrix.replace('\\\\', '&#92;\\\\') + '$.';
  check('<p><b>See</b> ' + text + '</p>', md, '<p><strong>See</strong> ' + text.replaceAll('&', '&amp;') + '</p>');
  assert.deepEqual(typeset(md), ['I:\\alpha', 'I:\\{x\\}', 'I:' + matrix]);
});

test('Docs pre-wrap spans retain real line breaks and lower headings share one bold style', () => {
  check('<h4>Fit <b>by group</b></h4><span style="white-space:pre-wrap">First.\n&gt; Again.</span>',
    '**Fit by group**\n\nFirst.  \n\\> Again.', '<p><strong>Fit by group</strong></p><p>First.<br>&gt; Again.</p>');
});

test('literal punctuation cannot turn into inline formatting or start a block after a break', () => {
  check('<p># title<br>&gt; quote<br>- bullet<br>1. item<br>*x* _y_ \x60z\x60 [name] | 3 &lt; 4</p>',
    '\\# title  \n\\> quote  \n\\- bullet  \n1\\. item  \n\\*x\\* \\_y\\_ \\\x60z\\\x60 \\[name\\] | 3 &lt; 4',
    '<p># title<br>&gt; quote<br>- bullet<br>1. item<br>*x* _y_ \x60z\x60 [name] | 3 &lt; 4</p>');
});

test('tables use the grid converter and keep neighboring paragraphs and literal cell pipes', () => {
  check('<p>Results.</p><table><tr><th>Model</th><th>N</th></tr><tr><td>A|B</td><td>8</td></tr></table><p>End.</p>',
    'Results.\n\n|Model|N|\n|:-|-:|\n|A\\|B|8|\n\nEnd.',
    '<p>Results.</p><table><thead><tr><th align="left">Model</th><th align="right">N</th></tr></thead>' +
    '<tbody><tr><td align="left">A|B</td><td align="right">8</td></tr></tbody></table><p>End.</p>');
});

test('image and MathML equations retain their alt text and warn once, including when a description is missing', () => {
  check('<p><strong>Fit:</strong> <img alt="x squared"> and <math alttext="y"><mi>ignored</mi></math>.' +
    '<img alt=""></p>', '**Fit:** x squared and y.', '<p><strong>Fit:</strong> x squared and y.</p>', [imageWarning]);
  check('<img src="equation.png">', '', '', [imageWarning]);
  check('<p>Scores</p><table><tr><td>A<td>B<tr><td><img alt="x squared"><td>2</table>',
    'Scores\n\n|A|B|\n|:-|-:|\n|x squared|2|',
    '<p>Scores</p><table><thead><tr><th align="left">A</th><th align="right">B</th></tr></thead>' +
    '<tbody><tr><td align="left">x squared</td><td align="right">2</td></tr></tbody></table>', [imageWarning]);
});

test('empty clipboard, ordinary text and unformatted wrappers need no conversion', () => {
  for (const src of ['', '<p><br></p>', '<ul><li><br></li></ul>', 'Ordinary *text*', '<b style="font-weight:normal"><span>same</span></b>',
    '<script>ignored()</script><style>b{font-weight:bold}</style>', '<b></b>', '<a href="https://x.org">https://x.org</a>']) {
    assert.equal(htmlToMarkdown(parse(src)), null, src);
  }
  assert.equal(htmlToMarkdown(null), null);
});
