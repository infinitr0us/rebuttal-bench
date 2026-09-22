# Changelog

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
