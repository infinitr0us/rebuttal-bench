# Third-party excerpts

`openreview-web.json` holds verbatim excerpts of
[openreview-web](https://github.com/openreview/openreview-web) (its Marked renderer and
options, DOMPurify configuration, MathJax configuration, character counter and note styles), as
of the commit recorded in the file. `npm run check-upstream` compares them with the latest
openreview-web to report when OpenReview changes something the page mirrors.

These excerpts are **not** part of Rebuttal Bench's own code and are not covered by its MIT
licence:

> Copyright © 2019-2026 OpenReview. openreview-web is free software, licensed under the GNU
> Affero General Public License, version 3 or (at your option) any later version. The full text
> is in [`LICENSE-AGPL-3.0.txt`](LICENSE-AGPL-3.0.txt); openreview-web's own copy is its
> [`LICENSE.md`](https://github.com/openreview/openreview-web/blob/master/LICENSE.md).

They are kept here only as data for the comparison and are distributed alongside Rebuttal Bench,
not combined with it. The page and the test pipeline re-implement the behavior they describe
(which HTML tags survive, how images and checkboxes are rendered, which delimiters MathJax looks
for, the note's font sizes) so that the preview matches openreview.net.
