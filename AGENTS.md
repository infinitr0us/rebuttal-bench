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

1. `<head>` script: the MathJax configuration, mirroring openreview-web's `lib/mathjax-config.js`.
2. `<style>`: light tokens on `:root`, dark overrides on `html[data-theme="dark"]`; the
   `.paper` rules mirror OpenReview's note styles value for value.
3. Markup: header controls, stats bar, editor + hazards + cheat sheet, preview, footer.
4. Main `<script>`, split by two banner comments that the tests rely on (keep them verbatim):
   - `/* ================= pure analysis ================= */`: everything the analyzer needs,
     plus the pure Fix-all engine (`fixAllText`), the compaction engine (`compactText`) and the
     venue presets (`VENUES`). **Must stay DOM-free**: the tests run this section in a Node VM
     with only `window.marked` available.
   - `/* ================= dom wiring ================= */`: rendering, persistence, UI events.

## Table import

`importTable(text, options)` lives in the pure section after `fixAllText`. It recognizes
LaTeX, TSV and quoted CSV. It returns `null` for unrecognized input, or Markdown, the detected
format and warnings with one-based input line numbers. Flatten spans and multiple header rows
with a warning. Preserve the cell contents through both GFM pipe splitting and inline parsing.
Run Fix all before measuring column padding. `tests/table-import.test.js` checks the exact
source in both layouts, sanitized cell contents and the TeX that reaches MathJax.

`readHtmlTable(doc)` takes a parsed document (DOMParser on the page, jsdom in tests) and
reads the first table with at least two rows and columns. `importHtmlTable(doc, options)` and
the text importer share `tableMarkdown`. HTML warnings use one-based table rows. Place each
merged cell's text at its top left. Read inline styles and attributes only. Google Docs wraps
the fragment in a normal-weight `b` and turns bold on again in spans. Word nests unstyled
spans inside bold tags. Excel can supply styles through classes in a separate stylesheet,
so its class-only cells use plain formatting and the usual numeric-column alignment.

The dialog shares the source preview's renderer and MathJax queue. Capture the original
selection for insertion. A direct paste stays native and its conversion offer refers to the
exact pasted range and draft. Use `setSourceText` so one undo restores the text.
Keep the clipboard grid with its plain text. Once the dialog textarea differs from that
text, discard the grid and use the regular text importer.

## The analyzer's model

- `collectMarkedRanges` locates Marked tokens in the source (with a prefix-tolerant fallback for
  list/quote content, and `\|`-tolerant matching inside table cells, where GFM unescapes the
  pipe first) and records *leaf blocks*, including GFM table cells split the way Marked splits
  them. It also records link syntax that is not text (brackets, destinations), which is masked
  like code. A code span it cannot locate masks its whole container.
- `buildRegions`: the strings MathJax searches: leaf blocks minus code, split at blank lines
  (except HTML blocks, which OpenReview shows as one run of text).
- `mathJaxView`: the text MathJax receives from a region after Markdown's escape handling and
  the browser's decoding of character references (an HTML block: as typed), with a source
  position for every character.
- `mjFind` / `mjFindEnd`: a **faithful port of MathJax 3.2.2 FindTeX** (`$$` before `$` at the
  same position, closers only at brace depth 0, `\X` skipped as a unit, processEscapes,
  processEnvironments, processRefs). Do not "improve" it; it must behave exactly like MathJax.
  Diagnostics (stray closers, stray `\end`) must not change where the scan resumes.
  `npm run fuzz` must report 0 mismatches after any change here or in the view.
- `scanMath`: real spans (what MathJax typesets) plus *recovered* spans: leftover delimiters
  paired across a boundary purely to explain breakage (`why`: blank, block, table, code,
  braces). Recovered spans are never counted as math.
- `analyze(src, opts)` reads the comment **as posted**: OpenReview trims a textarea before it
  posts it (`constructEdit` in `client/view-v2.js`, watched by `npm run check-upstream`), so
  `analyze` runs `analyzeText` on the trimmed text and moves every offset (hazards, edits,
  spans) back into the editor's text. The preview renders `ta.value.trim()`, and the reference
  `renderLikeOpenReview` trims too. Check 16 (in `analyze`) reports leading whitespace whose
  removal changes the rendered comment (`postedStartChanges`, compared with `visibleHtml`).
