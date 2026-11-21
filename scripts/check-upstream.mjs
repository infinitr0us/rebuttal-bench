// Detects changes in the parts of openreview-web that rebuttal-bench.html mirrors.
//
//   npm run check-upstream              compare the latest openreview-web against the snapshot
//   npm run check-upstream -- --update  accept the latest as the new snapshot
//
// Exit codes: 0 nothing changed (or the snapshot was written), 1 something
// changed upstream: read the diff, bring the page (and tests/lib/pipeline.js)
// in line, run `npm test`, then --update. 2 the check itself failed (network,
// GitHub rate limit, a moved file or marker, an unreadable snapshot).
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'openreview/openreview-web';
const BRANCH = 'master';
const SNAPSHOT = fileURLToPath(new URL('../upstream/openreview-web.json', import.meta.url));

/* The block that opens at the first `open` after `marker`, up to its matching
   close. Delimiters inside strings and line or block comments do not count,
   so a brace in a string cannot end the excerpt early and hide a later
   change. (Regular-expression literals are not recognized; none of the
   excerpts has one. "//" after a colon is a URL, not a comment.) */
export function block(text, marker, open = '{', close = '}') {
  const at = text.indexOf(marker);
  if (at < 0) throw new Error('marker not found: ' + marker);
  let i = text.indexOf(open, at), depth = 0;
  if (i < 0) throw new Error('no ' + open + ' after: ' + marker);
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < text.length && text[j] !== ch && (ch === '`' || text[j] !== '\n')) j += text[j] === '\\' ? 2 : 1;
      i = j + 1;
    } else if (ch === '/' && text[i + 1] === '/' && text[i - 1] !== ':') {
      const nl = text.indexOf('\n', i);
      i = nl < 0 ? text.length : nl;
    } else if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 2;
    } else {
      if (ch === open) depth++;
      else if (ch === close && --depth === 0) return text.slice(at, i + 1);
      i++;
    }
  }
  throw new Error('unbalanced block after: ' + marker);
}
export const lines = (text, re) => text.split('\n').filter((l) => re.test(l)).map((l) => l.trim()).join('\n');
export const between = (text, from, to) => {
  const a = text.indexOf(from), b = text.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('markers not found: ' + from + ' … ' + to);
  return text.slice(a, b + to.length);
};

// What the page mirrors, where it lives upstream, and how to cut it out.
export const EXCERPTS = [
  { id: 'MathJax config', file: 'lib/mathjax-config.js', pick: (t) => t },
  { id: 'MathJax script URL', file: 'app/MathjaxScript.js', pick: (t) => lines(t, /src=/) },
  { id: 'Marked renderer + options', file: 'client/view.js', pick: (t) => block(t, 'var setupMarked = function') },
  { id: 'DOMPurify config + hook', file: 'app/AppInit.js', pick: (t) => between(t, 'DOMPurify.setConfig', 'window.DOMPurify = DOMPurify') },
  { id: 'DOMPurify allowed tags', file: 'lib/utils.js', pick: (t) => block(t, 'export const allowedHtmlTags', '[', ']') },
  {
    id: 'Library versions (package-lock)', file: 'package-lock.json',
    pick: (t) => {
      const p = JSON.parse(t).packages;
      return ['marked', 'dompurify'].map((n) => n + ' ' + p['node_modules/' + n].version).join('\n');
    },
  },
  { id: 'Note rendering call', file: 'components/NoteContent.js', pick: (t) => lines(t, /marked\(|DOMPurify\.sanitize|markdown-rendered/) },
  { id: 'Character counter', file: 'components/EditorComponents/TextAreaWidget.js', pick: (t) => lines(t, /contentLength=|charsRemaining =/) },
  // A textarea's value is trimmed before posting: the preview and check 16 show the trimmed text.
  { id: 'Posting trims text fields', file: 'client/view-v2.js', pick: (t) => lines(t, /input === 'textarea'|newVal = newVal\?\.trim\(\)/) },
  { id: 'Markdown note styles', file: 'styles/utils/_mixins.scss', pick: (t) => block(t, '@mixin markdown-content-styles') },
  { id: 'Note content styles', file: 'styles/components/note-content.scss', pick: (t) => t },
  { id: 'Display-math styles', file: 'styles/components.scss', pick: (t) => block(t, '// Mathjax') },
];

/* Lines removed (-) and added (+), counting repeats, so a duplicated or
   dropped copy of a line shows up too. */
export function lineDiff(a, b) {
  const count = (text) => text.split('\n').reduce((m, l) => m.set(l, (m.get(l) || 0) + 1), new Map());
  const A = count(a), B = count(b), out = [];
  for (const [l, n] of A) for (let k = B.get(l) || 0; k < n; k++) out.push('  - ' + l);
  for (const [l, n] of B) for (let k = A.get(l) || 0; k < n; k++) out.push('  + ' + l);
  return out.length ? out.join('\n') : '  (line order only)';
}

/* The stored snapshot, or null when there is none yet. A snapshot that exists
   but cannot be read is an error: replacing it silently would lose the drift
   it records. */
export async function readSnapshot(file = SNAPSHOT) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  const snap = JSON.parse(text);
  if (!snap || typeof snap.commit !== 'string' || !snap.excerpts || typeof snap.excerpts !== 'object') {
    throw new Error('not a snapshot (expected "commit" and "excerpts")');
  }
  return snap;
}

