# Rebuttal Bench

A single-file previewer for OpenReview comments. Paste a rebuttal and see it rendered the way
openreview.net renders it (Marked with GFM, then DOMPurify, then MathJax), next to a list of *hazards*:
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
  Click *Import table* and paste a table copied from Word, Google Docs, Sheets, Excel, or a web
  page. You can also paste LaTeX, tab-separated cells, or CSV. When the clipboard includes HTML,
  the preview keeps inline bold and italics and leaves empty cells where a merged cell spanned
  the grid. Editing the pasted text switches to plain-text conversion. Check the OpenReview
  preview and any row or line warnings. *Pad columns* aligns the Markdown in the editor.
  *Insert at cursor* inserts the table in one undoable edit. Pasting a copied table, LaTeX
  table, or tab-separated grid into the editor also offers to convert it in place.
- **Paste from Google Docs or Word.** Paste formatted text into the editor and choose *Convert*
  to keep its headings, bold and italics, links, nested lists, quotes, inline code and tables as
  Markdown; one undo brings back the plain paste. TeX you wrote in the document (`$\alpha$`)
  reaches MathJax unchanged. An equation that arrives as an image or MathML keeps its alt text
  where it has one, with a warning to check it.
- **Compaction.** *Copy compact* copies a shorter form of your source that OpenReview renders
  exactly the same: table padding and long delimiter rows (`| --- |` becomes `|-|`), links
  that repeat their URL, closing `#`s, extra blank lines and spaces, character references.
  Inside formulas it can remove ignored spaces, shorten command arguments and aliases,
  use `\cr` for row breaks, and drop redundant `$$` around a display environment.
  The editor keeps your readable text; the status bar shows the compact count, and the
  character chip turns amber when only the compact form fits the limit. The *Compaction* panel
  under the hazards shows what each trick saves, with a switch for each; *Apply to source*
  rewrites the editor instead (one undo). Two tricks are off by default: dropping the outer
  pipes of table rows (harder to read as plain text), and writing one-symbol formulas as
  characters (`$\pm$` becomes `±`, `$\uparrow$` `↑`), which sets them in the text font instead
  of MathJax's.
- **Wording.** For a draft over the limit, the *Wording* panel suggests shorter ways to say the
  same, each with what it would save: filler phrases (*in order to*, *due to the fact that*,
  *We would like to thank*) and long names used three times or more that an abbreviation would
  shorten. Advice only: nothing changes your text. Click a phrase to go to it.
- **Sections.** The *Sections* panel lists the parts of a draft with the length of each and its
  share of the comment. A heading starts a part, and so does a paragraph, list item or quote that
  opens with a label such as `**W1.**`, `**Q2:**` or `W3:`; points are listed under their
  heading, so one comment answering several reviewers shows each reviewer's total. Click a part
  to go to it.
- **Promises.** The *Promises* panel lists what your drafts promise to change in the paper,
  grouped by tab: commitments (*we will add the seed sweep*) and changes already made (*we have
  revised Section 3*). Click one to open its draft at the sentence; *Copy as checklist* copies
  the commitments as a Markdown to-do list with their tab names, for the revision. A draft not
  read yet is marked *not checked*. It errs on the side of missing an indirect promise rather
  than listing a sentence that promises nothing.
- **Editing.** *Find* (Ctrl+F or ⌘F in the editor) searches and replaces in the source, with the
  matches highlighted; one undo takes back *Replace all*. Double-click a word or formula in the
  preview to select it in the source. *Spellcheck* turns on the browser's spellchecker in the
  editor (off by default, since TeX and Markdown are full of words it does not know).
