// npm run corpus -- notes.jsonl [--out summary.json] [--baseline previous.json]
// Each JSON line needs a unique id and string text. RB_PAGE selects the analyzer.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import page from '../tests/lib/page.js';
import pipeline from '../tests/lib/pipeline.js';
import converters from '../tests/lib/mathml.js';
import visitorModule from 'mathjax-full/js/core/MmlTree/SerializedMmlVisitor.js';

const visitor = new visitorModule.SerializedMmlVisitor();
const digest = text => createHash('sha256').update(text).digest('hex');
const checkTitles = [
  /^(?:Stray |Unpaired |\\begin\{|\\\$ is not protected|Backslash does not protect)/,
  /loses its MathJax delimiters/,
  /(?:consumed by Markdown|not a math accent|TeX row break|Line-end backslash|Blank line splits|cannot find the end|Currency dollars|bare % starts a TeX comment)/,
  /(?:splits this formula|interrupts this formula|Multiplication asterisks)/,
  /^(?:Table cell separator|Table row has more)/,
  /becomes a hyperlink inside math/,
  /^Indented text/,
  /has no target: OpenReview/,
  /^Raw HTML/,
  /^HTML comment/,
  /^External image/,
  /^Footnotes/,
  /^This heading/,
  /(?:is shown outside math|LaTeX quotation|LaTeX tie)/,
  /(?:not allowed at|Shortened URL|This link may reveal)/,
  /^Posting removes/,
  /^Placeholder left/,
  /^(?:Invisible characters|Ligature characters)/,
  /^LaTeX comment/,
  /^Text left over from a chat assistant/,
];

// Match exact character runs between two representations. Long shared substrings
// anchor each subdivision so a removed URL or table cell need not be guessed.
// Unmatched characters deliberately have no source position.
export function positions(source, visible) {
  const map = new Int32Array(visible.length).fill(-1);
  // Find the shortest insert/delete path first. This matters for adjacent
  // numeric table rows with long identical suffixes. Bound the trace for
  // inputs whose HTML discards most of a large source.
  const cap = Math.min(768, source.length + visible.length), trace = [];
  if (Math.abs(source.length - visible.length) <= cap) {
    for (let edits = 0; edits <= cap; edits++) {
      const row = new Int32Array(edits + 1), prev = trace.at(-1);
      for (let j = 0; j <= edits; j++) {
        const k = 2 * j - edits;
        let x = !prev ? 0 : j === 0 || (j < edits && prev[j - 1] < prev[j]) ? prev[j] : prev[j - 1] + 1;
        let y = x - k;
        while (x < source.length && y < visible.length && source[x] === visible[y]) { x++; y++; }
        row[j] = x;
        if (x !== source.length || y !== visible.length) continue;
        for (let d = edits; d > 0; d--) {
          const last = trace[d - 1];
          const down = j === 0 || (j < d && last[j - 1] < last[j]);
          const before = down ? last[j] : last[j - 1] + 1;
          while (x > before) map[--y] = --x;
          if (down) y--;
          else { x--; j--; }
        }
        while (x > 0) map[--y] = --x;
        return map;
      }
      trace.push(row);
    }
  }
  const pending = [[0, source.length, 0, visible.length]];
  while (pending.length) {
    let [a, b, c, d] = pending.pop();
    while (a < b && c < d && source[a] === visible[c]) map[c++] = a++;
    while (a < b && c < d && source[b - 1] === visible[d - 1]) map[--d] = --b;
    if (a === b || c === d) continue;
    let best = null;
    // Table rows in particular can repeat long stretches of digits. Prefer
    // a short local match over jumping several rows to a longer one.
    for (const [size, horizon] of [[16, 16], [6, 12], [3, 8], [2, 4], [1, 2],
      [48, Infinity], [16, Infinity], [6, Infinity], [2, Infinity], [1, Infinity]]) {
      if (size > b - a || size > d - c) continue;
      const chunk = source.slice(a, b);
      let cost = horizon;
      for (let v = c; v + size <= d && v - c < cost; v++) {
        const hit = chunk.indexOf(visible.slice(v, v + size));
        if (hit >= 0 && v - c + hit < cost) {
          cost = v - c + hit;
          best = [a + hit, v, size];
        }
      }
      if (best) break;
    }
    if (!best) continue;
    const [s, v, size] = best;
    for (let j = 0; j < size; j++) map[v + j] = s + j;
    pending.push([a, s, c, v], [s + size, b, v + size, d]);
  }
  return map;
}

// Offsets come from MathJax's DOM finder. Render every item in document
// order, including the label-resolution pass, before inspecting any MathML.
export function postedView(source) {
  const doc = pipeline.mathDocument(pipeline.renderHtml(source.trim()));
  doc.findMath().compile();
  const root = doc.document.body.firstElementChild;
  const walk = doc.document.createTreeWalker(root, 4);
  const nodes = new Map();
  let flat = '';
  for (let node = walk.nextNode(); node; node = walk.nextNode()) {
    nodes.set(node, flat.length);
    flat += node.data;
  }
  const map = positions(source, flat);
  const hidden = new Uint8Array(flat.length);
  const code = new Uint8Array(source.length);
  for (const [node, offset] of nodes) {
    if (node.parentElement.closest('code,pre')) {
      hidden.fill(1, offset, offset + node.length);
      for (let j = offset; j < offset + node.length; j++) if (map[j] >= 0) code[map[j]] = 1;
    }
  }
  const formulas = [], replacements = [], escapedDollars = [];
  for (const item of doc.math) {
    const a = nodes.get(item.start.node) + item.start.n;
    const b = nodes.get(item.end.node) + item.end.n;
    const start = map[a] ?? -1, end = (map[b - 1] ?? -2) + 1;
    hidden.fill(1, a, b);
    if (item.display === null) {
      replacements.push([item, doc.document.createTextNode(item.math)]);
      if (item.math === '$') escapedDollars.push({ kind: 'escaped-dollar', start, end, detail: '$' });
      continue;
    }
    const mml = visitor.visitTree(item.root);
    const errors = [], undef = [], refs = [];
    item.root.walkTree(n => {
      if (n.isKind('merror')) errors.push(String(n.attributes.get('data-mjx-error') || 'TeX error'));
      if (n.isKind('mtext') && n.attributes.getExplicit('mathcolor') === 'red' && n.getText().startsWith('\\')) undef.push(n.getText());
      if (n.isKind('mrow') && n.attributes.get('class') === 'MathJax_ref' && /\?\?\?/.test(visitor.visitTree(n))) refs.push(n.attributes.get('href'));
    });
    formulas.push({ tex: item.math, display: item.display, start, end, open: item.start.delim,
      close: item.end.delim, mml: digest(mml), errors, undef, refs });
    replacements.push([item, doc.document.createElement('rb-formula')]);
  }
  const runs = [], structural = [];
  for (const el of root.querySelectorAll('del,a')) {
    const texts = [...nodes.keys()].filter(n => el.contains(n));
    if (!texts.length) continue;
    const first = texts[0], last = texts.at(-1);
    const a = map[nodes.get(first)], b = map[nodes.get(last) + last.length - 1] + 1;
    if (a < 0 || b <= a) continue;
    if (el.localName === 'del' && source[a - 1] === '~' && source[b] === '~' &&
        source[a - 2] !== '~' && source[b + 1] !== '~') {
      structural.push({ kind: 'struck-between-tildes', start: a - 1, end: b + 1, detail: el.textContent });
    }
    if (el.localName === 'a' && el.textContent.startsWith('^') && source[a - 1] === '[' && source[b] === ']') {
      structural.push({ kind: 'footnote-as-link', start: a - 1, end: b + 1, detail: el.textContent });
    }
  }
  for (const [node, offset] of nodes) {
    for (let i = 0; i < node.length;) {
      while (i < node.length && hidden[offset + i]) i++;
      const start = i;
      while (i < node.length && !hidden[offset + i]) i++;
      if (start < i) runs.push({ text: node.data.slice(start, i), at: offset + start });
    }
  }
  for (const [item, marker] of replacements.reverse()) {
    item.typesetRoot = marker;
    item.updateDocument(doc);
  }
  return { formulas, outside: root.innerHTML, runs, map, code, structural, escapedDollars };
}

// Read the source delimiters before Markdown. Both spellings of the bracket
// delimiters occur in real comments. Pairing across a block is intentional:
// it yields a review candidate if the DOM finder cannot see that formula.
function typedFormulas(text, code) {
  const open = /\$\$?|(\\{1,2})([([])|\\begin\{([A-Za-z]+\*?)\}/g;
  const spans = [];
  for (let m; (m = open.exec(text));) {
    if (code[m.index] || (m[0][0] === '$' && text[m.index - 1] === '\\')) continue;
    const delim = m[0], inner = open.lastIndex;
    const close = m[3] ? '\\end{' + m[3] + '}' : m[2] ? m[1] + (m[2] === '(' ? ')' : ']') : delim;
    let at = text.indexOf(close, inner);
    while (at >= 0 && (code[at] || (delim[0] === '$' && text[at - 1] === '\\'))) at = text.indexOf(close, at + close.length);
    if (at < 0) continue;
    const end = at + close.length;
    spans.push({ start: m.index, end, tex: m[3] ? text.slice(m.index, end) : text.slice(inner, at),
      display: delim === '$$' || !!m[3] || m[2] === '[', open: delim });
    open.lastIndex = end;
  }
  return spans;
}

const literalPatterns = {
  'visible-dollar': /\$+/g,
  'visible-tex': /\\(?:[A-Za-z]{2,}\*?|[%&#{}|,;!])(?:\{[^{}\n]{0,80}\})?/g,
  'visible-html': /<!--[\s\S]*?(?:-->|$)|<\/?[A-Za-z][\w:-]*(?:\s[^<>\n]*)?\/?>/g,
  'visible-footnote': /\[\^[^\]\s]+\](?::)?/g,
  'visible-tie': /(?:\b(?:fig(?:ure)?|tab(?:le)?|eq(?:uation)?|sec(?:tion)?|appendix|experiment|theorem|lemma|ref(?:erence)?|algorithm)s?\.?~(?=\S)|~(?=\\(?:cite|ref|footnote)))/gi,
  'visible-delimiter': /\\[()[\]]/g,
  'visible-quotes': /``[^\n]{1,200}?''/g,
};

export function breakages(text, view) {
  const events = [...view.structural];
  const add = (kind, start, end, detail) => events.push({ kind, start, end, detail });
  const typed = typedFormulas(text, view.code);
  const actual = view.formulas;
  for (const f of actual) {
    for (const message of f.errors) add('tex-error', f.start, f.end, message);
    for (const name of new Set(f.undef)) add('undefined-macro', f.start, f.end, name);
    for (const ref of f.refs) add('unresolved-ref', f.start, f.end, ref);
    if (/(?:\d|\})\s*%/.test(f.tex)) add('possible-percent-comment', f.start, f.end, f.tex);
    if (f.open === '$' && (/\b[a-z]{2,}(?:\s+[a-z]{2,}){2}\b/i.test(f.tex) && !/[\\^_{}]/.test(f.tex) ||
        /^\s*\d[\s\S]{1,300}\b(?:cost|per|and|USD|dollars?)\b/i.test(f.tex) && !/[\\^_{}]/.test(f.tex) ||
        /^\s*\d[\d.,]*\s*(?:to|[-–—])\s*$/i.test(f.tex) && /^\s*\d/.test(text.slice(f.end)))) {
      add('possible-prose-in-math', f.start, f.end, f.tex);
    }
    // A source pair can be missed by the raw scan after an earlier stray $.
    // Exact DOM endpoint matches let us recover the typed contents in that case.
    if (f.open && f.close && text.startsWith(f.open, f.start) && text.slice(f.end - f.close.length, f.end) === f.close &&
        !typed.some(s => Math.abs(f.start - s.start) <= 1 && Math.abs(f.end - s.end) <= 1)) {
      typed.push({ start: f.start, end: f.end, display: f.display, open: f.open,
        tex: text.slice(f.start + f.open.length, f.end - f.close.length) });
    }
  }
  const probes = [];
  for (const s of typed) {
    const f = actual.find(f => Math.abs(f.start - s.start) <= 1 && Math.abs(f.end - s.end) <= 1);
    if (!f) {
      add('missing-formula', s.start, s.end, s.tex);
    } else if (s.tex !== f.tex || s.display !== f.display) {
      probes.push({ s, f });
    }
  }
  if (probes.length) {
    // Keep surrounding definitions and references. An identical MathML hash
    // excludes spelling changes which MathJax renders identically.
    const inputs = actual.map(f => probes.find(p => p.f === f)?.s || f);
    const expected = converters.mathml(inputs);
    for (const { s, f } of probes) {
      if (digest(expected[actual.indexOf(f)]) !== f.mml || s.display !== f.display) {
        add('changed-formula', s.start, s.end, { typed: s.tex, received: f.tex });
      }
    }
  }
  for (const run of view.runs) {
    for (const [kind, pattern] of Object.entries(literalPatterns)) {
      for (const m of run.text.matchAll(pattern)) {
        const a = run.at + m.index, b = a + m[0].length - 1;
        let start = view.map[a], end = view.map[b] < 0 ? -1 : view.map[b] + 1;
        // OpenReview generates literal <img> markup from an external Markdown
        // image. Its new tag brackets have no corresponding source character.
        const src = kind === 'visible-html' && /^<img src="([^"]+)"/.exec(m[0]);
        if (src && (start < 0 || end <= start || text[start] !== '<')) {
          const anchors = [...text.matchAll(/!\[[^\]\n]*\]\(([^)\n]+)\)/g)];
          const image = anchors.find(p => p[1].includes(src[1]) && !events.some(e => e.kind === kind && e.start === p.index));
          if (image) { start = image.index; end = start + image[0].length; }
        }
        add(kind, start, end, m[0]);
      }
    }
  }
  // Code examples often quote TeX deliberately. Keep these separate from
  // visibly broken prose, so an auditor can distinguish explanatory text.
  for (const s of typedFormulas(text, new Uint8Array(0))) {
    if (view.code[s.start] && view.code[s.end - 1]) add('code-formula', s.start, s.end, s.tex);
  }
  return events.concat(view.escapedDollars);
}

