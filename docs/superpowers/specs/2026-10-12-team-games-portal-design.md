# Team Games Portal — Design Spec

**Date:** 2026-10-12
**Status:** Approved (design); implementation plan pending
**Author:** Jocelyn Icaza

---

## 1. Purpose and context

A web portal hosting a bundle of live, multiplayer team-building games. Teammates
join a room together from a shared code and play on their own laptops.

Two horizons, deliberately distinguished:

- **Now (this week):** one playable game slice — a Halloween jack-o'-lantern
  carving game — for an internal playtest with a team of 5–12 people on laptops,
  playing live and simultaneously.
- **Later:** a commercial product sold to businesses as a subscription — a growing
  bundle of team-building games, multi-tenant, with per-company workspaces,
  rosters, and accumulated history.

**Success for the first slice:** 5–12 teammates join in under a minute without
instructions, everyone finishes with a pumpkin they're amused by, and the reveal
produces audible reactions. Nobody is eliminated and nobody spectates.

**Success for the architecture:** game #2 can be added by writing one module and
one registry entry, without touching the lobby, the transport, or the data model.

### Guiding principle

Build now only what is **expensive to reverse**. Product ambition is the most
common reason a first slice misses its deadline. Four things are expensive to
reverse and are therefore in scope immediately: tenancy in the data model, the
game module contract, the account/player split, and server-authoritative state.
Everything else is explicitly deferred (§12).

---

## 2. Locked decisions

| Decision | Choice | Rationale |
|---|---|---|
| Play mode | Live, synchronous, all players on own laptops | Reactions in the moment are the point |
| Deadline | Under 7 days | Forces the tier structure in §3 |
| Players / devices | 5–12, laptops (mouse and trackpad) | One input model; gallery fits one screen |
| Product shape | Subscription per company | An event is a workspace with one room — the superset |
| Backend | Single Node process, rooms in memory behind `RoomStore` | Debuggable under deadline; migrates to Durable Objects without a rewrite |
| Repo | pnpm monorepo, 3 packages | Enforced client/server boundary; pnpm's isolated `node_modules` actually enforces it, npm's hoisting does not |
| Persistence | Drizzle + SQLite now, Postgres later by connection string | Game history is a thing businesses pay for |
| Server/client framework | Fastify + `ws`; Vite + React | Fast, good TS inference |
| 3D | Three.js for the reveal only, not for carving | Carving is a 2D mask operation; CSG would be a research project |

### Rejected, with reasons

- **Cloudflare Durable Objects now** — architecturally the right destination and
  where this should end up, but learning it on the clock would consume the
  reveal polish. The `RoomStore` and `RoomContext` interfaces keep the migration
  contained to a week.
- **Supabase-only, no custom server** — no authoritative server means a host
  client drives timers and phases, which stalls when a laptop sleeps.
- **Elimination mechanics** (the original Squid Game cookie idea) — half the team
  spectating 90 seconds in is how a work social event dies. Stakes are preserved
  instead via structural integrity (§6.4).
- **Bun, uWebSockets.js, binary wire protocol** — all genuinely faster, all
  irrelevant at 12 concurrent players, all a compatibility risk on a 7-day clock.
- **Godot** — handles the game well but ships 10–20MB of wasm, which damages
  time-to-playable, the one performance axis users actually notice here.

---

## 3. Scope tiers

The deadline cuts from the bottom. This ordering is decided now so it is not
decided at midnight on day 5.

**Tier 1 — must ship (a complete, fun game on its own):**
join by code · lobby with live presence · 3-minute private carve with tools,
stamps, undo · live structural integrity meter · sequential anonymous voting
across four award categories · 2D lit gallery reveal with carvers and ribbons ·
results persisted

**Tier 2 — the stretch:**
Three.js catwalk reveal · collapsed-pumpkin face-plant animation

**Tier 3 — bonus:**
"guess who carved it" scoring · sound design

