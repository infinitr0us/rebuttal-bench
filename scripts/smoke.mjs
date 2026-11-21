// Browser smoke test: drives an installed Chrome or Edge headlessly over the
// DevTools protocol (no npm dependencies; Node 22's built-in WebSocket) and
// checks the behaviors the Node tests cannot see.
//
//   npm run smoke                      (BROWSER=/path/to/chrome to choose a browser)
//
// Needs internet access: the page loads its libraries from CDNs.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { resolve } from 'node:path';
const PAGE = pathToFileURL(process.env.RB_PAGE ? resolve(process.env.RB_PAGE)
  : fileURLToPath(new URL('../rebuttal-bench.html', import.meta.url))).href;
const CANDIDATES = [
  process.env.BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);
const browserPath = CANDIDATES.find((p) => existsSync(p));
if (!browserPath) { console.error('No Chrome/Edge found; set BROWSER=/path/to/browser'); process.exit(2); }

const profile = mkdtempSync(join(tmpdir(), 'rebuttal-bench-smoke-'));
const proc = spawn(browserPath, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile,
  '--window-size=1400,900', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });

const exited = new Promise((r) => proc.once('exit', r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Killing the launcher does not stop Chrome's child processes on Windows, so
   ask the browser to quit, wait for it, and only then delete the profile. */
async function cleanup(closeBrowser) {
  if (closeBrowser) await Promise.race([closeBrowser().catch(() => {}), sleep(3000)]);
  if (await Promise.race([exited.then(() => true), sleep(5000).then(() => false)]) === false) {
    if (process.platform === 'win32') spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
    else proc.kill('SIGKILL');
    await Promise.race([exited, sleep(3000)]);
  }
  // Helper processes (GPU, crashpad, …) hold profile files for a few seconds more.
  for (let i = 0; i < 30 && existsSync(profile); i++) {
    try { rmSync(profile, { recursive: true, force: true }); } catch { await sleep(500); }
  }
  if (existsSync(profile)) console.warn('could not remove temporary profile ' + profile);
}

/* Chrome writes "port\npath" to DevToolsActivePort once it listens (stderr is
   not reliably piped from the Windows GUI binary). */
let wsUrl = null;
for (let i = 0; i < 100 && !wsUrl; i++) {
  try {
    const [port, path] = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n');
    if (port && path) wsUrl = `ws://127.0.0.1:${port.trim()}${path.trim()}`;
  } catch { /* not written yet */ }
  if (!wsUrl) await new Promise((r) => setTimeout(r, 200));
}
if (!wsUrl) { await cleanup(); console.error('browser did not start: ' + browserPath); process.exit(2); }

// ---- minimal CDP client ----
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let nextId = 1;
const pending = new Map(), errors = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  }
});
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params, sessionId }));
});

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Runtime.enable', {}, sessionId);
await send('Page.enable', {}, sessionId);

