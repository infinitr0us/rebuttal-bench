# Engineering notes

Read by coding agents (Codex, Claude Code via `CLAUDE.md`) and human contributors alike.
User-facing documentation is in `README.md`; history of changes in `CHANGELOG.md`.

## Ground rules

- **One self-contained HTML file, no build step.** `rebuttal-bench.html` must keep working when
  opened from disk or shared as a single file. (`index.html` only redirects the GitHub Pages
  site root to it; `.nojekyll` makes Pages serve the files as they are.) Libraries come only from cdnjs / jsDelivr, pinned
  to exact versions that must equal the `devDependencies` in `package.json` (a test enforces it).
- **Match the surrounding style**: ES5 (`var`, `function`, no arrow functions or modules) in the
  page, 2-space indent, LF line endings (`.gitattributes`), comments that explain *why*.
- **`npm test` must pass before every commit**, and `npm run smoke` too when the DOM section
  changed. Keep commits small and focused.
- Both accept `RB_PAGE=<file>` to run against another copy of the page, e.g. an old version
  from git (`git show cfb4202:rebuttal-bench_v2.html > old.html`), to confirm a new test fails
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

## Table import

`importTable(text, options)` lives in the pure section after `fixAllText`. It recognizes
LaTeX, TSV and quoted CSV. It returns `null` for unrecognized input, or Markdown, the detected
format and warnings with one-based input line numbers. Flatten spans and multiple header rows
with a warning. Preserve the cell contents through both GFM pipe splitting and inline parsing.
Run Fix all before measuring column padding. `tests/table-import.test.js` checks the exact
source in both layouts, sanitized cell contents and the TeX that reaches MathJax.

The dialog shares the source preview's renderer and MathJax queue. Capture the original
selection for insertion. A direct paste stays native and its conversion offer refers to the
exact pasted range and draft. Use `setSourceText` so one undo restores the text.

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
- `analyze(src, opts)` reads the comment **as posted**: OpenReview trims a textarea before it
  posts it (`constructEdit` in `client/view-v2.js`, watched by `npm run check-upstream`), so
  `analyze` runs `analyzeText` on the trimmed text and moves every offset (hazards, edits,
  spans) back into the editor's text. The preview renders `ta.value.trim()`, and the reference
  `renderLikeOpenReview` trims too. Check 16 (in `analyze`) reports leading whitespace whose
  removal changes the rendered comment (`postedStartChanges`, compared with `visibleHtml`).
- `analyzeText(src, opts)` — the checks, numbered in the source. Each returns hazards
  `{sev, title, detail(HTML), start, end, fix, math}`; a fix is a list of edits carrying `was`
  (the text they expect), so stale fixes are refused; `math` marks checks 1–7, the ones about
  Markdown damaging TeX. Check 4 also marks formulas inline Markdown cuts apart (`sp.cut`).
  Checks 9–14 report what OpenReview shows as typed (raw HTML, HTML comments, external images,
  footnotes, h4–h6, LaTeX outside math); check 15 reports links under `opts.venue`'s rule (an
  id from `VENUES`; only the page passes it, so Fix all and compaction never see venue hazards).
  Check 17 reports placeholders in visible text only (not in code, link destinations and
  definitions, image syntax, dropped cells or HTML comments), each pattern limited to where it
  is unmistakable (no `??` in code, no `XXX` in math); check 18 invisible characters and
  ligatures, one card each, with a manual fix for all of them.
- `texProblemIssues(src, spans, reports, issues, {stale, analyze})` turns what MathJax reported
  after the last typeset (`texProblems()` in the DOM section: `{tex, undef, errors}` per formula,
  in document order) into cards. Formulas cut apart by inline Markdown are skipped (MathJax never
  sees them whole). Reports and formulas are aligned in order by TeX (`sameTeX`: up to whitespace
  and named character references), passing over formulas MathJax never saw (math in an image's
  attributes) and reports the analyzer has no formula for. Every TeX error gets a card; one that
  shares its formula with a `math` card says so. Views are built on the posted text.