---

## 4. Architecture

### 4.1 Repo layout

```
team-games/
  pnpm-workspace.yaml
  package.json              # scripts only; typescript, tsx, concurrently
  tsconfig.base.json        # strict, shared compiler options
  packages/
    shared/                 # @tg/shared — source-only, no build step
      src/events.ts         # websocket message types (client <-> server)
      src/game.ts           # GameModule interface
      src/ids.ts            # branded WorkspaceId, RoomId, PlayerId
    server/                 # @tg/server — fastify, ws, drizzle, better-sqlite3
      src/transport/        # ws handling; knows nothing about games
      src/rooms/            # RoomStore, RoomRuntime
      src/db/               # schema + migrations
      src/games/            # server-side game modules
    web/                    # @tg/web — react, three, zustand, vite
      src/lobby/
      src/store/
      src/games/            # client-side game components
```

`@tg/shared` is **source-only** — its `exports` field points at `./src/index.ts`
with no build step, no `dist`, no TypeScript project references. Vite compiles TS
from dependencies and the server runs under `tsx`. Project references are where
monorepo setup time disappears; this sidesteps the category entirely.

**Turborepo is skipped.** Root pnpm scripts plus `concurrently` suffice at three
packages and one developer. Adding Turbo later requires no restructuring.

Dev loop: root `pnpm dev` runs `tsx watch` on the server and Vite on the web app,
with Vite proxying `/ws` to the server so there is one origin and no CORS. For
deploy, the web build is copied into the server image and served statically — one
deployed artifact.

### 4.2 Runtime layers

Strictly one-directional:

```
ws transport  ->  RoomStore  ->  RoomRuntime  ->  GameModule
(knows no        (Map now,      (phases,         (pure logic,
 games)           interface       timers,          no I/O)
                  for later)      broadcast)
```

The transport knows nothing about games; games know nothing about sockets. This
is what makes the eventual Durable Objects migration a swap of `RoomStore` and
the transport, with zero game code touched.

### 4.3 Tenancy

Every row below the workspace carries `workspaceId`, and the store exposes **no
unscoped lookups**. Retrofitting multi-tenancy later means touching every query,
and the failure mode is a cross-tenant data leak — the bug that kills an
enterprise deal.

| Table | Fields | Used in slice 1 |
|---|---|---|
| `workspace` | id, name, slug, plan, createdAt | Yes — one seeded `default` |
| `user` | id, email, name | Schema only |
| `membership` | workspaceId, userId, role | Schema only |
| `room` | id, **workspaceId**, code, gameId, status, hostPlayerId, createdAt, expiresAt | Yes |
| `player` | id, roomId, **workspaceId**, displayName, userId?, connected | Yes |
| `gameResult` | id, roomId, **workspaceId**, gameId, payload (json), createdAt | Yes |

Defining `user` and `membership` now costs ten minutes and makes the auth story
additive rather than a migration that rewrites every foreign key.

**The account/player split:** the person who *buys* (org admin, has a login) is a
different entity from someone who *joins a room with a code and a nickname*.
Both are modeled now; only the guest path is implemented.

**Join codes:** 6 characters, uppercase, from an alphabet excluding `O 0 I 1 S 5`
so nobody mistypes them off a shared screen. Unique among *active* rooms only, so
codes recycle as rooms expire and stay short forever. A bare code is enough to
join — no workspace selection — but the room it resolves to carries its
`workspaceId`, so scoping is server-side and invisible to players. This gives
frictionless guest joins and clean tenant isolation simultaneously.

Branded ID types live in `shared`, so a `RoomId` cannot be passed where a
`WorkspaceId` is expected — cheap insurance on the tenancy rule.

---

## 5. The game module contract

The product surface. A game declares its rules; the server owns the clock and the
sockets.