/* Run an async function body in the page and return its (JSON) value. */
async function inPage(body) {
  const r = await send('Runtime.evaluate', {
    expression: `(async () => { const wait = (ms) => new Promise((r) => setTimeout(r, ms)); ${body} })()`,
    awaitPromise: true, returnByValue: true, userGesture: true,
  }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function load() {
  await send('Page.navigate', { url: PAGE }, sessionId);
  // Ready once MathJax is up and the boot sequence has put a draft (or the example) in the editor.
  return inPage(`for (let i = 0; i < 100; i++) { if (window.MJ_READY && ta.value) { await wait(500); return true; } await wait(200); } return false;`);
}

const results = [];
async function check(name, body) {
  try {
    const v = await inPage(body);
    results.push([v === true, name, v === true ? '' : JSON.stringify(v)]);
  } catch (e) {
    results.push([false, name, e.message]);
  }
}

try {
  if (!(await load())) throw new Error('page did not finish loading (MathJax from the CDN?)');

  await check('example loads with its deliberate hazards', `
    return ta.value === EXAMPLE && currentIssues.length >= 10 || { chars: ta.value.length, hazards: currentIssues.length };`);

  await check('Fix all clears every hazard and MathJax typesets all six formulas', `
    fixAllBtn.click(); await wait(2500);
    const n = document.querySelectorAll('#preview mjx-container').length;
    return currentIssues.length === 0 && n === 6 && mjStatus.textContent === 'MathJax ready' ||
      { hazards: currentIssues.length, formulas: n, status: mjStatus.textContent };`);

  await check('one undo reverts the whole Fix-all pass', `
    ta.focus(); document.execCommand('undo'); await wait(300);
    return ta.value === EXAMPLE || { chars: ta.value.length };`);

  await check('Clear is undoable', `
    window.confirm = () => true;
    document.getElementById('clearBtn').click(); await wait(300);
    const cleared = ta.value === '';
    ta.focus(); document.execCommand('undo'); await wait(300);
    return cleared && ta.value === EXAMPLE || { cleared, chars: ta.value.length };`);

  await check('status bar reports TeX errors and undefined macros', `
    setSourceText('Bad $\\\\Foo x$ and $x^$ here.', 0); updateAll(); renderPreview(); await wait(2500);
    const s = mjStatus.textContent;
    return /1 TeX error/.test(s) && /1 undefined macro/.test(s) || s;`);

  await check('clicking a hazard on a long wrapped line scrolls it into view', `
    setSourceText('word '.repeat(2500) + 'then $\\\\{x$ end', 0); updateAll(); await wait(200);
    ta.scrollTop = 0;
    document.querySelector('#lintList .issue').click(); await wait(200);
    const top = caretTop(ta.selectionStart);
    return ta.selectionStart > 12000 && top >= ta.scrollTop && top <= ta.scrollTop + ta.clientHeight ||
      { sel: ta.selectionStart, top, scrollTop: ta.scrollTop, height: ta.clientHeight };`);

  await check('the draft is autosaved', `
    setSourceText('Draft $x$ kept across reloads.', 0); ta.dispatchEvent(new Event('input')); await wait(1200);
    return /saved/i.test(saveStateEl.textContent) || saveStateEl.textContent;`);
  await load();
  await check('the draft survives a reload', `return ta.value === 'Draft $x$ kept across reloads.' || ta.value.slice(0, 80);`);

  await check('dark mode toggles', `
    themeBtn.click(); await wait(100);
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    themeBtn.click();
    return dark;`);

  await check('a labelled equation re-renders without a duplicate-label error', `
    setSourceText('\\\\begin{equation} a = b \\\\label{eq:main} \\\\end{equation}', 0); updateAll(); renderPreview(); await wait(2000);
    setSourceText('\\\\begin{equation} a = b + c \\\\label{eq:main} \\\\end{equation}', 0); updateAll(); renderPreview(); await wait(2000);
    return mjStatus.textContent === 'MathJax ready' || mjStatus.textContent;`);

  await check('deleted macro definitions are forgotten', `
    setSourceText('$\\\\newcommand{\\\\RBa}{x}\\\\RBa$ $\\\\DeclareMathOperator{\\\\RBb}{b}\\\\RBb$', 0); updateAll(); renderPreview(); await wait(2000);
    const defined = mjStatus.textContent === 'MathJax ready';
    setSourceText('$\\\\RBa$ $\\\\RBb$', 0); updateAll(); renderPreview(); await wait(2000);
    return defined && /2 undefined macros/.test(mjStatus.textContent) || { defined, status: mjStatus.textContent };`);

  await check('a deleted color definition is forgotten', `
    setSourceText('$\\\\definecolor{red}{RGB}{0,0,255}\\\\color{red}x$', 0); updateAll(); renderPreview(); await wait(2000);
    setSourceText('$\\\\color{red}x$', 0); updateAll(); renderPreview(); await wait(2000);
    const el = document.querySelector('#preview mjx-container [style*="color"]');
    const style = el ? el.getAttribute('style') : 'no colored element';
    return /red/i.test(style) || style;`);

  await check('allowed images keep their alt and title text as upstream', `
    setSourceText('![A &amp; B](/images/x.png "C &amp; D")', 0); updateAll(); renderPreview(); await wait(500);
    const img = document.querySelector('#preview img');
    return img && img.alt === 'A & B' && img.title === 'C & D' || (img ? { alt: img.alt, title: img.title } : 'no img');`);

  await check('Load example is undoable', `
    window.confirm = () => true;
    setSourceText('My draft $x$.', 0); await wait(100);
    document.getElementById('exampleBtn').click(); await wait(300);
    const loaded = ta.value === EXAMPLE;
    ta.focus(); document.execCommand('undo'); await wait(300);
    return loaded && ta.value === 'My draft $x$.' || { loaded, chars: ta.value.length };`);

  await check('a one-click fix is refused once the draft has moved on', `
    setSourceText('Set $\\\\{x\\\\}$ here.', 0); updateAll(); await wait(100);
    const btn = document.querySelector('#lintList .fixbtn');
    setSourceText('Set \`\\\\{x\\\\}\` here.', 0); /* before the 220 ms refresh */
    btn.click(); await wait(100);
    return ta.value === 'Set \`\\\\{x\\\\}\` here.' || ta.value;`);

  await check('Fix all counts only mechanical fixes and the manual card still works', `
    setSourceText('Set $a\\\\,b$. <b>ours</b>', 0); updateAll();
    if (fixAllBtn.hidden || fixAllBtn.textContent !== 'Fix all (1)') return fixAllBtn.textContent;
    fixAllBtn.click();
    if (!fixAllBtn.hidden || ta.value !== 'Set $a\\\\\\\\,b$. <b>ours</b>') return { hidden: fixAllBtn.hidden, text: ta.value };
    const btn = document.querySelector('#lintList .fixbtn');
    if (!btn || !btn.title.includes('Not part of Fix all')) return btn ? btn.title : 'missing button';
    btn.click();
    return ta.value === 'Set $a\\\\\\\\,b$. **ours**' && currentIssues.length === 0 || ta.value;`);

  await check('Fix all says how many characters it added', `
    setSourceText('Set $a\\\\,b$ and $c\\\\,d$.', 0); updateAll();
    fixAllBtn.click(); await wait(100);
    return /^Applied 2 fixes \\(\\+2 characters\\)/.test(toast.textContent) || toast.textContent;`);

  await check('the status bar shows the length of the selection', `
    setSourceText('abcdefgh', 0); updateAll();
    ta.focus(); ta.setSelectionRange(2, 7); ta.dispatchEvent(new Event('select')); await wait(50);
    const shown = !selStat.hidden && selStat.textContent === '5 selected';
    ta.setSelectionRange(3, 3); ta.dispatchEvent(new Event('select')); await wait(50);
    return shown && selStat.hidden || { shown, text: selStat.textContent, hidden: selStat.hidden };`);

  await check('choosing a venue sets its limit and checks links against its rule', `
    setSourceText('See [the logs](https://example.org/logs).', 0); updateAll();
    const before = currentIssues.length;
    venueSelect.value = 'neurips'; venueSelect.dispatchEvent(new Event('change')); await wait(50);
    const ok = before === 0 && limitInput.value === '10000' &&
      currentIssues.some((i) => /not allowed at NeurIPS/.test(i.title));
    venueSelect.value = ''; venueSelect.dispatchEvent(new Event('change'));
    limitInput.value = '5000'; limitInput.dispatchEvent(new Event('input'));
    return ok && prefs.venue === '' && currentIssues.length === 0 ||
      { before, limit: limitInput.value, issues: currentIssues.map((i) => i.title) };`);

  await check('Import table previews sanitized cells, warnings and math, then inserts with one undo', `
    const original = 'IntroSELECTConclusion';
    setSourceText(original, 5, 11);
    document.getElementById('importTableBtn').click();
    if (!tableDialog.open || !insertTableBtn.disabled) return 'empty dialog';
    tableInput.value = 'plain prose';
    tableInput.dispatchEvent(new Event('input'));
    if (!insertTableBtn.disabled) return 'prose accepted';
    tableInput.value = 'Model & Score \\\\\\\\\\n\\\\underline{Ours} & $95\\\\%$ \\\\\\\\';
    tableInput.dispatchEvent(new Event('input'));
    for (let n = 0; n < 60 && !tablePreview.querySelector('mjx-container'); n++) await wait(100);
    if (tablePreview.querySelector('th')?.textContent !== 'Model' ||
        !tablePreview.querySelector('mjx-container') || !tableWarnings.textContent.includes('Line 2')) {
      return { preview: tablePreview.innerHTML, warnings: tableWarnings.textContent };
    }
    tablePad.click();
    insertTableBtn.click(); await wait(300);
    const expected = 'Intro\\n\\n|Model|Score|\\n|:-|:-|\\n|Ours|$95\\\\\\\\%$|\\n\\nConclusion';
    if (tableDialog.open || ta.value !== expected || !document.querySelector('#preview table')) return ta.value;
    ta.focus(); document.execCommand('undo'); await wait(300);
    return ta.value === original || ta.value;`);

  await check('pasting offers conversion, Cancel keeps the paste, and one undo restores its exact range', `
    const original = 'before replace after', pasted = 'Group\\tAP\\nA\\t9';
    setSourceText(original, 7, 14);
    const data = new DataTransfer(); data.setData('text/plain', pasted);
    // A synthetic paste has no browser default action, so perform that insertion
    // after the event and let the real input and undo events reach the editor.
    if (!ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, cancelable: true }))) return 'paste cancelled';
    document.execCommand('insertText', false, pasted);
    const plain = 'before ' + pasted + ' after';
    if (tableOffer.hidden || tableDialog.open || ta.value !== plain) return { offer: !tableOffer.hidden, value: ta.value };
    document.getElementById('convertPaste').click();
    if (!tableDialog.open || tableInput.value !== pasted) return tableInput.value;
    document.getElementById('cancelTable').click(); await wait(50);
    if (ta.value !== plain || tableOffer.hidden) return 'Cancel lost the paste';
    ta.setSelectionRange(0, 0);
    document.getElementById('convertPaste').click();
    if (tablePad.checked) tablePad.click();
    insertTableBtn.click(); await wait(250);
    if (ta.value !== 'before \\n\\n|Group|AP|\\n|:-|-:|\\n|A|9|\\n\\n after' || !tableOffer.hidden) return ta.value;
    ta.focus(); document.execCommand('undo'); await wait(250);
    return ta.value === plain || ta.value;`);

  await check('paste offers expire on edits and ignore ordinary prose and CSV', `
    for (const [s, offered] of [['Research & development', false], ['A,B\\nx,1', false],
        ['A & B \\\\\\\\\\nx & y \\\\\\\\', true], ['\\\\begin{tabular}{lr} A & B \\\\end{tabular}', true]]) {
      setSourceText('Note: ', 6);
      const data = new DataTransfer(); data.setData('text/plain', s);
      ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data }));
      document.execCommand('insertText', false, s);
      if (!tableOffer.hidden !== offered) return { s, shown: !tableOffer.hidden };
      document.execCommand('insertText', false, '.');
      if (!tableOffer.hidden) return 'stale offer';
    }
    return true;`);

  // Compaction runs 300 ms after the last change.
  await check('Copy compact copies a shorter text that renders the same and leaves the editor alone', `
    const src = '| Method | Acc |\\n| --- | --- |\\n| A | 1 |';
    setSourceText(src, 0); updateAll(); await wait(700);
    let copied = null;
    Object.defineProperty(navigator, 'clipboard', { configurable: true,
      value: { writeText: (t) => { copied = t; return Promise.resolve(); } } });
    copyCompactBtn.click(); await wait(100);
    return copied === '|Method|Acc|\\n|-|-|\\n|A|1|' && ta.value === src &&
      renderOpenReviewMarkdown(copied) === renderOpenReviewMarkdown(src) &&
      compactStat.textContent === '24 compact' && copyCompactBtn.classList.contains('primary') ||
      { copied, value: ta.value, stat: compactStat.textContent };`);

  await check('Apply to source compacts the editor, and one undo brings the text back', `
    const src = ta.value;
    applyCompactBtn.click(); await wait(300);
    const applied = ta.value === '|Method|Acc|\\n|-|-|\\n|A|1|';
    ta.focus(); document.execCommand('undo'); await wait(300);
    return applied && ta.value === src || { applied, value: ta.value };`);

  await check('the character chip says when only the compact form fits the limit', `
    limitInput.value = '30'; limitInput.dispatchEvent(new Event('input')); await wait(700);
    const rescued = charChip.classList.contains('over') && charChip.classList.contains('rescued') &&
      !compactStat.classList.contains('over');
    limitInput.value = '5000'; limitInput.dispatchEvent(new Event('input')); await wait(700);
    return rescued && !charChip.classList.contains('rescued') || { rescued, cls: charChip.className };`);

  await check('a failed copy says so instead of claiming success', `
    setSourceText('## y ##', 0); updateAll(); await wait(700);
    Object.defineProperty(navigator, 'clipboard', { configurable: true,
      value: { writeText: () => Promise.reject(new Error('denied')) } });
    document.execCommand = function (cmd) {
      return cmd === 'copy' ? false : Document.prototype.execCommand.apply(document, arguments);
    };
    copyCompactBtn.click(); await wait(200);
    const msg = toast.textContent;
    delete document.execCommand;
    return /^Copy failed/.test(msg) || msg;`);

  await check('a compaction switch turned off applies at once', `
    setSourceText('| Method | Acc |\\n| --- | --- |\\n| A | 1 |', 0); updateAll(); await wait(700);
    compactList.querySelector('input[data-trick="tables"]').click();
    return prefs.compact.tables === false && compactStat.hidden || { tables: prefs.compact.tables, stat: compactStat.textContent };`);
  await load(); /* at once: the switch must already be stored */
  await check('a compaction switch stays off after a reload', `
    const box = compactList.querySelector('input[data-trick="tables"]');
    const off = prefs.compact.tables === false && !box.checked;
    box.click(); await wait(500);
    return off && prefs.compact.tables === true || { off, now: prefs.compact.tables };`);

  // Last, as it applies to every later navigation: an asynchronous store like
  // a hosted artifact's window.storage (answers after 50 ms or 'stub:delay',
  // kept in localStorage under its own prefix so that it survives reloads).
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    const later = (f) => new Promise((r) => setTimeout(() => r(f()), +(localStorage.getItem('stub:delay') || 50)));
    window.storage = {
      get: (k) => later(() => { const v = localStorage.getItem('stub:' + k); return v === null ? null : { value: v }; }),
      set: (k, v) => later(() => { localStorage.setItem('stub:' + k, v); }),
      delete: (k) => later(() => { localStorage.removeItem('stub:' + k); }),
    };` }, sessionId);
  await load();
  await check('with an asynchronous store, the autosave reaches it', `
    setSourceText('Old $x$.', 0); ta.dispatchEvent(new Event('input')); await wait(1200);
    return localStorage.getItem('stub:rebuttal-bench-draft') === 'Old $x$.' || localStorage.getItem('stub:rebuttal-bench-draft');`);
  await inPage(`setSourceText('New $y$.', 0); ta.dispatchEvent(new Event('input')); return true;`);
  await load(); /* reload before the 700 ms autosave can reach the store */
  await check('text typed just before a reload wins over the older stored draft', `
    return ta.value === 'New $y$.' || ta.value.slice(0, 80);`);
  await inPage(`await wait(300); /* the restored draft has reached the store */
    setSourceText('Mine $a$.', 0); ta.dispatchEvent(new Event('input'));
    localStorage.setItem('stub:rebuttal-bench-draft', 'Theirs $b$.'); /* saved on another device */
    return true;`);
  await load();
  await check('a draft saved elsewhere since wins over a stale local copy', `
    return ta.value === 'Theirs $b$.' || ta.value.slice(0, 80);`);
  await inPage(`localStorage.setItem('stub:delay', '4000'); return true;`);
  await send('Page.navigate', { url: PAGE }, sessionId);
  await sleep(800); /* leave again before the slow store has answered */
  await inPage(`localStorage.setItem('stub:delay', '50'); return true;`);
  await load();
  await check('leaving before the stored draft arrives does not replace it', `
    return ta.value === 'Theirs $b$.' || ta.value.slice(0, 80);`);

  await inPage(`localStorage.setItem('stub:delay', '3000'); return true;`);
  await send('Page.navigate', { url: PAGE }, sessionId);
  await sleep(600);
  await check('a switch flipped before the stored preferences arrive stays flipped', `
    for (let i = 0; i < 60 && typeof compactList === 'undefined'; i++) await wait(50);
    if (prefsRestored) return 'the stored preferences came back too soon to test this';
    compactList.querySelector('input[data-trick="tables"]').click();
    for (let i = 0; i < 80 && !prefsRestored; i++) await wait(50);
    return prefsRestored && prefs.compact.tables === false &&
      !compactList.querySelector('input[data-trick="tables"]').checked || { restored: prefsRestored, tables: prefs.compact.tables };`);
  await inPage(`localStorage.setItem('stub:delay', '50');
    compactList.querySelector('input[data-trick="tables"]').click(); await wait(300); return true;`);

  results.push([errors.length === 0, 'no uncaught page errors', errors.join(' | ')]);
} catch (e) {
  results.push([false, 'smoke run', e.message]);
} finally {
  await cleanup(() => send('Browser.close'));
  ws.close();
}

for (const [ok, name, info] of results) console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok || !info ? '' : '  -> ' + info));
const failed = results.filter((r) => !r[0]).length;
console.log(failed ? `\n${failed} of ${results.length} smoke checks failed.` : `\nAll ${results.length} smoke checks passed (${browserPath}).`);
process.exit(failed ? 1 : 0);
