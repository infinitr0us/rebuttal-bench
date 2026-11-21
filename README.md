# Rebuttal Bench

A single-file previewer for OpenReview comments. Paste a rebuttal and see it rendered the way
openreview.net renders it — Marked (GFM) → DOMPurify → MathJax — next to a list of *hazards*:
places where Markdown mangles your TeX before MathJax ever sees it, most with a one-click fix.

Rebuttal Bench is an independent tool. It is not affiliated with or endorsed by OpenReview.

## Using it

Use it online at **https://infinitr0us.github.io/rebuttal-bench/**, or download
`rebuttal-bench.html` and open it in a browser (double-click is fine). Either way it needs an
internet connection for its pinned CDN libraries and the Noto Sans font, and your drafts never
leave the browser: they autosave on this device only.

- **Hazards.** Click a card to jump to the spot; **Fix: …** rewrites the source; **Fix all**
  applies every mechanical fix, repeating (up to eight rounds) until nothing is left. One
  Ctrl+Z (⌘Z) undoes a fix, a whole Fix-all pass, *Clear* or *Load example*. Some fixes need
  your judgment (turning `<b>` or `\textbf{}` into Markdown, deleting an HTML comment, dropping
  a link): their cards say "Not part of Fix all", and only a click on the card applies them.
  Fix all's message says how many characters the pass added.
- **Import table.** Place the cursor where the results belong, or select text to replace.
  Click *Import table* next to *Load example* and paste a LaTeX table, cells copied from a
  spreadsheet, or CSV. Check the OpenReview preview and any line-numbered warnings. Spanning
  cells and multiple header rows are flattened. *Pad columns* aligns the Markdown in the
  editor. *Insert at cursor* inserts the table in one undoable edit. Pasting a recognizable
  LaTeX or tab-separated table directly into the editor also offers to convert that paste.
- **Compaction.** *Copy compact* copies a shorter form of your source that OpenReview renders
  exactly the same: table padding and long delimiter rows (`| --- |` becomes `|-|`), links
  that repeat their URL, closing `#`s, extra blank lines and spaces, character references.
  The editor keeps your readable text; the status bar shows the compact count, and the
  character chip turns amber when only the compact form fits the limit. The *Compaction* panel
  under the hazards shows what each trick saves, with a switch for each; *Apply to source*
  rewrites the editor instead (one undo). Two tricks are off by default: dropping the outer
  pipes of table rows (harder to read as plain text), and writing one-symbol formulas as
  characters (`$\pm$` becomes `±`, `$\uparrow$` `↑`), which sets them in the text font instead
  of MathJax's.
- **Venue.** Sets the limit and checks links against the venue's rebuttal rules: NeurIPS
  (10,000 per review), AAAI (2,500 for all reviews) and ACL Rolling Review (5,000 per response)
  allow no links at all, ICML (5,000 per round) no non-anonymized or shortened URLs. ICLR's
  guide states no limit. Each preset's tooltip names its official source and the date it was
  checked; rules change every year. At any venue, a link that may name the authors (a personal
  repository or page, a shared drive, an e-mail address) gets a note.
- **Split into comments.** Where the venue allows several comments (NeurIPS does since 2026,
  ICLR's discussion is open), *Split into comments…* in the Compaction panel cuts a draft that is
  over the limit into parts under it, numbered like (1/3): only between paragraphs, table rows
  (the header goes with every piece), list items or sentences, never inside a formula or code.
  Each part can be copied, or opened as drafts of its own. Since each comment is typeset on its
  own, it warns when a part uses a `\newcommand` or `\label` from another part, and repeats link
  reference definitions where they are needed. With a one-response venue chosen, it says so.
- **Drafts.** One tab per text you are writing: an answer per reviewer, a general response, a
  follow-up. Each tab shows its length (red over the limit), so the answers can be balanced at
  a glance; double-click the open tab to rename it (a reviewer's ID, say), × deletes it. Every
  draft autosaves on its own, and undo never crosses from one draft into another.
- **Status bar.** Characters counted the way OpenReview's own counter does (trimmed length),
  the length of the selection, the number of formulas MathJax will typeset, hazards, and
  MathJax problems (TeX errors *and* undefined macros).
- **Escape cheat sheet.** Under the compaction panel.

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
6. Other checks look for what OpenReview shows as typed: raw HTML (`<br>` in a table cell,
   `<sub>`), HTML comments (a hidden note to a co-author is published), images not under
   `/images/`, footnotes, and LaTeX pasted from the paper outside math (`\textbf{}`, `\cite{}`,
   ` ``quotes'' `, ties like `Table~1`, two of which can even pair into strikethrough).

Because **Fix all** runs unattended, a fix is only offered when it can't damage correct text;
ambiguous cases get a warning without a fix, or a fix that only a click on its card applies.

## How compaction stays safe

Each trick proposes edits, and an edit is kept only if the whole comment still renders to the
same sanitized HTML (so MathJax receives the same text), both as typed and as OpenReview posts
it (trimmed, which can change how the first line parses), and the analyzer reports no more
hazards of any kind than before. A batch that fails is split until the offending edits are
found, so a trick never has to be right about every corner of Markdown: what would change the
rendering is simply dropped. Two refinements:

- The whitespace tricks (paragraph indentation, single trailing spaces) change only whitespace
  that the note's `white-space: normal` collapses. They are compared on collapsed text (tags,
  attributes and `<pre>` untouched), and every formula MathJax will find in the rendered HTML
  must stay byte for byte the same, since `\text{}` and `\verb` keep their spaces.
- The opt-in symbol trick does change the rendering. Each formula it replaces, and the
  character replacing it, must both render exactly as a neutral placeholder at that spot, so
  the new HTML is the old one with that text swapped and nothing else moved.

On a draft with two space-aligned results tables the default tricks save about 20% (394 of
2,011 characters; `tests/fixtures/padded-tables.md`); a draft written tersely saves nothing.
While you type, compaction gets a short time slice and may stop early (the panel says so; the
result is still safe); *Copy compact* and *Apply to source* give it more time.

## Development

Requires Node.js 22+.

```sh
npm install
npm test                          # regression cases, the example, page checks, short fuzz
npm run fuzz -- 20000 42 blocks   # long fuzz: iterations, seed, alphabet (inline | blocks)
npm run smoke                     # headless Chrome/Edge: undo, jump, status bar, persistence, copy
npm run check-upstream            # did openreview-web change anything the page mirrors?
                                  #   exit 1: something changed; 2: the check itself failed
```

```
rebuttal-bench.html        the app (single self-contained file, no build step)
index.html                 redirects the GitHub Pages site root to the app
tests/
  regression.test.js       hazard + Fix-all cases, broken and correct input
  compact.test.js          compaction: what each trick saves, what it must leave alone
  table-import.test.js     imported tables, rendered cells, warnings and MathJax input
  links.test.js            links under each venue's rules
  fixtures/                realistic drafts used by the tests
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
.github/workflows/test.yml CI: npm test and the browser smoke test on every push and pull request
```

When adding or changing a check or fix, add regression cases for the broken input it repairs
**and** for nearby correct input it must leave alone.

## Licence

MIT, see [`LICENSE`](LICENSE). The one exception is `upstream/openreview-web.json`: verbatim
excerpts of openreview-web, kept for the drift check, which remain under openreview-web's own
licence (AGPL-3.0); see [`upstream/README.md`](upstream/README.md). The libraries the page loads
(Marked, DOMPurify, MathJax) come from public CDNs under their own licences.