- `analyzeText(src, opts)`: the checks, numbered in the source. Each returns hazards
  `{sev, title, detail(HTML), start, end, fix, math}`; a fix is a list of edits carrying `was`
  (the text they expect), so stale fixes are refused; `math` marks checks 1–7, the ones about
  Markdown damaging TeX. Check 4 also marks formulas inline Markdown cuts apart (`sp.cut`).
  Checks 9–14 report what OpenReview shows as typed (raw HTML, HTML comments, external images,
  footnotes, h4–h6, LaTeX outside math); check 15 reports links under `opts.venue`'s rule (an
  id from `VENUES`; only the page passes it, so Fix all and compaction never see venue hazards).
  Check 17 reports placeholders in visible text only (not in code, link destinations and
  definitions, image syntax, dropped cells or HTML comments), each pattern limited to where it
  is unmistakable (no `??` in code, no `XXX` in math); check 18 invisible characters and
  ligatures, one card each, with a manual fix for all of them. Check 19 reports commented-out
  LaTeX: a prose line starting with a single `%` and then a LaTeX command, a table row or a note
  to self; check 20 a chat assistant's citation markers (private-use delimited entities,
  `oaicite`, `【4†source】`, `oai_citation` link labels), its address to the user ("a revised
  version of your rebuttal") and its self-description. Both use check 17's mask and warn. Their
  manual fixes delete a whole line by the same line breaks the patterns use (LF, CR, U+2028,
  U+2029: `lineSpan`), and a marker inside a line without joining words or breaking a list or
  heading (`cutOut`); an opening deletes only itself when the author's text follows on its line.
  A Codex review ran a broader version on 310 real author responses and found 49 false cards
  (`reviews/2026-11-27/codex-review-310`, the corpus git-ignored): authors write `%%%` headings,
  `% of runs`, "I hope this helps", "Sure! Here are the results:", `[Authors]` signatures.
  `tests/leftovers.test.js` holds those shapes; widen a pattern only with such a near-miss case
  and a rerun of that corpus.
- Check 21 matches the author's anonymity word list (`identityTerms` parses the preference;
  `opts.identity`, passed only by the page through `pageAnalyzeOptions()` beside `opts.venue`, so
  Fix all, compaction and `splitComment` never see it) across the **whole** posted text, code,
  math, link syntax and HTML comments included: OpenReview e-mails the source as typed. It is
  precise by construction (the author's own words, case-insensitive, `WORD_CHAR` boundaries
  where a term starts or ends with a letter or digit, a space matching blanks with at most one
  line break, no-break spaces included); keep it free of guesses about what a name is. The
  longer of two overlapping matches wins, a draft shows at most 30 cards (`identityCount` has
  them all), and there is no fix. The list's textarea lives in a same-origin `srcdoc` iframe,
  like the review box, so its typing never enters the editor's undo history.
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
- "Correctly" means what the author meant, which the source often shows: a field audit on
  1,300 real author responses (`reviews/2026-11-27/codex-field-audit`, git-ignored) found Fix
  all damaging 10 of the 126 it changed, by repairing escapes that already gave MathJax the
  intended TeX. `slashedDollar`, `meantAsFormula` and `shieldMeant` in `analyzeText` hold what
  it taught: both signs escaped around TeX are a formula; bars composed into `||`, `\&` in an
  alignment and grouping braces (`^\{`, a `\}` closing a bare `{`) are meant as typed; a pair
  of prices or escaped signs that emphasis "cuts" was never a formula. `tests/field-fixall.test.js`
  holds each case and its near miss, compared with the independent MathJax oracle.
- **Measure every change to a check on real text before review**: `npm run corpus --
  <corpus.jsonl> --baseline <summary.json>` lists the cards that appeared and disappeared per
  text. Use the audit's corpus with its `summary.json` and the 310 responses of
  `reviews/2026-11-27/codex-review-310` (id field `note`; make a baseline with `RB_PAGE` set to
  the page before the change). Read every card that appears or disappears, and replay Fix all
  with `recheck-fixall.mjs` in the audit's folder.