export function inspect(row, analyzer) {
  const { id, text, url, venue } = row;
  const view = postedView(text);
  const breaks = breakages(text, view);
  const res = analyzer.analyze(text);
  const simple = (c, check) => ({ check, sev: c.sev, title: c.title, start: c.start, end: c.end });
  const cards = res.issues.map(c => simple(c, checkTitles.findIndex(p => p.test(c.title)) + 1 || 'unmapped'));
  // Match the page's per-formula error reports, including the preflight
  // helper's first-pass semantics for definitions shared across a document.
  for (const c of analyzer.texProblemIssues(text, res.spans, converters.texReports(text), res.issues, { stale: false })) {
    cards.push(simple(c, 'MathJax'));
  }
  return { id, url, venue, sourceHash: digest(text), cards, breaks, formulas: view.formulas.length,
    fixed: analyzer.fixAllText(text).text !== text };
}

function cardKey(c) {
  return JSON.stringify([c.check, c.sev, c.title, c.start, c.end]);
}

function difference(before, after) {
  const counts = new Map();
  for (const c of before) counts.set(cardKey(c), (counts.get(cardKey(c)) || 0) + 1);
  return after.filter(c => {
    const key = cardKey(c), n = counts.get(key) || 0;
    if (n) counts.set(key, n - 1);
    return !n;
  });
}