```ts
interface GameModule<State, Action, View> {
  id: string;                    // "pumpkin-carve"
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  estimatedMinutes: number;
  phases: readonly string[];
  theme: GameTheme;              // accent palette, see 8.2
  hostLines: Record<string, string[]>;   // phase -> narrator lines

  createState(players: Player[], seed: number): State;
  reduce(state: State, action: Action, by: PlayerId): State;   // PURE
  onPhaseEnter(state: State, phase: string, ctx: RoomContext): void;
  viewFor(state: State, viewer: PlayerId): View;
}
```

**`reduce` is pure** — same inputs, same output, no database, no clock, no
`Math.random()`, no network. The payoff is that the entire game is testable in
milliseconds with no server and no browser, which is how live multiplayer ships
in a week.

**`by` is supplied by the server** from the authenticated socket, never read from
the message body. Every rule about who may do what has a trustworthy subject.

**`seed`** is generated and persisted by `RoomRuntime` and passed into
`createState`, so any per-game randomness (e.g. jittered collapse thresholds) is
decided once and stored in state. `reduce` stays pure and replay stays
deterministic.

**`onPhaseEnter`** is the only place side effects live. `ctx` (`RoomContext`)
exposes `broadcast`, `setTimer`, `advancePhase`, `saveResult` — and never a
socket, which is what keeps games portable.

**`viewFor` redacts state per viewer.** The server calls it once per player and
sends each only their own view. Anonymous voting is therefore not a client-side
promise: carver identities are **never transmitted** during the voting phase.
Someone can inspect every byte on the wire and learn nothing. The same mechanism
enables "guess who carved it" and any future hidden-information game — secret
roles, a who-wrote-this-lie round, a traitor mechanic.

On the client, each game exports a component receiving `{ view, phase, dispatch }`
and nothing else. The dashboard renders the game list from the registry, so
adding game #2 is one module plus one array entry; the lobby is untouched.

---

## 6. The Halloween slice: `pumpkin-carve`

### 6.1 Carve mechanic

A fixed 512x640 logical canvas with a pumpkin silhouette and two layers: a warm
radial gradient beneath (the candle) and the pumpkin body above. Carving punches
holes in the body with `destination-out` compositing so light shows through —
the entire lit jack-o'-lantern look in about thirty lines of canvas code.

Tools:

- **Freehand cutter** — drag to cut, brush-size slider
- **Stamps** — triangle eyes, circles, crescents, zigzag mouth, snaggletooth grin
- **Uncarve** — restores flesh
- **Undo** — pops the last stroke

Stamps are an inclusivity decision, not a convenience. Freehand-only means
whoever cannot draw produces a sad blob and feels bad at a work event; stamps get
anyone to a recognizable pumpkin in fifteen seconds while freehand remains for
those who want it. All strokes clip to the silhouette path.

```ts
type Stroke = {
  tool: 'cut' | 'uncut' | 'stamp';
  shape?: StampShape;
  size: number;
  points: [number, number][];   // normalized 0..1
}
```

**Strokes, not images, are the wire format.** A stroke list is a few hundred
bytes, gives undo for free, replays deterministically, and — because points are
normalized — re-rasterizes at 2048px for the 3D texture without upscaling
artifacts. Shipping PNGs would foreclose the catwalk.

### 6.2 Phases

| Phase | Length | Behavior |
|---|---|---|
| `lobby` | — | Join by code, pick display name, host starts |
| `carving` | 180s | Private. Timer visible. Early submit allowed; phase ends immediately once all *connected* players have submitted |
| `voting` | 60s | Anonymized, shuffled gallery |
| `results` | — | Winners and carvers revealed |

Timings live in room config, not constants, so they are tunable after the first
playtest without a deploy. The early-exit rule matters: nothing drains a work
game like six people watching a clock run down.

### 6.3 Voting: four awards, not one winner

Each player casts one vote per category and may never vote for themselves:

**🎃 Scariest · 😂 Funniest · 🏆 Best Craftsmanship · 🫠 Most Cursed**

