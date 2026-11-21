'use strict';
// Compaction: shorter source, identical rendering. compactText keeps an edit
// only when the comment still renders to the same sanitized HTML, so these
// tests check that (a) the tricks find what they should, (b) the check drops
// what would change the rendering, and (c) correct-looking input is left alone.
// Rendering is the independent reference pipeline, not the page's own code.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadAnalyzer, readExample } = require('./lib/page');
const { renderHtml, typeset } = require('./lib/pipeline');
const { ALPHABETS } = require('./lib/fuzz');

const A = loadAnalyzer();
const DEFAULTS = A.compactDefaults();
const ALL = Object.fromEntries([...A.COMPACT_TRICKS].map((t) => [t.id, true]));
const compact = (src, enabled = DEFAULTS) => A.compactText(src, enabled, renderHtml);
// The whitespace tricks are checked with collapsible whitespace collapsed (the
// note text is white-space: normal) and with every formula unchanged.
const sameOnScreen = (a, b) =>
  A.collapseWhitespace(renderHtml(a)) === A.collapseWhitespace(renderHtml(b)) &&
  JSON.stringify(typeset(a)) === JSON.stringify(typeset(b));

// [name, source, compacted with the default tricks (null: unchanged), 'ws' when
// only collapsible whitespace differs in the HTML]
const CASES = [
  ['table padding and delimiter row', '| Method | Acc |\n| :--- | ---: |\n| A | 1 |', '|Method|Acc|\n|:-|-:|\n|A|1|'],
  ['centered column', '| a | b |\n| :---: | --- |\n| 1 | 2 |', '|a|b|\n|:-:|-|\n|1|2|'],
  ['one-column table keeps its pipes', '| A |\n| --- |\n| 1 |', '|A|\n|-|\n|1|'],
  ['empty cells', '| a | b |\n| --- | --- |\n|  | 2 |', '|a|b|\n|-|-|\n||2|'],
  ['backslash before a pipe keeps its space', '| path\\ | v |\n| --- | --- |\n| a | b |', '|path\\ |v|\n|-|-|\n|a|b|'],
  ['shielded pipes and math in cells', '| a | b |\n| --- | --- |\n| $\\|x\\|$ | `x \\| y` |', '|a|b|\n|-|-|\n|$\\|x\\|$|`x \\| y`|'],
  ['table in a block quote', '> | a | b |\n> | --- | --- |\n> | 1 | 2 |', '>|a|b|\n>|-|-|\n>|1|2|'],
  ['bare URL link', 'See [https://example.org/a](https://example.org/a).', 'See https://example.org/a.'],
  ['autolink brackets', 'See <https://example.org/a> now.', 'See https://example.org/a now.'],
  ['angle-bracket destination', '[logs](<https://example.org/a>)', '[logs](https://example.org/a)'],
  ['closing hashes and spaces', '##    Results ##\n\nText.', '## Results\n\nText.'],
  ['setext heading', 'Results\n=======\n\nText.', '# Results\n\nText.'],
  ['horizontal rule', 'A\n\n* * * * *\n\nB', 'A\n\n***\n\nB'],
  ['quote markers', '> Report variance.\n> > Nested.', '>Report variance.\n>>Nested.'],
  ['list marker spacing', '-   one\n-   two', '- one\n- two'],
  ['indented paragraph lines', 'First line\n    of a pasted paragraph.', 'First line\nof a pasted paragraph.', 'ws'],
  ['trailing spaces and a hard break', 'One. \nTwo  \nthree.', 'One.\nTwo\\\nthree.', 'ws'],
  ['whitespace in attributes and code spans stays',
    'See ![a\n   b](/images/x.png "t\n   u") and `x\n   y` and [l](https://x.org "p\n   q").', null],
  ['whitespace inside formulas stays', 'Let $\\text{a \n   b}$ hold \nand $x \n  + y$ too.',
    'Let $\\text{a \n   b}$ hold\nand $x \n  + y$ too.', 'ws'],
  ['blank lines', 'A\n\n\n\nB\n  \nC', 'A\n\nB\n\nC'],
  ['character references', 'Mean &plusmn; SD, Table&nbsp;1, &#x2192; done', 'Mean ± SD, Table 1, → done'],

  // correct or protected input that must stay exactly as typed
  ['already compact', '|A|B|\n|-|-|\n|1|2|\n\n## Done', null],
  ['table inside fenced code', '```\n| a | b |\n| --- | --- |\n```', null],
  ['trailing spaces inside fenced code', '```\nx = 1  \n```', null],
  ['HTML block shown as text', '<div>&plusmn;  </div>', null],
  ['code span', 'Use `&plusmn;` and `| a | b |`.', null],
  ['structural references', 'A &lt;b&gt; tag, &amp;, a dollar &#36;5 and a soft&shy;hyphen.', null],
  ['hash that is part of the heading', '## Language C#', null],
  ['indented code in a quote', '>     code line', null],
  ['link with its own label', '[the paper](https://example.org/a)', null],
  ['URL with a final dot in brackets', 'See <https://example.org/a.> now.', null],
  ['self-link glued to a word', '[https://example.org](https://example.org)x', null],
  ['math is never touched', 'We use $ x + y $ and $$\n a = b \n$$', null],
];

