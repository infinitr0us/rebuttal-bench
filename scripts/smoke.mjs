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

  await check('TeX problems become hazard cards, and an undefined macro is fixed from its card', `
    setSourceText('Bold $\\\\bm{x}$ and $\\\\bm y$, then $x^2^3$.', 0); updateAll(); renderPreview(); await wait(2500);
    const titles = currentIssues.map((i) => i.title);
    const card = currentIssues.find((i) => i.title === '\\\\bm is not defined in MathJax');
    if (!card || !titles.includes('MathJax cannot typeset this formula')) return titles;
    const btn = document.querySelector('#lintList .fixbtn[data-fix="' + currentIssues.indexOf(card) + '"]');
    if (!btn || !btn.title.includes('Not part of Fix all') || !fixAllBtn.hidden) return btn ? btn.title : 'no fix button';
    btn.click(); await wait(2500);
    const fixed = ta.value, left = currentIssues.map((i) => i.title);
    ta.focus(); document.execCommand('undo'); await wait(300);
    return fixed === 'Bold $\\\\boldsymbol{x}$ and $\\\\boldsymbol y$, then $x^2^3$.' &&
      left.join() === 'MathJax cannot typeset this formula' &&
      ta.value === 'Bold $\\\\bm{x}$ and $\\\\bm y$, then $x^2^3$.' || { fixed, left, undone: ta.value };`);

  await check('the preview shows the comment as posted, without its leading whitespace', `
    setSourceText('    python eval.py --seed 1', 0); updateAll(); renderPreview(); await wait(1500);
    const pre = document.querySelector('#preview pre'), p = document.querySelector('#preview p');
    const card = currentIssues.some((i) => i.title === 'Posting removes the leading whitespace');
    return !pre && p && p.textContent === 'python eval.py --seed 1' && card ||
      { pre: !!pre, p: p && p.textContent, titles: currentIssues.map((i) => i.title) };`);

  await check('a TeX fix waits for the typeset of the text it would change', `
    const isBm = (i) => i.title === '\\\\bm is not defined in MathJax';
    setSourceText('Bold $\\\\bm{x}$.', 0); updateAll(); renderPreview(); await wait(2500);
    const ready = currentIssues.some((i) => isBm(i) && i.fix);
    setSourceText('Bold $\\\\bm{x}$ and more.', 0); updateAll(); /* the preview has not caught up yet */
    const waiting = currentIssues.find(isBm), held = !!waiting && !waiting.fix &&
      !document.querySelector('#lintList .fixbtn[data-fix="' + currentIssues.indexOf(waiting) + '"]');
    renderPreview(); await wait(2500);
    const back = currentIssues.some((i) => isBm(i) && i.fix);
    return ready && held && back || { ready, held, back };`);

  await check('a TeX error card follows the formula MathJax reported, after an edit', `
    /* No help from the editor's own refresh: only the typeset may redraw. */
    setSourceText('$a\\\\label{s}$ then $x\\\\label{s}$', 0); clearTimeout(timer); updateAll(); renderPreview(); await wait(2500);
    setSourceText('$x\\\\label{s}$ then $x\\\\label{s}$', 0); clearTimeout(timer); updateAll(); renderPreview(); await wait(2500);
    const card = currentIssues.find((i) => i.title === 'MathJax cannot typeset this formula');
    return !!card && card.start === ta.value.lastIndexOf('$x') || { card, titles: currentIssues.map((i) => i.title) };`);

  await check('a delimiter declared in one preview is gone in the next', `
    setSourceText('$\\\\DeclarePairedDelimiter{\\\\lens}{\\\\lVert}{\\\\rVert}\\\\lens{x}$', 0); updateAll(); renderPreview(); await wait(2500);
    const defined = mjStatus.textContent === 'MathJax ready';
    setSourceText('$\\\\lens{x}$', 0); updateAll(); renderPreview(); await wait(2500);
    return defined && /1 undefined macro/.test(mjStatus.textContent) || { defined, status: mjStatus.textContent };`);

  await check('options set by \\\\mathtoolsset are gone in the next preview', `
    setSourceText('$\\\\mathtoolsset{prescript-sub-format=\\\\bm}\\\\prescript{1}{2}{X}$', 0); updateAll(); renderPreview(); await wait(2500);
    const before = mjStatus.textContent;
    setSourceText('$\\\\prescript{1}{2}{X}$', 0); updateAll(); renderPreview(); await wait(2500);
    return /undefined/.test(before) && mjStatus.textContent === 'MathJax ready' || { before, after: mjStatus.textContent };`);

  await check('a TeX fix that would change another formula is refused when clicked', `
    const src = '$\\\\def\\\\q{1}\\\\def\\\\boldsymbol#1{\\\\def\\\\q{2}#1}$ then $\\\\bm{x}$ then $\\\\q$';
    setSourceText(src, 0); clearTimeout(timer); updateAll(); renderPreview(); await wait(2500);
    const card = currentIssues.find((i) => i.title === '\\\\bm is not defined in MathJax');
    const btn = card && document.querySelector('#lintList .fixbtn[data-fix="' + currentIssues.indexOf(card) + '"]');
    if (!btn) return { titles: currentIssues.map((i) => i.title) };
    btn.click(); await wait(100);
    return ta.value === src && /would change something else/.test(toast.textContent) || { value: ta.value, toast: toast.textContent };`);

  await check('red \\\\verb text is not reported as an undefined macro', `
    setSourceText('$\\\\color{red}\\\\verb!\\\\bm!$', 0); updateAll(); renderPreview(); await wait(2500);
    return mjStatus.textContent === 'MathJax ready' && !currentIssues.length || { status: mjStatus.textContent, titles: currentIssues.map((i) => i.title) };`);

  await check('Fix all does not promise "no hazards left" before MathJax has checked the result', `
    setSourceText('$\\\\{x\\\\} + \\\\bm{x}$', 0); updateAll(); renderPreview(); await wait(2500);
    fixAllBtn.click(); await wait(50);
    const msg = toast.textContent;
    await wait(2500);
    const card = currentIssues.some((i) => i.title === '\\\\bm is not defined in MathJax');
    return !/no hazards left/.test(msg) && card || { msg, titles: currentIssues.map((i) => i.title) };`);

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

  await check('a venue that states no limit uses the one typed last, and the rule shows by the counter', `
    limitInput.value = '4200'; limitInput.dispatchEvent(new Event('input'));
    venueSelect.value = 'aaai'; venueSelect.dispatchEvent(new Event('change')); await wait(50);
    const aaai = limitInput.value === '2500' && !venueStat.hidden &&
      venueStat.textContent === 'AAAI-26 · for all reviews · no URLs' && /aaai-26-faq/.test(venueStat.href);
    venueSelect.value = 'iclr'; venueSelect.dispatchEvent(new Event('change')); await wait(50);
    const iclr = limitInput.value === '4200' && /Limit: your own, 4,200/.test(toast.textContent) &&
      venueStat.textContent === 'ICLR 2027 · your limit (none stated) · anonymous links only';
    venueSelect.value = 'neurips'; venueSelect.dispatchEvent(new Event('change'));
    limitInput.value = '9500'; limitInput.dispatchEvent(new Event('input'));
    const typed = venueStat.textContent === 'NeurIPS 2026 · your limit (rule: 10,000 per review) · no links (code for the AC excepted)';
    venueSelect.value = ''; venueSelect.dispatchEvent(new Event('change'));
    const custom = venueStat.hidden && limitInput.value === '9500';
    limitInput.value = '5000'; limitInput.dispatchEvent(new Event('input'));
    return aaai && iclr && typed && custom && prefs.ownLimit === 5000 ||
      { aaai, iclr, typed, custom, stat: venueStat.textContent, limit: limitInput.value, toast: toast.textContent };`);

  /* Preferences stored before 3.8 have no ownLimit: a venue's own limit is
     not taken for the author's. */
  await inPage(`localStorage.setItem('rebuttal-bench-prefs',
    JSON.stringify(Object.assign({}, prefs, { venue: 'aaai', limit: 2500, ownLimit: undefined }))); return true;`);
  await load();
  await check('preferences from before 3.8 keep the venue and do not take its limit for the author’s', `
    const kept = prefs.venue === 'aaai' && limitInput.value === '2500' && prefs.ownLimit === 5000;
    venueSelect.value = 'iclr'; venueSelect.dispatchEvent(new Event('change')); await wait(50);
    const iclr = limitInput.value === '5000';
    venueSelect.value = ''; venueSelect.dispatchEvent(new Event('change'));
    return kept && iclr && prefs.venue === '' || { kept, iclr, limit: limitInput.value, own: prefs.ownLimit };`);

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

  const htmlPaste = `
    const plain = 'Models and scores';
    const html = '<table><tr><td>Model</td><td>Score</td></tr>' +
      '<tr><td><a href="#base"><b>Base</b></a></td><td>8</td></tr></table>';
    const note = document.getElementById('tableHtmlNote');
    const paste = (field, markup = html, text = plain) => {
      const data = new DataTransfer();
      data.setData('text/plain', text);
      data.setData('text/html', markup);
      if (field.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, cancelable: true }))) {
        document.execCommand('insertText', false, text);
      }
    };`;
  await check('an HTML clipboard table offers conversion on its exact range with one undo', htmlPaste + `
    setSourceText('before X after', 7, 8);
    paste(ta);
    const original = 'before ' + plain + ' after';
    if (ta.value !== original || tableOffer.hidden) return 'missing native paste or HTML offer';
    ta.setSelectionRange(0, 0);
    document.getElementById('convertPaste').click();
    try {
      if (!tableDialog.open || tableInput.value !== plain || !note?.getClientRects().length ||
          !tableWarnings.textContent.includes('Row 2:')) return 'missing clipboard text, HTML note or row warning';
      if (tablePad.checked) tablePad.click();
      insertTableBtn.click(); await wait(100);
      if (ta.value !== 'before \\n\\n|Model|Score|\\n|:-|-:|\\n|**Base**|8|\\n\\n after' || !tableOffer.hidden) return ta.value;
      ta.focus(); document.execCommand('undo');
      return ta.value === original || ta.value;
    } finally { if (tableDialog.open) tableDialog.close(); }`);

  await check('pasting HTML in Import table uses its formatting until the plain text changes', htmlPaste + `
    document.getElementById('importTableBtn').click();
    try {
      tableInput.focus();
      paste(tableInput);
      if (tableInput.value !== plain || !note?.getClientRects().length || insertTableBtn.disabled ||
          !tableResult.markdown.includes('**Base**')) return 'missing HTML conversion in the dialog';
      tablePad.click();
      if (note.hidden || !tableResult.markdown.includes('**Base**')) return 'padding lost the HTML';
      tableInput.select(); document.execCommand('insertText', false, 'A,B\\nx,1');
      if (!note.hidden || tableResult?.format !== 'csv' || tableResult.markdown.includes('Base')) return 'stale HTML';
      tableInput.setSelectionRange(0, 0); paste(tableInput);
      return note.hidden && tableInput.value === plain + 'A,B\\nx,1' && tableResult?.format === 'csv' ||
        'partial paste discarded the surrounding text';
    } finally { tableDialog.close(); }`);

  await check('one-row, one-column and one-cell HTML tables leave the paste alone', htmlPaste + `
    for (const rows of ['<tr><td>x</td><td>y</td></tr>', '<tr><td>x</td></tr><tr><td>y</td></tr>',
        '<tr><td>layout</td></tr>']) {
      setSourceText('Intro', 5); paste(ta, '<table>' + rows + '</table>');
      if (!tableOffer.hidden || ta.value !== 'Intro' + plain) return rows;
    }
    return true;`);

  await check('an HTML-only clipboard can offer a table without replacing selected editor text', htmlPaste + `
    setSourceText('Keep this', 0, 4);
    const data = new DataTransfer(); data.setData('text/html', html);
    ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, cancelable: true }));
    if (tableOffer.hidden || ta.value !== 'Keep this') return 'missing HTML-only offer';
    document.getElementById('convertPaste').click();
    try {
      return tableDialog.open && tableInput.value === '' && !note.hidden && tableResult?.format === 'html' ||
        'missing HTML-only preview';
    } finally { if (tableDialog.open) tableDialog.close(); }`);

  await check('math compaction becomes available when MathJax is ready, even for a cached draft', `
    const src = '$ x + \\\\frac{1}{2} $';
    setSourceText(src, 0);
    window.MJ_READY = false;
    let cold;
    try { cold = compactResult(true); } finally { window.MJ_READY = true; }
    const warm = compactResult(true);
    return cold.text === src && cold.tricks.some(t => t.id === 'mathSpace' && t.skipped && !t.kept) &&
      warm.text === '$x+\\\\frac12$' || { cold, warm };`);

  await check('the MathML comparison is isolated from preview definitions, colors and labels', `
    const src = '$\\\\newcommand{\\\\RBcomp}{x}\\\\definecolor{rbblue}{RGB}{2,4,8}$ and ' +
      '$$\\\\begin{align} a & = \\\\color{rbblue}\\\\RBcomp \\\\tag{1}\\\\label{eq:rb}\\\\end{align}$$. See \\\\ref{eq:rb}.';
    setSourceText(src, 0); updateAll(); renderPreview(); await wait(700);
    const roots = () => Array.from(MathJax.startup.document.math).filter(m => m.display !== null)
      .map(m => MathJax.startup.toMML(m.root));
    const before = roots();
    const run = fs => compactMathML(fs, () => false);
    const previewInputs = Array.from(MathJax.startup.document.math).filter(m => m.display !== null)
      .map(m => ({ tex: m.math, display: m.display }));
    const isolated = run(previewInputs);
    const one = tex => [{ tex, display: false }];
    const separate = run(one('\\\\RBcomp'))[0];
    run(one('\\\\newcommand{\\\\RBother}{y}\\\\definecolor{red}{RGB}{0,0,255}'));
    const stillDefined = MathJax.tex2mml('\\\\RBcomp+\\\\RBother+\\\\color{red}z');
    const result = compactResult(true);
    setSourceText(result.text, 0); updateAll(); renderPreview(); await wait(700);
    return result.saved > 0 && before.length === 3 && JSON.stringify(before) === JSON.stringify(isolated) &&
      JSON.stringify(before) === JSON.stringify(roots()) && separate.includes('\\\\RBcomp') &&
      !stillDefined.includes('\\\\RBcomp') && stillDefined.includes('\\\\RBother') &&
      !stillDefined.includes('#0000ff') && mjStatus.textContent === 'MathJax ready' ||
      { result: result.text, status: mjStatus.textContent, before, isolated, separate, stillDefined };`);

  await check('checking a formula cannot populate the shared Unicode font cache', `
    const src = '$\\\\def\\\\sym{\\\\unicode[monospace]{8472}}$ then $ x + \\\\sym $';
    setSourceText(src, 0);
    const r = compactResult(true);
    const font = MathJax.tex2mml('\\\\unicode{8472}');
    return r.text === src && r.tricks.find(t => t.id === 'mathSpace').unavailable &&
      !font.includes('monospace') || { text: r.text, font };`);

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

  // Draft ids other than d1 are random: other() finds the second draft.
  const other = `const other = () => draftMeta.list.find((d) => d.id !== 'd1').id;`;
  await check('a new draft starts empty, and each draft keeps its own text', `${other}
    setSourceText('First draft $x$.', 0); ta.dispatchEvent(new Event('input')); await wait(50);
    document.querySelector('#draftTools .dadd').click(); await wait(50);
    const fresh = ta.value === '' && draftMeta.list.length === 2 && draftMeta.active === other();
    setSourceText('Second draft $y$.', 0); ta.dispatchEvent(new Event('input')); await wait(50);
    document.querySelector('#draftTabs .dtab[data-id="d1"]').click(); await wait(50);
    const counts = [...document.querySelectorAll('#draftTabs .dcount')].map((e) => e.textContent).join(',');
    return fresh && ta.value === 'First draft $x$.' && counts === '16,17' || { fresh, value: ta.value, counts };`);

  await check('undo after switching drafts cannot bring the other draft in', `
    ta.focus(); document.execCommand('undo'); await wait(50); document.execCommand('undo'); await wait(50);
    return ta.value === 'First draft $x$.' || ta.value;`);

  await load();
  await check('the drafts and the open one survive a reload', `${other}
    return draftMeta.list.length === 2 && draftMeta.active === 'd1' && ta.value === 'First draft $x$.' &&
      draftText(other()) === 'Second draft $y$.' || { meta: draftMeta, value: ta.value };`);

  await check('the tabs work from the keyboard', `${other}
    window.prompt = () => 'Keyboard name';
    const first = document.querySelector('#draftTabs .dtab[aria-selected="true"]');
    first.focus();
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    const moved = document.activeElement && document.activeElement.getAttribute('data-id') === other() && draftMeta.active === 'd1';
    document.activeElement.click(); await wait(50);
    const opened = draftMeta.active === other() && document.activeElement &&
      document.activeElement.getAttribute('data-id') === other();
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    const renamed = draftById(other()).name === 'Keyboard name';
    return moved && opened && renamed || { moved, opened, renamed, focus: document.activeElement && document.activeElement.outerHTML.slice(0, 80) };`);

  await check('a draft only looked at is not written back over a newer copy', `${other}
    const id = other(), key = 'rebuttal-bench-draft-' + id;
    switchDraft('d1'); await wait(50);
    localStorage.setItem(key, 'Newer answer from another window.'); /* while this window was elsewhere */
    switchDraft(id); await wait(50);
    const shown = ta.value === 'Newer answer from another window.';
    switchDraft('d1'); await wait(50);
    return shown && localStorage.getItem(key) === 'Newer answer from another window.' ||
      { shown, stored: localStorage.getItem(key) };`);

  await check('a draft added in another window is listed here and keeps its text', `${other}
    const meta = JSON.parse(localStorage.getItem('rebuttal-bench-drafts'));
    meta.list.push({ id: 'dotherwin01', name: 'Other window', at: Date.now() });
    localStorage.setItem('rebuttal-bench-draft-dotherwin01', 'Written in the other window.');
    localStorage.setItem('rebuttal-bench-drafts', JSON.stringify(meta));
    window.dispatchEvent(new StorageEvent('storage', { key: 'rebuttal-bench-drafts', newValue: JSON.stringify(meta) }));
    const listed = !!document.querySelector('#draftTabs .dtab[data-id="dotherwin01"]');
    document.querySelector('#draftTools .dadd').click(); await wait(50);
    const both = draftMeta.list.length === 4 && localStorage.getItem('rebuttal-bench-draft-dotherwin01') === 'Written in the other window.' &&
      JSON.parse(localStorage.getItem('rebuttal-bench-drafts')).list.some((d) => d.id === 'dotherwin01');
    return listed && both || { listed, both, meta: draftMeta };`);

  await inPage(`localStorage.setItem('rebuttal-bench-draft-dorphan001', 'An answer whose tab was lost.'); return true;`);
  await load();
  await check('a draft body without a tab gets its tab back', `
    const d = draftMeta.list.find((x) => x.id === 'dorphan001');
    return d && d.name === 'Recovered draft' && draftText('dorphan001') === 'An answer whose tab was lost.' ||
      draftMeta.list.map((x) => x.id + ':' + x.name).join(', ');`);

  await check('drafts can be deleted, and their text goes with them', `
    window.confirm = () => true;
    const gone = draftMeta.list.map((d) => d.id).filter((id) => id !== 'd1');
    gone.forEach(deleteDraft);
    switchDraft('d1'); await wait(50);
    return draftMeta.list.length === 1 && draftMeta.active === 'd1' && ta.value === 'First draft $x$.' &&
      !document.querySelector('#draftTools .dclose') &&
      gone.every((id) => localStorage.getItem('rebuttal-bench-draft-' + id) === null && draftMeta.gone[id]) ||
      { meta: draftMeta, value: ta.value };`);

  await check('History keeps the text from before Fix all, and Restore brings it back with one undo', `
    document.querySelector('#draftTools .dadd').click(); await wait(50);
    setSourceText('Set $a\\\\,b$ here.', 0); updateAll();
    fixAllBtn.click(); await wait(100);
    const fixed = ta.value;
    document.querySelector('#draftTools [data-act="history"]').click(); await wait(50);
    const shown = historyShown.map((v) => v.why + ':' + v.text);
    const btn = historyList.querySelector('[data-restore="0"]');
    if (!btn) return { shown, html: historyList.innerHTML.slice(0, 300) };
    btn.click(); await wait(100);
    const restored = ta.value, closed = historyDialog.hidden, kept = readHistory(draftMeta.active).map((v) => v.why);
    ta.focus(); document.execCommand('undo'); await wait(300);
    return shown[0] === 'before Fix all:Set $a\\\\,b$ here.' && restored === 'Set $a\\\\,b$ here.' && closed &&
      kept[0] === 'before a restore' && ta.value === fixed || { shown, restored, closed, kept, undone: ta.value, fixed };`);

  await check('Export writes every draft by name and text; Download writes the open one', `
    const files = [];
    const realDownload = downloadFile;
    downloadFile = function (name, content) { files.push({ name, content }); return true; };
    exportAllDrafts(); exportOpenDraft();
    downloadFile = realDownload;
    const [all, one] = files;
    if (!all || !/^rebuttal-drafts-\\d{4}-\\d\\d-\\d\\d\\.json$/.test(all.name)) return files;
    const file = JSON.parse(all.content);
    const same = file.drafts.length === draftMeta.list.length &&
      draftMeta.list.every((d, i) => file.drafts[i].name === d.name && file.drafts[i].text === draftText(d.id));
    const open = draftById(draftMeta.active);
    return same && one && one.name === open.name + '.md' && one.content === ta.value ||
      { names: file.drafts.map((d) => d.name), one: one && one.name };`);

  await check('a deleted draft takes its history along; a draft that needs the space comes before earlier versions', `
    window.confirm = () => true;
    const ids = draftMeta.list.map((d) => d.id).filter((id) => id !== 'd1');
    const hadHistory = ids.filter((id) => localStorage.getItem(HISTORY_PREFIX + id) !== null).length;
    ids.forEach(deleteDraft); switchDraft('d1'); await wait(50);
    const orphans = ids.filter((id) => localStorage.getItem(HISTORY_PREFIX + id) !== null);
    keepVersion('smoke', 'A version that gives way.');
    const had = localStorage.getItem(HISTORY_PREFIX + 'd1') !== null;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k.indexOf(HISTORY_PREFIX) !== 0 && Object.keys(localStorage).some((x) => x.indexOf(HISTORY_PREFIX) === 0)) {
        throw new DOMException('full', 'QuotaExceededError');
      }
      return setItem.call(this, k, v);
    };
    let ok, prefsKept;
    try {
      /* A preference that does not fit costs no version; a draft does. */
      fallbackSet(PREFS_KEY + '-smoke', 'x');
      prefsKept = localStorage.getItem(HISTORY_PREFIX + 'd1') !== null;
      ok = fallbackSet(DRAFT_KEY + '-smokespace', 'needed');
    } finally { Storage.prototype.setItem = setItem; }
    const left = Object.keys(localStorage).filter((k) => k.indexOf(HISTORY_PREFIX) === 0).length;
    fallbackDel(DRAFT_KEY + '-smokespace'); fallbackDel(PREFS_KEY + '-smoke');
    return hadHistory >= 1 && !orphans.length && had && prefsKept && ok === true && left === 0 && ta.value === 'First draft $x$.' ||
      { ids, hadHistory, orphans, had, prefsKept, ok, left, value: ta.value };`);

  await check('History is modal, its Copy keeps the focus, and Restore stays with its draft', `
    document.querySelector('#draftTools .dadd').click(); await wait(50);
    const a = draftMeta.active;
    setSourceText('A current', 0); updateAll(); keepVersion('test', 'A version');
    document.querySelector('#draftTools [data-act="history"]').click(); await wait(50);
    const inert = !!document.getElementById('draftTabs').closest('[inert]') && !!ta.closest('[inert]') && !historyDialog.closest('[inert]');
    const realWrite = navigator.clipboard && navigator.clipboard.writeText;
    if (navigator.clipboard) navigator.clipboard.writeText = () => Promise.reject(new Error('denied'));
    historyList.querySelector('[data-copy-version="0"]').click(); await wait(100);
    const focusKept = !!document.activeElement && document.activeElement.matches('[data-copy-version="0"]');
    if (navigator.clipboard) navigator.clipboard.writeText = realWrite;
    const version = historyShown.find((v) => v.text === 'A version');
    switchDraft('d1'); await wait(50); /* any way the open draft could change meanwhile */
    const closed = historyDialog.hidden && !ta.closest('[inert]');
    restoreVersion(version); await wait(50);
    const kept = ta.value === 'First draft $x$.';
    window.confirm = () => true; deleteDraft(a); await wait(50);
    return inert && focusKept && closed && kept && draftMeta.active === 'd1' || { inert, focusKept, closed, kept, active: draftMeta.active };`);

  await check('Export names a draft that has not loaded instead of writing it as blank', `
    const id = createDraft('Loading one', 'its text'); saveDraftMeta();
    fallbackDel(keyOfDraft(id)); delete draftTexts[id]; bodyState[id] = 'loading';
    let asked = '', downloaded = false;
    window.confirm = (q) => { asked = q; return false; };
    const realDownload = downloadFile;
    downloadFile = function () { downloaded = true; return true; };
    exportAllDrafts();
    downloadFile = realDownload;
    bodyState[id] = 'ready'; window.confirm = () => true; deleteDraft(id); switchDraft('d1');
    return /“Loading one” has not loaded/.test(asked) && !downloaded || { asked, downloaded };`);

  await check('with storage full, a new version and a draft each make room from the oldest versions of any draft', `
    historyKeys().forEach((k) => localStorage.removeItem(k)); historyNewest = {};
    const id = createDraft('Old one', 'Old text.'); saveDraftMeta();
    const old = [];
    for (let i = 0; i < 6; i++) old.unshift({ at: 1000 + i, why: 'test', text: 'old version ' + i + ' ' + 'o'.repeat(400) });
    localStorage.setItem(HISTORY_PREFIX + id, JSON.stringify(old));
    /* A quota a few hundred characters above what is stored now. */
    const used = () => Object.keys(localStorage).reduce((n, k) => n + k.length + localStorage.getItem(k).length, 0);
    const cap = used() + 300, setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      const was = localStorage.getItem(k);
      if (used() - (was === null ? 0 : k.length + was.length) + k.length + String(v).length > cap) throw new DOMException('full', 'QuotaExceededError');
      return setItem.call(this, k, v);
    };
    const ats = () => parseHistory(localStorage.getItem(HISTORY_PREFIX + id)).map((v) => v.at);
    let mine, afterVersion, afterDraft, saved;
    try {
      keepVersion('test', 'A new version ' + 'n'.repeat(1000));
      mine = readHistory('d1').map((v) => v.text.slice(0, 13)); afterVersion = ats();
      saved = fallbackSet(keyOfDraft(id), 'Old text, now longer: ' + 'd'.repeat(600)); afterDraft = ats();
    } finally { Storage.prototype.setItem = setItem; }
    const mineAfter = readHistory('d1').length;
    window.confirm = () => true; deleteDraft(id); switchDraft('d1'); dropHistory('d1');
    /* The old draft's oldest versions went first, its newest stayed; nothing waits in memory. */
    return mine.length === 1 && mine[0] === 'A new version' && afterVersion.length > 0 && afterVersion.length < 6 &&
      afterVersion[0] === 1005 && saved === true && afterDraft.length < afterVersion.length &&
      (afterDraft.length === 0 || afterDraft[0] === 1005) && mineAfter === 1 && !window.historyUnsaved ||
      { mine, afterVersion, afterDraft, saved, mineAfter };`);

  await check('all drafts’ versions together stay within the budget, the oldest going first', `
    const budget = HISTORY_BUDGET;
    const id = createDraft('Idle one', 'Idle text.'); saveDraftMeta();
    localStorage.setItem(HISTORY_PREFIX + id, JSON.stringify([
      { at: 2000, why: 'test', text: 'idle newer ' + 'i'.repeat(300) },
      { at: 1000, why: 'test', text: 'idle older ' + 'i'.repeat(300) }]));
    historyKeys().filter((k) => k !== HISTORY_PREFIX + id).forEach((k) => localStorage.removeItem(k)); historyNewest = {};
    HISTORY_BUDGET = 1000;
    try { keepVersion('test', 'Open draft version ' + 'v'.repeat(300)); } finally { HISTORY_BUDGET = budget; }
    const idle = parseHistory(localStorage.getItem(HISTORY_PREFIX + id)).map((v) => v.at);
    const mine = readHistory('d1').length, total = historySize(storedHistory());
    window.confirm = () => true; deleteDraft(id); switchDraft('d1'); dropHistory('d1');
    return mine === 1 && idle.length === 1 && idle[0] === 2000 && total <= 1000 || { mine, idle, total };`);

  await check('a page back from the back/forward cache takes in a deletion it missed and keeps its open draft', `
    const id = createDraft('Deleted while away', 'Its text.'); switchDraft(id); await wait(50);
    const theirs = JSON.parse(localStorage.getItem(DRAFTS_KEY)); /* another window deleted it meanwhile */
    theirs.list = theirs.list.filter((d) => d.id !== id); theirs.gone[id] = Date.now(); theirs.saved = Date.now();
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(theirs)); localStorage.removeItem(keyOfDraft(id));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); await wait(50);
    const stored = JSON.parse(localStorage.getItem(DRAFTS_KEY));
    const listed = stored.list.some((d) => d.id === id) && !!draftById(id) && draftMeta.active === id;
    setSourceText('Typed after coming back.', 0); saveDraftNow();
    const saved = localStorage.getItem(keyOfDraft(id)) === 'Typed after coming back.';
    window.confirm = () => true; deleteDraft(id); switchDraft('d1'); await wait(50);
    return listed && saved || { listed, saved, stored: stored.list.map((d) => d.id) };`);

  await check('a late storage event never writes the open draft over a newer text another window saved', `
    const id = createDraft('Re-created elsewhere', 'Mine.'); switchDraft(id); await wait(50);
    const base = JSON.parse(localStorage.getItem(DRAFTS_KEY));
    const deleted = JSON.parse(JSON.stringify(base)); /* another window deletes it */
    deleted.list = deleted.list.filter((d) => d.id !== id); deleted.gone[id] = Date.now(); deleted.saved = Date.now();
    await wait(5);
    const later = JSON.parse(JSON.stringify(base)); /* a third re-creates it and saves a newer text */
    later.list.forEach((d) => { if (d.id === id) d.at = Date.now(); }); later.gone[id] = deleted.gone[id]; later.saved = Date.now();
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(later));
    localStorage.setItem(keyOfDraft(id), 'Newer, saved by another window.');
    window.dispatchEvent(new StorageEvent('storage', { key: DRAFTS_KEY, newValue: JSON.stringify(deleted) })); await wait(50);
    const kept = localStorage.getItem(keyOfDraft(id)) === 'Newer, saved by another window.';
    /* A newer deletion stored, but a text written after it under the key: kept too, and listed again. */
    const again = JSON.stringify({ ...deleted, gone: { ...deleted.gone, [id]: Date.now() + 500 } });
    localStorage.setItem(DRAFTS_KEY, again); localStorage.setItem(keyOfDraft(id), 'Written after the deletion.');
    window.dispatchEvent(new StorageEvent('storage', { key: DRAFTS_KEY, newValue: again })); await wait(50);
    const guarded = localStorage.getItem(keyOfDraft(id)) === 'Written after the deletion.' &&
      JSON.parse(localStorage.getItem(DRAFTS_KEY)).list.some((d) => d.id === id);
    /* A deletion nobody answered still brings the draft back with this window's text. */
    localStorage.setItem(DRAFTS_KEY, JSON.stringify({ ...deleted, gone: { ...deleted.gone, [id]: Date.now() + 2000 } }));
    localStorage.removeItem(keyOfDraft(id));
    window.dispatchEvent(new StorageEvent('storage', { key: DRAFTS_KEY, newValue: localStorage.getItem(DRAFTS_KEY) })); await wait(50);
    const recreated = localStorage.getItem(keyOfDraft(id)) === ta.value && !!draftById(id);
    window.confirm = () => true; deleteDraft(id); switchDraft('d1'); await wait(50);
    return kept && guarded && recreated || { kept, guarded, recreated, stored: localStorage.getItem(keyOfDraft(id)), value: ta.value };`);

  await check('a draft that needs the space gets it even from History keys that cannot be read or shortened', `
    historyKeys().forEach((k) => localStorage.removeItem(k)); historyNewest = {};
    localStorage.setItem(HISTORY_PREFIX + 'dbroken01', 'broken'); localStorage.setItem(HISTORY_PREFIX + 'dempty001', '[]');
    let setItem = Storage.prototype.setItem, ok, left;
    Storage.prototype.setItem = function (k, v) {
      if (k.indexOf(HISTORY_PREFIX) !== 0 && Object.keys(localStorage).some((x) => x.indexOf(HISTORY_PREFIX) === 0)) throw new DOMException('full', 'QuotaExceededError');
      return setItem.call(this, k, v);
    };
    try { ok = fallbackSet(DRAFT_KEY + '-smokeroom', 'needed'); } finally { Storage.prototype.setItem = setItem; }
    left = historyKeys().length; fallbackDel(DRAFT_KEY + '-smokeroom');
    /* Over its quota, a browser refuses even a shorter History list, but not a removal. */
    localStorage.setItem(HISTORY_PREFIX + 'd1', JSON.stringify([{ at: 2, why: 'test', text: 'b'.repeat(300) }, { at: 1, why: 'test', text: 'a'.repeat(300) }]));
    const used = () => Object.keys(localStorage).reduce((n, k) => n + k.length + localStorage.getItem(k).length, 0);
    const cap = used() - 100;
    Storage.prototype.setItem = function (k, v) {
      const was = localStorage.getItem(k);
      if (used() - (was === null ? 0 : k.length + was.length) + k.length + String(v).length > cap) throw new DOMException('full', 'QuotaExceededError');
      return setItem.call(this, k, v);
    };
    let over;
    try { over = fallbackSet(DRAFT_KEY + '-smokeroom', 'needed'); } finally { Storage.prototype.setItem = setItem; }
    fallbackDel(DRAFT_KEY + '-smokeroom'); dropHistory('d1');
    return ok === true && left === 0 && over === true || { ok, left, over };`);

  await check('messages show above History and Split', `
    const z = (el) => +getComputedStyle(el).zIndex;
    return z(toast) > z(historyDialog) && z(toast) > z(splitDialog) || [z(toast), z(historyDialog), z(splitDialog)];`);

  await check('Import adds an exported file’s new drafts as tabs, skips those already here, and changes nothing else', `
    const files = [], realDownload = downloadFile;
    downloadFile = function (name, content) { files.push(content); return true; };
    exportAllDrafts();
    downloadFile = realDownload;
    const file = JSON.parse(files[0]);
    file.drafts.push({ name: file.drafts[0].name, text: 'An answer from another browser.' });
    const active = draftMeta.active, text = ta.value, n = draftMeta.list.length;
    const bodies = () => Object.keys(localStorage).filter((k) => k.indexOf(DRAFT_KEY) === 0 && k !== DRAFTS_KEY).sort();
    const before = bodies().map((k) => [k, localStorage.getItem(k)]);
    importDrafts(JSON.stringify(file), 'backup.json');
    const msg = toast.textContent;
    const added = draftMeta.list.filter((d) => draftText(d.id) === 'An answer from another browser.');
    const unchanged = before.every(([k, v]) => localStorage.getItem(k) === v) && bodies().length === before.length + 1;
    const listed = !!added[0] && JSON.parse(localStorage.getItem(DRAFTS_KEY)).list.some((d) => d.id === added[0].id);
    const count = draftMeta.list.length, stayed = draftMeta.active === active && ta.value === text;
    importDrafts(JSON.stringify(file), 'backup.json');
    const again = toast.textContent, countAgain = draftMeta.list.length;
    window.confirm = () => true; added.forEach((d) => deleteDraft(d.id));
    return count === n + 1 && added.length === 1 && added[0].name === file.drafts[0].name + ' (2)' && stayed && unchanged &&
      listed && /^Imported 1 draft as new tabs/.test(msg) && new RegExp('Already here: ' + n).test(msg) &&
      /are already here/.test(again) && countAgain === count ||
      { count, n, added: added.map((d) => d.name), stayed, unchanged, listed, msg, again };`);

  await check('Import leaves out a draft this browser has no room for, names it, and gives up no earlier version', `
    historyKeys().forEach((k) => localStorage.removeItem(k)); historyNewest = {};
    keepVersion('test', 'A version to keep.');
    const known = new Set(Object.keys(localStorage)), setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k.indexOf(DRAFT_KEY + '-') === 0 && !known.has(k)) throw new DOMException('full', 'QuotaExceededError');
      return setItem.call(this, k, v);
    };
    const n = draftMeta.list.length;
    let msg;
    try {
      importDrafts(JSON.stringify({ format: 'rebuttal-bench-drafts', drafts: [{ name: 'Too big', text: 'No room for this one.' }] }), 'x.json');
      msg = toast.textContent;
    } finally { Storage.prototype.setItem = setItem; }
    const kept = readHistory(draftMeta.active).some((v) => v.text === 'A version to keep.');
    dropHistory(draftMeta.active);
    return draftMeta.list.length === n && /^Nothing was imported/.test(msg) && /No room in this browser for “Too big”/.test(msg) &&
      kept && !Object.keys(memNewer).length || { n: draftMeta.list.length, msg, kept, memNewer: Object.keys(memNewer) };`);

  await check('Import reads a chosen file: a Markdown file is one draft named after it, and the open draft stays open', `
    const active = draftMeta.active, dt = new DataTransfer();
    dt.items.add(new File(['\\ufeff# Reviewer Q7\\r\\n\\r\\nThanks.'], 'Reviewer Q7.md', { type: 'text/markdown' }));
    importFile.files = dt.files;
    importFile.dispatchEvent(new Event('change'));
    await wait(300);
    const d = draftMeta.list.find((x) => x.name === 'Reviewer Q7'), text = d && draftText(d.id);
    const tab = d && !!draftTabs.querySelector('.dtab[data-id="' + d.id + '"]');
    if (d) { window.confirm = () => true; deleteDraft(d.id); }
    return text === '# Reviewer Q7\\n\\nThanks.' && tab && draftMeta.active === active || { text, tab, msg: toast.textContent };`);

  await check('Restore does not replace text another window saved since this one loaded it', `
    keepVersion('test', 'An older version.');
    localStorage.setItem(DRAFT_KEY, 'Saved by another window.'); /* as another window's autosave */
    document.querySelector('#draftTools [data-act="history"]').click(); await wait(50);
    const btn = [...historyList.querySelectorAll('[data-restore]')].find((b) => historyShown[+b.getAttribute('data-restore')].text === 'An older version.');
    btn.click(); await wait(50);
    const kept = ta.value === 'First draft $x$.' && localStorage.getItem(DRAFT_KEY) === 'Saved by another window.';
    const msg = toast.textContent;
    localStorage.setItem(DRAFT_KEY, 'First draft $x$.'); dropHistory('d1');
    return kept && historyDialog.hidden && /saved a newer version/.test(msg) || { kept, msg, value: ta.value };`);

  await check('Restore sees another window’s save even behind this window’s own refused write', `
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === DRAFT_KEY) throw new DOMException('full', 'QuotaExceededError');
      return setItem.call(this, k, v);
    };
    try { setSourceText('A long edit that does not fit.', 0); saveDraftNow(); } finally { Storage.prototype.setItem = setItem; }
    keepVersion('test', 'An older version.'); /* the refused write let stored versions go */
    setItem.call(localStorage, DRAFT_KEY, 'Final from another window.');
    document.querySelector('#draftTools [data-act="history"]').click(); await wait(50);
    const btn = [...historyList.querySelectorAll('[data-restore]')].find((b) => historyShown[+b.getAttribute('data-restore')].text === 'An older version.');
    btn.click(); await wait(50);
    const kept = localStorage.getItem(DRAFT_KEY) === 'Final from another window.' && ta.value === 'A long edit that does not fit.';
    const msg = toast.textContent;
    setSourceText('First draft $x$.', 0); saveDraftNow(); dropHistory('d1');
    return kept && /saved a newer version/.test(msg) && localStorage.getItem(DRAFT_KEY) === 'First draft $x$.' ||
      { kept, msg, stored: localStorage.getItem(DRAFT_KEY) };`);

  await check('Export changes nothing stored, even with a deletion from another window not yet taken in', `
    const id = createDraft('Deleted elsewhere', 'Its text.'); switchDraft(id); await wait(50);
    const theirs = JSON.parse(localStorage.getItem(DRAFTS_KEY)); /* the open draft, deleted in another window */
    theirs.list = theirs.list.filter((d) => d.id !== id); theirs.gone[id] = Date.now(); theirs.saved = Date.now();
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(theirs)); /* as another window, before its storage event */
    const snap = () => JSON.stringify(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)]));
    const before = snap();
    const realDownload = downloadFile;
    downloadFile = function () { return true; };
    window.confirm = () => true;
    exportAllDrafts(); exportOpenDraft();
    downloadFile = realDownload;
    const same = snap() === before;
    deleteDraft(id); switchDraft('d1');
    return same || 'storage changed';`);

  await check('Restore waits for a draft whose text has not been read', `
    keepVersion('test', 'An older version.');
    bodyKnown.d1 = false; /* as after a read that failed */
    document.querySelector('#draftTools [data-act="history"]').click(); await wait(50);
    const v = historyShown.find((x) => x.text === 'An older version.');
    restoreVersion(v); await wait(50);
    const kept = ta.value === 'First draft $x$.', msg = toast.textContent;
    bodyKnown.d1 = true; dropHistory('d1');
    return kept && /has not loaded completely/.test(msg) || { kept, msg };`);

  await check('the version kept while editing is the text the save replaces', `
    dropHistory('d1');
    const was = ta.value; /* saved */
    setSourceText('x', 0); saveDraftNow();
    const kept = readHistory('d1').map((v) => v.text);
    setSourceText(was, 0); saveDraftNow(); dropHistory('d1');
    return kept.length === 1 && kept[0] === was && localStorage.getItem(DRAFT_KEY) === was || kept;`);

  await check('Restore works on a draft another window created', `
    const id = 'd' + Date.now().toString(36) + 'smoke';
    const theirs = JSON.parse(localStorage.getItem(DRAFTS_KEY));
    theirs.list.push({ id, name: 'From another window', at: Date.now() }); theirs.saved = Date.now();
    localStorage.setItem(keyOfDraft(id), 'Their text.'); /* as another window's createDraft */
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(theirs));
    window.dispatchEvent(new StorageEvent('storage', { key: DRAFTS_KEY, newValue: JSON.stringify(theirs) }));
    await wait(50);
    switchDraft(id); await wait(50);
    keepVersion('test', 'An older version.');
    document.querySelector('#draftTools [data-act="history"]').click(); await wait(50);
    restoreVersion(historyShown.find((x) => x.text === 'An older version.')); await wait(50);
    const restored = ta.value === 'An older version.', msg = toast.textContent;
    window.confirm = () => true;
    deleteDraft(id); switchDraft('d1'); await wait(50);
    return restored && draftMeta.active === 'd1' && !draftById(id) || { value: ta.value, msg };`);

  await check('an offer to convert a pasted table expires when the open draft changes', `
    const origId = draftMeta.active;
    const tsv = 'A\\tB\\n1\\t2';
    pastedTable = { draft: origId, source: tsv, start: 0, end: tsv.length }; tableOffer.hidden = false;
    document.querySelector('#draftTools .dadd').click(); await wait(50);
    const gone = !pastedTable && tableOffer.hidden;
    setSourceText(tsv, 0); clearTimeout(timer);
    pastedTable = { draft: origId, source: tsv, start: 0, end: tsv.length }; /* as if left over */
    document.getElementById('convertPaste').click(); await wait(50);
    const refused = !tableDialog.open;
    if (tableDialog.open) tableDialog.close();
    window.confirm = () => true; deleteDraft(draftMeta.active); switchDraft(origId);
    return gone && refused || { gone, refused };`);

  await check('Split’s Copy keeps the focus in its dialog when the clipboard refuses', `
    limitInput.value = '40'; limitInput.dispatchEvent(new Event('input'));
    setSourceText('First part of the answer here.\\n\\nSecond part of the answer here.', 0); updateAll();
    document.getElementById('splitBtn').click(); await wait(50);
    const realWrite = navigator.clipboard && navigator.clipboard.writeText;
    if (navigator.clipboard) navigator.clipboard.writeText = () => Promise.reject(new Error('denied'));
    splitParts.querySelector('[data-copy="0"]').click(); await wait(100);
    const focusKept = !!document.activeElement && document.activeElement.matches('[data-copy="0"]');
    if (navigator.clipboard) navigator.clipboard.writeText = realWrite;
    closeSplit();
    limitInput.value = '5000'; limitInput.dispatchEvent(new Event('input'));
    setSourceText('First draft $x$.', 0); saveDraftNow();
    return focusKept || document.activeElement && document.activeElement.outerHTML.slice(0, 80);`);

  await check('Export asks about a draft whose read never answered', `
    const id = createDraft('Never answered', ''); saveDraftMeta();
    fallbackDel(keyOfDraft(id)); delete draftTexts[id]; bodyKnown[id] = false; /* as after the 8 s watchdog */
    let asked = '';
    window.confirm = (q) => { asked = q; return false; };
    exportAllDrafts();
    window.confirm = () => true; deleteDraft(id); switchDraft('d1');
    return /“Never answered” has not loaded/.test(asked) || { asked };`);

  await check('a fresh editor after a draft switch still offers to convert a pasted table', `
    const origId = draftMeta.active;
    document.querySelector('#draftTools .dadd').click(); await wait(50);
    const pasted = 'Group\\tAP\\nA\\t9';
    ta.focus();
    const data = new DataTransfer(); data.setData('text/plain', pasted);
    ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, cancelable: true }));
    document.execCommand('insertText', false, pasted); await wait(50);
    const offered = !tableOffer.hidden;
    tableOffer.querySelector('#dismissPaste').click();
    window.confirm = () => true;
    deleteDraft(draftMeta.active); switchDraft(origId);
    return offered || 'no offer after the switch';`);

  await check('Split cuts an over-limit draft into parts under the limit, which can become drafts', `
    limitInput.value = '300'; limitInput.dispatchEvent(new Event('input'));
    const para = (k) => [0, 1, 2].map((i) => 'Sentence ' + (k + i) + ' explains a point in enough words to take some room.').join(' ');
    const original = [para(1), para(4), para(7)].join('\\n\\n');
    setSourceText(original, 0); ta.dispatchEvent(new Event('input')); updateAll(); await wait(100);
    document.getElementById('splitBtn').click(); await wait(100);
    const parts = splitResult.parts, n = parts.length;
    const shown = !splitDialog.hidden && n >= 2 && parts.every((p) => p.length <= 300) &&
      splitParts.querySelectorAll('.split-part').length === n;
    let copied = null;
    Object.defineProperty(navigator, 'clipboard', { configurable: true,
      value: { writeText: (t) => { copied = t; return Promise.resolve(); } } });
    splitParts.querySelector('[data-copy="1"]').click(); await wait(50);
    const copiedOk = copied === parts[1].text;
    const origId = draftMeta.active, before = draftMeta.list.map((d) => d.id);
    splitDraftsBtn.click(); await wait(100);
    const made = splitDialog.hidden && draftMeta.list.length === before.length + n && ta.value === parts[0].text &&
      draftTexts[origId] === original && /\\(1\\/\\d\\)$/.test(draftById(draftMeta.active).name);
    window.confirm = () => true;
    draftMeta.list.map((d) => d.id).filter((id) => !before.includes(id)).forEach(deleteDraft);
    switchDraft(origId);
    limitInput.value = '5000'; limitInput.dispatchEvent(new Event('input'));
    return shown && copiedOk && made && ta.value === original || { shown, copiedOk, made, n, value: ta.value.slice(0, 40) };`);

  await check('Split cuts the comment as posted: an indented first fence stays one block', `
    const src = '    \`\`\`text\\n\\nCost $5 to $10.\\n\\n\`\`\`';
    limitInput.value = '17'; limitInput.dispatchEvent(new Event('input'));
    splitLabelBox.checked = false;
    setSourceText(src, 0); updateAll(); await wait(50);
    document.getElementById('splitBtn').click(); await wait(100);
    const parts = splitResult.parts.map((p) => p.text);
    closeSplit(); splitLabelBox.checked = true;
    limitInput.value = '5000'; limitInput.dispatchEvent(new Event('input'));
    return parts.length === 1 && parts[0] === src.trim() || { parts };`);

  await check('Sections lists the parts of a draft with their counts, and a click goes to one', `
    const was = ta.value;
    setSourceText('Thanks.\\n\\n## Reviewer A\\n\\n**W1.** One.\\n\\n**W2.** Two.\\n\\n## Reviewer B\\n\\nB.', 0); updateAll();
    sectionsBox.open = true; await wait(50);
    const rows = [...sectionsList.querySelectorAll('.section')];
    const names = rows.map((b) => b.querySelector('.name').textContent), levels = rows.map((b) => b.style.getPropertyValue('--level').trim());
    rows[3].click(); await wait(50);
    const at = ta.selectionStart, want = ta.value.indexOf('**W2.**'), sum = sectionsSum.textContent;
    const gain = rows[1].querySelector('.gain').textContent;
    sectionsBox.open = false;
    setSourceText(was, 0); saveDraftNow(); updateAll();
    return names.join('|') === 'Opening|Reviewer A|W1. One.|W2. Two.|Reviewer B' && levels.join('') === '00110' &&
      sum === '5 parts' && at === want && /^\\d+ · \\d+%$/.test(gain) || { names, levels, sum, at, want, gain };`);

  await check('Wording lists filler phrases with their savings, and clicks go to each use in turn', `
    const was = ta.value;
    setSourceText('In order to be brief: in order to fit. We would like to thank you.\\n\\n\`in order to\`', 0); updateAll();
    wordingBox.open = true; await wait(50);
    const rows = [...wordingList.querySelectorAll('[data-hint]')].map((b) => b.textContent);
    const row = [...wordingList.querySelectorAll('[data-hint]')].find((b) => /in order to/i.test(b.textContent));
    ta.setSelectionRange(0, 0);
    row.click(); await wait(30); const first = [ta.selectionStart, ta.selectionEnd];
    row.click(); await wait(30); const second = [ta.selectionStart, ta.selectionEnd];
    row.click(); await wait(30); const third = ta.selectionStart; /* back to the first: code is not prose */
    const sum = wordingSum.textContent, unchanged = ta.value.indexOf('In order to be brief') === 0;
    wordingBox.open = false;
    setSourceText(was, 0); saveDraftNow(); updateAll();
    return rows.length === 2 && /×2 · −18$/.test(row.textContent) && first[0] === 0 && first[1] === 11 &&
      second[0] === 22 && third === 0 && /^about \\d+ to save$/.test(sum) && unchanged || { rows, first, second, third, sum };`);

  await check('the spellcheck switch reaches the editor and survives a draft switch', `
    const was = ta.spellcheck;
    spellBox.click(); await wait(30);
    const on = ta.spellcheck === true && prefs.spellcheck === true;
    const origId = draftMeta.active;
    document.querySelector('#draftTools .dadd').click(); await wait(50); /* a fresh editor */
    const kept = ta.spellcheck === true;
    window.confirm = () => true; deleteDraft(draftMeta.active); switchDraft(origId); await wait(50);
    spellBox.click(); await wait(30);
    return !was && on && kept && ta.spellcheck === false || { was, on, kept, now: ta.spellcheck };`);

  await check('find and replace: Ctrl+F from a selection, Enter to step, boxes over the matches, one undo for Replace all', `
    const was = ta.value;
    setSourceText('alpha beta alpha gamma Alpha', 0, 5); updateAll();
    ta.focus(); ta.setSelectionRange(0, 5);
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }));
    const opened = !findBar.hidden && findInput.value === 'alpha' && document.activeElement === findInput;
    const first = findCount.textContent; /* the selection is a match: 1 of 3 */
    findInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const second = [ta.selectionStart, ta.selectionEnd, findCount.textContent];
    const boxes = findMarks.querySelectorAll('span').length, cur = findMarks.querySelectorAll('span.cur').length;
    findCase.click(); const caseCount = findCount.textContent; findCase.click();
    replaceInput.value = 'omega';
    document.getElementById('replaceOne').click(); await wait(30);
    const one = ta.value;
    document.getElementById('replaceAll').click(); await wait(30);
    const all = ta.value;
    ta.focus(); document.execCommand('undo'); await wait(30);
    const undone = ta.value;
    findInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const closed = findBar.hidden && document.activeElement === ta && !findMarks.children.length;
    findInput.value = ''; replaceInput.value = '';
    setSourceText(was, 0); saveDraftNow(); updateAll();
    return opened && first === '1 of 3' && second[0] === 11 && second[1] === 16 && second[2] === '2 of 3' &&
      boxes === 3 && cur === 1 && caseCount === '2 of 2' && one === 'alpha beta omega gamma Alpha' &&
      all === 'omega beta omega gamma omega' && undone === one && closed ||
      { opened, first, second, boxes, cur, caseCount, one, all, undone, closed };`);

  await check('a double-click in the preview selects the same word, or the same formula, in the source', `
    const was = ta.value;
    setSourceText('Here is one.\\n\\nThen here and here, with $x$ and $y^2$.', 0); updateAll(); renderPreview();
    for (let i = 0; i < 50 && preview.querySelectorAll('mjx-container').length < 2; i++) await wait(100);
    const p = preview.children[1], text = [...p.childNodes].find((n) => n.nodeType === 3 && /and here/.test(n.nodeValue));
    const at = text.nodeValue.indexOf('here', text.nodeValue.indexOf('here') + 1);
    const r = document.createRange(); r.setStart(text, at); r.setEnd(text, at + 4);
    getSelection().removeAllRanges(); getSelection().addRange(r);
    p.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const word = [ta.selectionStart, ta.selectionEnd], want = ta.value.lastIndexOf('here');
    const math = p.querySelectorAll('mjx-container')[1];
    math.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const formula = ta.value.slice(ta.selectionStart, ta.selectionEnd);
    setSourceText(was, 0); saveDraftNow(); updateAll(); renderPreview();
    return word[0] === want && word[1] === want + 4 && formula === '$y^2$' && document.activeElement === ta ||
      { word, want, formula };`);

  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 640, deviceScaleFactor: 1, mobile: false }, sessionId);
  await check('in a short window the hazards and Fix all stay in view, and an open panel shows its content', `
    const was = ta.value;
    setSourceText(EXAMPLE, 0); updateAll(); await wait(100);
    const lint = document.querySelector('.lint').getBoundingClientRect();
    const fb = fixAllBtn.getBoundingClientRect();
    const hit = document.elementFromPoint(fb.left + fb.width / 2, fb.top + fb.height / 2);
    compactBox.open = true; await wait(100);
    const body = compactBox.querySelector('.compact-body').getBoundingClientRect(), box = compactBox.getBoundingClientRect();
    const shown = Math.min(body.bottom, box.bottom) - body.top;
    compactBox.open = false;
    setSourceText(was, 0); saveDraftNow(); updateAll();
    return lint.height >= 60 && hit === fixAllBtn && shown >= 40 || { lint: lint.height, hit: hit && hit.outerHTML.slice(0, 60), shown };`);
  await send('Emulation.clearDeviceMetricsOverride', {}, sessionId);

  await check('Replace all that changes nothing says so and offers no undo', `
    const was = ta.value;
    setSourceText('Our method works.', 0); updateAll();
    openFind(false); findInput.value = 'method'; findInput.dispatchEvent(new Event('input')); replaceInput.value = 'method';
    document.getElementById('replaceAll').click(); await wait(30);
    const msg = toast.textContent, same = ta.value === 'Our method works.';
    closeFind(); findInput.value = ''; replaceInput.value = '';
    setSourceText(was, 0); saveDraftNow(); updateAll();
    return same && /^No changes/.test(msg) && !/undo/i.test(msg) || { msg, value: ta.value };`);

  await check('find boxes follow the text when the editor font size changes', `
    const was = ta.value;
    setSourceText('Calibration took place before the final experiment. NEEDLE then more.', 0); updateAll();
    openFind(false); findInput.value = 'NEEDLE'; findInput.dispatchEvent(new Event('input')); await wait(50);
    const at = () => { const b = findMarks.querySelector('span'); return b && b.style.left + ',' + b.style.top; };
    const plus = document.querySelector('.fs-ctl button[data-fs="fsEditor"][data-dir="1"]');
    const minus = document.querySelector('.fs-ctl button[data-fs="fsEditor"][data-dir="-1"]');
    const before = at(); plus.click(); plus.click(); await wait(50);
    const after = at(); refreshFind(); const fresh = at();
    minus.click(); minus.click(); closeFind(); findInput.value = '';
    setSourceText(was, 0); saveDraftNow(); updateAll();
    return before !== after && after === fresh || { before, after, fresh };`);

  await check('a double-click selects the visible word, not one in a formula, a link address, or one Markdown emphasizes', `
    const was = ta.value, out = [];
    for (const [src, word, nth, want] of [
      ['Given $loss$, we report loss again.', 'loss', 0, 24],
      ['See [the logs](https://example.org/logs). The logs agree.', 'logs', 1, 46],
      ['The _ablated_ model was ablated again.', 'ablated', 0, 5],
      ['We report \\u201caccuracy\\u201d here.', 'accuracy', 0, 11],
    ]) {
      setSourceText(src, 0); updateAll(); renderPreview();
      for (let i = 0; i < 40 && previewText !== ta.value; i++) await wait(50);
      await wait(300);
      const p = preview.children[0], walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT), nodes = [];
      let node, seen = 0, done = false;
      while (!done && (node = walker.nextNode())) {
        if (node.parentNode.closest('mjx-container')) continue;
        let k = -1;
        while ((k = node.nodeValue.indexOf(word, k + 1)) >= 0) {
          if (seen++ === nth) {
            const r = document.createRange(); r.setStart(node, k); r.setEnd(node, k + word.length);
            getSelection().removeAllRanges(); getSelection().addRange(r); done = true; break;
          }
        }
      }
      p.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      out.push([ta.selectionStart, ta.selectionEnd, want]);
    }
    setSourceText(was, 0); saveDraftNow(); updateAll(); renderPreview();
    return out.every(([s, e, want]) => s === want && e > s) || out;`);

  await check('Sections and Wording read the comment as posted, with an indented first line', `
    const was = ta.value;
    setSourceText('    ## Reviewer A\\n\\nW1: First\\n\\n## Reviewer B\\n\\nW1: Next', 0); updateAll();
    const rows = [...sectionsList.querySelectorAll('.section')].map((b) => b.querySelector('.name').textContent + ':' + b.style.getPropertyValue('--level').trim());
    const first = sectionsList.querySelector('.section');
    first.click(); await wait(30);
    const at = ta.selectionStart;
    setSourceText(was, 0); saveDraftNow(); updateAll();
    return rows.join('|') === 'Reviewer A:0|W1: First:1|Reviewer B:0|W1: Next:1' && at === 4 || { rows, at };`);

  await check('a draft named for one reviewer that thanks another gets a card, which follows renames here and in another window', `
    const home = draftMeta.active;
    const ab = createDraft('Reviewer Ab12', '**W1.** Seeds.');
    const k9 = createDraft('Reviewer k9F2', ''); saveDraftMeta();
    switchDraft(k9); await wait(50);
    setSourceText('We thank Reviewer Ab12 for the review.\\n\\nW1: more seeds.', 0); updateAll();
    const titles = () => currentIssues.map((i) => i.title + ' @' + ta.value.slice(i.start, i.end)).join('|');
    const card = titles() === 'This draft addresses another reviewer @Ab12';
    /* Another window renames this tab: the card goes with no edit here. */
    const meta = JSON.parse(localStorage.getItem('rebuttal-bench-drafts'));
    meta.list.find((d) => d.id === k9).name = 'Reviewer Ab12 (follow-up)';
    meta.list.find((d) => d.id === k9).at = Date.now();
    localStorage.setItem('rebuttal-bench-drafts', JSON.stringify(meta));
    window.dispatchEvent(new StorageEvent('storage', { key: 'rebuttal-bench-drafts', newValue: JSON.stringify(meta) }));
    const elsewhere = draftById(k9).name === 'Reviewer Ab12 (follow-up)' && titles() === '';
    window.prompt = () => 'Reviewer k9F2';
    await wait(5); /* a later rename here, which the merge keeps */
    renameDraft(k9); await wait(20);
    const renamed = titles() === 'This draft addresses another reviewer @Ab12';
    window.confirm = () => true;
    deleteDraft(ab); deleteDraft(k9); await wait(50);
    switchDraft(home); await wait(50);
    return card && elsewhere && renamed && draftMeta.active === home && !draftById(ab) && !draftById(k9) ||
      { card, elsewhere, renamed, titles: titles() };`);

  // Native input creates the undo entries that assigning .value cannot.
  async function key(key, code, keyCode, modifiers = 0) {
    for (const type of ['rawKeyDown', 'keyUp']) {
      const event = { type, key, code, windowsVirtualKeyCode: keyCode, modifiers };
      if (process.platform === 'darwin' && modifiers === 2) {
        event.modifiers = 4;
        if (type === 'rawKeyDown') event.commands = [{ z: 'Undo', y: 'Redo', v: 'Paste' }[key]];
      }
      await send('Input.dispatchKeyEvent', event, sessionId);
    }
  }
  const undo = () => key('z', 'KeyZ', 90, 2);
  const redo = () => key('y', 'KeyY', 89, 2);
  const typeText = text => send('Input.insertText', { text }, sessionId);
  await inPage(`window.undoOriginal = draftMeta.active; window.undoA = createDraft("Isolation A", "Body A"); window.undoB = createDraft("Isolation B", "Body B");
    localStorage.setItem(reviewKey(undoA), "Review A"); localStorage.setItem(reviewKey(undoB), "Review B");
    switchDraft(undoA); viewReviewBtn.click(); await wait(80); ta.focus(); ta.setSelectionRange(6,6);`);
  await typeText(' authored');
  await inPage('reviewInput.focus();');
  await undo();
  await check('Undo in the review cannot remove native typing in the source', 'return ta.value === "Body A authored" && reviewInput.value === "Review A";');
  await inPage('ta.focus();');
  await undo();
  await inPage('reviewInput.focus();');
  await redo();
  await check('Redo in the review leaves the source redo entry available', 'return ta.value === "Body A" && reviewInput.value === "Review A";');
  await inPage('ta.focus();');
  await redo();
  await inPage('reviewInput.focus(); reviewInput.select();');
  await typeText('Changed A');
  await inPage('ta.focus();');
  await undo();
  await check('Undo in the source preserves native review edits', 'return ta.value === "Body A" && reviewInput.value === "Changed A";');
  await redo();
  await check('Redo in the source preserves the review', 'return reviewInput.value === "Changed A" && ta.value === "Body A authored";');
  await inPage('switchDraft(undoB); await wait(80); reviewInput.focus();');
  await undo();
  await check('Undo in another draft cannot replay the previous review', 'await wait(450); return reviewInput.value === "Review B" && storedReview(undoB) === "Review B";');
  await redo();
  await check('Redo in another draft cannot replay the previous review', 'await wait(450); return reviewInput.value === "Review B" && storedReview(undoB) === "Review B" && storedReview(undoA) === "Changed A";');

  await inPage('viewPreviewBtn.click(); viewPreviewBtn.focus();');
  await key('ArrowRight', 'ArrowRight', 39);
  await check('Right Arrow activates Review and moves the tab stop', `
    return document.activeElement === viewReviewBtn && viewReviewBtn.tabIndex === 0 && viewPreviewBtn.tabIndex === -1 &&
      !reviewView.hidden && viewReviewBtn.getAttribute('aria-selected') === 'true' && scroller.getAttribute('aria-hidden') === 'true';`);
  await key('ArrowLeft', 'ArrowLeft', 37);
  await check('Left Arrow returns to the labelled Preview tabpanel', `
    return document.activeElement === viewPreviewBtn && viewPreviewBtn.tabIndex === 0 && viewReviewBtn.tabIndex === -1 &&
      scroller.getAttribute('role') === 'tabpanel' && scroller.getAttribute('aria-labelledby') === viewPreviewBtn.id && reviewView.hidden;`);

  await check('the review document follows both page themes', `
    const original = prefs.theme;
    const colors = ['light','dark'].map(theme => {
      prefs.theme = theme; applyPrefs();
      const style = reviewInput.ownerDocument.defaultView.getComputedStyle(reviewInput);
      return [style.backgroundColor, style.color, reviewInput.ownerDocument.documentElement.style.colorScheme];
    });
    prefs.theme = original; applyPrefs();
    return colors[0][0] !== colors[1][0] && colors[0][1] !== colors[1][1] && colors[0][2] === 'light' && colors[1][2] === 'dark' || colors;`);

  // Copy a synthetic forum selection and paste it through the OS clipboard.
  await inPage(`viewReviewBtn.click(); const note = document.createElement("div");
    note.innerHTML = '<strong class="note-content-field">Questions:</strong> <div class="note-content-value"><p>For the axes:</p><ol><li>Which unit?</li><li>Which scale?</li></ol></div>';
    document.body.appendChild(note); const range = document.createRange(); range.selectNodeContents(note);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range); if (!document.execCommand("copy")) throw Error("copy");
    note.remove(); reviewInput.focus(); reviewInput.select();`);
  await key('v', 'KeyV', 86, 2);
  await check('forum paste reconstructs the HTML list in the review editor', `
    await wait(100); return reviewInput.value === 'Questions:\\nFor the axes:\\n\\n1. Which unit?\\n2. Which scale?' &&
      reviewList.querySelectorAll('.rpoint').length === 2 || {value:reviewInput.value};`);
  await undo();
  await check('one native undo restores the pre-paste review', 'return reviewInput.value === "Review B" && ta.value === "Body B";');

  await inPage(`window.quoteBase = "Opening.\\n\\n> Which unit describes the temperature axis?\\n\\nClosing.";
    setSourceText(quoteBase,0); updateAll(); reviewInput.focus(); reviewInput.select();`);
  await typeText('Questions:\n- Which unit describes the temperature axis?\n- Which scale?');
  for (const [action, click] of [['Quote', 'reviewList.querySelectorAll(".rquote")[1].click()'], ['Insert skeleton', 'skeletonBtn.click()']]) {
    await inPage('updateAll(); reviewList.querySelector(".rgo").click(); ' + click);
    await check(action + ' after a point jump preserves the passage', `
      return ta.value === "Opening.\\n\\n> Which unit describes the temperature axis?\\n\\n> **Q2.** Which scale?\\n\\nClosing." || {text:ta.value};`);
    await undo();
    await check(action + ' after a point jump takes one native undo', 'return ta.value === quoteBase;');
  }
  await check('review insertion respects manual selections and paragraph boundaries', `
    const base = 'One.\\n\\nTwo\\nlines.\\n\\nThree.';
    function inserted(start, end) { setSourceText(base,0); ta.setSelectionRange(start,end); insertBlock('Quote'); return ta.value; }
    return inserted(2,8) === 'One.\\n\\nTwo\\nlines.\\n\\nQuote\\n\\nThree.' &&
      inserted(5,5) === 'One.\\n\\nQuote\\n\\nTwo\\nlines.\\n\\nThree.' &&
      inserted(0,0) === 'Quote\\n\\n' + base && inserted(6,6) === 'One.\\n\\nQuote\\n\\nTwo\\nlines.\\n\\nThree.';`);

  await inPage('switchDraft(undoOriginal); window.confirm = () => true; deleteDraft(undoA); deleteDraft(undoB);');

  /* A Node string with real line breaks; JSON.stringify writes it into the page code. */
  const REVIEW = 'Official Review of Submission1 by Reviewer k9F2\nWeaknesses:\n1. No ablation on the number of experts.\n' +
    '2. Missing comparison with Switch Transformer.\nQuestions:\n- Why is the loss weighted by 0.01?\nRating: 4';
  await check('the review view lists the points and what the draft answers; Quote and the skeleton are one undo each', `
    const id = createDraft('Smoke review', ''); saveDraftMeta(); switchDraft(id); await wait(50);
    const base = 'We thank the reviewer.\\n\\n**W1.** We added it.';
    setSourceText(base, 0); updateAll();
    viewReviewBtn.click(); await wait(20);
    const shown = !reviewView.hidden && scroller.style.visibility === 'hidden' && prefs.view === 'review';
    reviewInput.value = ${JSON.stringify(REVIEW)}; reviewInput.dispatchEvent(new Event('input')); await wait(20);
    const rows = () => [...reviewList.querySelectorAll('.rpoint')].map((r) => r.querySelector('.rlabel').textContent + ':' + r.className.replace('rpoint ', '')).join(',');
    const listed = rows() === 'W1:labelled,W2:missing,Q1:missing' && reviewBadge.textContent === '1/3';
    reviewList.querySelector('.rgo[data-i="0"]').click(); await wait(20);
    const went = ta.value.slice(ta.selectionStart).startsWith('**W1.**');
    ta.setSelectionRange(ta.value.length, ta.value.length);
    reviewList.querySelector('.rquote[data-i="1"]').click(); await wait(500); /* the analysis runs after a pause */
    const quoted = ta.value === base + '\\n\\n> **W2.** Missing comparison with Switch Transformer.' && rows() === 'W1:labelled,W2:labelled,Q1:missing';
    ta.focus(); document.execCommand('undo'); await wait(50);
    const undone = ta.value === base;
    ta.setSelectionRange(ta.value.length, ta.value.length);
    skeletonBtn.click(); await wait(50);
    const skeleton = ta.value === base + '\\n\\n> **W2.** Missing comparison with Switch Transformer.\\n\\n> **Q1.** Why is the loss weighted by 0.01?';
    document.execCommand('undo'); await wait(50);
    const undone2 = ta.value === base;
    const note = !reviewNote.hidden && !!document.getElementById('reviewNameTab');
    document.getElementById('reviewNameTab').click(); await wait(20);
    const named = draftById(id).name === 'Reviewer k9F2' && reviewNote.hidden;
    return shown && listed && went && quoted && undone && skeleton && undone2 && note && named ||
      { shown, listed, rows: rows(), badge: reviewBadge.textContent, went, quoted, undone, skeleton, undone2, note, named, value: ta.value };`);

  await check('each draft keeps its own review', `
    const id = draftMeta.list.find((d) => d.name === 'Reviewer k9F2').id;
    const other = createDraft('No review', ''); saveDraftMeta(); switchDraft(other); await wait(50);
    const empty = reviewInput.value === '' && reviewBadge.textContent === '' && reviewList.children.length === 0;
    switchDraft(id); await wait(50);
    const back = reviewInput.value === ${JSON.stringify(REVIEW)} && localStorage.getItem('rebuttal-bench-review-' + id) === reviewInput.value;
    window.confirm = () => true; deleteDraft(other); await wait(20);
    return empty && back || { empty, back, box: reviewInput.value.slice(0, 40) };`);
  await load();
  await check('a review and the review view survive a reload, and go with their draft', `
    const id = draftMeta.list.find((d) => d.name === 'Reviewer k9F2').id;
    switchDraft(id); await wait(50);
    const kept = prefs.view === 'review' && !reviewView.hidden && reviewInput.value === ${JSON.stringify(REVIEW)} &&
      reviewList.querySelectorAll('.rpoint').length === 3;
    window.confirm = () => true; deleteDraft(id); await wait(50);
    const gone = localStorage.getItem('rebuttal-bench-review-' + id) === null && !draftById(id);
    viewPreviewBtn.click(); await wait(20);
    return kept && gone && prefs.view === 'preview' && reviewView.hidden && scroller.style.visibility === '' ||
      { kept, gone, view: prefs.view };`);

  await check('Quote goes after the block that holds the caret, never into a code block that follows it', `
    const home = draftMeta.active;
    const id = createDraft('Code answer', ''); saveDraftMeta(); switchDraft(id); await wait(50);
    viewReviewBtn.click();
    for (let i = 0; i < 60 && !(reviewInput && reviewFor === id); i++) await wait(50);
    const base = 'Opening answer.\\n\`\`\`py\\nrun()\\n\\nrun()\\n\`\`\`';
    setSourceText(base, 0); updateAll();
    reviewInput.value = 'Questions:\\n- Why twice?'; reviewInput.dispatchEvent(new Event('input')); await wait(50);
    ta.focus(); ta.setSelectionRange(15, 15);
    reviewList.querySelector('.rquote[data-i="0"]').click(); await wait(50);
    const placed = ta.value === 'Opening answer.\\n\\n> **Q1.** Why twice?\\n\\n\`\`\`py\\nrun()\\n\\nrun()\\n\`\`\`';
    ta.focus(); document.execCommand('undo'); await wait(50);
    const undone = ta.value === base;
    window.confirm = () => true; deleteDraft(id); await wait(50);
    switchDraft(home); await wait(50);
    viewPreviewBtn.click(); await wait(20);
    return placed && undone || { placed, undone, value: ta.value };`);

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
  await check('nothing can be typed before the drafts are restored', `
    for (let i = 0; i < 60 && typeof ta === 'undefined'; i++) await wait(50);
    return ta.readOnly === true && !draftReady && /Loading/.test(ta.placeholder) ||
      { readOnly: ta.readOnly, ready: draftReady, placeholder: ta.placeholder };`);
  await check('a switch flipped before the stored preferences arrive stays flipped', `
    for (let i = 0; i < 60 && typeof compactList === 'undefined'; i++) await wait(50);
    if (prefsRestored) return 'the stored preferences came back too soon to test this';
    compactList.querySelector('input[data-trick="tables"]').click();
    for (let i = 0; i < 80 && !prefsRestored; i++) await wait(50);
    return prefsRestored && prefs.compact.tables === false &&
      !compactList.querySelector('input[data-trick="tables"]').checked || { restored: prefsRestored, tables: prefs.compact.tables };`);
  await inPage(`localStorage.setItem('stub:delay', '50');
    compactList.querySelector('input[data-trick="tables"]').click(); await wait(300); return true;`);

  await inPage(`localStorage.setItem('stub:delay', '3000');
    const p = JSON.parse(localStorage.getItem('stub:rebuttal-bench-prefs') || JSON.stringify(prefs));
    localStorage.setItem('stub:rebuttal-bench-prefs', JSON.stringify(Object.assign(p, { venue: 'aaai', limit: 2500, ownLimit: 4200 })));
    return true;`);
  await send('Page.navigate', { url: PAGE }, sessionId);
  await sleep(600);
  await check('a venue chosen before the stored preferences arrive gets its limit, or the author’s stored one', `
    for (let i = 0; i < 60 && typeof venueSelect === 'undefined'; i++) await wait(50);
    if (prefsRestored) return 'the stored preferences came back too soon to test this';
    venueSelect.value = 'iclr'; venueSelect.dispatchEvent(new Event('change'));
    for (let i = 0; i < 80 && !prefsRestored; i++) await wait(50);
    return prefsRestored && prefs.venue === 'iclr' && prefs.limit === 4200 && limitInput.value === '4200' ||
      { venue: prefs.venue, limit: prefs.limit, own: prefs.ownLimit, shown: limitInput.value };`);
  await inPage(`localStorage.setItem('stub:delay', '50');
    for (let i = 0; i < 100 && !draftReady; i++) await wait(50);
    venueSelect.value = ''; venueSelect.dispatchEvent(new Event('change'));
    limitInput.value = '5000'; limitInput.dispatchEvent(new Event('input')); await wait(300); return true;`);

  await load();
  await inPage(`document.querySelector('#draftTools .dadd').click(); await wait(50);
    setSourceText('Typed in a second draft $z$.', 0); ta.dispatchEvent(new Event('input')); return draftMeta.active;`);
  await load(); /* before the 700 ms autosave reaches the store */
  await check('with an asynchronous store, text typed in a second draft just before a reload is kept', `
    const ok = draftMeta.list.length === 2 && ta.value === 'Typed in a second draft $z$.' && draftText('d1') === 'Theirs $b$.' && !ta.readOnly;
    window.confirm = () => true;
    document.querySelector('#draftTools .dclose').click(); await wait(300);
    return ok && draftMeta.list.length === 1 || { meta: draftMeta, value: ta.value, d1: draftTexts.d1 };`);

  await inPage(`importDrafts(JSON.stringify({ format: 'rebuttal-bench-drafts', drafts: [{ name: 'Imported here', text: 'Imported $q$.' }] }), 'x.json');
    await wait(400); return true;`);
  await load();
  await check('with an asynchronous store, an imported draft reaches it and is there after a reload', `
    const d = draftMeta.list.find((x) => x.name === 'Imported here');
    const inStore = !!d && localStorage.getItem('stub:' + keyOfDraft(d.id)) === 'Imported $q$.' &&
      JSON.parse(localStorage.getItem('stub:' + DRAFTS_KEY)).list.some((x) => x.id === d.id);
    const ok = inStore && draftText(d.id) === 'Imported $q$.' && ta.value === 'Theirs $b$.';
    if (d) { window.confirm = () => true; deleteDraft(d.id); await wait(300); }
    return ok || { found: !!d, inStore, list: draftMeta.list.map((x) => x.name), value: ta.value };`);

  await check('with an asynchronous store, a merge that brings back the open draft deleted on another device brings back its text', `
    const id = createDraft('Deleted on another device', 'Still here $r$.'); switchDraft(id); await wait(500);
    const s = JSON.parse(localStorage.getItem('stub:' + DRAFTS_KEY)); /* that device deleted it */
    s.list = s.list.filter((d) => d.id !== id); s.gone[id] = Date.now(); s.saved = Date.now();
    localStorage.setItem('stub:' + DRAFTS_KEY, JSON.stringify(s)); localStorage.removeItem('stub:' + keyOfDraft(id));
    saveDraftMeta(); await wait(700);
    const listed = JSON.parse(localStorage.getItem('stub:' + DRAFTS_KEY)).list.some((d) => d.id === id);
    const body = localStorage.getItem('stub:' + keyOfDraft(id));
    window.confirm = () => true; deleteDraft(id); await wait(300);
    return listed && body === 'Still here $r$.' || { listed, body };`);

  await check('with an asynchronous store, a draft re-created after a deletion elsewhere keeps its text through a switch right after', `
    const origId = draftMeta.active;
    const id = createDraft('Deleted in another window', 'Keep me $k$.'); switchDraft(id); await wait(500);
    const theirs = JSON.parse(localStorage.getItem(DRAFTS_KEY)); /* another window deletes it, here and in the store */
    theirs.list = theirs.list.filter((d) => d.id !== id); theirs.gone[id] = Date.now() + 1000; theirs.saved = Date.now();
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(theirs)); localStorage.removeItem(keyOfDraft(id));
    localStorage.removeItem('stub:' + keyOfDraft(id));
    window.dispatchEvent(new StorageEvent('storage', { key: DRAFTS_KEY, newValue: JSON.stringify(theirs) }));
    switchDraft(origId); /* before the store has answered */
    const localAtOnce = localStorage.getItem(keyOfDraft(id));
    await wait(600);
    const stored = localStorage.getItem('stub:' + keyOfDraft(id));
    const listed = JSON.parse(localStorage.getItem(DRAFTS_KEY)).list.some((d) => d.id === id);
    window.confirm = () => true; deleteDraft(id); await wait(300);
    return localAtOnce === 'Keep me $k$.' && stored === 'Keep me $k$.' && listed || { localAtOnce, stored, listed };`);

  await check('with an asynchronous store, re-creating never sends this window’s text over one another window saved meanwhile', `
    const origId = draftMeta.active;
    const id = createDraft('Saved meanwhile', 'Old text $o$.'); switchDraft(id); await wait(500);
    const theirs = JSON.parse(localStorage.getItem(DRAFTS_KEY));
    theirs.list = theirs.list.filter((d) => d.id !== id); theirs.gone[id] = Date.now() + 1000; theirs.saved = Date.now();
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(theirs)); localStorage.removeItem(keyOfDraft(id));
    localStorage.removeItem('stub:' + keyOfDraft(id));
    window.dispatchEvent(new StorageEvent('storage', { key: DRAFTS_KEY, newValue: JSON.stringify(theirs) }));
    localStorage.setItem(keyOfDraft(id), 'Newer, from a third window.'); /* while the store is read */
    await wait(600);
    const stored = localStorage.getItem('stub:' + keyOfDraft(id)), local = localStorage.getItem(keyOfDraft(id));
    window.confirm = () => true; switchDraft(origId); deleteDraft(id); await wait(300);
    return stored !== 'Old text $o$.' && local === 'Newer, from a third window.' || { stored, local };`);

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