- A macro card's fix (from `TEX_SUBSTITUTES`, Markdown-neutral) exists only for reports of
  exactly the editor's text (`stale` false: the page tracks `texReportsFor`), a certain pairing,
  and when every word it rewrites is a use MathJax reported (not a `\label` key, `\verb` text, a
  comment or a macro's expansion). It is **decided when clicked**: `fix.check(compile)` tries the
  plain replacement, then one in braces, and returns the first whose comment keeps its Markdown
  structure and hazards (`holds`, analyzed with the page's `analyze` options) and, compiled by
  `compileFormulas` (the page's isolated `compactMathML`: ordered MathML from a fresh TeX state),
  reports neither the macro nor a new error or undefined macro anywhere, with every other
  formula's MathML (`\ref` included) unchanged. `applyIssueFix` applies what it returns, or
  refuses. A macro the comment defines at the top level of a formula from its first use on gets
  advice, never a rewrite. `fixAllText` never sees these cards.
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

- **A trick only proposes; the check decides.** Compare each candidate to the text the trick
  started from, both as typed and trimmed (OpenReview trims on posting). The default check
  requires identical sanitized HTML. All checks require `analyze` to report no more hazards
  of any kind (severity and title) than the original. Failing batches are bisected. Do not weaken this to
  make a trick "work": a candidate the check rejects is reported as left alone (`kept`), which
  is fine; `skipped` counts unchecked candidates when the limits run out or MathML is unavailable.
- `ws: true` tricks (whitespace only) compare `collapseWhitespace(html)` (text outside `<pre>`;
  tags and attribute values untouched) and require `mathJaxInputs(html)`, every formula MathJax
  will find in the rendered HTML, to stay identical. They also stay out of math, code, inline
  HTML and link syntax. This relies on the note text being `white-space: normal` (`_mixins.scss`,
  watched by `npm run check-upstream`).
- The page passes time limits (`{checks, ms}`): a short slice while typing, more on a click.
  Results are safe whenever the limit hits; keep it that way.
- `math: true` tricks compare exact sanitized HTML between every pair of formula boundaries
  and exact serialized MathML for the ordered formulas in both views. Delimiter kind and
  display mode must match. Only the display-wrapper trick can change `$$` to the identical
  bare environment. Pass `mathml(formulas, expired)` in the limits object. It returns one
  string per `{tex, display, kind}` in order, starting with a fresh TeX state, or `null`
  when unavailable. Unchecked edits count as skipped. Cache whole ordered inputs unless
  every formula is known to be independent of TeX state. The page skips comparison if TeX
  executes `\unicode` or `\require`, whose state is shared across input jaxes. `tests/lib/mathml.js` also checks
  the result independently with MathJax's DOM finder.
- `look: true` tricks change the rendering on purpose and stay off by default. Their edits are
  checked with placeholders (`sameButSwapped`): old and new text must each render exactly as a
  neutral placeholder at that spot. `e.shown` is what the page shows for the old text when that
  differs from the source (Markdown escapes).
- `findX` functions must not throw on any input and should avoid proposing edits the check
  will reject anyway (each rejection costs renders; the budget is 400 checks).
- Add cases to `tests/compact.test.js` in both directions, as for fixes.

## Drafts and storage

Several windows of the page, several devices sharing an asynchronous store, a slow or failing store
and a reload at any moment must never lose or mix up a draft. Two Codex reviews probed this
(`reviews/2026-11-21/codex-review-drafts`, `codex-recheck-drafts`: 17 storage scenarios, 32 edge
cases, Chrome probes); keep their rules:

- **Keys.** Each draft's text has its own key: the first draft (`d1`) keeps `rebuttal-bench-draft`,
  the key every older version used, so existing drafts carry over; the others use
  `rebuttal-bench-draft-<id>` with a **random id** (`newDraftId`). `rebuttal-bench-drafts` holds the
  list `{active, list: [{id, name, at}], gone, saved}`: `at` is when an entry was created, renamed or
  re-created, `gone` when a draft was deleted (a deletion wins over every entry not newer than it),
  `saved` when this copy and its choice of open draft were saved.
- **The list is merged, never overwritten** (`mergeDraftMeta`, pure, `tests/drafts.test.js`): with
  the latest local copy before every write (`saveDraftMeta`, `deleteDraft`, which also refuses to
  delete the last draft), with the store's copy during the write (`remoteWrite` with a merge
  function: read, merge, write), with another window's copy on a `storage` event, and at boot. A
  live window whose open draft was deleted elsewhere re-creates it with its text
  (`adoptDraftMeta`); a cold boot applies deletions. At boot the open draft comes from the newer
  copy (`saved`). `recoverDraftBodies` gives a tab back to any exactly keyed, nonempty local body
  missing from the list, and to an answer an older version wrote under the first draft's key after
  that draft was deleted.
- **One autosave logic for every key**, the list included. Remote writes and deletions of a key go
  one at a time, in order, latest value only (`remoteWrite`/`pumpRemote`). Whenever the store may
  lack the latest value (leaving, switching, a failed or unfinished write) the local copy is marked
  pending (`markPending`: the last confirmed base plus the values still on their way, so one of ours
  landing after the page is gone is not taken for another device's edit). `loadDraft` decides when
  the store answers, not when the read starts, and reports a read that failed with no local copy
  (`failed`). Deletions are remembered (`<key>:deleting`) until the store confirms them and are
  retried at the next start (`retryDeletes`).
- **Only a real edit is written.** `savedText` is what this window last saved or loaded for the open
  draft (it advances only once a local write succeeded); switching away, leaving the page, the
  autosave and Clear write only when the editor differs from it, so an undone edit or a Clear on a
  blank draft cannot put a stale copy over a newer one. The built-in example counts as saved. A
  local write refused for lack of space is retried on switching, deleting and leaving
  (`retryLocalWrites`); a remote write is marked pending as soon as it is queued. Delete asks
  whenever the editor or the stored copy holds text, and every control that changes the text needs
  a writable editor (not a draft still loading). Opening a draft reads the local copy, which every window
  of the browser keeps current; a draft whose text has not been read yet (or could not be) is read
  first, with the editor locked (`bodyState`, `startBodyLoad`, `unlockDraft`, at most 8 s).
- **Startup.** Nothing is typed, saved or flushed before the open draft is restored (`draftReady`):
  the editor is read-only, `setSourceText`, Clear, Load example, the input handler, the autosave and
  `flushDraft` do nothing. Only the open draft is waited for; the others load in the background,
  each bound to its own id. A store that never answers is given up after 8 s (this browser's copies
  are used). Every call into the store is guarded against synchronous throws (`remoteRead`).
- **localStorage**: readable is probed apart from writable (`canLocalRead`), and a key whose last
  local write failed (quota) is read from memory until a write succeeds (`memNewer`).
- A draft switch puts in a **fresh textarea** (`freshEditor`) inside the tab panel (`#draftPanel`):
  Chrome replays its undo history into whatever the textarea holds, so a plain value assignment
  would let Ctrl+Z pour one draft's edits into another. Therefore **attach editor listeners with
  `onEditor(type, fn)`**, never `ta.addEventListener`, and read `ta` at call time.
- Known limits: two windows typing in *the same* draft at the same time still means the last save
  wins; a draft deleted in one window comes back if another window has it open; with the
  asynchronous store, a list write that stalls while another device adds a draft can drop that
  entry until the other device's next save or start restores it (the text itself is kept; without
  store revisions this lost update cannot be excluded).
- **History** (earlier versions) is a safety net that must never cost a draft. Each draft's versions
  live under `HISTORY_PREFIX + id` in localStorage only (never the asynchronous store), newest
  first, capped by `capHistory` (pure: `parseHistory`, `historyAdd`, `historyDue`, `mergeHistory`,
  `tests/history.test.js`). `keepVersion` runs before every bulk change of the editor (Fix all,
  Apply to source, Clear, Load example, a restore; none on a read-only draft) and `saveDraftNow`
  keeps one every `HISTORY_EVERY`. A history write that does not fit keeps fewer versions there
  and the rest in memory (`historyUnsaved`), written by `retryHistory` after a draft save. Only a
  quota error on a draft key (body, list, pending or deleting mark) drops all history and retries
  once (`fallbackSet` → `isQuotaError`, `dropAllHistory`); preferences never do. Deleting a draft
  deletes its history, here and, through tombstones, in other windows and after a boot
  (`pruneHistory`). Two windows adding versions of one draft at the same moment can lose one of
  the two versions.
- **Dialogs are modal** (`setModal`: everything behind History and Split is `inert`, so no draft
  switch or keystroke reaches the editor while one is open) and **bound to their draft**: a draft
  switch (`openDraft`) closes History, Split and Import table. `restoreVersion` refuses a version
  of another draft (`historyFor`), and refuses when another window saved newer text since this
  editor loaded it (reload first); otherwise it keeps the editor's text as a version first.
  Copy in a dialog passes its button to `copyText`, whose fallback then never selects the editor.
  `renderHistory` keeps the focus on the same version through a redraw.
- **Files**: `knownDraftText(id)` is a draft's text or null while it loads or was never read
  (`bodyKnown`: set by a successful read, `createDraft` or a successful save; not by the 8 s
  watchdog unless this browser has a copy). An edited editor is the author's text; an unchanged one
  yields to a newer copy another window saved; the example stands for an empty draft. Export
  writes `draftsFile` with every known text and names the others before leaving them out;
  Download refuses an unknown text. Import reads a `.json` export (`readDraftsFile`, no limit on
  the number of drafts, format version 1) or any other text file as one literal draft, decoded
  strictly as UTF-8 or UTF-16 with one BOM (`decodeTextFile`), and is dropped when the open draft
  or a dialog changed while the file was read (`importFor`). It takes in other windows' drafts,
  saves the open draft through `secureOpenDraft` (the ordinary save; its body and pending mark
  must both be stored), and `importPlan` adds only texts no known draft has (an unknown text
  keeps only its name), under names no draft has. `createDraft` stores a body before giving it a
  tab and returns null when it does not fit; `commitNewDrafts` then stores the list and, when
  that does not fit, takes the new drafts out again (`discardNewDrafts`, with tombstones).
  Split's "Open the parts as drafts" does the same, all parts or none. A failed write of the open
  draft is retried with the editor's current text (`retryLocalWrites`), so an undone edit cannot
  come back. Nothing is ever replaced or merged into a draft.
- Known limits of Files: two windows importing the same file at the same instant can each add it
  (two identical drafts, nothing lost); a browser that lets the page read local storage but not
  write it, while an asynchronous store works, reports no space for an import.

## Splitting

`splitComment(text, limit, {label})` (pure) cuts only where a comment can end: between top-level
blocks, and inside a block too long for one part between table rows (header and delimiter row
repeated), list items (each piece starts with its own item, so an ordered list keeps its numbers)
or sentences (never at a position inside a formula, code, a link or inline HTML). It never drops
or reorders content (`tests/split.test.js` checks the text round-trips), appends each link
reference definition to the parts that use it, and reports macros and labels used across parts,
because OpenReview typesets each comment from a fresh TeX state.

## Venue presets

`VENUES` holds each venue's limit, link rule, whether several comments are allowed (`parts`) and official source, checked on `VENUES_CHECKED`.
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
status bar's TeX-error and undefined-macro counts and their hazard cards (a macro fixed from its
card, with undo; no fix before the typeset of the current text; a card that follows its formula
after an edit; red `\verb` text not taken for a macro; Fix all's message while MathJax catches
up), the preview of the trimmed comment, History (a version before Fix all, Restore with undo,
deleted with its draft, dropped when a draft needs the space), Export and Import, a fresh TeX
state per preview (no duplicate `\label` errors, deleted `\newcommand`s, `\definecolor`s and
`\DeclarePairedDelimiter`s forgotten), drafts (a fresh one, switching, undo isolation, rename and delete,
across a reload and with a slow store), manual fixes outside Fix
all, Fix all's added-character count, the selection count, venue presets, Copy compact and Apply to
source (with undo), the compact chip state, compaction switches across a reload, jumping to a hazard on a
long soft-wrapped line, refusing a stale one-click fix, draft persistence across a reload (also
with a stubbed asynchronous `window.storage`: keystrokes before a reload, a draft saved elsewhere,
leaving before the restore), `/images/` attributes, the theme toggle, and that no page errors
were thrown. Add a check there for any new browser-only behavior.

Still by eye: zoom and editor-size controls, dark-mode colors, the layout below 920 px width.
