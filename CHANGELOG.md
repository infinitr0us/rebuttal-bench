# Changelog

## Unreleased

### Drafts
- A tab per draft (an answer per reviewer, a general response, a follow-up), each with its length
  against the limit; double-click to rename, × to delete. Each draft autosaves under its own key
  with the same protection against a slow asynchronous store; existing drafts carry over as the
  first tab. Switching drafts gives the editor a fresh undo history, so Ctrl+Z cannot carry text
  from one draft into another. Several windows, several devices sharing an asynchronous store, a
  slow or failing store or a reload at any moment cannot lose or mix up a draft (two Codex reviews
  probed this with 49 scenarios and Chrome checks): random draft ids, the list merged with every
  other copy rather than overwritten, writes queued in order and marked pending until confirmed,
  deletions retried until confirmed, only real edits written back, nothing typed before the open
  draft is restored, and any draft body missing from the list given its tab back. The tabs work
  from the keyboard (arrows, Enter, F2 to rename the focused tab).

## 3.2.0 (2026-11-21)

From a brainstorm on 2026-11-21 (Claude, Codex and Fable) about per-comment character limits and
what else a rebuttal author needs.

### Compaction: fewer characters, the same rendering
- *Copy compact* copies a shorter form of the source; the editor keeps the readable text. The
  status bar shows the compact count, and the character chip turns amber when only the compact
  form fits the limit. *Apply to source* rewrites the editor instead (one undo).
- Tricks, each with a switch and its saving in the *Compaction* panel: table cell padding and
  delimiter rows (`| --- | :---: |` becomes `|-|:-:|`), links that repeat their URL, heading
  syntax, horizontal rules, the space after `>`, spaces after list markers, indented paragraph
  lines, trailing spaces (a two-space break becomes a backslash break), extra blank lines,
  character references (`&plusmn;` becomes `±`). Off by default: outer table pipes, and
  one-symbol formulas as characters (`$\pm$` becomes `±`, which changes the font of the symbol).
- Every edit is checked against the rendered comment, as typed and as posted (trimmed), and
  dropped if anything would differ; see README, "How compaction stays safe". A draft with two
  space-aligned results tables shrinks by about 20%. A Codex review of the first version found
  ten problems (submission trimming, whitespace inside formulas the analyzer did not see, a
  multi-second stall on long drafts, a copy failure reported as success, switches lost on a fast
  reload, invisible characters from references, attribute whitespace, budget accounting); all are
  fixed and covered by tests, and the review's 2,000-document fuzz corpus now shows no
  difference.

### Checks
- OpenReview shows these as typed, and they are now reported: raw HTML (`<br>` in a table cell,
  `<sub>`, `<b>`), HTML comments (an error: reviewers can read them), images not under
  `/images/`, footnotes, LaTeX outside math (`\textbf`, `\emph`, `\texttt`, `\url`, `\href`,
  `\underline`, `\cite`, ` ``quotes'' `, ties such as `Table~1`, which can pair into
  strikethrough), and `####` headings, which look like body text.
- Links under the chosen venue's rule: an error at NeurIPS, AAAI and ACL ARR (no links), an error
  for shortened URLs at ICML; a note at any venue for links that may name the authors.
- Fixes that need the author's judgment (formatting conversions, deleting a comment, dropping a
  link) apply only from their card; Fix all leaves them alone and does not count them.

### Page
- A *Venue* menu sets the limit and link rule (NeurIPS 10,000 per review, ICML 5,000 per round,
  AAAI 2,500 for all reviews, ACL ARR 5,000 per response, ICLR none stated), each with its
  official source and the date it was checked (2026-11-21).
- The status bar shows the length of the selection; Fix all says how many characters it added
  and warns when that took the draft over the limit.

### Project
- `tests/compact.test.js`, `tests/links.test.js` and a padded-tables fixture; `tests/lib/pipeline.js`
  exports `renderHtml`; new regression cases for the literal-text checks; smoke checks for copy,
  apply and undo, the chip, switches across a reload, venue presets, the selection count and
  manual fixes.
- Published on GitHub under the MIT licence, with the page on GitHub Pages and CI running
  `npm test` and the smoke test. `upstream/openreview-web.json` keeps openreview-web's AGPL-3.0
  licence (see `upstream/README.md`).

## 3.1.0 (2026-10-02)

From a review of 3.0.0 on 2026-10-01 (Claude and Codex, each finding reproduced against the real
pipeline).

### Fix all no longer damages correct text
- A number followed by a word inside math (`$16 GB$`, `$16 GB $`, `$100 epochs$`, `$2 xy$`) was
  taken for prose between two prices and turned into literal text.
- In "It costs $5 per run, and $x$ is the input." (or `$2x$`, `$-x$`) both dollar signs were
  escaped and the formula was lost with them; only the currency sign is escaped now.
- Negative amounts in two table cells (`| $-5 | $-10 |`) were paired across the `|` and the
  cells merged; ``$2 - `x`$`` was taken for two prices instead of math cut by inline code.
- Escaped brackets in prose (`\[A\]`, `\[k=5\]`, `\[+2.1\]`) became display math. Brackets are
  rewritten only around unmistakable TeX; `\(a\)` (one letter) gets a warning only.
- An indented command with a Windows path (`C:\data`, `src\utils`) counted as TeX and was
  unindented; the fix now needs a control word with an argument, sub- or superscript.
