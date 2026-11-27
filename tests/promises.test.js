'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAnalyzer } = require('./lib/page');
const A = loadAnalyzer();

const rows = (text, spans) => Array.from(A.promisesIn(text, spans), r => ({ ...r }));
test('active and passive commitments, revision introductions and completed changes', () => {
  for (const [kind, sentences] of Object.entries({
    will: [
      'We will add the seed sweep to the appendix.',
      'We will include the training scripts.',
      'In the camera-ready version we will clarify why we chose this threshold.',
      'We will revise Section 3 accordingly.',
      'We will discuss the limitations of the sampler.',
      'We will move the diagram to Section 2.',
      'We will release our code and weights.',
      'We will report per-site results.',
      'The confidence intervals will be added in the revised version.',
      'In the final version, we include the calibration curve.',
      'The scripts will be released upon publication.',
    ],
    done: [
      'We have added the annotations to our revised paper.',
      'We have revised Section 3 accordingly.',
      'We have updated the manuscript to identify the source.',
      'We have included a control in the revised manuscript.',
      'The revised version now includes a citation for the instrument.',
    ],
  })) {
    for (const sentence of sentences) {
      assert.deepEqual(rows(sentence), [{ start: 0, end: sentence.length, kind, sentence }]);
    }
  }
});

test('a prediction, question, conditional, quoted promise or explanation in the reply stays quiet', () => {
  for (const text of [
    'We will show that the gradient stays bounded in Section 3.',
    'The model will converge after two epochs.',
    'We will add noise to the dataset at each step.',
    'The weights will be updated after each pass described in Section 5.',
    'We cannot promise we will add the citations.',
    'The authors were asked when we will report the results.',
    'Are you asking if we will revise the appendix?',
    'Can you confirm we will release the scripts?',
    'If we get permission, we will release the dataset.',
    'We will add two figures, provided that we receive the extra page.',
    'We might revise the appendix.',
    'We will not add another table to the paper.',
    'We will consider adding the ablation results.',
    'We have shown that the choice in Section 3 is stable.',
    'As we have noted, the revised manuscript describes both cases.',
    'We have discussed the bound in the original manuscript.',
    'We have added the numbers in the following table.',
    'We have added a diagnostic probe, as shown in the table.',
    'In addition to the paper authors, we have added two raters to the internal pool.',
    'We will add a subsection that\n- answers the remaining questions.',
    'We will report the results in a follow-up comment.',
    'Our colleague wrote, “We will update the paper.”',
    'The review quotes "We have updated the appendix."',
    "The review reads: 'It's unclear why we will release the scripts.'",
    "> We will expand the appendix to give the missing proof.\n> We will also release the scripts.",
    '~~We will release the scripts.~~',
    'Use `We will release the scripts.` as a test sentence.',
    '~~~text\nWe will update the paper.\n~~~',
    '$\\text{We will release the dataset.}$',
    '[our code](https://example.org "We will release the scripts.")',
    '![We will add a figure.](/images/example.png)',
    '[old]: https://example.org "We will revise the paper."',
    '<!-- We will revise the abstract. -->',
  ]) assert.deepEqual(rows(text), [], text);
});

test('list items, soft wraps, abbreviations and decimals preserve source ranges after posting', () => {
  const first = 'We will update Sec. 3 with results at 0.25, e.g. the estimate from Lin et al. (2020).';
  const second = 'We have revised\r\nthe manuscript accordingly';
  const third = 'We will release our code';
  const text = '  \r\n    - Already explained. ' + first + '\r\n- ' + second + '\r\n- ' + third + '\r\n  ';
  const expected = [first, second, third].map((sentence, i) => ({
    start: text.indexOf(sentence), end: text.indexOf(sentence) + sentence.length,
    kind: i === 1 ? 'done' : 'will', sentence,
  }));
  assert.deepEqual(rows(text), expected);
  assert.deepEqual(rows(text, A.analyze(text).spans), expected);
  const masked = '    > We will add results.\r\n> We will release our code.\r\n\r\n' + third;
  assert.deepEqual(rows(masked).map(r => r.sentence), [third]);
  assert.deepEqual(rows(third + '.We appreciate the feedback.').map(r => r.sentence), [third + '.']);
});

test('prose around a formula, code or a link stays together without matching their contents', () => {
  const text = '   We will clarify the definition of $v$ in the [appendix](https://example.org).';
  assert.deepEqual(rows(text, A.analyze(text).spans).map(r => [r.start, r.sentence]), [[3, text.trim()]]);
  assert.deepEqual(rows('We will [add](https://example.org) an ablation.').map(r => r.kind), ['will']);
  const equation = 'We have revised the caption to read $$v = 3. $$';
  assert.deepEqual(rows(equation + ' This value is exact.').map(r => r.sentence), [equation]);
  for (const value of [null, undefined, 42, '', '$', '**']) assert.deepEqual(rows(value), []);
});
