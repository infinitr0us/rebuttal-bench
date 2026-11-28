# Changelog

## 3.14.0 (unreleased)

### Ready to post
- A *Ready to post* panel lists every draft of the open paper with its length against the
  limit, the analyzer's errors and warnings, placeholders, words from the anonymity list, how
  many of its review's points it answers, and its promises still to do. A draft is ready when it
  fits the limit and has no error, placeholder or anonymity match left, and answers every point
  of its review; the summary reads *3 of 4 ready*. A draft not read yet shows *not loaded*.
  MathJax's own TeX errors need a typeset, so they show only for the open draft. A click on a row
  opens that draft. The panel only reads: it changes no draft, list, paper or setting other than
  whether it is open.

### Find across drafts
- *All drafts* in the find bar lists the matches in every draft of the open paper, up to three
  per draft with the text around them. A click opens that draft at the match, also when its
  text is still loading. *Replace* and *Replace all* still change the open draft only, and say
  so while *All drafts* is on. The box is not stored: a reload turns it off.

### Fixed
- Split's warnings about a macro or label used across parts gave the wrong reason. OpenReview's
  forum does not typeset each comment on its own: MathJax keeps definitions and labels from the
  comments typeset before on the page, so whether a part sees another part's definition depends
  on the order the forum shows them in. The advice stays (repeat the definition, write the
  number out); the reason now says so.
- The smoke test that runs the released 3.12 page beside the current one read it from a commit
  the shallow CI checkout lacked; it now reads the `v3.12.0` tag, and CI checks out the whole
  history. The 3.13.0 release was not affected.

## 3.13.0 (2026-11-28)

### Papers
- Drafts can be grouped by paper, for authors with several submissions under review in one
  season. *New paper* names a paper and opens its first draft; a row of papers then sits above
  the draft tabs (a menu below 920 px), each paper with its number of drafts and a mark when one
  is over its limit, and the draft tabs show the open paper's drafts. *No paper* shows whenever
  it holds drafts. Rename a paper with F2 or a double-click on its tab; *Move to…* puts the open
  draft in another paper; choosing a paper opens the draft last opened there.