- **Venue.** Sets the limit and checks links against the venue's rebuttal rules: NeurIPS 2026
  (10,000 per review) allows no links in a response (an anonymized link to code the reviewers
  asked for, sent to the AC in an Official Comment, excepted), AAAI-26 (2,500 for all reviews)
  no URLs, ACL Rolling Review (5,000 per response) no external links, ICML 2027 (5,000 per
  round) no non-anonymized or shortened URLs; ICLR 2027 wants code in anonymous repositories
  and demos on hosts that do not track visitors. ICLR states
  no number, so the limit you typed last applies there. Two more presets follow OpenReview's
  default forms (5,000 per comment, 2,500 per rebuttal) for workshops and smaller venues. The
  rule shows beside the counter (*your limit* when the number is yours, not the venue's); hover
  for its official sources and the date it was checked, click to open it. Rules change every
  year. At any venue, a link that may name the authors (a personal repository or page, a shared
  drive, an e-mail address) gets a note.
- **Split into comments.** Where the venue allows several comments (NeurIPS does since 2026,
  ICLR's discussion is open), *Split into comments…* in the Compaction panel cuts a draft that is
  over the limit into parts under it, numbered like (1/3): only between paragraphs, table rows
  (the header goes with every piece), list items or sentences, never inside a formula or code.
  Each part can be copied, or opened as drafts of its own. Since each comment is typeset on its
  own, it warns when a part uses a `\newcommand` or `\label` from another part, and repeats link
  reference definitions where they are needed. With a one-response venue chosen, it says so.
- **Drafts.** One tab per text you are writing: an answer per reviewer, a general response, a
  follow-up. Each tab shows its length (red over the limit), so the answers can be balanced at
  a glance. *Rename* (or F2, or a double-click on the open tab) names it after a reviewer's ID,
  say; *Delete* removes it. Every draft autosaves on its own, undo never crosses from one draft
  into another, and several windows of the page can be open at once without losing a draft (a
  draft deleted in one window comes back if another window still has it open). A tab named for a
  reviewer (`Reviewer k9F2`, `k9F2`, `R2`) is checked against the others: a card points out a
  salutation, a *Response to* line or an opening or closing thanks that addresses another
  reviewer (an answer copied from their draft), an ID in other capitals than its tab, and a
  pointer such as *please refer to our response to Reviewer Ab12, Q2* when that reviewer's drafts
  label no Q2. Mentions in passing and joint thanks are left alone.
- **Review.** Switch the right pane between *Preview* and *Review* with a click or the arrow
  keys. Paste the forum review your draft answers. A rich paste keeps its fields, paragraphs
  and lists. Plain text works too. Each weakness, question, limitation or comment gets a label
  such as W1, Q2, L1 or C1, using the reviewer's label when supplied. Click a covered point
  to find its label or quotation in the draft. A heading can answer several points together.
  The tab shows the count (*3/5*). *Quote* inserts the point and *Insert skeleton* adds the
  missing labels, optionally with quotes. Each inserts at a paragraph boundary or after the
  paragraph containing the selection's end. One undo restores the draft. Each review has its
  own undo history and stays with its draft in this browser, outside exports, until deletion.
- **History and export.** *History* lists earlier versions of the open draft: one is kept before
  *Fix all*, *Apply to source*, *Replace all*, *Clear*, *Load example* and a restore, and one every 10 minutes
  while you edit, of the text the edit replaces (up to 20 per draft, in this browser only). When
  the versions of all drafts together take up too much room (about a million characters), or a
  draft needs the space, the oldest go first, whichever draft they belong to. *Restore* is one more
  edit, so one undo takes it back; it waits until the draft has loaded completely, and refuses when another
  window or device has saved the draft since this one loaded it. The same dialog exports every draft as one `.json` file, or the open draft as `.md`, as a
  backup (with this browser's storage full, a window exports its own copy of a draft it could
  not save). *Import…* reads such a file back, or a `.md` or `.txt` file as one draft: each draft
  you do not have yet becomes a new tab, and no draft is replaced or changed. The online page and
  a downloaded copy of it keep separate drafts; to move drafts between them, or to another
  browser, export them in one and import them in the other. *Compare* shows what changed between
  the open draft and an earlier version, another draft or a co-author's copy you paste in
  (insertions underlined, deletions struck through, with counts); it changes nothing. *Print
  this draft* and *Print all drafts* print the comments as OpenReview renders them, with typeset
  math, each with its title and its length against the limit, for an advisor who reads no
  Markdown.
- **Before posting.** Cards also point out placeholders left in the text (`TODO`, `XX.X`,
  `Table X`, `[cite]`, `[Your Name]`, `??`), invisible characters and ligatures (`ﬁ`) that a copy
  from a PDF brings along, commented-out LaTeX pasted from Overleaf (`% \vspace{2mm}`, a `%`
  table row, `% TODO`), which OpenReview posts as typed, what a chat assistant leaves behind
  (citation markers such as `:contentReference[oaicite:0]{index=0}`, "Here is a revised version
  of your rebuttal:"), and a start that posting reads differently: OpenReview trims a comment when it
  posts it, so an indented first line is no longer a code block. Once MathJax has typeset the
  preview, every formula it cannot typeset gets a card with its error message, and every macro
  it does not know (`\bm`, `\argmax`, `\R`) gets one card for all the formulas that use it,
  with a replacement MathJax has (`\boldsymbol`) where there is one.
- **Anonymity.** List the words that would name you in the *Anonymity* panel, one per line: your
  names, e-mail addresses, institution, lab, project and GitHub names. Every occurrence in the
  open draft gets a card, wherever it is, since OpenReview posts the comment as typed and
  e-mails its source: link destinations, code, math and HTML comments count too. Matching is
  exact apart from capitals and a name wrapped across a line, so prefer full names (a surname
  alone also matches other people's citations). The list is kept with your preferences, never
  in a draft, an export or a copy.
- **Status bar.** Characters counted the way OpenReview's own counter does (trimmed length),
  the length of the selection, the number of formulas MathJax will typeset, hazards, and
  MathJax problems (TeX errors *and* undefined macros).
- **Escape cheat sheet.** Under the compaction panel.

## Reporting a problem

*Report a problem* in the page's footer opens a GitHub issue form with the page's version, your
browser and the chosen venue filled in; *Suggest an idea* opens one for ideas and changed venue
rules. Issues are public and your rebuttal is not: paste only a small example that shows the
problem, rewritten so it says nothing about your paper. When the preview and the posted comment
differ, screenshots of both are the most useful report there is.

## How faithful is the preview?

| Stage | OpenReview (openreview-web) | This page |
| --- | --- | --- |
| Markdown | Marked 15.0.6, GFM, custom renderer in `client/view.js` (`setupMarked`): raw HTML shown as text, images only from `/images/`, task checkboxes as `[x]` | same |
| Sanitizing | DOMPurify 3.4.17, tag allowlist from `lib/utils.js`, hook in `app/AppInit.js` | same |
| Math | MathJax 3.2.2 `tex-chtml-full`, `$…$`/`\(…\)` inline, `$$…$$`/`\[…\]` display, bare `\begin{…}` environments and `\ref`/`\eqref` (`lib/mathjax-config.js` + MathJax defaults; equations are not numbered) | same; each preview starts from a fresh TeX state, as a posted comment does |
| Styles | `.note-content-value.markdown-rendered`: Noto Sans 12px/18px (`styles/utils/_mixins.scss`) | same; 100 % zoom is 1:1 |

The preview shows the comment as posted: OpenReview trims a text field before it posts it
(`constructEdit` in `client/view-v2.js`), and so does the preview.
Line *wrapping* still depends on the reader's window width and reply depth. The table was
verified against openreview-web at commit `be86e65` (2026-11-20); `npm run check-upstream`
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
   `<sub>`; made-up tokens such as `<think>` are meant to show and stay quiet), HTML comments
   (a hidden note to a co-author is published), images not under `/images/`, footnotes, LaTeX
   pasted from the paper outside math (`\textbf{}`, `\cite{}`, `\footnote{}`, ` ``quotes'' `,
   ties like `Table~1`, two of which can even pair into strikethrough), and math commands typed
   without delimiters (`We use \alpha=10`).
7. The last checks look at the draft as a whole: placeholders, invisible characters and
   ligatures. All checks read the comment as posted, which OpenReview trims; a card says when
   the trim changes how the start reads.
8. After each typeset, what MathJax reported for each formula is matched to its source formula,
   so its card points at the right place even while you keep typing. A replacement for an
   unknown macro is offered only once the preview shows exactly the text in the editor, and only
   when the whole comment, checked again with it, keeps every other formula intact.

Because **Fix all** runs unattended, a fix is only offered when it can't damage correct text;
ambiguous cases get a warning without a fix, or a fix that only a click on its card applies.

## How compaction stays safe

Each proposed edit is checked against the whole comment, both as typed and as OpenReview
posts it. Posting trims the source, which can change how the first line parses. The analyzer
must find no additional hazards of any kind. Most tricks require identical sanitized HTML.
A batch that fails is split so that independent edits can still apply.

- The whitespace tricks (paragraph indentation, single trailing spaces) change only whitespace
  that the note's `white-space: normal` collapses. They are compared on collapsed text (tags,
  attributes and `<pre>` untouched), and every formula MathJax will find in the rendered HTML
  must stay byte for byte the same, since `\text{}` and `\verb` keep their spaces.
- Inside a formula, `$ x + y $` can become `$x+y$`, `\frac{1}{2}` can become `\frac12`,
  and `\leq` can become `\le`. Every formula must produce identical MathML, in the same
  position and display mode, and all HTML outside the formulas must match exactly. MathJax
  starts fresh for each comment and compiles its formulas in order, so an earlier definition
  can rule out a later substitution. `x^{2}` and `\rightarrow` keep their spelling because the
  shorter forms change the MathML. Math edits are skipped while MathJax is loading.
- The opt-in symbol trick does change the rendering. Each formula it replaces, and the
  character replacing it, must both render exactly as a neutral placeholder at that spot, so
  the new HTML is the old one with that text swapped and nothing else moved.

On the padded-tables fixture the default tricks save 414 of 2,007 characters, including 20
inside formulas. On the theory-response fixture they save 85 of 1,006 characters.
While you type, compaction gets a short time slice and may stop early (the panel says so; the
result is still safe); *Copy compact* and *Apply to source* give it more time.

## Development

Requires Node.js 22+.

```sh
npm install
npm test                          # regression cases, the example, page checks, short fuzz
npm run fuzz -- 20000 42 blocks   # long fuzz: iterations, seed, alphabet (inline | blocks)
npm run smoke                     # headless Chrome/Edge: undo, jump, status bar, persistence, copy
npm run corpus -- texts.jsonl --baseline summary.json
                                  # the analyzer on real texts ({id, text} per line): cards per
                                  #   check, and what appeared or disappeared since a run
npm run check-upstream            # did openreview-web change anything the page mirrors?
                                  #   exit 1: something changed; 2: the check itself failed
```

GitHub also runs the upstream check every Monday (`.github/workflows/upstream.yml`) and opens an
issue labelled `upstream-drift` when something changed.

```
rebuttal-bench.html        the app (single self-contained file, no build step)
index.html                 redirects the GitHub Pages site root to the app
tests/
  regression.test.js       hazard + Fix-all cases, broken and correct input
  field-fixall.test.js     Fix all on what real authors write: left alone, or still repaired
  field-audit.test.js      quiet on what renders as meant; math commands outside math
  compact.test.js          compaction: what each trick saves, what it must leave alone
  table-import.test.js     imported tables, rendered cells, warnings and MathJax input
  compact-math.test.js     formula compaction against independently typeset MathML
  links.test.js            links under each venue's rules
  drafts.test.js           the stored list of drafts: parsing, merging two windows' lists
  split.test.js            splitting a draft into comments: where it cuts, what it keeps
  reviewers.test.js        reviewer IDs across drafts: greetings and IDs in other capitals
  leftovers.test.js        LaTeX comment lines and chat-assistant leftovers, caught and quiet
  anonymity.test.js        the anonymity word list: parsing, exact matches everywhere, offsets
  report.test.js           the footer's report links: version, browser, issue-form fields
  review.test.js           a review's points and how a draft covers them
  paste.test.js            formatted prose from Docs, Word and web pages as Markdown
  promises.test.js         promises to change the paper, found and left alone
  diff.test.js             the word-level comparison: exact texts, bounded work
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
scripts/corpus.mjs         replays the analyzer on a corpus of real texts (npm run corpus)
AGENTS.md                  engineering notes for contributors and coding agents
.github/workflows/test.yml CI: npm test and the browser smoke test on every push and pull request
.github/workflows/upstream.yml   weekly check-upstream, opening an issue on drift
.github/ISSUE_TEMPLATE/    the issue forms the page's report links open
```

When adding or changing a check or fix, add regression cases for the broken input it repairs
**and** for nearby correct input it must leave alone.

## Licence

MIT, see [`LICENSE`](LICENSE). The one exception is `upstream/openreview-web.json`: verbatim
excerpts of openreview-web, kept for the drift check, which remain under openreview-web's own
licence (AGPL-3.0); see [`upstream/README.md`](upstream/README.md). The libraries the page loads
(Marked, DOMPurify, MathJax) come from public CDNs under their own licences.
