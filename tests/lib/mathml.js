'use strict';
const { SerializedMmlVisitor } = require('mathjax-full/js/core/MmlTree/SerializedMmlVisitor.js');
const { renderHtml, mathDocument } = require('./pipeline');
const visitor = new SerializedMmlVisitor();

// The injectable converter starts with a fresh input jax per document.
function mathml(formulas) {
  const doc = mathDocument('');
  doc.options.compileError = (_doc, _item, err) => { throw err; };
  const items = formulas.map(({ tex, display }) => {
    const item = new doc.options.MathItem(tex, doc.inputJax[0], display);
    item.start.node = doc.document.body;
    doc.math.push(item);
    return item;
  });
  doc.compile();
  return items.map(item => visitor.visitTree(item.root));
}

// Independent oracle from the compaction probes. Use actual FindTeX over the
// DOM and replace its ranges backwards, after compiling in document order.
function renderedWithMathML(src) {
  const doc = mathDocument(renderHtml(src));
  doc.findMath().compile();
  for (const item of Array.from(doc.math).reverse()) {
    if (item.display === null) continue;
    const marker = doc.document.createElement('probe-math');
    marker.setAttribute('display', String(item.display));
    marker.textContent = visitor.visitTree(item.root);
    item.typesetRoot = marker;
    item.updateDocument(doc);
  }
  return doc.document.body.firstElementChild.innerHTML;
}

// What the page's texProblems() reports after the preview typesets the posted
// (trimmed) comment: per formula in document order, its undefined macros and
// TeX errors. One document, so \newcommand carries over as in the preview.
function texReports(src) {
  const doc = mathDocument(renderHtml(src.trim()));
  doc.findMath();
  const out = [];
  for (const item of doc.math) {
    if (item.display === null) continue;
    const r = { tex: item.math, undef: [], errors: [] };
    item.compile(doc);
    item.root.walkTree((n) => {
      if (n.isKind('merror')) r.errors.push(String(n.attributes.get('data-mjx-error') || 'TeX error'));
      else if (n.isKind('mtext') && n.attributes.get('mathcolor') === 'red' && n.getText().startsWith('\\')) r.undef.push(n.getText());
    });
    out.push(r);
  }
  return out;
}

module.exports = { mathml, renderedWithMathML, texReports };