## Formatted prose paste

`htmlToMarkdown(doc, options)` (pure, `tests/paste.test.js`) reads a parsed clipboard fragment
from Google Docs, Word or a web page and shares the table importer's emphasis and grid rendering
(`readHtmlTable`'s quirks: Docs' normal-weight `b`, Word's `mso-` lists). It escapes what would
become Markdown but never `$` or a backslash, since authors write TeX in their documents. The
editor asks for `keepGrid`, so a paste that is only a table still opens the table dialog, and an
explicit HTML list wins over the tab-separated heuristic (Word puts tabs after list markers). The
offer is bound to the captured draft, source and range, like the table offer, and applies with
`setSourceText` for one undo. Tests check the exact Markdown, the rendered HTML and the TeX that
reaches MathJax. Fixed after the 3.11 review (`reviews/2026-11-27/codex-review-311`, with a real
Word clipboard fragment): superscripts and subscripts (`sup`, `sub`, `vertical-align`) go through
the table importer's `readHtmlScript`, so `10<sup>-3</sup>` stays an exponent; spaces are kept in
`pre`, `pre-wrap` and monospace runs (`\verb|A  B|`); a paste counts as a LaTeX table only when
its text starts with the environment (`looksLikeTablePaste`), not when a sentence holds an
`array`; a pasted block (table, list, heading, quote, code) is set apart from the draft text
next to it by a blank line (`placeProsePaste`); and a table keeps an equation image's alt text,
with the media warning, whether pasted alone or inside prose.

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
  autosave and Clear write only when the editor differs from it or memory holds an edit refused for
  space (`refusedEdit`), so an undone edit or a Clear on a blank draft cannot put a stale copy over
  a newer one, and an undone refused edit is not retried later. The built-in example counts as saved. A
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
- **Back from the back/forward cache**, a page got no storage events while it was away: `pageshow`
  with `persisted` takes in the list as localStorage holds it (`takeInList`, the storage event's
  handler, merged with this window's list), so its open draft deleted meanwhile is re-created like
  in a live window, not saved under a deleted key. Chrome may still deliver the queued events
  afterwards, so `takeInList` merges every event's list with the one stored now.
- **Re-creating the open draft** (`adoptDraftMeta` → `recreateOpenDraft` → `recreateBody`)
  happens only when the deletion is newer than this window's entry, and never writes over a
  different text stored under the key since this window last saved or loaded it (`storedValue`):
  that text is kept, and this window's stays in its editor. This browser's copy is written at
  once, as in 3.5.0, so a switch right after finds it. With the asynchronous store that copy is
  pending, and the store gets the text only after a **successful** read shows it holds no newer
  text from another device and, just before the write, the local copy is still this one (a window
  that saved meanwhile wins). Keep both steps: an asynchronous write alone lost the text when the
  author switched drafts during the read, and a write without the second check sent an old text
  over a newer one (`reviews/2026-11-25/codex-recheck-storage36`). The store's merge in
  `saveDraftMeta` can revive a draft too (deleted on another device, or renamed here since): it
  reports which one, and `recreateBody` sends its text the same way, even after a switch.
- **History** (earlier versions) is a safety net that must never cost a draft, and is best effort.
  Each draft's versions live under `HISTORY_PREFIX + id` in localStorage only (never the
  asynchronous store), newest first, capped per draft by `capHistory` and for all drafts together
  by `HISTORY_BUDGET`, characters of stored JSON, well under any browser's quota (pure:
  `parseHistory`, `historyAdd`, `historyDue`, `historySize`, `fitHistory`, `tests/history.test.js`).
  `keepVersion` runs before every bulk change of the editor (Fix all, Apply to source, Replace all, Clear, Load
  example, a restore; none on a read-only draft) and `saveDraftNow`, every `HISTORY_EVERY`, keeps
  the text its save replaces (`savedText`; not the startup example, stored nowhere).
  The storage rules are Fable's model A (`reviews/2026-11-21/fable-history-advice.md`), which in
  3.6 replaced the quota machinery of 3.5.0 (versions held in memory and written back later, which
  nine reviews kept finding new ways to lose): **nothing waits in memory to be written later.**
  `writeHistory` fits all drafts' versions into the budget, the oldest of any draft going first
  (`fitHistory`), and when storage refuses the write, frees about what the write adds, oldest first
  again, twice as much each time, until it fits or no version is left. A draft's write refused for
  lack of space (body, list, pending or deleting mark: `fallbackSet` → `isQuotaError`) makes room
  the same way (`setMakingRoom`), and as a last resort, like 3.5.0, removes every History key
  (also one that cannot be read or shortened: a browser over its quota refuses a shorter value but
  not a removal) and tries once more; preferences and imported texts never give up a version. The
  budget is approximate (one character per list and the key names are not counted) and trimming
  is best effort; `fitHistory` expects each list newest first, as `parseHistory` returns it.
  Without readable localStorage, versions stay in memory with the per-draft caps only. Do not bring
  back a write-back of versions that did not fit. Deleting a draft deletes its history, here and,
  through tombstones, in other windows and after a boot (`pruneHistory`, which first merges this
  window's list with both the in-memory and the stored copy: `storedValue`); a window keeps the
  versions of its open draft deleted elsewhere, since it re-creates the draft. Two windows writing
  versions at the same moment (of one draft, or one trimming a draft the other adds to) can lose
  one version.
- **Dialogs are modal** (`setModal`: everything behind History and Split is `inert`, so no draft
  switch or keystroke reaches the editor while one is open) and **bound to their draft**: a draft
  switch (`openDraft`) closes History, Split and Import table and drops an offer to convert a
  pasted table; the table dialog and the offer also check their draft before they insert. Copy in
  a dialog passes its button to `copyText`, whose fallback then never selects the editor.
  `renderHistory` keeps the focus on the same version.
- **Restore writes like typing**, so `restoreVersion` refuses unless this window has the draft's
  latest text: a version of the open draft (`historyFor`), its text read completely (`bodyKnown`,
  `bodyState` ready: not the example or an old copy after a read that failed), the copy
  localStorage holds (`storedValue`, not this window's copy in memory) equal to the editor or
  `savedText`, as must what memory holds in front of it (a newer read that did not fit), and with
  the asynchronous store a fresh read equal to the last confirmed value, the editor or
  `savedText` (another device). The restore belongs to the click (`restoreSeq`, `editSeq`, which
  `setSourceText` advances too, and the editor's text then): an edit, an undo, another restore or
  a draft switch before it applies drops it, and every
  condition is checked again just before writing. When this window holds text it could not
  save, the refusal says to copy it before closing or reloading (the page-exit retry, a limit
  shared with 3.4.0, may write it over the newer version).
- **Export only reads**: it never adopts or saves the list. `knownDraftText(id)` is a draft's text
  or null while it loads or was never read (`bodyKnown`: set by a successful read, `createDraft`, a
  save or a switch's flush by this window, which also counts while an older read is outstanding;
  the 8 s watchdog only when this browser has a copy; while a known draft is read again, its
  stored copy). An edited editor (`ta.value !== savedText`) is the author's text; an unchanged one
  yields to this window's newest copy, including a newer text read from the store that did not
  fit here (`readCache`), but not an edit refused for space and undone since; the example stands
  for an empty draft (after such an undo: when localStorage never held the draft).
  Export all merges, in a private copy, this window's list with the stored one (drafts another
  window just added), writes `draftsFile` with every known text and names the others before
  leaving them out; Download refuses an unknown text.
- **Compare and Print only read.** `diffWords(a, b, details)` (pure, `tests/diff.test.js`) keeps
  both texts exactly (the `same` and `del` runs rebuild `a`, `same` and `ins` rebuild `b`); it
  bounds the word-level LCS, then retries by line, then falls back to one replacement, and
  `details.mode` tells the view when its counts cover whole lines or texts. The History version
  picker stays bound to the versions shown when Compare opened. Print reads `knownDraftText`
  with Export's private list merge, renders through the preview's queue with a fresh TeX state
  per comment, waits for the typeset before `window.print()`, and removes its copy on
  `afterprint`; closing History or switching drafts cancels a pending print. MathJax updates
  `\eqref` across one document, so Print takes the preview's math out of MathJax's list before
  it typesets, clears each printed comment's math right after its typeset (two drafts may both
  define `eq:main`), and re-renders the preview when printing ends.
- **Import only adds** (`importDrafts`; pure: `readDraftsFile`, `importPlan`). Each draft of the
  file whose text no draft known here has (`knownDraftText`, after taking in the stored list)
  becomes a new tab under a name no draft has. It never replaces, changes or opens a draft and
  never switches away from the open one, so it flushes nothing, and it is bound to no draft: a
  file read that ends after a switch still only adds tabs. A text is written to localStorage
  before its draft is listed (`newDraft(name, text, true)`), without making room: a draft that
  does not fit is left out and named, and no version is given up for its text, since the file
  still holds it (the list written afterwards, and the pending marks, follow the ordinary rules).
  The list is saved at once, as for Split. Without localStorage the store is the only copy: the
  first message says to keep the file, and a second one reports what the store confirmed, from
  each write's own answer (the texts' and the list's). Holding the list back until the texts were
  stored was tried in 3.6 and reverted: any other list save published it anyway, the late save
  could undo another window's choice of open draft, and its message misjudged edited drafts. The 3.5.0 design made a multi-draft import all-or-nothing, with
  the open draft secured first, a commit and a rollback, and a switch to the first new draft; three
  reviews kept finding ways for it to lose text (`reviews/2026-11-21/codex-final-history`). Do not
  bring back a rollback or a switch.
- Known limits shared with 3.4.0, found by the History reviews: a refused write of the list or of
  a draft is retried with this window's old value (`retryLocalWrites`), which can write over a
  newer one another window saved meanwhile, or bring back an edit undone after the refusal; a
  pending mark that does not fit can let a reload choose the store's older text over a saved
  local edit. Fixing them needs store revisions, or writes staged until a whole operation is
  stored. Likewise for Export: a window whose
  last write or read of a draft did not fit exports its own copy, not a newer one another window
  saved since (a baseline of what each window last saw was tried and reviewed twice, and kept
  missing paths: `reviews/2026-11-21/codex-confirm3-history`). A draft deleted in one window that
  comes back because another window still has it open comes back without its versions (the
  deletion removed them; `codex-final2-history`). A window or device that has not yet seen
  another's import of the same file (at the same moment, or with an older list) adds its drafts
  again. A list that names new or revived drafts (Import, Split's *Open the parts as drafts*, a
  draft brought back) is sent beside their texts, so a device that reads the store in the moment
  a text is still on its way, or after its write failed, sees that tab blank (since 3.3.0); typing
  there can then replace the text when it lands. Each text is queued before its list, so with a
  store that answers in order this needs a text write slower than the list's. The importing
  browser keeps its copies, and the file still holds them. Re-creating reads the store first, so
  only a text another device writes there during that read can still be overwritten (reviews:
  `reviews/2026-11-25/codex-review-storage36`, `codex-recheck-storage36`).

## Splitting

`splitComment(text, limit, {label})` (pure) cuts only where a comment can end: between top-level
blocks, and inside a block too long for one part between table rows (header and delimiter row
repeated), list items (each piece starts with its own item, so an ordered list keeps its numbers)
or sentences (never at a position inside a formula, code, a link or inline HTML). It never drops
or reorders content (`tests/split.test.js` checks the text round-trips), appends each link
reference definition to the parts that use it, and reports macros and labels used across parts,
because OpenReview typesets each comment from a fresh TeX state.

## Sections, wording and editing aids

- `commentSections(text)` (pure, `tests/sections.test.js`) finds the parts of a draft for the
  *Sections* panel from Marked's top-level tokens only: a heading runs to the next heading of its
  level or higher, a labelled point (`sectionLabel`: bold that ends in punctuation or stands
  alone, or a point name such as `W1:`; bold followed by a parenthesis only for a point name) to
  the next part of any kind. Counts are trimmed UTF-16 lengths, as the limit counts. Bold that
  starts a sentence is no label; keep it that way. Blocks are located past link definitions
  (`locateBlock`), whose titles can repeat a paragraph's words.
- `wordingHints(text, spans)` (pure, `tests/wording.test.js`) is advice and is **never applied**,
  not even as a manual fix: a phrase can be the author's choice. It reads only the author's
  visible prose (`proseMask`: not code, math, HTML, quotes, link or image syntax, definitions;
  also code Marked's tokens could not be located, through a looser fence scan, since masking too
  much only drops a hint). Add a filler to `FILLERS` only with a shorter form that keeps the
  meaning in every context (no *with respect to*, which a derivative needs; no *whether or not*,
  which can mean regardless; *would like to* only before a courtesy verb) and a near-miss case
  in the tests.
- Both panels read the comment **as posted** (`text.trim()`, like the preview) and move their
  offsets back into the editor's text (`leadOf`).
- `blockSources(text)` (pure, `tests/editing.test.js`, which checks it against the rendered
  elements) lists each top-level block that renders an element, with its tag. A double-click in
  the preview lines it up with the preview's children by tag, then finds the n-th use of the
  word (formulas left out) or the n-th formula in that block's source, counting only what the
  preview shows: not formulas, an image's syntax and alt text, link destinations, definitions or
  a fence's info string, with word boundaries of letters and digits (`WORD_CHAR`; not `_`, which
  is emphasis, or curly quotes). OpenReview renders an HTML block as text, so it has no entry.
