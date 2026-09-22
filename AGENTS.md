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
     plus the pure Fix-all engine (`fixAllText`). **Must stay DOM-free**: the tests run this
     section in a Node VM with only `window.marked` available.
   - `/* ================= dom wiring ================= */` — rendering, persistence, UI events.

## The analyzer's model

- `collectMarkedRanges` locates Marked tokens in the source (with a prefix-tolerant fallback for
  list/quote content) and records *leaf blocks*, including GFM table cells split the way Marked
  splits them.
- `buildRegions` — the strings MathJax searches: leaf blocks minus code, split at blank lines.
- `mathJaxView` — the text MathJax receives from a region after Markdown's escape handling,
  with a source position for every character.
- `mjFind` / `mjFindEnd` — a **faithful port of MathJax 3.2.2 FindTeX** (`$$` before `$` at the
  same position, closers only at brace depth 0, `\X` skipped as a unit, processEscapes,
  processEnvironments). Do not "improve" it; it must behave exactly like MathJax.
  `npm run fuzz` must report 0 mismatches after any change here or in the view.
- `scanMath` — real spans (what MathJax typesets) plus *recovered* spans: leftover delimiters
  paired across a boundary purely to explain breakage (`why`: blank, block, table, code,
  braces). Recovered spans are never counted as math.
- `analyze` — the checks, numbered in the source. Each returns hazards
  `{sev, title, detail(HTML), start, end, fix}`; a fix is a list of edits carrying `was`
  (the text they expect), so stale fixes are refused.

## Autofix rules

- Fix all runs unattended: **a fix must never change input that already renders correctly.**
  If a pattern is ambiguous (e.g. `$5$` vs. currency), warn without a fix.
- Every fix touching one `$` goes through `literalDollar`, so Fix all can't stack two edits on the
  same dollar sign.
- Add regression cases for both the broken input and nearby correct input (`fixed: null`).

## Staying in sync with OpenReview

`npm run check-upstream` diffs the openreview-web excerpts the page mirrors against
`upstream/openreview-web.json`. When it reports a change: update the page **and**
`tests/lib/pipeline.js` (the independent reference implementation), bump CDN URLs and
`devDependencies` together, run `npm test`, then `npm run check-upstream -- --update`.

## Browser behavior

`npm test` runs in Node and cannot see the DOM section. After touching it, run
`npm run smoke`: it drives the installed Chrome/Edge headlessly (DevTools protocol, no
dependencies) and checks Fix all + single-step undo, undoable *Clear*, the status bar's TeX-error
and undefined-macro counts, jumping to a hazard on a long soft-wrapped line, draft persistence
across a reload, the theme toggle, and that no page errors were thrown. Add a check there for any
new browser-only behavior.

Still by eye: zoom and editor-size controls, dark-mode colors, the layout below 920 px width.