- *Group by name* proposes papers from tab names that share a first word (`P2 R1`, `ICML-R1`,
  `[ARR] General`, never a reviewer's ID) in a dialog where every row can be changed, and
  writes only what you apply. No draft is renamed.
- Each paper can have its own venue and limit; until you choose one it uses the page's, so
  grouping changes no card. The reviewer-ID cards and the pointer check compare drafts of the
  same paper only (two papers each with an `R1` no longer meet), and *Promises*, *Copy as
  checklist*, *Print all drafts* and new drafts (also Split's parts) follow the open paper.
  *Compare* lists the paper's other drafts first and the rest under *Other papers*.
- *Export* keeps each draft's paper and that paper's venue, in a file 3.12 still imports
  (ungrouped). *Import* puts each draft in the paper its file names (or the open paper) with
  names unique per paper, and says where drafts already present are; *New paper from a file*
  puts every draft of a file in a new paper named after it, for instance the export of a
  downloaded copy used for another paper. A paper cannot be renamed to another paper's name, so
  a backup never merges two papers. Built by Gemini 4 Neon on the storage core below.
- A paper owns no text: it is a label on drafts, in a record of its own that 3.12 never reads,
  kept in this browser like reviews and the word list (Export and Import carry it to another).
  Windows and the back/forward cache merge their copies of it, never replace them, and a window
  writes the merge back whenever the stored copy lacks something it knows, so a grouping change
  survives the window that made it; losing the record would only regroup drafts. A paper's
  venue and limit never touch the preferences (with papers, the venue and limit controls wait
  until the drafts are restored), and deleting a paper's open draft opens another draft of the
  same paper (the confirm names the paper). Designed with a review by Claude Fable 5.2 before
  any code was written; two Codex review rounds then found problems with windows writing at
  once, a full storage, backups and syncing papers through a slow store, each fixed or, for the
  store, designed away.

## 3.12.0 (2026-11-28)

### Checked on real author responses
- A field audit ran the analyzer on 1,300 public author responses (ICLR, NeurIPS, ICML, TMLR,
  COLM). About one in eight of those with math had a formula that OpenReview showed differently
  from what was typed, and the cards pointed at most of them. It also found Fix all rewriting
  formulas that already showed what their authors meant, in 10 of the 126 responses it changed,
  and two review rounds found more such inputs. The rule now: **Fix all repairs a Markdown-eaten
  escape unattended only where the bare character cannot be what you meant.** A visible comma
  instead of `\,`, a stray `#` or `&` (TeX errors) and a `%` (a comment) are still repaired;
  `{`, `}` and `|` are valid TeX with other meanings, so their fixes mostly wait for your click:
  - a `\|` always does: it can be a norm, an absolute value (`\|r\|^2` of a scalar), a
    conditioning or evaluation bar (`P(A \big\| B)`, `F(t)\big\|\_{t=b}`) or a KL divergence's
    separator (`[q\|p]`), and its card says which TeX symbol the fix gives;
  - set braces are repaired only where only a set can open (`$\{x_i\}_{i=1}^N$`, `S = \{…\}`,
    `\in \{0,1\}`, `\left\{`) or when a brace has no partner; elsewhere (`\bigcup_i\{x_i\}`)
    the card's fix waits, and braces that group (`R^\{P\}`, `\sqrt\{n+1\}`, `\label\{eq:x\}`,
    `\mathbf{x\}`) get no card at all;
  - both dollar signs escaped around a formula (`(\$\tilde{P}\$)`, `\$n=16\$`, `\$16 GB\$`) are
    a formula; only prices between escaped signs, the second leading into the next amount, are
    currency. With one sign of a pair escaped, the fix waits for your click;
  - bars composed into a double bar (`\|\|h\|\|`) and `\&` as the column separator of an
    alignment keep their escapes;
  - emphasis between two prices (`**$484**) vs. B (**$1,500**`, `__$5__ versus __$8__`) cuts no
    formula, and escaping emphasis inside `\text{}` is manual, since the stars would then show.
  On the 1,300 responses Fix all now changes 103 (rather than 126), none of them for the worse;
  24 keep a card with a one-click fix instead.
- Fourteen error cards that were wrong are gone; a lone `\$`, which shows as typed for now, is a
  warning.
- A bare `%` right after a number that ends a formula or comes before a closing bracket
  (`$78.1%$`, `$\text{top 10%}$`) gets a card and a fix: MathJax reads it as a TeX comment and
  drops the sign. Anything else after it, as in a comment copied from the paper (`x=1%\quad + 2`,
  `% \vspace{-1mm}`, a line-joining `%`), stays a comment, and so does a `%` in `\verb`.
- Math commands typed without delimiters in prose (`We use \alpha=10`, `c_\phi`, `\arg\max_i`)
  and `\footnote{…}` get a card: OpenReview shows them as typed. Adjacent commands of one
  expression share a card; paths (`results\min`), a macro quoted by name and quotes of the
  review are left alone. On the two real corpora it found 21 such places outside quotes, all
  genuine. Built by Gemini 4 Neon.
- Check 9 (raw HTML shown as text) still reports markup such as `<figure>` and `<section>`, but
  not prompt tokens named by plain words (`<think>`, `<input>`, `<output>`, `<label>`).
- Fewer cards on what renders as meant (87 on the two corpora, each read): a heading that is
  already bold, made-up tokens such as `<think>` (not HTML), approximations and ranges with a
  tilde (`(~2GB)`, `0.55~0.65`), an indented example with prices, `feasible??` at the end of a
  question, `TBD-based`, and a placeholder quoted with its correction (`"Figure ??" to "Figure
  2"`). Built by Gemini 4 Neon.
- `npm run corpus` replays the analyzer on a corpus of texts and compares its cards with an
  earlier run, so a change to any check can be measured on real text before review.

### Anonymity
- The *Anonymity* panel keeps a private list of the words that would name you (your names,
  e-mail addresses, institution, lab, project and GitHub names, one per line). Each occurrence in
  the open draft gets a card, wherever it is: prose, code, math, link destinations, image text
  and HTML comments all count, because OpenReview posts the comment as typed and e-mails its
  source. Matches are exact (any capitals, a name wrapped across a line), so they cannot fire on
  words you did not list. The list is kept in this browser only, under a key of its own (so
  another window's preferences never overwrite it), never in a draft, an export or a copy, and it
  has its own undo history. Built by Gemini 4 Neon.

### Reporting a problem
- The footer names the page's version and links to *Report a problem* and *Suggest an idea*,
  GitHub issue forms that come with the version, the browser and the chosen venue filled in.
  No draft text goes in: issues are public, so the form asks for a small example rewritten to
  say nothing about the paper.

### Maintenance
- A weekly GitHub workflow runs `check-upstream` and opens an issue when openreview-web changes
  anything the page mirrors, so the preview cannot drift from OpenReview unnoticed between
  rebuttal seasons.
- The page's visible text and the README no longer use em-dashes.

## 3.11.0 (2026-11-27)

### Paste from Google Docs or Word
- Formatted text pasted into the editor offers *Convert*: headings, bold and italics, links,
  nested lists, quotes, inline code and tables become Markdown, and one undo brings back the
  plain paste. TeX written in the document (`$\alpha$`) reaches MathJax unchanged; an equation
  that arrives as an image or MathML keeps its alt text, with a warning. Superscripts stay
  exponents (`10<sup>-3</sup>` from Word becomes `10$^{-3}$`), spaces in code stay, and a pasted
  table or list never runs into the text after it.
- A Codex review with a real Word clipboard found six problems in this and in Print before
  release; Gemini 4 Neon fixed them, each with a test that fails without the fix.

### Promises
- The *Promises* panel lists what the drafts promise to change in the paper, grouped by tab:
  commitments (*we will add*) and changes already made (*we have revised*). A click opens the
  draft at the sentence, and *Copy as checklist* copies the commitments as a Markdown to-do
  list with their tab names. Tuned on 310 real author responses to list only real promises.

### Pointers into another reviewer's answer
- An explicit pointer into another reviewer's answer ("please refer to our response to Reviewer
  Ab12, Q2", "Q2 of our answer to Reviewer Ab12", "our response to Q1 from Reviewer Ab12") gets a
  card on the label when that reviewer's drafts label no such part, naming the labels they have.
  A combined heading (`## W1 and W2`, `## Questions 2 and 9`) counts for each label. Mentions of
  the reviewer's own points, technical terms (`L2 regularization`, `W2V`), quarter-years and bare
  counts stay quiet, and so do drafts not read yet or without labels. On 310 real author
  responses it found the two genuine pointers and nothing else. Built by Gemini 4 Neon.

### Compare and print
- *Compare* in the History dialog shows what changed between the open draft and an earlier
  version, another draft or a pasted co-author's copy, word by word (insertions underlined,
  deletions struck through, with counts). It changes nothing.
- *Print this draft* and *Print all drafts* print the comments as OpenReview renders them, with
  typeset math, each on its own page with its title and length against the limit.

## 3.10.0 (2026-11-27)

### Before posting
- Commented-out LaTeX pasted from the paper's source gets a card, with a click to delete the
  line: a line that starts with a single `%` followed by a LaTeX command or a table row
  (`% \vspace{2mm}`, `%Ours & 71.2 \\`), or a note to self (`% TODO ask Alice`). OpenReview
  posts it as typed. Other lines that start with `%` are the authors' own (`%%% W1 %%%`
  headings, `% of runs ...`, a wrapped percentage) and are left alone, as are comments inside
  math or code.