- Find works on the source as typed. A textarea shows no selection while the focus is elsewhere,
  so `drawFindMarks` lays the text out in `caretTop`'s twin (`prepareMirror`) and draws boxes in
  `#findMarks` over the editor; it is redrawn on scroll, input, selection, the editor's resize
  (`ResizeObserver`, moved to a fresh editor), a font change (`applyPrefs`) and after every
  analysis (a draft switch). A *Replace all* that changes nothing says so and records nothing. *Replace* goes through `execCommand('insertText')` and *Replace
  all* through `setSourceText`, so each is one undo; *Replace all* keeps a version in History.
  Ctrl+F is taken only in the editor and the find bar; elsewhere the browser's find stays.
- The editor's `spellcheck` follows `prefs.spellcheck`; a fresh editor is a clone, so it keeps it.

- `promisesIn(text, spans)` (pure, `tests/promises.test.js`) finds the sentences of visible prose
  that commit to a change of the paper (`will`) or report one (`done`), one Markdown leaf at a
  time with `proseMask`, quotes of the review left out, offsets in the editor's text (CRLF
  included). Precision comes before recall: it was tuned on 310 real author responses (181
  detections read, none wrong; `reviews/2026-11-27/codex-promises`, git-ignored). Extend a
  trigger only with a synthetic positive, a near miss and a rerun of that corpus. The panel reads
  every tab through `knownDraftText` and reuses detections while a text is unchanged; a row of
  another draft goes through `switchDraft` and selects the sentence once that draft is loaded.