Rationale. With 12 players and a single vote each you get a three-way tie decided
by nothing. Four categories means roughly four different people win something,
which matters far more at a work event than crowning one person. And "Most
Cursed" hands whoever made a disaster a trophy instead of an exposure — that is
the laugh of the night, and it rewards low-effort play rather than punishing it.

Per Jackbox's "one decision at a time" principle (§8.1), categories are presented
**sequentially**, not as a single four-field form.

### 6.4 Structural integrity

Cut past ~40% of the pumpkin's area and it begins to sag; past ~55% and it
collapses — on the catwalk it face-plants into a pile. Nobody is eliminated and
nobody stops playing, but over-carving becomes a real risk, which turns the carve
phase into a decision rather than just drawing. It also makes "Most Cursed"
genuinely contested.

Two details that make it work:

- The meter is **live during carving**. Without live feedback there is no decision.
- The bar is **unlabeled** and the exact collapse threshold is **jittered ±4%**
  per pumpkin, seeded in `createState`, so the player is genuinely gambling rather
  than reading a number.

Implementation is an area ratio over the mask. Promoted from Tier 3 to Tier 1
(meter and sag states); the 3D face-plant rides with the catwalk in Tier 2.

### 6.5 Reveal

- **Tier 1:** the gallery lights up, votes tally per category, each winner flips
  to reveal its carver with a ribbon. 2D, CSS transitions. Collapsed pumpkins
  render slumped and cracked.
- **Tier 2:** the catwalk — a squashed low-poly sphere with the carved mask as an
  emissive texture, stick legs, bobbing down a foggy runway one pumpkin at a time
  with its award. One shared geometry; textures rasterized once on phase entry;
  chunk lazy-loaded and preloaded when the voting phase begins (there is dead
  time there, so the download is free).

---

## 7. Protocol and sync

Join is HTTP first, then websocket: `POST /api/rooms/:code/join` with a display
name returns `{ roomId, playerId, playerToken }`; the client opens the socket with
that token. The split gives a clean place to reject bad codes and full rooms, and
the same token drives reconnect.

Server to client:

| Message | When |
|---|---|
| `snapshot { phase, view, players }` | On connect, reconnect, and every state change |
| `timer { endsAt, serverNow }` | Once per phase |
| `host { line }` | On phase transitions |
| `reveal { index }` | Lockstep steps during the catwalk |

Client to server: `action { payload }`, fed straight into `reduce`.

**Snapshots, not patches.** State is small and `viewFor` strips what a viewer
cannot see, so payloads stay tiny — and it eliminates the entire class of bugs
where a client misses a patch and silently diverges. The right trade at 12
players.

**Timers send an absolute deadline, never a tick stream.** One message says "this
ends at T"; the client computes remaining time locally and renders at 60fps.
`serverNow` rides along so the client can compute clock offset and correct a
skewed laptop. Streaming ticks is the obvious implementation and strictly worse:
more traffic, jerkier rendering, and a visible stall on any network hiccup.

**Carving is local.** Strokes never leave the browser until submit, so drawing has
zero network latency, with a unicast **draft autosave every 10 seconds** against
browser crashes. A save, not a broadcast — the no-fan-out property holds, which
is what deletes realtime throughput as a concern entirely.

### 7.1 Client performance rules

Decided now because retrofitting these is expensive:

1. **Carving never goes through React.** Drawing is imperative via a ref; pointer
   events are coalesced with `getCoalescedEvents()`; React sees only the committed
   stroke list. React renders chrome; the canvas lives outside its render cycle.
2. **Socket state lives in an external store** (Zustand / `useSyncExternalStore`),
   not a context provider. Otherwise every server message re-renders the tree —
   tolerable at 12 players today, miserable once a lobby has presence, chat, and
   a scoreboard.
3. **Three.js is code-split** and preloaded at the start of the voting phase. The
   lobby and carve screens must not pay for it.