- `\>` at the start of a line inside math, where it keeps `>` from starting a block quote, was
  doubled into a TeX space.
- Deliberate intraword emphasis (`pre*training*`) lost its asterisks.
- A code span in a table cell that uses `\|` was edited as if it were math.

### The analyzer models OpenReview more closely
- In a table cell that uses `\|`, emphasis splitting a formula went unreported (Marked unescapes
  the pipe before lexing the cell, so its tokens were not found in the source); the same for
  `\[ \]` in a link label.
- `\ref{…}` and `\eqref{…}` outside math are typeset by MathJax (processRefs, on by default);
  a stray `\end{…}` no longer hides a formula inside its braces.
- Character references (`&#36;`), link syntax (only a link's label is text) and HTML blocks
  (shown as typed, adjacent ones in one text node) are modeled.

### Checks
- New: a `\ref`/`\eqref` without a `\label` in a tagged formula (or `align` row) of the same
  comment, which OpenReview shows as `(???)` (typically copied from the paper).
- New: text accents `\"` `\'` `` \` `` `\^` `\=` `\.` inside `\text{…}` whose backslash Markdown
  removes.
- Every unpaired delimiter is reported (only the first 12 were).

### Page
- Each preview starts from a fresh TeX state: no false "Label multiply defined" from the second
  render on, and deleted `\newcommand` / `\def` / `\newenvironment` / `\DeclareMathOperator`
  definitions and `\definecolor` colors are forgotten, as on a freshly loaded OpenReview page.
- With an asynchronous store (`window.storage`), text typed just before closing the page now wins
  over the older stored draft, but not over one saved elsewhere since; leaving before the draft
  was restored no longer replaces it with an empty one.
- Images under `/images/` get their alt and title text exactly as upstream builds them.

### Project
- `npm run check-upstream` validates the snapshot before going online, never replaces an
  unreadable one without `--update`, exits 2 when the check itself fails, shows duplicated lines
  in its diff, and no longer ends an excerpt at a brace inside a string or comment; its helpers
  have offline tests.
- More regression cases (each with a nearby correct input, some pinning the exact source after
  Fix all), fuzz atoms for references, character references and HTML blocks, and ten new
  smoke checks.

## 3.0.0 — 2026-09-22

A full review of v2, checked against openreview-web@45c27aa and against the real Marked 15.0.6 /
DOMPurify 3.4.13 / MathJax 3.2.2 pipeline, with an independent second review by Codex.

### Fix all no longer damages correct text
- Dollar signs were paired across the whole document, so a currency `$` in one paragraph paired
  with math in the next. Fix all then merged the paragraphs and escaped the real formula.
- `$5$ seeds` (a number typeset on purpose) was treated as currency and turned into literal `$5$`.
- `| $5 | $10 |` was treated as one formula, and the pipe "fix" merged the two table cells.
- Escaped citations such as `\[12\]` were converted into display math.
- A deliberate indented shell snippet (`$HOME … $PATH`) was unindented into broken math.
- `$f\[x\](y)$`: correct bracket shields were "fixed" into a real Markdown link.
- A backslash fix and a currency fix on the same `$` could both apply, leaving it a delimiter.
- The row-break and tilde checks now know *where* in the TeX they are, so `\\alpha` in a matrix,
  `\\ ` (a control space) inside `\text{…}` and the text accent `\\~{n}` in `\text{…}` are left
  alone instead of being rewritten.
- Math that merely starts with a number (`$2x $`, `| $2x|y$ |`) is no longer mistaken for currency.

### The analyzer now models MathJax exactly
- Pairing is a port of MathJax's FindTeX, run per paragraph / table cell / code-free stretch on
  the text Markdown actually hands over (left-to-right, `$$` only at the same position, brace
  depth). `$x$$y$` and `costs $5 and $$x$$` now match what MathJax typesets.
- Bare `\begin{…}…\end{…}` environments (typeset by MathJax without dollars) are checked too.
- `<br>` inside math is not a split (MathJax reads it as a newline): the false "hard break"
  errors are gone.
- Formulas in table cells beyond the header's width (which Marked drops) are not counted.
- A 4-space-indented continuation line no longer makes the analyzer lose paragraph boundaries
  (Marked's token text gains an extra newline there).

### Checks
- New: `\\` row break followed by a space collapses to `\ ` (was missed); unbalanced braces;
  table rows with more cells than the header (Marked silently drops them); inline code inside a
  formula.
- `\~{a}` now suggests `\tilde{a}` (`\\~` is undefined in MathJax math).
- "Consumed by Markdown" only for `\X` that MathJax defines in math (`\, \; \! \{ \| …`);
  `\[ \( \* \~ …` inside math are correct shields and stay silent.
- Multiplication asterisks are reported even when the emphasis happens to contain a formula.

### Page
- DOMPurify 3.4.13 with OpenReview's tag allowlist and attribute hook.
- Status bar counts undefined macros as well as TeX errors.
- Character count matches OpenReview's counter (trimmed length).
- Clicking a hazard scrolls to it on long, soft-wrapped lines.
- Stale one-click fixes are refused after the draft changes; a slow draft restore no longer
  overwrites text typed at startup; *Clear* and *Load example* are undoable; drafts also flush
  on `pagehide`.

### Project
- git history (v2 baseline first), Node test suite with differential fuzzing, headless-browser
  smoke test, upstream drift check, README / AGENTS.md / CHANGELOG.