for (const [name, src, want, ws] of CASES) {
  test(`compact: ${name}`, () => {
    const r = compact(src);
    assert.equal(r.text, want === null ? src : want);
    if (ws) assert.ok(sameOnScreen(r.text, src));
    else assert.equal(renderHtml(r.text), renderHtml(src));
    assert.equal(r.saved, src.trim().length - r.text.trim().length);
    assert.ok(r.complete);
  });
}

test('compact: edits that would change the rendering are counted as kept', () => {
  const r = compact('See <https://example.org/a.> and [https://example.org](https://example.org)x.');
  const links = [...r.tricks].find((t) => t.id === 'links');
  assert.equal(links.count, 0);
  assert.equal(links.kept, 2);
});

test('compact: outer table pipes are off by default and reported as available', () => {
  const src = '| Method | Acc |\n| --- | --- |\n| A | 1 |\n| - | 2 |';
  const r = compact(src);
  assert.equal(r.text, '|Method|Acc|\n|-|-|\n|A|1|\n|-|2|');
  const edges = [...r.tricks].find((t) => t.id === 'tableEdges');
  assert.equal(edges.on, false);
  assert.ok(edges.saved > 0);
  // With it on: a row starting with "-" (a list marker) keeps its leading pipe.
  const all = compact(src, ALL);
  assert.equal(all.text, 'Method|Acc\n-|-\nA|1\n|-|2');
  assert.equal(renderHtml(all.text), renderHtml(src));
});

test('compact: a switched-off trick changes nothing', () => {
  const src = '| a | b |\n| --- | --- |\n| 1 | 2 |';
  const r = compact(src, { ...DEFAULTS, tables: false });
  assert.equal(r.text, src);
  assert.ok([...r.tricks].find((t) => t.id === 'tables').saved > 0);
});

test('compact: no new hazards, even where the source has some', () => {
  const src = '| A | B |\n| --- | --- |\n| $a|b$ | Costs $5 |\n\nAnd $\\{x\\}$ here.  \nNext.';
  const r = compact(src, ALL);
  const titles = (t) => [...A.analyze(t).issues].map((i) => i.sev + ' ' + i.title).sort();
  assert.ok(r.saved > 0);
  assert.deepEqual(titles(r.text), titles(src));
  assert.deepEqual(typeset(r.text), typeset(src));
});

test('compact: the built-in example renders the same and compacting twice changes nothing more', () => {
  const ex = readExample();
  const r = compact(ex, ALL);
  assert.ok(r.saved >= 20, 'saved ' + r.saved);
  assert.ok(sameOnScreen(r.text, ex));
  assert.equal(compact(r.text, ALL).saved, 0);
});

test('compact: a realistic draft with padded tables', () => {
  const src = fs.readFileSync(path.join(__dirname, 'fixtures', 'padded-tables.md'), 'utf8');
  const r = compact(src);
  assert.ok(r.saved > 300, 'saved ' + r.saved);
  assert.ok(sameOnScreen(r.text, src));
  assert.equal(compact(r.text).saved, 0);
});

test('compact: the check budget ends compaction safely', () => {
  const src = '| a | b |\n| --- | --- |\n| 1 | 2 |\n\n-   x\n\n## T ##';
  const r = A.compactText(src, DEFAULTS, renderHtml, 2);
  assert.equal(r.complete, false);
  assert.equal(renderHtml(r.text), renderHtml(src));
});

test('compact: random documents never throw and never change the rendering', () => {
  let s = 12345;
  const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff);
  const extra = ['| a | b |\n| --- | --- |\n', '  \n', '\n\n\n', '&plusmn;', '&#36;', '## ', ' ##', '-   ', '> ',
    '[https://x.org](https://x.org)', '<https://x.org>', '\n* * *\n', '    '];
  for (const atoms of [ALPHABETS.inline.concat(extra), ALPHABETS.blocks.concat(extra)]) {
    for (let it = 0; it < 150; it++) {
      let src = '';
      const len = 1 + Math.floor(rnd() * 16);
      for (let k = 0; k < len; k++) src += atoms[Math.floor(rnd() * atoms.length)];
      const r = compact(src, ALL);
      assert.ok(r, 'no result for ' + JSON.stringify(src));
      assert.ok(sameOnScreen(r.text, src), JSON.stringify(src) + ' -> ' + JSON.stringify(r.text));
      assert.ok(r.text.trim().length <= src.trim().length);
    }
  }
});