4. **Textures rasterize once** on phase entry, never per frame; one shared pumpkin
   geometry across all instances.

The performance budget here is **input latency and time-to-playable**, not
throughput.

---

## 8. Visual design direction

### 8.1 What we take from Jackbox

Research finding that shaped this section: **Jackbox's cohesion does not come from
a shared visual style.** Each game in a pack has its own art director and a
deliberately distinct look, and the artists actively avoid visual overlap.
Cohesion comes from a shared hub environment, identical interaction grammar, and
constant UI chrome.

This is good news for a growing bundle: forcing one visual style across many
games is the expensive, fragile path and makes bundles feel samey. Therefore —
**cohesion lives in the chrome and the grammar; personality is per-game.** Which
maps directly onto the module contract: a game declares its own palette, theme,
and art, and inherits the shell.

Principles adopted:

- **No download, no account, no app.** Code on a page, immediately connected.
- **One decision at a time.** Never ask for two things at once.
- **Private per-player information as a core mechanic.** This is `viewFor`.
- **TV conventions for pacing** — transitions, timing, host dialogue.
- **Playtest at multiple group sizes** — at 4 and at 12 before game night.

**Host dialogue is the cheap steal with the biggest payoff.** No voice acting
needed: a text host line on every phase transition, declared per module
("Three minutes. Try not to maim it." / "Votes are in. Some of you should be
ashamed."). It costs an array of strings, it is the strongest cohesion device
across a bundle, and it is most of what makes Jackbox feel *hosted* rather than
operated.

### 8.2 Typography

The Jackbox wordmark is Supria Sans (HVD Fonts) — commercial, ~$50/style and $449
for the family. Not worth licensing when open alternatives are strong, and their
per-game fonts vary wildly anyway.

All SIL Open Font License, free for commercial use:

| Role | Font | Why |
|---|---|---|
| Display / headings | **Archivo** (incl. Expanded) | Utilitarian grotesque in Supria's Swiss-clarity lineage; heavy weights hold up huge on screen; variable |
| UI / body | **Inter** | Best-in-class small-size legibility; the boring correct choice |
| Game accent (Halloween) | **Bungee** (fallback: Bowlby One) | Fat, confident display face for the game's own identity |

**Avoid the obvious horror fonts** — Creepster, Nosifer, Eater are free but read
as clip-art and would make a product you intend to sell look cheap. The season
comes from color and illustration; the typography stays confident. None of
Jackbox's horror games use a dripping-blood typeface either.

### 8.3 Color

**The shell is dark** — not an aesthetic preference. This gets played in dim
rooms, over Zoom compression, and sometimes projected; a dark UI with saturated
accents survives all three.

Layer one, portal tokens, constant across every game:

```
--shell-bg:      #0E0D14   /* near-black, slight violet cast */
--shell-surface: #1A1826
--shell-border:  #2E2B3F
--shell-text:    #F4F2F8
--shell-muted:   #9A95AD
```

Layer two, declared per game in module metadata:

```ts
theme: { accent: '#FF7518', accent2: '#8B5CF6', glow: '#FFC24D', danger: '#84CC16' }
```

For `pumpkin-carve`: pumpkin orange `#FF7518`, candle amber `#FFC24D` (the glow
behind the carve holes), witch violet `#8B5CF6`, toxic green `#84CC16` for
cursed/collapse states. The carve canvas gets the amber glow layer; the catwalk
gets violet fog.

**Accessibility rules**, since companies will ask:

- Text and UI meet WCAG AA against the shell.
- **Nothing is encoded in color alone.** Specifically, the structural integrity
  meter cannot be green-to-red only — roughly 8% of men have red-green color
  vision deficiency. It needs a text label and a shape change (hairline cracks
  appearing) alongside the color shift.

### 8.4 Lobby

- **Room code enormous and always on screen**, top-left, Archivo Expanded Black.
  Late joiners read it off a shared screen; this is the highest-traffic element in
  the product.
- **Player cards pop in as people join**, small spring animation. Watching your
  team arrive is most of why a lobby feels alive.
- **First joiner is host** and gets the start button; others see "waiting for host."
- **A host line at the bottom** doing the pacing work.

One adaptation: Jackbox splits a shared TV from private phone controllers, but our
players are all on laptops, each with one screen showing both shared and private
views. Consequences: the catwalk must be **server-driven in lockstep** (server
broadcasts "now showing pumpkin 3") rather than each client animating on its own
clock, and **audio is muted by default** — twelve laptops playing spooky music on
one call is a disaster.

---

## 9. Resilience

The things that actually ruin a live event, each with a specific answer:

| Failure | Response |
|---|---|
| Socket drops | Reconnect with backoff, re-auth with `playerToken`, fresh snapshot. State is server-side; a refresh costs nothing |
| Mid-carve browser crash | Strokes in `localStorage` on every stroke commit, plus the 10s server draft |
| Host's laptop sleeps | Host role auto-transfers to the longest-connected player |
| Someone never submits | Server timer advances the phase regardless; early-exit triggers on all *connected* players. An absent player's pumpkin enters the gallery uncarved — funny and self-explanatory |
| Server restart | Room state snapshots to SQLite on each phase change, so a crash costs 30 seconds, not the night (~20 lines, not skipped). Also: do not deploy during the game |
| Vote tampering | One vote per category, no self-votes, enforced in `reduce` |

---

## 10. Testing strategy

TDD. The contract's shape makes it cheap.

- **Unit tests on `reduce` and `viewFor`** carry the bulk of coverage — no server,
  no browser, millisecond runtime, full game logic.
- **`viewFor` tests are security tests** and are written as such: assert that no
  carver identity appears anywhere in the voting-phase payload for any viewer.
  That is the anonymity guarantee, and it should fail the build if someone later
  adds a convenient field.
- **`RoomRuntime` integration tests** with fake timers run a complete four-phase
  round in milliseconds.
- **One Playwright smoke test** — two browser contexts: join, carve, submit, vote,
  results.
- **A 12-headless-client script** so the game is playtested at real size before
  game night.

---

## 11. Build order

| Day | Deliverable |
|---|---|
| 1 | Monorepo, shared types, ws transport, `RoomStore`, join-by-code working across two browsers. No game |
| 2 | `GameModule` + `RoomRuntime` phases and timers + pumpkin state machine, fully tested. No UI |
| 3 | Carve canvas — tools, stamps, undo, integrity meter, draft persistence. Hardest client day |
| 4 | Sequential category voting, 2D gallery reveal, results. **Tier 1 complete and playable** |
| 5 | Lobby polish, host lines, fonts and palette, playtest at 12 |
| 6 | Catwalk (Tier 2) if day 5 held; otherwise more polish. Deploy to real infra |
| 7 | Buffer. One full round on production before game night |

**The cut line:** if day 4 slips, the catwalk goes, without regret. Tier 1 is a
complete, fun game.

Hosting: **Fly.io** with a small volume for SQLite — persistent websockets, one
process, a few dollars a month, same shape as it scales.

---

## 12. Explicitly out of scope

Deferred deliberately, not forgotten: billing and Stripe, SSO, authentication of
any kind, admin dashboards, workspace member management UI, custom branding per
customer, analytics, sound design, mobile layouts, games #2 and beyond.

The `user` and `membership` tables exist so these are additive.

---

## 13. Known future migrations

1. **`RoomStore` to Cloudflare Durable Objects** — one object per room, isolation
   by construction. A week, not a quarter, because game logic never touches
   transport.
2. **SQLite to Postgres** — a Drizzle connection string change.
3. **Horizontal scaling** — room-affinity (sticky) routing in front of multiple
   server processes.