## Venue presets

`VENUES` holds each venue's limit, link rule, whether several comments are allowed (`parts`) and official source, checked on `VENUES_CHECKED`.
`label` names the rules (with their year where they have one), `unit` what the limit counts and
`linksBrief` the link rule, all shown beside the counter by `renderVenueStat`; `also` lists
further pages a rule draws on. `links` is 'none', 'external' (a link into the forum is fine),
'anon' or 'any'; `noShorteners` only where shortened URLs are named and forbidden. Wording must
not claim more than the cited page says (a Codex review caught "no links" for ARR's "no
external links"). `limit: null` means the rules state no number, and the page then uses
`prefs.ownLimit`, the limit the author typed last, so one venue's limit never stays on under
another; a venue chosen before the stored preferences arrive is resolved after they do
(`limitAction`). Ids are stored in the preferences: keep them when renaming a venue.
When a call for papers changes, update the entry, its sources and the date together, and keep
`tests/links.test.js` passing. Do not add a venue without an official page that states its rule.

## Reviewer IDs across drafts

`reviewerIssues(text, self, others, spans)` (pure, `tests/reviewers.test.js`) reads the open
draft as posted against the tabs' names (`draftReviewer`: an ID-shaped word after "Reviewer", a
bare ID-shaped word with a small letter, a whole-word number). **Only what is unmistakable gets
a card**: a salutation naming another reviewer anywhere, a "Response to Reviewer X" heading or
line of its own, thanks with that reviewer as its object (and no other reviewer named with it)
in the opening or closing block; an ID that no tab spells so but one does in other capitals.
The card selects the ID alone. Mentions in passing, joint thanks, text in quotation marks within
its block, quotes, code, general tabs and comparisons across numbering schemes (ID against
number) give nothing. Two Codex reviews (`reviews/2026-11-27/codex-review-38`,
`codex-recheck-38`) found false cards in broader versions, which also checked pointers ("see our
answer to Reviewer X, Q2") and IDs no tab has; both were dropped. Their sentences are the
regression cases: widen a pattern only with a near-miss test. Pointers came back in 3.11 in that
narrow form: a cue (`see`, `cf.`, `refer to`, `as we answered in`) and "our/the
answer/response/reply to Reviewer X" with a point label right after, right before or between
("our response to Q1 from Reviewer X"), checked against the `labelledParts` of that reviewer's
other drafts (which read combined headings such as `## W1 and W2`); nothing when one of those
drafts is unread or none has labels. A precision probe on the 310 real author responses found
only the two genuine pointers (`reviews/2026-11-27/neon-pointers`); rerun it after any change.
The pointer card selects the missing label and needs the other drafts' texts (`others[i].text`),
so a background read and a draft text saved in another window also refresh the cards. Known misses, accepted by the final
review round (`codex-final-38`): a salutation in italics, or wrapped right after "Dear". At ARR,
`[x](www.host/path)` counts as external although OpenReview would resolve it inside the forum
(the author means to leave it). The cards are advice without fixes
and come from `renderIssues` (`reviewerCards`), not from `analyze`, so Fix all, compaction and
the macro check never see them. They depend on the tabs' names, so a rename, a deletion, an
import, a list taken in from another window and a list merged on saving call
`refreshReviewerCards`.

## The review beside its draft

The Preview and Review tabs (`prefs.view`, `applyView`) use roving focus and arrow keys.
The hidden preview stays laid out so MathJax can measure it. The review textarea lives in a
same-origin `srcdoc` iframe. Chrome keeps undo history per document. `loadReviewBox` replaces
the frame on a draft switch, binds input only after the current frame loads, and copies the
theme tokens into its document on load and theme changes.

`readHtmlReview(doc)` reads OpenReview's field/value sibling elements from a parsed clipboard
fragment, preserving list markers, nested items, paragraphs, code lines and table cells. An
ordinary paste stays native.
`reviewPoints(text)` reads the original line endings for source offsets. Form fields set the
type (W, Q, L or C) or end the preceding value; an unknown title-cased heading ends it only
when it reads as the form's administration (Acknowledgement, Justification, Declaration and the
like), otherwise it is the reviewer's sub-heading and its items stay in the field. Aspect names
such as Clarity can introduce prose inside a field. Plain selections lose list markers, so sentence boundaries and question
openings help separate items while wrapped prose stays together. Keep ambiguous concerns in
mixed fields, even when that also keeps some praise. Tests use synthetic reviews.