- What a chat assistant leaves behind gets a card: the citation markers of its copy button
  (`:contentReference[oaicite:0]{index=0}`, the `citeturn` and `filecite` entities,
  `【4†source】`, a link labelled `oai_citation:5‡Source`), its address to the user ("Here is a
  revised version of your rebuttal:") and its self-description ("As an AI language model,
  I ..."). A click deletes a marker without joining two words or changing a list or heading,
  or the opening without the text after it; a link keeps its destination. Phrases authors use
  too ("I hope this helps", "Sure! Here are the results:") get nothing.
- `[Your Name]`, `[Your affiliation]` and the like count as placeholders; `[Authors]` as an
  anonymous signature does not.
- A Codex review ran a broader first version on 310 real public author responses and found 49
  false cards; the checks were narrowed until only the two genuine ones remained (commented-out
  table rows), and those shapes are regression cases.
- The Compaction panel says that notification e-mails show the Markdown rendered but formulas
  as LaTeX source, so only the formula tricks change what a reviewer reads there (checked in
  Outlook).

## 3.9.0 (2026-11-27)

### The review beside its draft
- The right pane has keyboard-accessible *Preview* and *Review* tabs. Each draft keeps its
  review in this browser only, outside exports and the asynchronous store. Deleting the draft
  deletes its review. The review editor has its own undo and redo history for each draft.
- Pasting an OpenReview note keeps field names, paragraphs and numbered or bulleted items.
  Plain-text lists copied from the forum also yield separate points. The parser recognizes
  NeurIPS, ICLR, ICML, TMLR, EMNLP, ACL ARR and AAAI field names, skips scores and administrative
  fields, and keeps substantive limitations. Mixed fields can include praise alongside concerns.
- The reviewer's labels and the inserted labels use W, Q, L and C. A combined heading such
  as `(Weakness1, Question1)` covers both points. Visible quotes count, including complete short
  questions. Points with the same opening use the full text. Click a covered point to find it.
  The tab shows the count (*3/5*). A point without a match says *no part labelled W3*, since
  only the author can judge an answer written in other words.
- *Quote* and *Insert skeleton* add separate paragraphs. A caret inside a paragraph, a list or
  a code block inserts after that block, and a selection uses its end. One undo restores the
  original passage.
- Pasted code keeps its lines and a pasted table its rows and cells. A reviewer's own
  sub-heading inside a field (*Experimental Setup:*) keeps the items under it, and TMLR's
  *Explain your answer above* counts as comments, since it can hold a request.
- When the review names its reviewer (OpenReview's *Official Review ... by Reviewer k9F2*) and
  the tab is named for another one, the view says so; a tab named for no one can take the
  reviewer's name with one click.
- Two Codex reviews tested the view on 26 public reviews from ICLR, NeurIPS, ICML, TMLR and
  EMNLP (kept out of the repository; the tests use invented reviews of the same shapes). Every
  point an author would answer is found, both from a field-by-field paste and from a copy of
  the forum page; some extra rows remain, mostly praise or explanations inside a field of
  concerns, which the parser keeps rather than risk dropping a real concern.

## 3.8.0 (2026-11-27)

### Venue rules, checked again on 2026-11-27
- The rule of the chosen venue now shows beside the character counter: the rules it follows
  (with their year where they have one), what the limit counts and its link rule, for example
  *NeurIPS 2026 · per review · no links (code for the AC excepted)*. Hover for the full rule,
  its sources and the date it was checked; click to open the official page.
- A venue whose rules state no number (ICLR) no longer keeps the limit of the venue chosen
  before it: it uses the limit you typed last (5,000 until you type one), and the counter says
  *your limit*. So does a limit you type over a venue's, with the venue's own number beside it.
  A limit stored by 3.7 counts as yours unless it is the stored venue's own (3.7 could leave
  one venue's limit under another, which cannot be told apart from a typed one). A venue picked
  in the first moments, before the stored preferences are read, keeps its own limit.
- ICML cites its 2027 instructions (5,000 characters per round, unchanged). AAAI is labelled
  AAAI-26: the 2,500 characters come from its FAQ, and the AAAI-27 call states no character
  limit. ACL ARR forbids external links, so a link into the OpenReview forum (a path, a query or
  a fragment) is no longer flagged there, while `//host` links are. ICLR's guide asks for code in
  an anonymous repository and demos on hosts that do not track visitors: a link that may name the
  authors gets a warning there, a shortened URL a warning (an error only at ICML, which names
  them). The NeurIPS rule names its one exception: an anonymized link to code the
  reviewers asked for, sent to the AC in an Official Comment.
- Two new presets for venues that keep OpenReview's default forms (workshops, smaller venues):
  *OpenReview default comment* (5,000 characters) and *OpenReview default rebuttal* (2,500).

### Reviewer IDs across drafts
- A draft whose tab is named for a reviewer (`Reviewer k9F2`, `k9F2`, `R2`) gets a card when it
  addresses another one: a salutation (*Dear Reviewer Ab12*), a line such as *Response to
  Reviewer Ab12*, or thanks to that reviewer in its opening or closing. That is the sign of an
  answer copied from another draft. Mentions in passing (*as Reviewer Ab12 also noted*, *thank
  you for raising the same concern as Reviewer Ab12*), joint thanks to several reviewers, quotes
  and a general response are left alone, and IDs are never compared with numbers.
- An ID written in other capitals than every tab's (`k9f2` for `k9F2`) gets a card, since
  OpenReview IDs are case-sensitive.
- Both are advice: nothing changes the text, and Fix all does not count them. The cards follow
  the tabs' names, renamed here, in another window or on another device.
- Two Codex reviews of these checks found cards on ordinary sentences; the checks were narrowed
  to what is unmistakable, a planned check of pointers such as *see our answer to Reviewer
  Ab12, Q2* was left out for now, and every sentence the reviews tried is a regression case.

## 3.7.0 (2026-11-25)

### Tables pasted from Word, Google Docs and web pages

- Copy a table from Word, Google Docs, Sheets, Excel, or a web page and paste it into the
  editor. Choose *Convert* to preview the Markdown. Bold, italics, and alignment carry over
  when the clipboard includes them as tags or inline styles. Merged cells become ordinary
  cells, and warnings point to the affected rows.
- You can also paste directly into *Import table*. Editing the text there switches the preview
  to your edited version. One undo after insertion brings back the original editor text.

### Sections and wording
- *Sections* (under the hazards) lists the parts of a draft with the length of each, counted
  like the limit, and its share of the comment: a heading starts a part, and so does a
  paragraph, list item or quote that opens with a label such as `**W1.**`, `**Q2:**` or `W3:`.
  Points are listed under their heading, so a combined answer to several reviewers shows each
  reviewer's total and each point's. Click a part to go to it.
- *Wording* suggests shorter ways to say the same, with what each would save: filler phrases
  (*in order to* for *to*, *due to the fact that* for *because*, *We would like to thank* for
  *We thank*) and long names used three times or more, which an abbreviation would shorten
  (*Contrastive Language-Image Pre-training*, four times, as *CLIP*). It is advice only and
  never changes the text; code, math, quotes and link addresses are left out. Click a phrase to
  go to it, and again for its next use.

### Editing
- *Find* (or Ctrl+F, ⌘F in the editor) searches the source, with a match-case switch, and
  replaces one match at a time or all of them; one undo takes back *Replace all*, which also
  keeps a version in History. The matches are highlighted in the editor while you type in the
  find field.
- Double-click a word or a formula in the preview to select it in the source.
- *Spellcheck* (beside *Find*) turns on the browser's spellchecker in the editor. It is off by
  default, since TeX and Markdown are full of words it does not know.
- With several panels open under the editor, the editor keeps at least 30% of the pane, the
  hazards their header and a card, and an open panel some of its content; the panels share the
  rest, each scrolling on its own, and only a window too short for all of that scrolls the pane.
- A Codex review of these features found eight problems before release, all fixed: the layout
  could hide the hazards in a short window, a *Replace all* that changed nothing offered an undo,
  a double-click could select a word inside a formula or a link's address, find's highlights
  stayed put after a font-size change, an indented first line made *Sections* and *Wording*
  read the comment differently from the preview, *Wording* could flag code in a list indented
  with tabs, *Sections* took a bold sentence subject for a point, and two filler rules could
  change the meaning (*would like to* is now only suggested before *thank*, *clarify* and the
  like, and *whether or not* is no longer flagged).

### Project
- `tests/sections.test.js`, `tests/wording.test.js` and `tests/editing.test.js`, and HTML tables
  in `tests/table-import.test.js` (Codex). Fourteen new smoke checks.

## 3.6.0 (2026-11-25)

### Import
- *Import…* in the History dialog reads back a file that *Export all drafts* wrote, or a `.md` or
  `.txt` file as one draft. It only adds: each draft whose text you do not have yet becomes a new
  tab, under its name in the file (numbered when a tab already has that name), and the open draft
  stays open. A draft this browser has no room for is left out and named. No draft is replaced or
  changed and no earlier version is given up to make room for an imported text, so an import
  cannot cost any text, and the file is still there to import again. Where a hosted page keeps
  drafts only in its own storage, a second message says what that storage confirmed. This
  replaces the all-or-nothing design that three reviews before 3.5.0 kept finding ways to break.

### History
- The versions of all drafts now share one budget of about a million characters, and the oldest
  go first, whichever draft they belong to: a draft left alone for weeks gives way before the one
  you are editing. When the browser's storage is full, a new version or a draft makes room the
  same way, oldest first, where before a draft that needed space removed every stored version at
  once. Only when that is not enough, as before, do all of them give way to the draft.
- Versions are no longer held in memory to be written later. That code is what nine reviews of
  3.5.0 kept finding new ways to break; now a version that finds no room is simply not kept, and
  undo still has the text.

### Fixes
- A page you come back to with the browser's Back button takes in the list of drafts as other
  windows left it. Before, if its open draft had been deleted in another window meanwhile, what
  you typed afterwards was saved under the deleted draft, where no tab showed it.
- A draft deleted in one window comes back if another window still has it open, as before, but
  that window no longer writes its own text over a newer one saved since: when a third window had
  already brought the draft back and saved it, or when the browser delivered the deletion late
  (Chrome does, after the Back button). Also in 3.5.0.
- Where drafts are kept in a hosted page's storage, a draft deleted on another device and brought
  back by this window (by a rename, for instance) came back without its text. Also in 3.5.0.
- Messages now show above the History and Split dialogs; on a narrow screen, History hid most of
  them.

### Project
- `tests/history.test.js` covers the budget, reading import files and the import plan. Thirteen
  new smoke checks; two retired with the code they tested. A Codex review of the first version and
  a re-check of its fixes found the fixes above (`reviews/2026-11-25`).

## 3.5.0 (2026-11-21)

### History and export
- *History* (beside the draft tabs) lists earlier versions of the open draft, each with its
  time, why it was kept and its length. One is kept before *Fix all*, *Apply to source*, *Clear*,
  *Load example* and a restore, and, every 10 minutes while you edit, the text before the edit:
  up to 20 per draft, in this browser only. *Restore* is undoable; *Copy* copies a version.
- Versions never cost a draft: when a draft cannot be saved for lack of space, the stored ones
  give way, so with this browser's storage full earlier versions are kept on a best-effort basis
  and may be lost (without browser storage, they last until the page is reloaded). Deleting a
  draft deletes its versions, in other windows too; a draft that comes back because another
  window still had it open comes back without them.
- Restore writes like typing, so it waits until this window has the draft's latest text: it
  refuses while the draft has not loaded completely, and when another window or device has
  saved it since this one loaded it.
- *Export all drafts* writes every draft to one `.json` file, and *Download this draft* the open
  one as `.md`, as a backup; neither changes anything stored. A draft that has not loaded is
  named and left out, never written as blank. With this browser's storage full, a window exports
  its own copy of a draft it could not save, even if another window has saved a newer one since.
  Importing drafts is not included yet: three Codex
  reviews kept finding ways for it to lose text when storage is full or several windows write at
  once, so it waits for a safer design.
- History, Split and Import table are bound to the open draft: they close when it changes, and
  nothing behind them can be reached while they are open.

### Fixes
- An offer to convert a pasted table could, after a switch to a draft with the same text, insert
  into that other draft.

### Project
- `tests/history.test.js` and sixteen smoke checks. Nine Codex reviews and a design review by
  Fable (`reviews/2026-11-21`).

## 3.4.0 (2026-11-21)

### Before posting
- Placeholders left in the text get a warning: `TODO`, `TBD`, `FIXME`, `XXX`, numbers to fill
  in (`XX.X`, `x.xx`, `XX%`), cross-references (`Table X`, `Fig. ??`, `Section XX`),
  `Reviewer X`, `[cite]`, `[citation needed]`, `[add …]`, `??` and lorem ipsum. Each pattern
  counts only where it is unmistakable: `??` in code, `XXX` in math and `[Update]` notes are
  left alone.
- Invisible characters and ligatures from a PDF copy (soft hyphens, zero-width spaces,
  direction marks, `ﬁ`) get one card each, whose fix removes or spells out all of them. They
  count toward the limit and keep a search from finding the word.
- The comment as posted: OpenReview trims a comment when it posts it (`constructEdit` in
  openreview-web's `client/view-v2.js`), so an indented first line is ordinary text there, not
  a code block. The preview and every check now read the trimmed comment, and a card says when
  the trim changes how it reads. This also stops Fix all from editing text that the trim turns
  into code, a problem older versions had.

### MathJax problems as cards
- Once MathJax has typeset the preview, a formula it cannot typeset gets a card with MathJax's
  message (`Double exponent: use braces to clarify`); when a Markdown card on the same formula
  may be the cause, it says so.
- A macro MathJax does not know gets one card for all the formulas that use it. Where MathJax
  has a replacement, the card's fix applies it everywhere: `\bm` → `\boldsymbol`, `\mathbbm` →
  `\mathbb`, `\argmax` → `\mathop{\mathrm{arg\ max}}`, `\R` → `\mathbb{R}`, `\abs{x}` →
  `\lvert x\rvert`, `\diag` → `\operatorname{diag}`, and others. Each replacement is tested to
  typeset inline, displayed and in a table cell. A macro defined after its first use gets
  advice instead, and an unknown one the `\newcommand` to copy from the paper.
- A fix is offered only once the preview shows exactly the text in the editor, and only for the
  uses MathJax reported (not a `\label` key, `\verb` text or a comment). When clicked, MathJax
  compiles the whole comment with it: the fix applies only if the macro is gone, nothing new
  fails, and every other formula, references included, comes out exactly the same.
- Two Codex reviews of this feature found 35 problems (stale fixes, a fix that let Markdown pair
  emphasis across two formulas or changed another formula's value through a local `\def`, cards
  on the wrong formula, placeholders in hidden text, red `\verb` text taken for a macro, a
  `\DeclarePairedDelimiter` or `\mathtoolsset` from the table preview leaking into the draft's
  preview, a split that cut a fenced block posting creates, and others). All but two contrived
  ones are fixed and covered by tests: red text an author writes with
  `\mmlToken{mtext}[mathcolor=red]{\R}` still looks like an undefined macro (its fix is refused),
  and a card can point at math in an image's title when the same formula also appears in text.

### Project
- DOMPurify 3.4.17, which openreview-web now uses (reported by `npm run check-upstream`).
- The drift check also watches the trim on posting.
- `tests/preflight.test.js` and ten smoke checks.

## 3.3.0 (2026-11-21)

### Drafts
- A tab per draft (an answer per reviewer, a general response, a follow-up), each with its length
  against the limit; double-click to rename, × to delete. Each draft autosaves under its own key
  with the same protection against a slow asynchronous store; existing drafts carry over as the
  first tab. Switching drafts gives the editor a fresh undo history, so Ctrl+Z cannot carry text
  from one draft into another. Several windows, several devices sharing an asynchronous store, a
  slow or failing store or a reload at any moment cannot lose or mix up a draft (three Codex reviews
  probed this with over 60 scenarios and Chrome checks): random draft ids, the list merged with every
  other copy rather than overwritten, writes queued in order and marked pending until confirmed,
  deletions retried until confirmed, only real edits written back, nothing typed before the open
  draft is restored, and any draft body missing from the list given its tab back. The tabs work
  from the keyboard (arrows, Enter, F2 to rename the focused tab).

### Splitting into several comments
- *Split into comments…* (in the Compaction panel) cuts a draft over the limit into numbered parts
  under it: between blocks, or between table rows (header repeated), list items (an ordered list
  keeps counting) and sentences, never inside a formula, code or a link. Parts can be copied one
  by one or opened as drafts. Macros and labels used across parts are reported (each comment is
  typeset on its own), link reference definitions are repeated where used, and the venue presets
  say where only one response is allowed (AAAI, ACL ARR, one per round at ICML).

### Table import
- Import LaTeX tables, spreadsheet selections and quoted CSV into the source editor as
  OpenReview Markdown. Preview the result and line-numbered warnings, choose padded or compact
  columns, and insert with one undo. Pasting LaTeX or tab-separated rows in the editor offers
  the same conversion for the pasted range.

### Formula compaction
- Compaction can now shorten formulas when MathJax produces identical MathML. It removes
  ignored spaces, shortens single-token arguments and aliases, uses `\cr` between rows,
  and removes redundant display-environment wrappers. All five switches are on by default.
  Each comparison starts with fresh TeX definitions and checks every formula in order.
  The new tricks save 20 characters on the padded-tables draft and 85 on the theory response.

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

## 3.0.0 (2026-09-22)

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
