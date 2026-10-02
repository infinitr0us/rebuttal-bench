'use strict';
// The drift check's offline parts: excerpt cutting, diffing, snapshot loading.
// (The network part runs only in `npm run check-upstream`.)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'scripts', 'check-upstream.mjs')).href);

test('block() cuts out a balanced block and fails loudly otherwise', async () => {
  const { block } = await load();
  assert.equal(block('x var f = function () { if (a) { b() } } y', 'var f'), 'var f = function () { if (a) { b() } }');
  assert.equal(block('const t = [\n  1,\n  [2],\n]\n', 'const t', '[', ']'), 'const t = [\n  1,\n  [2],\n]');
  assert.throws(() => block('nothing here', 'var f'), /marker not found/);
  assert.throws(() => block('var f = 1', 'var f'), /no \{ after/);
  assert.throws(() => block('var f = { a', 'var f'), /unbalanced/);
});

test('block() ignores braces in strings and comments', async () => {
  const { block } = await load();
  const fn = (gfm) => 'var setupMarked = function () { var s = "}"; marked.setOptions({gfm: ' + gfm + '}); }';
  assert.equal(block(fn('true') + ' tail', 'var setupMarked'), fn('true'));
  assert.notEqual(block(fn('true'), 'var setupMarked'), block(fn('false'), 'var setupMarked'));
  assert.equal(block("a { x: '}'; /* } */ y: `\n}`; // }\n b: url(http://e.com/{x}.png); } z", 'a'),
    "a { x: '}'; /* } */ y: `\n}`; // }\n b: url(http://e.com/{x}.png); }");
});

test('cutting the committed excerpts again changes nothing', async () => {
  const { readSnapshot, EXCERPTS } = await load();
  const snap = await readSnapshot();
  for (const ex of EXCERPTS) {
    if (ex.file === 'package-lock.json') continue; // its excerpt is a summary, not a cut
    assert.equal(ex.pick(snap.excerpts[ex.id].text), snap.excerpts[ex.id].text, ex.id);
  }
});

test('lineDiff counts repeated lines', async () => {
  const { lineDiff } = await load();
  assert.equal(lineDiff('a\nb', 'a\nb\nb'), '  + b');
  assert.equal(lineDiff('a\nb\nb', 'a\nb'), '  - b');
  assert.equal(lineDiff('a\nb', 'b\na'), '  (line order only)');
  assert.equal(lineDiff('a\nb', 'a\nc'), '  - b\n  + c');
});

test('readSnapshot: missing is a first run, malformed is an error', async () => {
  const { readSnapshot } = await load();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-snapshot-'));
  try {
    assert.equal(await readSnapshot(path.join(dir, 'none.json')), null);
    const bad = path.join(dir, 'bad.json');
    fs.writeFileSync(bad, '{');
    await assert.rejects(readSnapshot(bad), SyntaxError);
    fs.writeFileSync(bad, '{"excerpts": {}}');
    await assert.rejects(readSnapshot(bad), /not a snapshot/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the committed snapshot is readable and covers every excerpt', async () => {
  const { readSnapshot, EXCERPTS } = await load();
  const snap = await readSnapshot();
  assert.match(snap.commit, /^[0-9a-f]{40}$/);
  for (const ex of EXCERPTS) {
    assert.equal(typeof snap.excerpts[ex.id]?.text, 'string', ex.id);
    assert.equal(snap.excerpts[ex.id].file, ex.file, ex.id);
  }
});