`REVIEW_NAME` is shared by review items, section names and coverage. `labelledParts` reads all
the leading labels in a section, including combined headings. `reviewCoverage` maps visible
quotes back to source offsets after case and whitespace folding. Shared openings require the
full point. Link definitions, destinations, comments and code blocks cannot cover a point;
inline code is visible text (only its backticks are skipped). A point under 15 characters counts
only as a whole word inside a blockquote. A missing match says *no part labelled X*.
`insertBlock` inserts Quote and Insert skeleton at a block boundary or after the top-level block
(`blockSources`) holding the selection's end, never inside a fenced code block, with one source
undo. Known limits accepted by the last review (`reviews/2026-11-27/codex-final-39`): praise in a
field of concerns can become a point, and a part labelled Question2.1 counts for Q2.

**Storage** is deliberately simpler than the drafts': a review lives under
`REVIEW_PREFIX + draft id` in localStorage only (never the asynchronous store, Export, Import or
History), since OpenReview keeps the original and it is the reviewer's text. `fallbackSet`
makes room only for drafts, so a review that does not fit stays in memory until the page is
left, and the view says so. The box is bound to its draft (`reviewFor`): `openDraft` saves the
review of the draft it leaves, then loads the new one; deleting a draft deletes its review, and
`pruneHistory` drops reviews of drafts deleted elsewhere. Another window's save of the same
review is taken in only when this box holds no edit of its own (last save wins otherwise).

