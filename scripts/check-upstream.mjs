// Detects changes in the parts of openreview-web that rebuttal-bench.html mirrors.
//
//   npm run check-upstream              compare the latest openreview-web against the snapshot
//   npm run check-upstream -- --update  accept the latest as the new snapshot
//
// Exit code 1 means something changed upstream: read the diff, bring the page
// (and tests/lib/pipeline.js) in line, run `npm test`, then --update.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const REPO = 'openreview/openreview-web';
const BRANCH = 'master';
const SNAPSHOT = fileURLToPath(new URL('../upstream/openreview-web.json', import.meta.url));

/* The block that opens at the first `open` after `marker`, up to its matching close. */
function block(text, marker, open = '{', close = '}') {
  const at = text.indexOf(marker);
  if (at < 0) throw new Error('marker not found: ' + marker);
  let i = text.indexOf(open, at), depth = 0;
  for (; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close && --depth === 0) return text.slice(at, i + 1);
  }
  throw new Error('unbalanced block after: ' + marker);
}
const lines = (text, re) => text.split('\n').filter((l) => re.test(l)).map((l) => l.trim()).join('\n');
const between = (text, from, to) => {
  const a = text.indexOf(from), b = text.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('markers not found: ' + from + ' … ' + to);
  return text.slice(a, b + to.length);
};

// What the page mirrors, where it lives upstream, and how to cut it out.
const EXCERPTS = [
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
  { id: 'Markdown note styles', file: 'styles/utils/_mixins.scss', pick: (t) => block(t, '@mixin markdown-content-styles') },
  { id: 'Note content styles', file: 'styles/components/note-content.scss', pick: (t) => t },
  { id: 'Display-math styles', file: 'styles/components.scss', pick: (t) => block(t, '// Mathjax') },
];

async function get(url, json) {
  const res = await fetch(url, { headers: { 'User-Agent': 'rebuttal-bench-check-upstream' } });
  if (!res.ok) throw new Error(res.status + ' ' + res.statusText + ' for ' + url);
  return json ? res.json() : res.text();
}

function lineDiff(a, b) {
  const A = a.split('\n'), B = b.split('\n'), out = [];
  const setA = new Set(A), setB = new Set(B);
  A.forEach((l) => { if (!setB.has(l)) out.push('  - ' + l); });
  B.forEach((l) => { if (!setA.has(l)) out.push('  + ' + l); });
  return out.length ? out.join('\n') : '  (whitespace or line order only)';
}

const update = process.argv.includes('--update');
const head = await get(`https://api.github.com/repos/${REPO}/commits/${BRANCH}`, true);
const current = { commit: head.sha, date: head.commit.committer.date, excerpts: {} };
for (const ex of EXCERPTS) {
  const text = await get(`https://raw.githubusercontent.com/${REPO}/${head.sha}/${ex.file}`);
  current.excerpts[ex.id] = { file: ex.file, text: ex.pick(text).replace(/\r\n/g, '\n') };
}

let snapshot = null;
try { snapshot = JSON.parse(await readFile(SNAPSHOT, 'utf8')); } catch { /* first run */ }

if (update || !snapshot) {
  await writeFile(SNAPSHOT, JSON.stringify(current, null, 2) + '\n');
  console.log(`Snapshot ${snapshot ? 'updated' : 'created'} at ${REPO}@${head.sha.slice(0, 7)} (${current.date}).`);
  process.exit(0);
}

const changed = EXCERPTS.filter((ex) => snapshot.excerpts[ex.id]?.text !== current.excerpts[ex.id].text);
console.log(`Snapshot: ${REPO}@${snapshot.commit.slice(0, 7)} (${snapshot.date})`);
console.log(`Latest:   ${REPO}@${head.sha.slice(0, 7)} (${current.date})`);
if (!changed.length) {
  console.log('\nNo change in anything the page mirrors.');
  process.exit(0);
}
for (const ex of changed) {
  console.log(`\nCHANGED: ${ex.id}  (${ex.file})`);
  console.log(lineDiff(snapshot.excerpts[ex.id]?.text || '', current.excerpts[ex.id].text));
}
console.log(`\nCompare: https://github.com/${REPO}/compare/${snapshot.commit}...${head.sha}`);
console.log('Update the page and tests/lib/pipeline.js to match, run `npm test`, then `npm run check-upstream -- --update`.');
process.exit(1);
