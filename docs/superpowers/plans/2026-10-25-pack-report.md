# Halloween pack — build report

**Date:** 2026-10-25
**Safe to read.** No prompt, no choice and no answer appears below. This is
the account of how the pack was built and what was rejected, written so the
person who owns this repo can audit the process without spoiling their own
game.

---

## What shipped

A six-by-five board, thirty clues, values 200 / 400 / 600 / 800 / 1000.

| Category | Kind | Clues |
|---|---|---|
| Who's That Killer? | pixelated image | 5 |
| Blurry Treats | pixelated image | 5 |
| Monster Mash | trivia | 5 |
| Reel Frights | trivia | 5 |
| Trick or Treat | trivia | 5 |
| Things That Go Bump | trivia | 5 |

Four options on the 200 / 400 / 600 rows, six on 800 / 1000. Every clue is
answered by picking one; nothing is typed.

The Twilight reference you asked for is in there. It is a real, sourced,
unambiguous question rather than a gag, and its position is not disclosed.

## Images: where they came from

All ten are from **Wikimedia Commons**, under CC0, public domain, CC BY or
CC BY-SA licences. Every clue records the Commons page, the licence and the
photographer's name.

This was a deliberate change from the original plan, which said "pull images
from the web". Commons gives the pack a licence story it would not otherwise
have — the design spec flags that an arbitrary web-sourced pack could not ship
if this portal ever became the commercial product the portal spec describes.
With Commons, it could.

**Filenames are content hashes.** A file called `hockey-mask.jpg` would put
the answer in the file tree, in `git log`, and in the URL every player's
browser requests *before* the reveal. All ten are sixteen hex characters and
an extension, and a test enforces it.

## Images: what was rejected, and why

Thirteen candidates were pulled; three were cut after looking at them.

| Rejected | Reason |
|---|---|
| A Jason Voorhees photo | Crowded convention floor — several other costumed people in frame. Fails "alone in frame, not a group scene". |
| A Ghostface photo | Subject small against a banner with legible event text. Fails framing, and the text is a caption near the subject. |
| A Freddy Krueger photo | Lit in deep red and green; too dark to read even un-pixelated, and hopeless under a mosaic. |

Two further changes while building:

- **A jack-o'-lantern was dropped from Blurry Treats.** It is not a treat, and
  a category whose distractors are not all the same kind of thing turns a
  one-in-four into a one-in-two.
- **The category is candy, as you asked.** Commons' coverage of branded
  wrappers is thin, so it mixes wrappers with other Halloween sweets. Both
  wrappers that did make it are the real thing.

## Mosaics: every one was checked by eye

Each image was rendered at its proposed block count and looked at, which is
the step that makes the point values mean something. Two were re-tuned:

- **One 200-value clue was unreadable** at the block count the design guide
  suggested — its subject is a fine repeating pattern rather than a
  silhouette, so a coarse mosaic averaged it to a single colour. Its block
  count went up sharply. A 200 nobody can get is worse than an easy one.
- **The wrapper clues moved to the top of the board.** A wrapper is identified
  by its brand colours, which survive a coarse mosaic, while its brand *name*
  must not become readable — so the block count is capped, which makes them
  genuinely hard, which is where they belong. This inverts the design spec's
  general guide, deliberately and only for these two.

## Trivia: how each one was checked

Every fact was confirmed against a source at the time of writing rather than
recalled, and the URL is recorded on the clue. Four were checked against live
searches because they are the kind of thing people misremember.

Rules applied to all twenty, per the design spec:

- One unambiguous answer. If a careful person could defend a second answer to
  the question as written, it was rewritten.
- No facts with a shelf life — nothing phrased "most", "latest" or "currently".
- No trick phrasing.
- Distractors plausible and same-category, never arguably correct, never
  distinguishable by shape alone, and distinct after normalisation.

One planned clue was rewritten because it rested on a "first ever" claim that
a well-informed player could reasonably dispute. "First" claims are exactly
what the spec warns about, so it was replaced with a question of fact.

## What a test now guards

- Every category is full and every value appears exactly once.
- Choice counts match the row: four low, six high, all distinct.
- Every clue of both kinds carries a source URL and a verification date.
- Every image file exists **at the URL the browser will request** — not merely
  somewhere on disk, which would pass while every image 404s in the game.
- No image filename names its answer.

Validator messages identify a clue by category and value only, never by its
text, so a failing run is safe for you to read.

## The honest caveat

This pack was built in a session you can scroll back through. The content
passed through that transcript, so the only thing protecting goal 9 — that you
can play fairly — is you not reading it. If this matters for a future pack,
build it in a session you never open, or have someone else run the build.
