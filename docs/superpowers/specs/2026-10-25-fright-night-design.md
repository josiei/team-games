# Fright Night — Design Spec

**Date:** 2026-10-25
**Status:** Draft for approval
**Author:** Jocelyn Icaza (design conversation), written up by Claude
**Depends on:** [`2026-10-12-team-games-portal-design.md`](2026-10-12-team-games-portal-design.md)
**Reference images:** [`assets/2026-10-25-fright-night/`](assets/2026-10-25-fright-night/)

---

## 1. Purpose and context

The second game in the team-games portal: a Halloween quiz-board game for two
teams, in the shape of Jeopardy. Categories run across the top of a board, point
values increase down each column, and the team in control picks a tile. The tile
opens a clue — either a **pixelated photograph** to identify or a **text trivia
question** — and both teams race to buzz. **Every clue is answered by clicking
one of four or six buttons**; nobody ever types. The team that buzzes picks an
answer against a clock; a miss hands the clue to the other side.

Three things are being built, separable in that order:

- **The portal layer** — a game picker with thumbnail cards, plus lobby support
  for teams and avatars. Shared infrastructure every future game reuses. The
  portal spec §5 promised game #2 would be "one module plus one array entry";
  §4.1 records exactly where that holds and where it does not.
- **The board and buzzer engine** — categories, tiles, control, the reading
  window, the buzzer race, choices, scoring.
- **The content** — one clue pack of pixelated images and trivia.

**Occasion.** An internal Halloween session with the author's remote work team,
fewer than 15 people, on a video call, each on their own laptop. Played live,
once, in late October 2026.

**Success looks like:** two teams form without anyone being told how; the room
gets loud at the moment someone buzzes; at least one clue starts an argument;
and the author — who built the whole thing — can play without an advantage.

### Guiding principle

Inherited from the portal spec: build only what is expensive to reverse. One
thing here is expensive to reverse and goes into shared code deliberately — a
board game cannot express itself in a linear phase list (§4.1). Everything else
is this game's own module, or a lobby feature any future team game reuses.

---

## 2. Goals, non-goals, anti-goals

**Goals**

1. A Jeopardy-style board: categories across the top, increasing point values
   down each column, tiles that empty as they are played, all of it inside a
   rendered game-show set.
2. The team in control decides together and any member clicks the tile; clicking
   launches the clue.
3. Two clue kinds on one board — a pixelated image to identify, and a text
   trivia question.
4. **One answer mechanism for both: buttons.** Four on the low rows, six on the
   high ones. No text input anywhere in the game.
5. A buzzer any team member can press for their team, dead until the clue has
   been readable for a moment, then visibly armed.
6. One shot per team per clue; both teams miss and the answer is revealed with
   nobody scoring.
7. Two lifelines per team per game, spendable on a clue they have buzzed, whose
   benefit is visible only to the team that spent it.
8. Score on screen throughout.
9. A picker screen with thumbnails so this and `pumpkin-carve` sit side by side.
10. **The author can play fairly.** They will not have seen the clue pack, and
   nothing in the build requires them to.

**Non-goals**

- Typed answers, free-text input, or answer matching of any kind.
- More than two teams.
- Daily Doubles, wagering, or a Final Jeopardy round.
- Audio, music, or buzzer sounds.
- A second doubled board.
- Mobile layouts. Laptops, as the portal spec assumes.
- Persistent rosters, cross-session leaderboards, or any account system beyond
  what the portal already has.

**Anti-goals** — things that would make this a failure even if it worked

- **A referee.** Any mechanism where a human judges an answer puts the host in
  the position of seeing answers early, and the host is playing. No host
  override of a result. §3, §8.5.
- **Gore.** This is a work event. An image that makes someone uncomfortable on a
  Monday call fails, however recognisable it is. §7.3.
- **A distractor that is arguably also correct.** With buttons, this replaces
  "a right answer the matcher rejects" as the way a clue can cheat a team. A
  team picks a defensible answer, the game calls it wrong, and there is no
  referee to appeal to. Distractor quality is therefore a correctness
  requirement, not a polish one. §7.4.
- **A buzzer race decided before anyone has read the clue.** The reason for the
  reading window, §8.3.
- **A clue that lands in silence** — unidentifiable even revealed, or a question
  nobody could have known with its options in front of them.

---

## 3. Decisions, as made

Decisions the author made in conversation, in their words where it matters:

| # | Decision | Notes |
|---|---|---|
| 1 | Two teams, chosen by the players, each with an avatar and a screen name | "my team can divide into two teams and choose their avatar and screen name" |
| 2 | A **Jeopardy board**: "ui for the board with increasing points like jeopardy and categories on top" | `ref-jeopardy-board.png` |
| 3 | **Points, not money** — "this is the idea for the board, but not money" | No `$` anywhere |
| 4 | The team picks a tile together, any member clicks it, and that **launches the question or image** | §6.1 |
| 5 | **"Who's That Killer?"** is the pixelated-image category | "who's that killer can be this pixel game" |
| 6 | The other categories are **text trivia** | "and then the other categories can be trivia" |
| 7 | The clue stage looks like a game-show room, avatars behind the team podiums | Mockup layout A, chosen from three; §6.2 |
| 8 | Score is visible on screen throughout | §6.0 |
| 9 | Anyone on a team may buzz, for the whole team | |
| 10 | Buzzing starts a clock; running out passes the shot to the other team | |
| 11 | Image blur is **fixed per image**, set by its difficulty | Rejected: blur sharpening on a clock, and on a wrong answer |
| 12 | Both teams miss → reveal the answer, nobody scores | One shot per team per clue |
| 13 | Images are **pulled from the web** | Pixelating pixel art does not read; the mosaic needs a photo under it |
| 14 | Every image must be **verified to actually depict its answer** | "or else that will ruin the game" |
| 15 | A separate pack of test content for development | So the author can play the real pack fairly |
| 16 | **Nothing too gory — it is for work** | Hard content rule, §7.3 |
| 17 | Games are chosen from a picker, each with a thumbnail | §4.3 |
| 18 | Research how Jeopardy handles buzzers and follow it | Findings and what we take, §8.3 |
| 19 | **Dev trivia questions too**, and the real trivia pack must be **verified accurate** | "we have to verify our trivia question pack to make sure they are accurate" |
| 20 | The board sits inside a rendered **game-show set** — proscenium, pillars, curtains, spotlights, starfield — scores on a rail along the bottom | `ref-jeopardy-set.png`; §6.0 |
| 21 | The six categories in §5.2 are approved; the second image category is **pixelated candy wrappers** | "that's good yeah it could be pixelated candy wrappers" |
| 22 | At least one clue references **Twilight** | An in-joke. Which clue is not disclosed (§7.2) |
| 23 | Trivia is answered with **buttons**, not a text field | "we might be better off with like four buttons that appear with different answers and the team can click on one… that might be best for all them TBH" |
| 24 | **Difficulty scales with button count** — four on low rows, six on high | "if we want to increase difficulty we can show 6 buttons" |
| 25 | **No typed text fields anywhere, image clues included** | "yeah no typed textfields anywhere even on the image ones we will just do buttons" |
| 26 | **Each team gets a small number of lifelines** that give them a hint | "each team can have like 1-2 clue helpers like the idea of phone a friend… the teams can decide to use this life line and it gives them a hint" — §8.6 |