async function get(url, json) {
  const res = await fetch(url, { headers: { 'User-Agent': 'rebuttal-bench-check-upstream' } });
  if (!res.ok) throw new Error(res.status + ' ' + res.statusText + ' for ' + url);
  return json ? res.json() : res.text();
}

async function main(argv) {
  const update = argv.includes('--update');
  let snapshot = null;
  try {
    snapshot = await readSnapshot();
  } catch (e) {
    if (!update) throw new Error(`cannot read ${SNAPSHOT}: ${e.message} (repair it, or replace it with --update)`);
  }

  const head = await get(`https://api.github.com/repos/${REPO}/commits/${BRANCH}`, true);
  const current = { commit: head.sha, date: head.commit.committer.date, excerpts: {} };
  for (const ex of EXCERPTS) {
    const text = await get(`https://raw.githubusercontent.com/${REPO}/${head.sha}/${ex.file}`);
    current.excerpts[ex.id] = { file: ex.file, text: ex.pick(text).replace(/\r\n/g, '\n') };
  }

  if (update || !snapshot) {
    await writeFile(SNAPSHOT, JSON.stringify(current, null, 2) + '\n');
    console.log(`Snapshot ${snapshot ? 'updated' : 'created'} at ${REPO}@${head.sha.slice(0, 7)} (${current.date}).`);
    return 0;
  }

  const changed = EXCERPTS.filter((ex) => snapshot.excerpts[ex.id]?.text !== current.excerpts[ex.id].text);
  console.log(`Snapshot: ${REPO}@${snapshot.commit.slice(0, 7)} (${snapshot.date})`);
  console.log(`Latest:   ${REPO}@${head.sha.slice(0, 7)} (${current.date})`);
  if (!changed.length) {
    console.log('\nNo change in anything the page mirrors.');
    return 0;
  }
  for (const ex of changed) {
    console.log(`\nCHANGED: ${ex.id}  (${ex.file})`);
    console.log(lineDiff(snapshot.excerpts[ex.id]?.text || '', current.excerpts[ex.id].text));
  }
  console.log(`\nCompare: https://github.com/${REPO}/compare/${snapshot.commit}...${head.sha}`);
  console.log('Update the page and tests/lib/pipeline.js to match, run `npm test`, then `npm run check-upstream -- --update`.');
  return 1;
}

// Run only as a script, so the tests can import the helpers above.
const self = fileURLToPath(import.meta.url).toLowerCase();
if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === self) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => { console.error('check-upstream failed: ' + (e && e.message ? e.message : e)); process.exit(2); },
  );
}
