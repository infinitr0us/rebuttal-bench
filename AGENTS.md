# Engineering notes

Read by coding agents (Codex, Claude Code via `CLAUDE.md`) and human contributors alike.
User-facing documentation is in `README.md`; history of changes in `CHANGELOG.md`.

## Ground rules

- **One self-contained HTML file, no build step.** `rebuttal-bench.html` must keep working when
  opened from disk or shared as a single file. Libraries come only from cdnjs / jsDelivr, pinned
  to exact versions that must equal the `devDependencies` in `package.json` (a test enforces it).
- **Match the surrounding style**: ES5 (`var`, `function`, no arrow functions or modules) in the
  page, 2-space indent, LF line endings (`.gitattributes`), comments that explain *why*.
- **`npm test` must pass before every commit**, and `npm run smoke` too when the DOM section
  changed. Keep commits small and focused.
- Both accept `RB_PAGE=<file>` to run against another copy of the page, e.g. an old version
  from git (`git show 7501f14:rebuttal-bench_v2.html > old.html`), to confirm a new test fails
  without the fix.

## Anatomy of `rebuttal-bench.html`

1. `<head>` script — the MathJax configuration, mirroring openreview-web's `lib/mathjax-config.js`.
2. `<style>` — light tokens on `:root`, dark overrides on `html[data-theme="dark"]`; the
   `.paper` rules mirror OpenReview's note styles value for value.
3. Markup — header controls, stats bar, editor + hazards + cheat sheet, preview, footer.
4. Main `<script>`, split by two banner comments that the tests rely on (keep them verbatim):
   - `/* ================= pure analysis ================= */` — everything the analyzer needs,
     plus the pure Fix-all engine (`fixAllText`), the compaction engine (`compactText`) and the
     venue presets (`VENUES`). **Must stay DOM-free**: the tests run this section in a Node VM
     with only `window.marked` available.
   - `/* ================= dom wiring ================= */` — rendering, persistence, UI events.

## The analyzer's model

- `collectMarkedRanges` locates Marked tokens in the source (with a prefix-tolerant fallback for
  list/quote content, and `\|`-tolerant matching inside table cells, where GFM unescapes the
  pipe first) and records *leaf blocks*, including GFM table cells split the way Marked splits
  them. It also records link syntax that is not text (brackets, destinations), which is masked
  like code. A code span it cannot locate masks its whole container.
- `buildRegions` — the strings MathJax searches: leaf blocks minus code, split at blank lines
  (except HTML blocks, which OpenReview shows as one run of text).
- `mathJaxView` — the text MathJax receives from a region after Markdown's escape handling and
  the browser's decoding of character references (an HTML block: as typed), with a source
  position for every character.
- `mjFind` / `mjFindEnd` — a **faithful port of MathJax 3.2.2 FindTeX** (`$$` before `$` at the
  same position, closers only at brace depth 0, `\X` skipped as a unit, processEscapes,
  processEnvironments, processRefs). Do not "improve" it; it must behave exactly like MathJax.
  Diagnostics (stray closers, stray `\end`) must not change where the scan resumes.
  `npm run fuzz` must report 0 mismatches after any change here or in the view.
- `scanMath` — real spans (what MathJax typesets) plus *recovered* spans: leftover delimiters
  paired across a boundary purely to explain breakage (`why`: blank, block, table, code,
  braces). Recovered spans are never counted as math.
- `analyze(src, opts)` — the checks, numbered in the source. Each returns hazards
  `{sev, title, detail(HTML), start, end, fix}`; a fix is a list of edits carrying `was`
  (the text they expect), so stale fixes are refused. Checks 9–14 report what OpenReview shows
  as typed (raw HTML, HTML comments, external images, footnotes, h4–h6, LaTeX outside math);
  check 15 reports links under `opts.venue`'s rule (an id from `VENUES`; only the page passes
  it, so Fix all and compaction never see venue hazards).
- `collectMarkedRanges` also records link reference definitions (`definitions`), which Marked
  consumes without a token, through a block extension that only observes.

## Autofix rules

- Fix all runs unattended: **a fix must never change input that already renders correctly.**
  If a pattern is ambiguous (e.g. `$5$` vs. currency), warn without a fix.
