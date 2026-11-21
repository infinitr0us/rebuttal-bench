'use strict';
// Reference implementation of OpenReview's comment pipeline, used as ground
// truth: Marked 15 with OpenReview's renderer -> DOMPurify with OpenReview's
// allowlist -> MathJax 3.2.2 FindTeX over the resulting DOM (jsdom).
//
// This deliberately re-implements openreview-web instead of reusing the page's
// code, so the page is checked against an independent copy. Upstream sources:
//   client/view.js       setupMarked()          (renderer + marked options)
//   app/AppInit.js       DOMPurify.setConfig / addHook
//   lib/utils.js         allowedHtmlTags
//   lib/mathjax-config.js                       (inlineMath; the rest are MathJax defaults)
// `npm run check-upstream` reports when any of these change.
const { JSDOM } = require('jsdom');
const createDOMPurify = require('dompurify');
const { marked } = require('marked');
const { mathjax } = require('mathjax-full/js/mathjax.js');
const { TeX } = require('mathjax-full/js/input/tex.js');
const { jsdomAdaptor } = require('mathjax-full/js/adaptors/jsdomAdaptor.js');
const { RegisterHTMLHandler } = require('mathjax-full/js/handlers/html.js');
const { AllPackages } = require('mathjax-full/js/input/tex/AllPackages.js');

const { window } = new JSDOM('<!DOCTYPE html><html><body></body></html>');
const DOMPurify = createDOMPurify(window);
const ALLOWED_TAGS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'div', 'span', 'blockquote', 'pre', 'hr', 'section', 'article',
  'header', 'footer', 'figure', 'figcaption', 'details', 'summary',
  'a', 'b', 'i', 'em', 'strong', 'u', 's', 'strike', 'del', 'ins', 'sub', 'sup', 'small', 'mark', 'code',
  'kbd', 'samp', 'var', 'abbr', 'cite', 'q', 'br', 'wbr',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  'img',
];
DOMPurify.setConfig({ ALLOWED_TAGS });
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
  node.removeAttribute?.('style');
  node.removeAttribute?.('action');
  node.removeAttribute?.('formaction');
});

// jQuery's $('<div/>').text(s).html() escapes only &, < and >.
const jqText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const renderer = new marked.Renderer();
renderer.image = function ({ href, title, text }) {
  if (href.startsWith('/images/')) {
    const titleAttr = title ? 'title="' + title + '" ' : '';
    const classAttr = href.endsWith('_icon.svg') ? 'class="icon" ' : '';
    return '<img src="' + href + '" alt="' + text + '" ' + titleAttr + classAttr + '/>';
  }
  return jqText('<img src="' + href + '" alt="' + text + '" title="' + title + '">');
};
renderer.checkbox = ({ checked }) => (checked ? '[x]' : '[ ]');
renderer.html = ({ text }) => jqText(text);
marked.setOptions({
  baseUrl: null, breaks: false, gfm: true, headerIds: false, langPrefix: 'language-', mangle: false, renderer,
});

RegisterHTMLHandler(jsdomAdaptor(JSDOM));
// The browser's tex-chtml-full loads every package; bussproofs alone needs an
// output jax to compile, and no rebuttal uses proof trees.
const PACKAGES = AllPackages.filter((p) => p !== 'bussproofs');

/** The sanitized HTML openreview.net puts on the page, before MathJax runs. */
function renderHtml(src) {
  return DOMPurify.sanitize(marked(src));
}

function mathDocument(html) {
  return mathjax.document('<!DOCTYPE html><html><body><div>' + html + '</div></body></html>', {
    InputJax: new TeX({ inlineMath: [['$', '$'], ['\\(', '\\)']], packages: PACKAGES }),
  });
}

/**
 * Render `src` the way openreview.net does and report what MathJax typesets.
 * @returns {{html: string, items: {tex: string, display: boolean, err: string|null}[]}}
 */
function renderLikeOpenReview(src) {
  const html = renderHtml(src);
  const doc = mathDocument(html);
  doc.findMath();
  const items = [];
  for (const item of doc.math) {
    if (item.display === null) continue; // a processEscapes escape (\$ -> $), not math
    let err = null;
    try {
      item.compile(doc);
      item.root.walkTree((n) => {
        if (err) return;
        if (n.isKind('merror')) err = n.attributes.get('data-mjx-error') || 'merror';
        // noundefined renders an unknown macro as red text instead of an error.
        else if (n.isKind('mtext') && n.attributes.get('mathcolor') === 'red' && n.getText().startsWith('\\')) {
          err = 'undefined ' + n.getText();
        }
      });
    } catch (e) {
      err = String(e.message || e);
    }
    items.push({ tex: item.math, display: item.display, err });
  }
  return { html, items };
}

/** Compact form for assertions: "I:tex" / "D:tex", plus " [ERR …]" when TeX fails. */
function typeset(src) {
  return renderLikeOpenReview(src).items.map((i) => (i.display ? 'D:' : 'I:') + i.tex + (i.err ? ' [ERR ' + i.err + ']' : ''));
}

module.exports = { renderHtml, renderLikeOpenReview, typeset, mathDocument };
