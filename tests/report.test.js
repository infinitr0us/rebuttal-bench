'use strict';
// The footer's problem report: the version it names, the browser label, and
// the issue-form fields it fills in (which must exist in .github/ISSUE_TEMPLATE).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadAnalyzer, readPage } = require('./lib/page');

const A = loadAnalyzer();
const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const formIds = (file) => [...fs.readFileSync(path.join(ROOT, '.github/ISSUE_TEMPLATE', file), 'utf8')
  .matchAll(/^\s+id: ([\w-]+)$/gm)].map((m) => m[1]);

test('the page names the version package.json has', () => {
  assert.equal(A.APP_VERSION, pkg.version, 'bump APP_VERSION in rebuttal-bench.html with package.json');
});

test('browser labels for the common user agents', () => {
  const cases = {
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36': 'Chrome 142 on Windows',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0': 'Edge 142 on Windows',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.1 Safari/605.1.15': 'Safari 19 on macOS',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 15.6; rv:145.0) Gecko/20100101 Firefox/145.0': 'Firefox 145 on macOS',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/142.0.0.0 Safari/537.36': 'Chrome 142 on Linux',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 19_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.1 Mobile/15E148 Safari/604.1': 'Safari 19 on iOS',
    'Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36': 'Chrome 142 on Android',
    'Mozilla/5.0 (X11; CrOS x86_64 16000.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36': 'Chrome 142 on ChromeOS',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 OPR/125.0.0.0': 'Opera 125 on Windows',
  };
  for (const [ua, label] of Object.entries(cases)) assert.equal(A.browserLabel(ua), label, ua);
  assert.equal(A.browserLabel(''), '');
  assert.equal(A.browserLabel(undefined), '');
  assert.equal(A.browserLabel('SomeBot/1.0'), '');
});

test('a report link fills the form by field id and leaves empty fields out', () => {
  const url = A.reportUrl('problem.yml', { version: '3.12.0', browser: 'Chrome 142 on Windows', venue: '' });
  assert.equal(url, 'https://github.com/infinitr0us/rebuttal-bench/issues/new?template=problem.yml&version=3.12.0&browser=Chrome%20142%20on%20Windows');
  assert.match(A.reportUrl('idea.yml', { version: 'a&b=c' }), /&version=a%26b%3Dc$/);
});

test('a report names the venue with its year or its form', () => {
  assert.equal(A.reportVenue(A.venueById('neurips')), 'NeurIPS 2026');
  assert.equal(A.reportVenue(A.venueById('or-rebuttal')), 'OpenReview default rebuttal');
  assert.equal(A.reportVenue(A.venueById('arr')), 'ACL ARR (ACL, NAACL, EMNLP)');
  assert.equal(A.reportVenue(null), '');
  // Two presets must never read the same in a report.
  const names = A.VENUES.map((v) => A.reportVenue(v));
  assert.equal(new Set(names).size, names.length, names.join(', '));
});

test('the page fills only fields its issue forms have', () => {
  const html = readPage();
  const calls = [...html.matchAll(/reportUrl\('([\w-]+\.yml)', \{([^}]*)\}/g)];
  assert.ok(calls.length >= 2, 'the footer builds both links');
  for (const [, file, body] of calls) {
    const ids = formIds(file);
    const keys = [...body.matchAll(/(\w+):/g)].map((m) => m[1]);
    for (const k of keys) assert.ok(ids.includes(k), `${file} has no field "${k}"`);
  }
  // The links work before the script runs (and without it), as plain URLs.
  assert.match(html, /id="reportLink" href="https:\/\/github\.com\/infinitr0us\/rebuttal-bench\/issues\/new\?template=problem\.yml"/);
  assert.match(html, /id="ideaLink" href="https:\/\/github\.com\/infinitr0us\/rebuttal-bench\/issues\/new\?template=idea\.yml"/);
});