### What decision 25 removes

This is the largest simplification in the design and it is worth stating plainly,
because earlier drafts of this document were built around the opposite choice.

**There is no answer matcher.** No normalisation, no edit-distance tolerance, no
alias lists, no `fright-answers.ts`, and no tests for any of it. An answer is an
index into a shuffled list, compared for equality. What was the riskiest
subsystem in the build — the one whose failure mode was named in the anti-goals —
no longer exists.

The risk does not vanish, it moves: it is now entirely a **content** risk. A
badly chosen distractor is the new way a clue can cheat a team, and the only
defence is §7.4. Code cannot help.

### Rejected, with reasons

- **Blur that sharpens on a clock, points dropping as it does.** Real tension,
  but punishes a team that recognises an image instantly while the other side
  dithers. The author chose fixed blur per difficulty.
- **Blur that sharpens on a wrong answer.** Would make the steal fairer; the
  author chose fixed. The steal is balanced instead by the stealing team having
  seen the first team's wrong answer eliminated.
- **A host override for a wrong result.** Proposed, then withdrawn in the same
  conversation: the host is playing, and an override means seeing answers early.
  With buttons there is nothing to adjudicate anyway.
- **PixelLab-generated guessables.** PixelLab makes the chrome — the set,
  avatars, thumbnails — not the images being guessed.
- **Host uploads their own images at setup.** Offered; the author chose a
  bundled pack.
