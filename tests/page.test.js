'use strict';
// Structural checks on the page itself.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readPage, inlineScripts, BANNER_START, BANNER_END } = require('./lib/page');
const pkg = require('../package.json');

const html = readPage();

test('every inline script parses', () => {
  const scripts = inlineScripts();
  assert.ok(scripts.length >= 2);
  scripts.forEach((s, i) => assert.doesNotThrow(() => new Function(s), 'inline script #' + i));
});

test('analysis banners appear exactly once, in order', () => {
  const count = (s) => html.split(s).length - 1;
  assert.equal(count(BANNER_START), 1);
  assert.equal(count(BANNER_END), 1);
  assert.ok(html.indexOf(BANNER_START) < html.indexOf(BANNER_END));
});

test('the analysis section stays DOM-free', () => {
  const section = html.slice(html.indexOf(BANNER_START), html.indexOf(BANNER_END));
  assert.doesNotMatch(section, /\bdocument\.|getElementById|querySelector|localStorage|\bnavigator\./);
});

// The page loads its libraries from CDNs; the tests validate against the npm
// copies. Both must be the same versions or the tests prove nothing.
test('CDN library versions match the tested devDependencies', () => {
  const cdn = {
    marked: html.match(/ajax\/libs\/marked\/([\d.]+)\//)?.[1],
    dompurify: html.match(/ajax\/libs\/dompurify\/([\d.]+)\//)?.[1],
    'mathjax-full': html.match(/npm\/mathjax@([\d.]+)\//)?.[1],
  };
  for (const [name, version] of Object.entries(cdn)) {
    assert.equal(version, pkg.devDependencies[name], name + ' on the CDN vs package.json');
  }
});

test('no invisible characters hide in the source', () => {
  assert.doesNotMatch(html, /[​‌‍⁠﻿]/);
});
