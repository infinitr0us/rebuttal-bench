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
