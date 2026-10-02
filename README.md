# Rebuttal Bench

A single-file previewer for OpenReview comments. Paste a rebuttal and see it rendered the way
openreview.net renders it — Marked (GFM) → DOMPurify → MathJax — next to a list of *hazards*:
places where Markdown mangles your TeX before MathJax ever sees it, most with a one-click fix.

## Using it

Open `rebuttal-bench.html` in a browser (double-click is fine). It needs an internet connection
for its pinned CDN libraries and the Noto Sans font. Drafts autosave in the browser, on this
device only.

- **Hazards** — click a card to jump to the spot; **Fix: …** rewrites the source; **Fix all**
  applies every mechanical fix, repeating (up to eight rounds) until nothing is left. One
  Ctrl+Z (⌘Z) undoes a fix, a whole Fix-all pass, *Clear* or *Load example*.
- **Status bar** — characters counted the way OpenReview's own counter does (trimmed length),
  the number of formulas MathJax will typeset, hazards, and MathJax problems (TeX errors *and*
  undefined macros).
- **Escape cheat sheet** — under the hazards list.

## How faithful is the preview?

| Stage | OpenReview (openreview-web) | This page |
| --- | --- | --- |
| Markdown | Marked 15.0.6, GFM, custom renderer in `client/view.js` (`setupMarked`): raw HTML shown as text, images only from `/images/`, task checkboxes as `[x]` | same |
| Sanitizing | DOMPurify 3.4.13, tag allowlist from `lib/utils.js`, hook in `app/AppInit.js` | same |
| Math | MathJax 3.2.2 `tex-chtml-full`, `$…$`/`\(…\)` inline, `$$…$$`/`\[…\]` display, bare `\begin{…}` environments and `\ref`/`\eqref` (`lib/mathjax-config.js` + MathJax defaults; equations are not numbered) | same; each preview starts from a fresh TeX state, as a posted comment does |
| Styles | `.note-content-value.markdown-rendered`: Noto Sans 12px/18px (`styles/utils/_mixins.scss`) | same; 100 % zoom is 1:1 |

Line *wrapping* still depends on the reader's window width and reply depth. The table was
verified against openreview-web at commit `45c27aa` (2026-09-22); `npm run check-upstream`
reports when any of those sources change.

## How the hazard analyzer works

1. Marked's own lexer splits the draft into leaf blocks (paragraphs, headings, list items,
   table cells). MathJax searches each one as a separate string, and never inside code or link
   destinations.
2. For each block the analyzer computes the text MathJax actually receives: Markdown turns `\\`
   into `\`, drops the `\` of `\X` before punctuation, and turns a line-final `\` into `<br>`;
   the browser decodes character references such as `&#36;`. An HTML block is shown as typed.
3. A port of MathJax 3.2.2's delimiter finder runs over that text, so the analyzer knows exactly
   which formulas will be typeset. Differential fuzzing against real MathJax keeps it honest.
4. Leftover delimiters are paired across block boundaries only to *explain* breakage (a blank
   line inside display math, a list marker, a bare `|` that split a table cell).
5. Checks then look for Markdown that damages each formula: consumed `\,` `\{` `\|` …, collapsed
   `\\` row breaks, emphasis eating `_` or `*`, currency dollars pairing up, and more; and for
   `\ref`/`\eqref` copied from the paper, which OpenReview shows as `(???)`.

Because **Fix all** runs unattended, a fix is only offered when it can't damage correct text;
ambiguous cases get a warning without a fix.

## Development

Requires Node.js 22+.

```sh
npm install
npm test                          # regression cases, the example, page checks, short fuzz
npm run fuzz -- 20000 42 blocks   # long fuzz: iterations, seed, alphabet (inline | blocks)
npm run smoke                     # headless Chrome/Edge: undo, jump, status bar, persistence
npm run check-upstream            # did openreview-web change anything the page mirrors?
                                  #   exit 1: something changed; 2: the check itself failed
```

```
rebuttal-bench.html        the app (single self-contained file, no build step)
tests/
  regression.test.js       hazard + Fix-all cases, broken and correct input
  example.test.js          the built-in example must end clean and fully typeset
  fuzz.test.js             analyzer vs. real Marked + DOMPurify + MathJax
  page.test.js             scripts parse, CDN versions match package.json, …
  check-upstream.test.js   the drift check's offline parts and the committed snapshot
  lib/pipeline.js          OpenReview's pipeline re-implemented as ground truth
  lib/page.js              loads the analyzer out of the HTML
  lib/fuzz.js              differential fuzzer (+ CLI)
scripts/smoke.mjs          browser smoke test over the DevTools protocol
scripts/check-upstream.mjs compares openreview-web against upstream/openreview-web.json
AGENTS.md                  engineering notes for contributors and coding agents
```

When adding or changing a check or fix, add regression cases for the broken input it repairs
**and** for nearby correct input it must leave alone.