## Staying in sync with OpenReview

`npm run check-upstream` diffs the openreview-web excerpts the page mirrors against
`upstream/openreview-web.json`. When it reports a change: update the page **and**
`tests/lib/pipeline.js` (the independent reference implementation), bump CDN URLs and
`devDependencies` together, run `npm test`, then `npm run check-upstream -- --update`.
Exit codes: 0 nothing changed, 1 something changed, 2 the check itself failed (network, rate
limit, a moved file or marker, an unreadable snapshot; it never overwrites one without `--update`).
`.github/workflows/upstream.yml` runs it every Monday: exit 1 opens an issue labelled
`upstream-drift` (or refreshes the open one's body, without a comment that would notify
everyone weekly), exit 2 fails the run. GitHub turns scheduled workflows off after 60 days
without a commit; turn it back on in the Actions tab.

## Releases and reports

`APP_VERSION` in the pure section is the page's version, shown in the footer and filled into
problem reports; bump it with `package.json` and `package-lock.json` in the release commit
(`tests/report.test.js` checks it). The footer's report links (`renderReportLinks`) fill the
issue forms in `.github/ISSUE_TEMPLATE` by field id with the version, the browser
(`browserLabel`) and the venue (`reportVenue`), **never draft text**: issues are public. A test
checks that every field the page fills exists in its form. Do not release while a venue the
users target is in its author response window; Pages serves `main` at once.