function printDiff(previous, current) {
  const old = new Map(previous.map(r => [r.id, r])), now = new Map(current.map(r => [r.id, r]));
  let changed = 0;
  for (const id of new Set([...old.keys(), ...now.keys()])) {
    const a = old.get(id), b = now.get(id);
    const appeared = difference(a?.cards || [], b?.cards || []);
    const disappeared = difference(b?.cards || [], a?.cards || []);
    if (appeared.length || disappeared.length || !a || !b || a.sourceHash !== b.sourceHash) {
      console.log(JSON.stringify({ id, source: !a ? 'added' : !b ? 'removed' : a.sourceHash !== b.sourceHash ? 'changed' : 'same',
        appeared, disappeared }));
      changed++;
    }
  }
  console.log('Baseline differences in ' + changed + ' texts');
}

async function main(args) {
  const [file, ...flags] = args;
  if (!file || file.startsWith('--')) throw Error('Usage: npm run corpus -- <corpus.jsonl> [--out summary.json] [--baseline previous.json]');
  const opts = {};
  for (let i = 0; i < flags.length; i += 2) {
    const flag = flags[i], value = flags[i + 1];
    if (!['--out', '--baseline'].includes(flag) || !value || value.startsWith('--') || opts[flag]) throw Error('Invalid option: ' + flag);
    opts[flag] = value;
  }
  const baseline = opts['--baseline'] && JSON.parse(fs.readFileSync(opts['--baseline'], 'utf8'));
  if (baseline && (baseline.version !== 1 || !Array.isArray(baseline.texts))) throw Error('Unsupported baseline format');
  const analyzer = page.loadAnalyzer(), texts = [], ids = new Set();
  const counts = new Map(), breaks = new Map();
  for (const kind of ['tex-error', 'undefined-macro', 'unresolved-ref', 'changed-formula', 'missing-formula',
    'possible-prose-in-math', 'possible-percent-comment', 'code-formula', 'struck-between-tildes',
    'footnote-as-link', 'escaped-dollar', ...Object.keys(literalPatterns)]) breaks.set(kind, { kind, texts: 0, occurrences: 0 });
  let line = 0, fixed = 0, mathBearing = 0, formulas = 0;
  for await (const raw of createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity })) {
    line++;
    if (!raw.trim()) continue;
    try {
      const row = JSON.parse(raw);
      if (!row || !(typeof row.id === 'string' && row.id.length || Number.isFinite(row.id)) ||
          typeof row.text !== 'string' || ids.has(row.id)) throw Error('Expected unique string or numeric id and string text');
      ids.add(row.id);
      const result = inspect(row, analyzer);
      texts.push(result);
      formulas += result.formulas;
      if (/\$|\\(?:\(|\[|begin\{)/.test(row.text)) mathBearing++;
      if (result.fixed) fixed++;
      for (const c of result.cards) {
        const k = JSON.stringify([c.check, c.sev, c.title]);
        counts.set(k, (counts.get(k) || 0) + 1);
      }
      for (const kind of new Set(result.breaks.map(b => b.kind))) {
        breaks.get(kind).texts++;
      }
      for (const b of result.breaks) breaks.get(b.kind).occurrences++;
    } catch (err) {
      throw Error(file + ':' + line + ': ' + err.message, { cause: err });
    }
  }
  const cards = Array.from(counts, ([key, count]) => {
    const [check, sev, title] = JSON.parse(key);
    return { check, sev, title, count };
  }).sort((a, b) => String(a.check).localeCompare(String(b.check), 'en', { numeric: true }) || a.title.localeCompare(b.title));
  const summary = { version: 1, analyzerHash: digest(page.readPage()), count: texts.length, mathBearing, formulas, fixed,
    cards, breakageCandidates: [...breaks.values()], texts };
  console.log('Texts: ' + texts.length + ', math-bearing: ' + mathBearing + ', posted formulas: ' + formulas + ', changed by Fix all: ' + fixed);
  console.table(cards);
  console.log('Reference pipeline findings (candidates require intent review)');
  console.table(summary.breakageCandidates);
  if (baseline) printDiff(baseline.texts, texts);
  if (opts['--out']) fs.writeFileSync(opts['--out'], JSON.stringify(summary, null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(err => { console.error(err.stack); process.exitCode = 1; });
}