- Every fix touching one `$` goes through `literalDollar`, so Fix all can't stack two edits on the
  same dollar sign.
- Add regression cases for both the broken input and nearby correct input (`fixed: null`).
- A fix that needs the author's judgment (it changes wording or formatting, or the input could
  be intended) is **manual**: build it with `manual()` in `analyze`. `fixAllText` skips it, the
  Fix all button does not count it, and its card says "Not part of Fix all". Even so, verify
  in a regression case that the fixed text renders as promised.

## Compaction

`compactText(text, enabled, render, maxChecks)` rewrites the source with the tricks in
`COMPACT_TRICKS` (each `{id, on, find(text, ctx), label, hint}`; `on` is the default). The
caller passes `render` (the page: `renderOpenReviewMarkdown`; the tests: `renderHtml` from
`tests/lib/pipeline.js`). The rules:

- **A trick only proposes; the check decides.** An edit is kept only if the comment still
  renders to the same sanitized HTML as the text the trick started from, both as typed and
  trimmed (OpenReview trims on posting), and `analyze` reports no more hazards of any kind
  (severity and title) than the original. Failing batches are bisected. Do not weaken this to
  make a trick "work": a candidate the check rejects is reported as left alone (`kept`), which
  is fine; `skipped` counts candidates never tried because the limits ran out.
- `ws: true` tricks (whitespace only) compare `collapseWhitespace(html)` (text outside `<pre>`;
  tags and attribute values untouched) and require `mathJaxInputs(html)`, every formula MathJax
  will find in the rendered HTML, to stay identical. They also stay out of math, code, inline
  HTML and link syntax. This relies on the note text being `white-space: normal` (`_mixins.scss`,
  watched by `npm run check-upstream`).
- The page passes time limits (`{checks, ms}`): a short slice while typing, more on a click.
  Results are safe whenever the limit hits; keep it that way.
- `look: true` tricks change the rendering on purpose and stay off by default. Their edits are
  checked with placeholders (`sameButSwapped`): old and new text must each render exactly as a
  neutral placeholder at that spot. `e.shown` is what the page shows for the old text when that
  differs from the source (Markdown escapes).
- `findX` functions must not throw on any input and should avoid proposing edits the check
  will reject anyway (each rejection costs renders; the budget is 400 checks).
- Add cases to `tests/compact.test.js` in both directions, as for fixes.

## Venue presets

`VENUES` holds each venue's limit, link rule and official source, checked on `VENUES_CHECKED`.
When a call for papers changes, update the entry, its source and the date together, and keep
`tests/links.test.js` passing. Do not add a venue without an official page that states its rule.

## Staying in sync with OpenReview

`npm run check-upstream` diffs the openreview-web excerpts the page mirrors against
`upstream/openreview-web.json`. When it reports a change: update the page **and**
`tests/lib/pipeline.js` (the independent reference implementation), bump CDN URLs and
`devDependencies` together, run `npm test`, then `npm run check-upstream -- --update`.
Exit codes: 0 nothing changed, 1 something changed, 2 the check itself failed (network, rate
limit, a moved file or marker, an unreadable snapshot; it never overwrites one without `--update`).

## Browser behavior

`npm test` runs in Node and cannot see the DOM section. After touching it, run
`npm run smoke`: it drives the installed Chrome/Edge headlessly (DevTools protocol, no
dependencies) and checks Fix all + single-step undo, undoable *Clear* and *Load example*, the
status bar's TeX-error and undefined-macro counts, a fresh TeX state per preview (no duplicate
`\label` errors, deleted `\newcommand`s and `\definecolor`s forgotten), manual fixes outside Fix
all, Fix all's added-character count, the selection count, venue presets, Copy compact and Apply to
source (with undo), the compact chip state, compaction switches across a reload, jumping to a hazard on a
long soft-wrapped line, refusing a stale one-click fix, draft persistence across a reload (also
with a stubbed asynchronous `window.storage`: keystrokes before a reload, a draft saved elsewhere,
leaving before the restore), `/images/` attributes, the theme toggle, and that no page errors
were thrown. Add a check there for any new browser-only behavior.

Still by eye: zoom and editor-size controls, dark-mode colors, the layout below 920 px width.