## Browser behavior

`npm test` runs in Node and cannot see the DOM section. After touching it, run
`npm run smoke`: it drives the installed Chrome/Edge headlessly (DevTools protocol, no
dependencies) and checks Fix all + single-step undo, undoable *Clear* and *Load example*, the
status bar's TeX-error and undefined-macro counts and their hazard cards (a macro fixed from its
card, with undo; no fix before the typeset of the current text; a card that follows its formula
after an edit; red `\verb` text not taken for a macro; Fix all's message while MathJax catches
up), the preview of the trimmed comment, History (a version before Fix all, Restore with undo,
deleted with its draft, the budget and a full storage evicting the oldest versions of any draft
first, a conflict with another window), Export, Import (new tabs only, no room, a chosen file, the
asynchronous store), a page back from the back/forward cache, a fresh TeX
state per preview (no duplicate `\label` errors, deleted `\newcommand`s, `\definecolor`s and
`\DeclarePairedDelimiter`s forgotten), drafts (a fresh one, switching, undo isolation, rename and delete,
across a reload and with a slow store), manual fixes outside Fix
all, Fix all's added-character count, the selection count, venue presets (the rule beside the
counter, the author's own limit, preferences stored before 3.8), reviewer cards across drafts
(with renames here and in another window), the review view (points, coverage, Quote and the
skeleton with one undo each, a review per draft, across a reload, deleted with its draft),
Copy compact and Apply to
source (with undo), the compact chip state, compaction switches across a reload, jumping to a hazard on a
long soft-wrapped line, refusing a stale one-click fix, draft persistence across a reload (also
with a stubbed asynchronous `window.storage`: keystrokes before a reload, a draft saved elsewhere,
leaving before the restore), `/images/` attributes, the theme toggle, the Sections and Wording
panels, find and replace (with its boxes and one undo), a double-click from the preview to the
source, the spellcheck switch across a draft switch, the Anonymity panel (cards, its own undo,
across a reload), the footer's report links (no draft text in them), and that no page errors
were thrown. Add a
check there for any new browser-only behavior.

Still by eye: zoom and editor-size controls, dark-mode colors, the layout below 920 px width, the
left pane with several panels open (the smoke test checks the hazards at 1280 x 640).