- **A linear round list** (the shape of this document's first draft). The board
  makes clue order player-chosen, which a fixed sequence cannot express.
- **Hiding the choices until after the buzz.** Would turn every clue into a
  gamble on a 25% guess rather than a test of recognition. The choices are part
  of the clue (§6.2).
- **Latecomers joining a team mid-game.** Written into an earlier draft as a
  default, then withdrawn: the store already makes it impossible (§4.2).

### Settled by the writer, not the author

Stated as defaults and not contradicted, or decided while writing. A builder may
treat these as decided; they are the writer's calls.

- **Board shape:** 6 categories × 5 rows, values 200/400/600/800/1000 — matching
  `ref-jeopardy-board.png` with the `$` dropped per decision 3. No host-selected
  board size: the board is whatever shape the pack declares (§4.5).
- **Two image categories, not one.** The author named one. On a 30-tile board
  that uses the game's signature mechanic five times out of thirty; a second
  brings it to ten. Proposed by the writer, then confirmed and named by the
  author (decision 21).
- **Wrong answers cost nothing.** Real Jeopardy subtracts the clue's value, which
  is what stops contestants buzzing on everything. Here the cost is the shot plus
  handing the other team a narrowed field, and the author said "nobody gets
  points," which reads as no negatives. Flagged for the playtest: if teams buzz
  blind and guess, the fix is a half-value penalty.
- **Board control** starts with a team chosen from the room seed and passes to
  the team that answered correctly; if nobody did, to the other team, so control
  alternates rather than sticking.
- **Host powers:** start, skip the current clue, end early. None reveal an
  answer. Authorised per §4.4.
- **Teams** are self-picked with a nudge when the sides are lopsided, not
  auto-balanced. The roster is frozen when the host presses Start (§4.2).
- **Results** show the final score, "most buzzes" and "most correct" by player,
  and a gallery of every image clue un-pixelated with its answer.
- The game is named **Fright Night**, id `fright-night`. Rename freely.

---

## 4. Architecture

Four changes to shared code. §4.1 is the significant one; the rest are small and
each exists because a specific rule in this game has nowhere else to live.

### 4.1 `nextPhase` — the board cannot be a list

The portal spec §5 claims a new game is "one module plus one array entry." That
holds for almost everything here. It does not hold for the board, and
`packages/server/src/rooms/runtime.ts` says why:

**`GameModule.phases` is a linear array and `RoomRuntime.tryAdvance()` walks it
by index.** There is no way to say "back to the board, thirty times, in
player-chosen order, then results."

Three ways out were considered:

1. **Generate the phase list** — `['lobby','board-1','clue-1',…]`. `phases` is a
   static readonly on the module, so it cannot vary per room, and a short board
   could not skip its unused tail. Rejected.
2. **Collapse to one `play` phase** driven by `ctx.setTimer`. `onPhaseEnter` and
   timer callbacks cannot write state — only `reduce` and `setPhase` can — so
   every transition would need a new escape hatch anyway, and every countdown
   would have to be duplicated into the view because `snapshot.endsAt` carries
   only the phase clock. Rejected as the larger change wearing smaller clothes.
3. **Let the module choose its own next phase.** Adopted.

```ts
/**
 * The phase to enter when this one ends, or null to stop. Omit it and the
 * runtime walks `phases` in order, exactly as before.
 */
nextPhase?(state: State, current: string): string | null
```

`tryAdvance()` consults it when present and falls back to index + 1 when absent.
`pumpkin-carve` does not implement it and is untouched.

Everything else follows for free: `phases` becomes the set of distinct phase
names, `room.config.phaseMs` keys off those names so each has its own duration,
`snapshot.endsAt` is the real deadline behind every countdown the UI draws, and
`resume()` restores a clue mid-flight with no new code.

Two guard rails ship with it, because an index walk could not loop and this can:

- **A hop budget.** `nextPhase` returning its own phase, or two phases returning
  each other, must not spin. Cap transitions per room (a 30-tile board uses about
  180; 500 is a safe ceiling) and `failRoom` past it.
- **Unknown phase names.** A returned string not in `phases` is a module bug;
  treat it exactly like a failed `enterPhase` and fail the room visibly rather
  than stall silently.

### 4.2 Teams and avatars, and why the roster freezes at Start

Team choice happens in the lobby, before Start, as in `ref-codenames-lobby.png`.
So it cannot live in game state, which does not exist until `createState` runs.

**`Player` in `packages/shared/src/game.ts` gains two fields:**

```ts
avatar: string        // id from the shared avatar set; '' until chosen
team: string | null   // team id, or null for no team / games without teams
```

Both are generic lobby concepts, not Halloween ones. `pumpkin-carve` ignores
`team` and gains avatars in its lobby for free.

**`GameModule` gains optional team metadata:**

```ts
readonly teams?: readonly { id: string; name: string; color: string }[]
```

The lobby renders team columns only for a game that declares them, so
`pumpkin-carve`'s lobby does not change shape. `fright-night` declares `blue`
(`#3B82F6`) and `red` (`#EF4444`).

**New lobby endpoint**, beside the existing join/start routes in
`packages/server/src/http/rooms.ts`:

`POST /api/rooms/:code/me` — body `{ playerToken, avatar?, team? }`. Authenticates
by token exactly as `/start` does, validates the avatar against the shared set and
the team against the selected game's declared teams, writes through to both the
live store and the repo, and broadcasts a snapshot.

**The roster is a snapshot taken at Start, and this is forced, not chosen.**
`reduce(state, action, by)` receives the actor's id and nothing else — it never
sees a `Player`, so it cannot ask what team `by` is on. The only hook that sees
players is `createState(players, seed)`. Therefore `createState` copies
`{ playerId → team }` into game state, and every team rule in §8.3 reads it from
there. Consequences the builder must not try to work around:

- `POST /me` after Start changes nothing in the game. Reject it with a clear
  code rather than appearing to work.
- A player who disconnects stays on their team in state and stays visible on the
  podium, dimmed. `viewFor`'s `waiting` argument is filtered to *connected*
  participants and is the wrong source for the roster.
- **Latecomers cannot join a team.** `InMemoryRoomStore.addPlayer` already sets
  `spectator: room.phase !== 'lobby'`, and `participants()` filters spectators
  out permanently, so a latecomer was never passed to `createState` and cannot
  be on a team. They watch. An earlier draft of this document promised otherwise;
  that promise was wrong about the code and is withdrawn.

The alternative — feeding roster updates into state through a new
`applyPlayers(state, players)` hook — is a third contract change in the layer the
portal spec calls expensive to reverse, bought for a case (someone arrives late
to a 15-person call) that a spectator seat handles fine.

### 4.3 The game picker and thumbnails

**`GameModule` gains `thumbnail: string`** — a path under the web client's static
assets, e.g. `/games/fright-night/thumb.png` — **and `hidden?: boolean`** (§4.5).
`GET /api/games` already projects a field list; `thumbnail` and `teams` join it,
and hidden games are filtered out.

`JoinScreen.tsx` currently hardcodes `createRoom('pumpkin-carve')`. The picker
replaces that: "Start a new room" fetches `/api/games` and shows a card per game
(thumbnail, name, description, player range, estimated minutes, theme accent as
the card's glow), then creates the room with the chosen id. Joining by code is
unchanged — a guest types a code and never sees the picker.

Both games need a thumbnail or the picker ships half-empty. `pumpkin-carve` gets
one; it is otherwise untouched.

### 4.4 Host-only actions

`SKIP` and `END` must be host-only, but `reduce` is pure and has no notion of who
the host is: `hostId` lives on `LiveRoom` and `reassignHostIfNeeded` moves it
mid-game. Copying it into state at `createState` would go stale the moment the
host's laptop sleeps.

**`GameModule` gains `hostActions?: readonly string[]`.** `RoomRuntime.dispatch`
drops an action whose type is in that list when `by !== room.hostId`, before
calling `reduce`. The check sits in the layer that actually knows the answer,
`reduce` stays pure, and no new message types are needed. `fright-night` declares
`['SKIP', 'END']`; `pumpkin-carve` declares none and is unaffected.

Without this, any player could skip a clue they did not like — in a game whose
anti-goals are specifically about nobody holding referee powers.

### 4.5 Packs: two registry entries, not a new parameter

`createState(players, seed)` takes no configuration and `POST /api/rooms` accepts
only `{ gameId }`, but §7.1 needs rooms on the dev pack while §7.2 needs rooms on
the Halloween pack.

**A module is built by a factory over a pack**, and the registry holds two
instances:

```ts
export const GAMES = [pumpkinModule, frightNight, frightNightDev] as const
```

- `fright-night` — the Halloween pack. In the picker.
- `fright-night-dev` — the dev pack. `hidden: true`, so it never appears in the
  picker, and `name: 'Fright Night (dev pack)'`, which satisfies §7.1's "labelled
  on screen" for free: the name is already in the snapshot. Tests and `pnpm e2e`
  create rooms with this id directly.

No contract change, no new request field, no env var that would stop a game-night
server from running the e2e suite. The board's shape is derived from the pack's
own categories and values, so the pack is the single source of truth for what the
board looks like.

### 4.6 Where the files go

```
packages/shared/src/fright.ts              phases, state, reduce, nextPhase, viewFor, scoring
packages/shared/src/fright-pack.ts         pack types and the shuffle
packages/shared/src/avatars.ts             the shared avatar set
packages/server/src/games/fright/index.ts  the module factory + both instances
packages/server/src/games/registry.ts      two new entries
packages/web/src/games/fright/*.tsx        Set, Board, Tile, Stage, Podium,
                                           PixelImage, ClueCard, ChoiceGrid,
                                           Buzzer, Reveal, Results
packages/web/src/lobby/GamePicker.tsx      §4.3
packages/web/public/games/…                thumbnails, set art, pack images
content/packs/dev/pack.json                the development pack (§7.1)
content/packs/halloween/pack.json          the real pack (§7.2)
```

---

## 5. The clue pack

One pack describes a whole board. Both clue kinds share a shape; `kind`
discriminates. **Every clue has `choices`; no clue has a free-text answer.**

```jsonc
{
  "id": "halloween-2026",
  "name": "Halloween 2026",
  "values": [200, 400, 600, 800, 1000],
  "categories": [
    {
      "id": "whos-that-killer",
      "name": "Who's That Killer?",
      "clues": [
        {
          "value": 200,
          "kind": "image",
          "file": "7f3a9c21e4b85d60.jpg",   // opaque: never names the answer (§7.2)
          "mosaic": 10,                     // blocks across; fixed per clue (§7.5)
          "prompt": "Who is this?",
          // choices[0] is correct AS WRITTEN IN THE PACK. The room shuffles
          // them from its seed, so position leaks nothing and two rooms differ.
          // Exactly 4 on 200/400/600, exactly 6 on 800/1000 (§5.1).
          "choices": ["Jason Voorhees", "Michael Myers",
                      "Leatherface", "Ghostface"],
          "source": "<url>",
          "verifiedAt": "2026-10-25"
        }
      ]
    },
    {
      "id": "monster-mash",
      "name": "Monster Mash",
      "clues": [
        {
          "value": 200,
          "kind": "text",
          "prompt": "This Transylvanian count first appeared in an 1897 novel.",
          "choices": ["Dracula", "Nosferatu", "Lord Ruthven", "Carmilla"],
          "source": "<url>",               // the fact's source, not optional (§7.4)
          "verifiedAt": "2026-10-25"
        }
      ]
    }
  ]
}
```

The validator (§11) enforces: every category has exactly one clue per declared
value; every clue has a `source` and a `verifiedAt`; `choices` is exactly the
length its row requires with all entries distinct; an `image` clue has a file
that exists and a `mosaic` in range; no clue carries a free-text answer field.

### 5.1 Button count by row

| Row | Choices | Blind guess |
|---|---|---|
| 200 | 4 | 25% |
| 400 | 4 | 25% |
| 600 | 4 | 25% |
| 800 | 6 | 17% |
| 1000 | 6 | 17% |

A blind guess is never worthless, deliberately: a team that buzzes clueless on a
1000 still has one chance in six, so buzzing stays a live decision rather than a
solved one. The distractors do the real work (§7.4).

### 5.2 Categories

| Category | Kind | Content |
|---|---|---|
| Who's That Killer? | image | Pixelated horror-film icons (decision 5) |
| Blurry Treats | image | Pixelated **candy wrappers** (decision 21). Near-ideal source material: brand colour blocks survive a heavy mosaic, so a wrapper stays guessable while looking like nothing, and everyone has held one |
| Monster Mash | text | Classic monsters and folklore |
| Reel Frights | text | Horror films — years, directors, taglines, one-liners |
| Trick or Treat | text | Halloween history and customs |
| Things That Go Bump | text | Haunted places, urban legends, spooky animals |

---

## 6. The screens

### 6.0 The set

Every in-game screen is the same room. `ref-jeopardy-set.png` is a rendered
game-show **set** — proscenium with pillars and curtains, spotlights washing the
back wall, a starfield above, the board mounted in a frame at centre, and names
and scores along the bottom on lit rails. That set is the game's single
persistent frame; only the panel inside the proscenium changes.

| Phase | What is in the frame |
|---|---|
| `board` | The category grid |
| `reading`, `clue`, `steal`, `answer` | The clue and its choices |
| `reveal` | The full image or the clue, with the correct choice marked |
| `results` | The final scoreboard |

Consequences to hold on to:

- **The set is one component drawn once**, with a slot. The panel swaps; the
  pillars, curtains, lighting and score rails never re-mount, so the game reads
  as one continuous room rather than a sequence of pages.
- **Team scores live on the bottom rail** — name, avatars and score over a lit
  underline, as in the reference. Same information in the same place on every
  screen, including the board, which flanking podiums could not manage.
- The set art is PixelLab work and lands last (§12 step 11), so the layout must
  hold up with a placeholder set behind it, and the placeholder's proportions
  must be the real ones from the start.
- Everything inside the proscenium stays legible over Zoom compression at
  1280px. The set is decoration and gets no contrast budget (portal spec §8.3).

### 6.1 The board

```
┌═══════════════════════════════════════════════════════════════════════┐
║  ·  ·    ✦        ·      ✦   ·        ·     ✦      ·    ✦      ·   ·  ║
║ ║│║  ┌─────────┬─────────┬─────────┬─────────┬─────────┬─────────┐ ║│║ ║
║ ║│║  │ WHO'S   │ BLURRY  │ MONSTER │  REEL   │ TRICK   │ THINGS  │ ║│║ ║
║ ║│║  │ THAT    │ TREATS  │  MASH   │ FRIGHTS │   OR    │ THAT GO │ ║│║ ║
║ ║│║  │ KILLER? │         │         │         │ TREAT   │  BUMP   │ ║│║ ║
║ ║│║  ├─────────┼─────────┼─────────┼─────────┼─────────┼─────────┤ ║│║ ║
║ ║│║  │   200   │   200   │         │   200   │   200   │   200   │ ║│║ ║
║ ║│║  │   400   │   400   │   400   │   400   │         │   400   │ ║│║ ║
║ ║│║  │   600   │   600   │   600   │   600   │   600   │   600   │ ║│║ ║
║ ║│║  │   800   │   800   │   800   │   800   │   800   │   800   │ ║│║ ║
║ ║│║  │  1000   │  1000   │  1000   │  1000   │  1000   │  1000   │ ║│║ ║
║ ║│║  └─────────┴─────────┴─────────┴─────────┴─────────┴─────────┘ ║│║ ║
║  ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁  BLUE PICKS A CLUE  ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁   ║
║                                                                       ║
║   🧛👻🦇  BLUE          1400                  RED   800   🎃🧟🕷️      ║
║   ───────────────────────              ───────────────────────────    ║
└═══════════════════════════════════════════════════════════════════════┘
```

- **Played tiles go blank** and are not clickable, as on the show and in the
  reference, where the spent tiles are the dark ones.
- **Only the controlling team's tiles are live.** For everyone else they are
  visibly inert, with the banner naming who picks — so the room knows why its
  clicks do nothing rather than thinking the board is broken.
- **Scores sit on the bottom rail** (§6.0), not in a header and not on tiles.
- Hover and focus states on live tiles; the board is keyboard-navigable, because
  a grid of thirty click targets is exactly where keyboard users get stranded.
- A 30-tile grid inside the proscenium at 1280px gives roughly 150 × 60px tiles.
  Values are Archivo Expanded Black (portal spec §8.2) and must stay legible over
  Zoom compression — the set art must not eat the space that makes that true.

### 6.2 The clue stage

Chosen by the author from three mockups (preserved in `.superpowers/brainstorm/`):
**flanking podiums**, inside the same proscenium.

```
┌═══════════════════════════════════════════════════════════════════════┐
║  ·  ·    ✦        ·      ✦   ·        ·     ✦      ·    ✦      ·   ·  ║
║ ║│║        WHO'S THAT KILLER?  ·  600                            ║│║  ║
║ ║│║   ┌────────┐    ┌────────────────────┐    ┌────────┐         ║│║  ║
║ ║│║   │ 🧛👻🦇 │    │   pixelated image  │    │ 🎃🧟🕷️ │         ║│║  ║
║ ║│║   │  BLUE  │    │        ·OR·        │    │  RED   │         ║│║  ║
║ ║│║   │        │    │    trivia text     │    │        │         ║│║  ║
║ ║│║   └────────┘    └────────────────────┘    └────────┘         ║│║  ║
║ ║│║        ① Jason Voorhees      ② Michael Myers                 ║│║  ║
║ ║│║        ③ Leatherface         ④ Ghostface                     ║│║  ║
║ ║│║          ┌────────────────────────────┐                      ║│║  ║
║ ║│║          │   ···   READING   ···      │  ← dead, grey        ║│║  ║
║ ║│║          └────────────────────────────┘                      ║│║  ║
║                                                                       ║
║   🧛👻🦇  BLUE          1400                  RED   800   🎃🧟🕷️      ║
║   ───────────────────────              ───────────────────────────    ║
└═══════════════════════════════════════════════════════════════════════┘
```

- **The choices are on screen from the start of `reading`**, for everyone, inert
  until somebody buzzes. They are part of the clue, not part of the answer step:
  the room reads the question *and* its options during the reading window, and
  the buzz then means "I know which one," not "I'll gamble on a quarter."
- Image clues and trivia clues use the identical layout; only the centre panel
  differs. One stage component, two panels.
- Avatars stack above each podium; the numbers are on the bottom rail, not
  duplicated on the podiums.
- The buzzer is one wide target at the bottom, reachable without aiming.
- **During `reading` the buzzer is visibly dead** — grey, labelled, not a button.
  When it arms it flashes to full colour with a label change. That transition is
  the single most important animation in the game (§8.3).
- Dark shell per portal spec §8.3. The clue is the only bright thing on screen.

### 6.3 Buzzed in

The buzzer bar is replaced in place — the stage does not re-flow — and the
choices above it come alive **for the buzzing player only**:

- **For the player who pressed:** the choices become real buttons, in a 2 × 2 grid
  for four or a 3 × 2 for six. One click submits; there is no confirm step,
  because a confirm step on a twelve-second clock is only a way to lose to the
  clock. The buttons are numbered and the number keys work, since on a short
  clock the keyboard beats the trackpad.
- **A FLASHLIGHT button** sits beside the choices for the buzzing player, with
  the team's remaining pips on it, enabled only while that team has one left and
  has not already spent one on this clue (§8.6). Pressing it dims two of the
  four, or three of the six, **for that team only**.
- **For everyone else, both teams:** "🧛 wosie is answering for Blue", the same
  countdown, and the same choices still inert — so the room can shout at the
  person answering, which is the point of a team game. When a lifeline is spent
  they see "Blue used a Flashlight" and the pip go dark, but **not** which
  options were cut.

The buzzing team's podium lights; the other dims. The dim is always accompanied
by text, never colour alone (portal spec §8.3 accessibility rule).

On a steal, the first team's wrong choice stays visible and struck through. The
stealing team is choosing from a narrowed field, and seeing that is what makes a
steal feel earned rather than arbitrary.

### 6.4 Reveal

The correct button lights. An image mosaic crossfades to the full photo; a text
clue stays put. Scores animate. Three cases, each visibly different and labelled
in words: **correct** (which team, how many points), **both teams missed** (the
answer, no points), **nobody buzzed** (the answer, no points). Then back to the
board with the tile now blank.

### 6.5 Lobby

The existing lobby gains, for games that declare teams: two team columns with a
JOIN button each, an avatar picker, and the existing name field. The room code
stays the largest thing on screen (portal spec §8.4). Start stays host-only and
additionally requires both teams to be non-empty.

### 6.6 Results

Final score with the winning team called out, "most buzzes" and "most correct" by
player, and a gallery of every image clue un-pixelated with its answer — the part
people scroll back through while arguing.

---

## 7. Content

### 7.1 The dev pack

A small board — 2 categories × 2 rows, one of each kind — generated by a
committed script. Image clues are coloured shapes; trivia clues ask about the dev
pack itself ("what colour is the triangle in the 200 clue"), so they are correct
by construction, need no fact-checking, and let tests assert on content without
quietly depending on real-world trivia.

Every unit test, every Playwright run and every `pnpm playtest` uses this pack,
reached through the `fright-night-dev` registry entry (§4.5). **Nothing in the
build or the test suite reads the Halloween pack.**

### 7.2 The Halloween pack

Thirty clues — six categories × five rows, ten of them images — assembled by
Claude, committed, **and not shown to the author**. The author knows the
categories, the board shape and the button counts; not the clues, not the
answers. Answers are not printed in the terminal during the build, and the pack
is not opened again in a session the author is reading.

Two mechanical protections, because discipline alone is not enough when the file
sits in the author's own repo:

- **Opaque filenames.** `hockey-mask.jpg` would put the answer in the filename —
  visible in the file tree, in a fuzzy-finder, in `git log`, and in the image URL
  every player's browser requests *before* the reveal. Image files are named by
  content hash. This is nearly free and closes a leak to players as well as to
  the author.
- **The pack lands in one commit** with a message that says what it is, so the
  author can avoid that diff deliberately rather than stumbling into it.

One of the thirty references *Twilight* (decision 22). It still clears every bar
in §7.4 like any other clue: a real, sourced, unambiguous fact with plausible
distractors, not a joke with an answer nobody can give. Its position is not
disclosed.

### 7.3 The content rule

**Work-appropriate, no gore.** Excluded: blood, wounds, bodies, weapons mid-use,
realistic corpses, jump-scare faces, anything sexualised, and anything that reads
as a real person in distress. A costumed character holding a prop is fine; the
same character covered in blood is not. Where an icon only exists in gory images,
it does not go in the pack. The same bar applies to trivia wording, not only
pictures.

The test is "would this be fine on a shared screen in a work meeting." When it is
arguable, it is out — there are more Halloween subjects than tiles.

### 7.4 Verification

Decisions 14 and 19 are build steps, not intentions. **No clue enters the pack
unverified**, and every clue records the source that verified it.

**Image clues.** For each candidate: pull it and open it; **look at it**, and
keep it only if the subject is unmistakable, alone in frame, not a group shot or
collage, with no watermark or caption giving the answer away; check it against
§7.3; **render it at its proposed mosaic size and look at that too** — a 200 must
be gettable at its mosaic and a 1000 must not be, and if it is not, change the
mosaic, move the clue, or drop it; record the source URL and date. Anything that
cannot be confidently identified does not go in.

**Trivia clues.** A wrong trivia fact ruins a round exactly as a mislabelled image
does, and worse: nobody in the room can see it is wrong, so the team that knew
the real answer simply loses. Each text clue gets:

1. **A source, checked at write time** — confirmed against a reliable reference,
   not recalled from memory, which is where confident wrong years and wrong
   directors come from. The URL goes in `source`.
2. **A single unambiguous answer.** If a careful person could defend a second
   answer to the question as written, it is rewritten or dropped. "The first
   slasher film" is an argument; "the 1978 John Carpenter film that introduced
   Michael Myers" is a fact.
3. **No facts with a shelf life.** Nothing phrased "most", "latest",
   "highest-grossing" or "currently" — true when written, maybe not on game
   night. Dates, titles, authors and plots do not move.
4. **No trick phrasing.** The question means what it appears to mean. Difficulty
   that comes from misreading is a bad clue at any value.

**Distractors, for every clue of both kinds.** With buttons this is where a clue
cheats a team, so it carries the same weight as the fact itself:

5. **No distractor may be arguably correct.** This is the anti-goal. Check each
   one against the question as written, not as intended.
6. **Distractors are plausible and same-category** — four horror villains, not
   three villains and a US senator. An implausible set turns a 1-in-4 into a
   1-in-2 and wastes the clue.
7. **No giveaway by shape.** One long answer among three short ones, or one that
   matches the question's phrasing while the others do not, is answerable without
   knowing anything.
8. **Distinct after normalisation** — no "Dracula" and "Count Dracula" in the
   same set, where a team could pick the "wrong" right answer.

A clue failing any of these is rewritten or replaced, not shipped with a caveat.

**Licensing — a decision, recorded.** The author chose web-sourced photographs
(decision 13) for a one-off internal event in a private, undeployed repo; the
images are not redistributed and the game is not sold. Proceeding on that basis.
**If this portal is ever made the commercial product the portal spec §1
describes, this pack cannot ship with it** — the image clues would need licensed
stock or original art. Flagged here rather than discovered later.

**The report.** A short write-up of what was kept, what was dropped and why —
**categories and reasons; no images, no questions, no answers** — is the
deliverable the author can read without spoiling their own game.

### 7.5 Mosaic sizes

Fixed per clue (decision 11), set at verification time, applied client-side onto
a canvas. Rough guide by row:

| Row | Blocks across | Intent |
|---|---|---|
| 200 | ~10 | Nameable from a silhouette |
| 400 | ~12 | |
| 600 | ~14 | |
| 800 | ~18 | |
| 1000 | ~22 | Obscure subject; blur it less or it is unguessable |

Counter-intuitively the blur *decreases* as the value rises: difficulty at the top
of the board comes from the subject being obscure, and a heavy mosaic over an
obscure subject produces a clue nobody gets — an anti-goal. These are starting
points for the playtest and belong in one constant table so they can be retuned
without a code change, in the spirit of `CARVE_MS` and `VOTE_MS` in the README.

---

## 8. Game mechanics

### 8.1 Phases

`['lobby', 'board', 'reading', 'clue', 'steal', 'answer', 'reveal', 'results']`,
cycling via `nextPhase` (§4.1).

There are more phase names than conceptually distinct steps, deliberately:
`room.config.phaseMs` is keyed by phase name, so **a step needing two durations
needs two names**. `steal` is a shorter `clue`.

| Phase | Duration | Env | Ends when |
|---|---|---|---|
| `board` | 30s | `BOARD_MS` | A controlling-team player clicks a live tile, or the clock runs out |
| `reading` | 6s | `READ_MS` | Clock only. Buzzer dead — the whole point (§8.3) |
| `clue` | 20s | `CLUE_MS` | A team buzzes, or the clock runs out |
| `steal` | 12s | `STEAL_MS` | As `clue`, armed only for the team that has not tried |
| `answer` | 12s | `ANSWER_MS` | A choice is clicked, or the clock runs out |
| `reveal` | 6s | `REVEAL_MS` | Clock |
| `results` | — | — | Terminal |

Transitions:

- `board` → `reading`. A clock expiry auto-picks the lowest-value remaining tile
  in the leftmost column that has one, so a quiet team cannot stall the room.
- `reading` → `clue` always. **This is the arm moment.**
- `clue` / `steal` → `answer` if a team buzzed; → `reveal` if nobody did.
- `answer` → `reveal` if the choice was correct **or** both teams have used their
  shot; → `steal` otherwise.
- `reveal` → `board` if tiles remain; → `results` otherwise.

`steal` gets no reading window: that team has read the clue for at least six
seconds plus however long the first team took, and a second pause is dead air.

`setPhase(state, 'board')` clears the clue slot and reassigns control only when
arriving from `reveal`, which it can tell because the state carries its own
`phase` — the same pattern `pumpkin-carve` uses.

### 8.2 Choices and shuffling

`choices[0]` is correct in the pack file. At `createState` the module shuffles
each clue's choices with a PRNG seeded from `room.seed` plus the clue id, and
stores the shuffled order and the correct index in state. This keeps `reduce`
pure, makes a room reproducible from its seed, and means two rooms running the
same pack do not share an answer layout.

A client submits `CHOOSE { index }` against the shuffled order it was shown.
`reduce` compares it to the stored correct index. That is the entire answer
system — there is no matcher (§3).

### 8.3 The buzzer

Modelled on the real show, researched at the author's request (decision 18). On
*Jeopardy!*, the signalling devices are **dead until a staffer arms them** once
the host finishes reading; lights along the gameboard tell contestants they are
live, and home viewers never see them. Ringing in early locks that contestant out
a further quarter-second, usually enough to lose the clue. Only the first signal
after arming registers, and a wrong answer re-arms the others. Contestants
consistently describe buzzer control, not knowledge, as what decides games.

Sources: [Today](https://www.today.com/today/amp/tdna116238),
[Mental Floss](https://www.mentalfloss.com/entertainment/game-shows/why-those-jeopardy-buzzers-are-even-more-anxiety-producing-they-look),
[The Ringer](https://www.theringer.com/2019/04/18/tv/james-holzhauer-jeopardy-winner-alex-trebek-ken-jennings),
[Game Show Forum](https://gameshowforum.org/index.php/topic,18753.0.html).
These are press and enthusiast sources, not show documentation; the
quarter-second figure is consistent across them but is well-attested rather than
official.

**What we take:**

- **A reading phase where the buzzer is dead.** Without it the race goes to the
  fastest trigger finger rather than the fastest reader — an anti-goal. The most
  valuable thing the research gave us, and the reason `reading` exists at all.
- **A visible arm moment.** The board lights' equivalent: the buzzer flashes from
  grey to full colour with a label change, at the same instant for everyone.
- **First press after arming wins**, and only that one. Later presses are ignored
  silently, never errored.
- **A wrong answer re-arms the other team** — the `answer` → `steal` transition.

**What we deliberately do not take:** the quarter-second early-press penalty. It
exists because contestants hold a physical plunger with no clean arm signal and
presses *can* be made early. Here, presses during `reading` are rejected server-
side and not queued, the arm signal is on screen, and the client requires a press
that *began* after arming — so holding the button through `reading` gains
nothing. A penalty would add a rule to explain for no benefit.

**Who may buzz:** any connected player whose team (from the frozen roster, §4.2)
has not used its shot, while `clue` or `steal` is open. Spectators cannot.
`reduce` enforces this regardless of what a client sends; `by` comes from the
authenticated socket, so a client cannot claim to be someone else or to have been
first.

**The beat.** `phaseComplete('clue')` returns true once a buzz is recorded, so the
runtime's existing 700ms `EARLY_ADVANCE_MS` applies. That is wanted: the room sees
"Blue buzzed!" before the buttons come alive.

**Latency, stated plainly.** The winner is whoever's press *reaches the server*
first, so a player on a worse connection is at a real disadvantage — the show
solves this with identical hardware on one stage and we cannot. A fix exists
(hold the first buzz ~150ms, then award it to the earliest client-reported press
time, clamped to the arm moment) but it adds a timer to an otherwise pure reducer
and is trivially spoofable by a modified client. **Not built. Recorded so it is a
decision, not a surprise**; revisit if a playtest shows one team's connection
consistently losing races.

### 8.4 Answering

- Only the buzzing player may submit. `viewFor` makes the choices live for that
  player alone; `reduce` enforces it regardless of what a client sends.
- Submitting ends the phase (`phaseComplete('answer')`).
- Letting the clock expire spends that team's shot.
- If the answering player disconnects mid-answer their team's shot is forfeit and
  play moves on — the room is never held open by an absent laptop.
- An out-of-range index is ignored, not treated as a wrong answer. It can only
  come from a malformed client, and spending a team's shot on a bug would be
  unfair in a way a wrong click is not.

### 8.5 Scoring and control

- Correct: the tile's value to that team.
- Wrong: no penalty (writer's call, §3 — flagged for the playtest).
- Both teams miss, or nobody buzzes: no points.
- Control passes to the team that answered correctly; if nobody did, to the other
  team. The first board's control comes from the room seed.
- A tie at the end is a tie, shown as a tie. No sudden death.

### 8.6 Lifelines

**Each team gets two per game** (decision 26).

**Phone a friend does not translate.** The team is already together on a video
call, so conferring is free and continuous — a lifeline that grants discussion
grants nothing. What a remote team actually lacks is a way to cut the field down
when they are torn between two options.

**The lifeline is 50:50, themed as a Flashlight.** It removes half the wrong
choices: four becomes two, six becomes three. One mechanic covers both clue
kinds, since image clues are answered from a choice list too, and it needs
nothing new in the pack — the eliminations derive from `choices` and the room
seed.

| Rule | Value |
|---|---|
| Per team, per game | 2 |
| Per clue | 1, by the team that holds the buzzer |
| When | Only during `answer`, after that team has buzzed |
| Who presses | The buzzing player, like every other control |
| Cost | The lifeline only. The clock does not pause and does not extend |
| Which choices are cut | Derived from the room seed and the clue key, so it is deterministic and survives a restart |

**Only after buzzing, and this is the load-bearing rule.** The choices are on
screen for everyone from `reading` (§6.2), so a lifeline spendable before the
buzz would hand the narrowed field to both teams and help the opponent as much
as the spender. Tying it to the buzz makes it a real decision: you committed,
you are unsure, you burn one.

**The elimination is private to the team that spent it.** `viewFor` already
redacts per viewer, so the other team sees "Blue used a Flashlight" and the count
tick down, but *not which options were cut*. Without this, a team could burn a
lifeline, answer wrong, and hand the stealing team a one-in-two — turning a
help into a gift. The private view is what makes the lifeline safe to use.

On a steal, the stealing team may spend their own lifeline on the same clue; the
first team's eliminations stay invisible to them, so the two teams can cut
different options. The first team's *wrong answer* is still public and struck
through (§6.3) — that was earned by being wrong, not purchased.

Lifelines remaining are shown on each team's podium as two pips that go dark as
they are spent, so the room can see what is left without asking.

---

## 9. Protocol

No new socket message types. Everything rides the existing `snapshot` / `host` /
`error` frames in `packages/shared/src/events.ts`.

Client actions (the `action` frame's payload): `PICK { categoryId, value }`,
`BUZZ`, `CHOOSE { index }`, `LIFELINE`, and the host-only `SKIP` and `END`,
authorised by `hostActions` in the runtime (§4.4).

**`viewFor` redaction** — the reason this is safe (portal spec §5):

| Phase | Everyone gets | Nobody gets until reveal |
|---|---|---|
| `board` | the grid, which tiles are spent, scores, who controls | every clue and every choice |
| `reading` | category, value, the clue, the shuffled choices, buzzer dead | which choice is correct |
| `clue` / `steal` | the above, buzzer armed, which teams have used a shot, any eliminated choice | which choice is correct |
| `answer` | the above, plus who is answering and for which team, and each team's remaining lifelines | which choice is correct, the choice being hovered, and **the other team's eliminated choices** (§8.6) |
| `reveal` | the full image or clue, and the correct index | — |

The correct index never leaves the server before `reveal`, and neither does a
selection in progress. Shipping the correct index with the choices would put the
answer one devtools tab away.

**Eliminated choices are per team, not per room.** A viewer gets only their own
team's eliminations. Broadcasting both teams' would leak a spent lifeline into
the steal, which §8.6 exists to prevent — and would do it invisibly, since the
UI would simply look correct.

**Known leak, accepted.** Images are served as static files, so a determined
player could fetch the current clue's un-pixelated source before the reveal.
Opaque filenames (§7.2) mean the URL gives nothing away by itself, but the bytes
are reachable. This is a work social event; the alternative — proxying every
image through an authenticated route that opens only on reveal — is not worth the
complexity. Recorded as a decision, not an oversight.

---

## 10. Resilience

| Failure | Response |
|---|---|
| Controlling team all disconnect | `board` clock expires and auto-picks; control passes on the next reveal |
| Answerer disconnects mid-answer | Their team's shot is forfeit; play continues (§8.4) |
| Everyone on a team disconnects | The remaining team plays on; a dead team cannot block a phase |
| Server restart mid-clue | Existing snapshot restore plus `resume()`; the clue resumes with the time that was left |
| An image fails to load in a browser | That client shows a placeholder, the clue still runs on its text, the host can `SKIP` |
| Two buzzes in the same millisecond | Server arrival order decides; the loser's press is ignored silently (§8.3) |
| Host leaves | Existing host reassignment; the new host gets `hostActions` by virtue of being host (§4.4) |
| `nextPhase` bug loops | Hop budget, then `failRoom` (§4.1) |

---

## 11. Testing

Following the portal spec's strategy and the repo's existing shape:

- **Unit, `shared`:** `reduce` for every pick, buzz and choose path, including
  buzzes rejected during `reading`, a buzz from a spectator, a buzz from a team
  that has spent its shot, and an out-of-range index; `nextPhase` for all eight
  transitions including the steal and the last tile; control passing; scoring;
  the shuffle being deterministic from a seed and differing between seeds;
  lifelines (two per team, one per clue, rejected before a buzz, rejected when
  spent, eliminations deterministic from the seed and never covering the correct
  choice); and **`viewFor` redaction — one test asserting the correct index
  appears in no pre-reveal view for any phase, and one asserting a viewer never
  receives the other team's eliminated choices**.
- **Unit, `server`:** `tryAdvance` with and without `nextPhase` (so
  `pumpkin-carve` is proven unaffected); the hop budget; an unknown phase name;
  `hostActions` dropping a host action from a non-host and admitting it from the
  host *after* a host reassignment; `POST /api/rooms/:code/me` including its
  rejection after Start; `/api/games` carrying `thumbnail` and `teams` and
  **omitting the hidden dev entry**.
- **Component, `web`:** the board (live tiles only for the controlling team,
  spent tiles inert, keyboard navigation); the buzzer dead in `reading` and armed
  in `clue`; choices inert for everyone but the buzzing player; number-key
  selection; the Flashlight button's enabled states and the podium pips; the
  picker rendering from a mocked `/api/games`.
- **Pack validation:** structure only, never printing prompts or choices — run
  against both packs. Every category full, every clue sourced and dated, choices
  the right length and distinct, every image file present with a `mosaic` in
  range, values matching the declared list. A failing assertion names the clue by
  category and value, never by its text.
- **E2E:** two browsers on `fright-night-dev` — pick a tile, press during
  `reading` and be ignored, buzz after arming, choose wrong, steal, choose right,
  reveal, pick again, clear the board, results. Phase lengths read from config,
  as `pnpm e2e` already does.

---

## 12. Build order

1. `nextPhase` on the contract, runtime support, hop budget, tests.
   `pumpkin-carve` still green.
2. `hostActions` in the runtime (§4.4).
3. `Player.avatar` / `Player.team`, the avatar set, `POST /api/rooms/:code/me`.
4. `thumbnail`, `teams` and `hidden` on the contract and `/api/games`.
5. The game picker; `pumpkin-carve` thumbnail; lobby team columns and avatar
   picker.
6. The dev pack, its generator script, and the pack validator.
7. `shared/fright.ts` — state, reduce, nextPhase, shuffle, control, scoring,
   viewFor — TDD, no UI.
8. The module factory and both registry entries (§4.5).
9. The board UI inside a placeholder set.
10. The clue stage: pixel renderer, text clue, choice grid, buzzer with its arm
    transition, reveal, results.
11. E2E on the dev pack.
12. The Halloween pack: write and source-check the trivia and its distractors,
    pull and verify the images, hash the filenames, commit, report (§7.4).
13. PixelLab chrome — the set, avatars, both picker thumbnails.

Steps 1–11 never touch the real pack, so all of the risky engineering is done and
tested before any content the author must not see exists.

---

## 13. Out of scope

Typed answers of any kind; Daily Doubles, wagering and Final Jeopardy; a second
doubled board; more than two teams; sounds; per-player statistics beyond the two
results callouts; mobile; latecomers joining a team (§4.2); persisting teams
between games; any change to `pumpkin-carve`'s rules; deployment (the portal is
still undeployed, per the README).

---

## 14. Open to the builder

- The mosaic numbers in §7.5 and every phase length in §8.1 — starting points, to
  be tuned by a playtest.
- Whether `reading` at a flat 6s suits the longest trivia clue *with six options
  to read*. If not, the fix is a `reading-long` phase that `nextPhase` routes to
  above a length threshold, not a per-clue duration, which `phaseMs` cannot
  express.
- The avatar set's contents and how they are drawn, beyond "generated with
  PixelLab, work-appropriate, readable at 22px."
- Component decomposition under `packages/web/src/games/fright/`.
- Whether the mosaic is drawn with canvas `imageSmoothingEnabled = false` on a
  downscale-then-upscale, or as a CSS grid of blocks. Canvas is the likely
  answer; the reveal is a crossfade to the untouched image either way.
- The shuffle PRNG, provided it is seeded, pure and stable across a restart.
