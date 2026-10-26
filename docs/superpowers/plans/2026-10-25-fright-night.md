# Fright Night Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a two-team Halloween Jeopardy board game to the team-games portal, plus the shared picker/teams/avatars layer every future game reuses.

**Architecture:** Four small additions to the existing `GameModule` contract (`nextPhase`, `hostActions`, `thumbnail`/`teams`/`hidden`, `Player.avatar`/`Player.team`) unlock a board game on the existing runtime. The game itself is a pure reducer in `@tg/shared` driven by a clue pack; the server registers two module instances over two packs (real and dev) so tests never read game-night content. Every answer is an index into a seed-shuffled choice list — there is no text matching anywhere.

**Tech Stack:** pnpm monorepo · TypeScript 5.7 · Fastify + `ws` · Drizzle + better-sqlite3 · Vite + React 18 + Zustand · Vitest · Playwright

**Spec:** [`docs/superpowers/specs/2026-10-25-fright-night-design.md`](../specs/2026-10-25-fright-night-design.md)

## Global Constraints

- `reduce` is **pure**: no clock, no `Math.random()`, no I/O. Any randomness derives from `room.seed`, consumed in `createState`.
- `by` comes from the authenticated socket. Never trust a player id in a payload.
- **No free-text answer input anywhere.** No matcher, no normalisation, no alias lists.
- The correct choice index **never** leaves the server before the `reveal` phase.
- `pumpkin-carve` behaviour must not change. Its tests stay green at every commit.
- Phase durations come from `room.config.phaseMs`, keyed by phase name, overridable by env var. Never hardcode a duration in a component or a test.
- `choices[0]` is the correct answer **as written in the pack file**; the shuffled order and correct index live in game state.
- Node >= 22, pnpm >= 9. Run `pnpm test` from the repo root; `pnpm -F @tg/shared test` etc. for one package.
- Commit after every task. Conventional-commit prefixes, matching the existing log (`feat(vote):`, `fix(web):`).

## Review Focus

Six things the spec implies, that a reasonable player will hit, and that no task's happy-path test would catch. Each has a test pinned to the task that owns the code. (Six rather than five: the lifeline leak was found after the list was drawn and is the one most likely to look correct while being wrong.)

1. **A second buzz landing inside the 700ms `EARLY_ADVANCE_MS` beat.** `phaseComplete('clue')` goes true on the first buzz but the phase does not change for 700ms, so a second press arrives at a live `clue` phase. It must be ignored, not overwrite the buzzer. → Task 10.
2. **A `CHOOSE` from someone who is not the buzzing player**, including a teammate of the buzzing player. The UI only offers buttons to one person; the socket does not enforce that. → Task 10.
3. **A `PICK` naming a spent tile, or a category/value that is not on the board.** A stale client re-sending a click after the board moved on must not open a clue twice or crash the reducer. → Task 10.
4. **`board` expiring when the controlling team's column is spent.** The auto-pick rule says "lowest value remaining in the leftmost column that has one" — the obvious implementation indexes a column that may be empty. → Task 11.
5. **A lifeline's eliminations leaking to the other team.** The clue view is built once per viewer, and the obvious implementation puts `eliminated` on the clue where both teams can read it. The UI would look right — the other team's client simply would not render them — while the data sat in every snapshot, handing the steal a one-in-two. → Task 12.
6. **An `avatar` or `team` value that is not in the allowed set**, posted directly to `/api/rooms/:code/me`. Unvalidated, it reaches every client's lobby render. → Task 4.

---

## File Structure

**Shared (`packages/shared/src/`)**
- `game.ts` — *modify*: `Player.avatar`, `Player.team`, `GameModule.nextPhase`, `.hostActions`, `.thumbnail`, `.teams`, `.hidden`
- `avatars.ts` — *create*: the avatar set and its guard
- `fright-pack.ts` — *create*: pack types, the validator, the seeded shuffle
- `fright.ts` — *create*: state, createState, setPhase, reduce, nextPhase, phaseComplete, viewFor, scoring
- `index.ts` — *modify*: re-export the new modules

**Server (`packages/server/src/`)**
- `rooms/runtime.ts` — *modify*: `nextPhase` dispatch, hop budget, `hostActions` gate, avatar/team in `snapshotFor`
- `rooms/store.ts` — *modify*: avatar/team defaults, `setProfile`, fright phase durations in `roomConfigFromEnv`
- `rooms/snapshot.ts` — *modify*: carry avatar/team through restore
- `db/schema.ts`, `db/client.ts`, `db/repo.ts` — *modify*: two additive player columns
- `http/rooms.ts` — *modify*: `/api/games` projection, `POST /:code/me`
- `games/fright/index.ts` — *create*: the module factory and both instances
- `games/pumpkin/index.ts` — *modify*: add a `thumbnail`
- `games/registry.ts` — *modify*: two entries

**Web (`packages/web/src/`)**
- `lobby/api.ts` — *modify*: `listGames`, `setProfile`, new error strings
- `lobby/GamePicker.tsx` — *create*
- `lobby/JoinScreen.tsx`, `lobby/Lobby.tsx` — *modify*
- `games/fright/` — *create*: `Set.tsx`, `Board.tsx`, `Stage.tsx`, `ClueCard.tsx`, `PixelImage.tsx`, `ChoiceGrid.tsx`, `Buzzer.tsx`, `Reveal.tsx`, `Results.tsx`
- `App.tsx` — *modify*: route the new view kinds

**Content**
- `content/packs/dev/pack.json` + `scripts/gen-dev-pack.ts` — *create*
- `content/packs/halloween/pack.json` — *create* (Task 18)

---

## Task 1: `nextPhase` on the contract

**Files:**
- Modify: `packages/shared/src/game.ts`
- Modify: `packages/server/src/rooms/runtime.ts:126-137` (`advancePhase`/`tryAdvance`)
- Test: `packages/server/src/__tests__/runtime.test.ts`

**Interfaces:**
- Produces: `GameModule.nextPhase?(state, current: string): string | null` — optional; absent means walk `phases` by index, the current behaviour.
- Produces: `MAX_PHASE_HOPS` exported from `runtime.ts` for tests.

- [ ] **Step 1: Write the failing tests** in `runtime.test.ts`

```ts
// A module WITHOUT nextPhase still walks phases in order (pumpkin's behaviour).
test('a module without nextPhase advances by index')
// A module WITH nextPhase goes where it says, including backwards.
test('nextPhase can return an earlier phase, so a loop is possible')
// Returning null stops.
test('nextPhase returning null leaves the room in its current phase')
// A name not in `phases` is a module bug: fail the room, do not stall.
test('nextPhase returning an unknown phase fails the room with PHASE_FAILED')
// Review Focus is not here; this one is the hop budget guard rail.
test('a nextPhase that returns its own phase stops at MAX_PHASE_HOPS and fails the room')
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -F @tg/server exec vitest run src/__tests__/runtime.test.ts`
Expected: FAIL — `nextPhase` is not a property of `GameModule`.

- [ ] **Step 3: Add `nextPhase?(state: State, current: string): string | null` to `GameModule`** in `packages/shared/src/game.ts`

Document it as: the phase to enter when this one ends, null to stop, omit to walk `phases` in order.

- [ ] **Step 4: Implement the dispatch in `RoomRuntime.tryAdvance()`**

Consult `this.module.nextPhase?.(this.room.state, this.room.phase)` when the method exists; fall back to `phases[index + 1]`. A returned name not in `this.module.phases` returns `false` from `tryAdvance`, which the existing callers already turn into `failRoom`. Count hops in a private counter incremented in `enterPhase`; past `MAX_PHASE_HOPS = 500`, `failRoom('phase hop budget exhausted')`.

- [ ] **Step 5: Run the server and shared suites**

Run: `pnpm test`
Expected: PASS, including every existing `pumpkin-carve` test.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/game.ts packages/server/src/rooms/runtime.ts packages/server/src/__tests__/runtime.test.ts
git commit -m "feat(engine): let a game module choose its own next phase"
```

---

## Task 2: `hostActions`

**Files:**
- Modify: `packages/shared/src/game.ts`
- Modify: `packages/server/src/rooms/runtime.ts:90-124` (`dispatch`)
- Test: `packages/server/src/__tests__/runtime.test.ts`

**Interfaces:**
- Produces: `GameModule.hostActions?: readonly string[]` — action `type`s only the current host may dispatch.

- [ ] **Step 1: Write the failing tests**

```ts
test('an action in hostActions from a non-host never reaches reduce')
test('an action in hostActions from the host reaches reduce')
// hostId moves when the host disconnects; the gate must read it live, not a copy.
test('after host reassignment the new host can dispatch a host action')
test('a module with no hostActions gates nothing')
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -F @tg/server exec vitest run src/__tests__/runtime.test.ts -t hostAction`
Expected: FAIL.

- [ ] **Step 3: Add `hostActions?: readonly string[]` to `GameModule`**

- [ ] **Step 4: Gate in `RoomRuntime.dispatch`**

After the existing `this.room.players.has(by)` guard and before calling `reduce`: if `this.module.hostActions?.includes(action.type)` and `by !== this.room.hostId`, return. Reading `this.room.hostId` at dispatch time is what makes the reassignment test pass.

- [ ] **Step 5: Run tests**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(engine): let a module declare host-only actions"
```

---

## Task 3: Avatars and teams on `Player`

**Files:**
- Create: `packages/shared/src/avatars.ts`
- Modify: `packages/shared/src/game.ts`, `packages/shared/src/index.ts`
- Modify: `packages/server/src/db/schema.ts`, `db/client.ts` (DDL + additive `ALTER`), `db/repo.ts`
- Modify: `packages/server/src/rooms/store.ts`, `rooms/snapshot.ts:34-46`, `rooms/runtime.ts:186-206` (`snapshotFor`)
- Test: `packages/server/src/__tests__/repo.test.ts`, `store.test.ts`, `restore-resume.test.ts`

**Interfaces:**
- Produces: `AVATARS: readonly { id: string; emoji: string; label: string }[]` and `isAvatarId(v: unknown): v is string` in `avatars.ts`.
- Produces: `Player.avatar: string` (`''` until chosen) and `Player.team: string | null`.
- Produces: `RoomStore.setProfile(room, playerId, patch: { avatar?: string; team?: string | null }): void`.
- Produces: `Repo.setProfile(workspaceId, playerId, patch): void`.

- [ ] **Step 1: Write the failing tests**

```ts
// store.test.ts
test('a new player starts with no avatar and no team')
test('setProfile updates avatar and team on the live player')
// repo.test.ts
test('setProfile persists avatar and team')
test('a database file created before these columns gains them on open')
// restore-resume.test.ts
test('a restored room keeps each player avatar and team')
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -F @tg/server exec vitest run`
Expected: FAIL.

- [ ] **Step 3: Create `packages/shared/src/avatars.ts`**

Twelve work-appropriate Halloween avatars, each `{ id, emoji, label }` — ids are stable kebab-case slugs (`vampire`, `ghost`, `bat`, `pumpkin`, `zombie`, `spider`, `black-cat`, `skull`, `witch`, `wolf`, `mummy`, `owl`). `isAvatarId` checks membership. Emoji now; Task 19 swaps in PixelLab art behind the same ids.

- [ ] **Step 4: Add the two fields to `Player`**, export `avatars.js` from `index.ts`

- [ ] **Step 5: Add the columns**

`schema.ts`: `avatar: text('avatar').notNull().default('')` and `team: text('team')`. `client.ts`: the same two columns in the `player` DDL, plus an additive `ALTER TABLE player ADD COLUMN` for each, following the `room_snapshot.participants` pattern already at the bottom of `createDb`.

- [ ] **Step 6: Thread the fields through**

`repo.addPlayer` writes `avatar: ''`, `team: null`; add `Repo.setProfile`. `store.addPlayer` sets the same defaults; add `InMemoryRoomStore.setProfile`. `snapshot.ts` copies both onto the rebuilt `RoomPlayer` (the object literal there will fail to typecheck until it does, which is the reminder). `runtime.snapshotFor` adds both to the mapped player — without this the lobby cannot render them.

- [ ] **Step 7: Run tests and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git commit -am "feat(lobby): give every player an avatar and a team slot"
```

---

## Task 4: `POST /api/rooms/:code/me`

**Files:**
- Modify: `packages/server/src/http/rooms.ts`
- Test: `packages/server/src/__tests__/http.test.ts`

**Interfaces:**
- Consumes: `isAvatarId` (Task 3), `RoomStore.setProfile`, `Repo.setProfile`.
- Produces: `POST /api/rooms/:code/me`, body `{ playerToken, avatar?, team? }` → `{ ok: true }`. Errors: `ROOM_NOT_FOUND` 404, `NOT_A_PLAYER` 403, `ALREADY_STARTED` 409, `BAD_AVATAR` 400, `BAD_TEAM` 400.

- [ ] **Step 1: Write the failing tests**

```ts
test('a player sets their avatar and team and both appear in the next snapshot')
test('an unknown playerToken is rejected with NOT_A_PLAYER')
test('setting a profile after the game has started is rejected with ALREADY_STARTED')
// Review Focus 5 — unvalidated values reach every client's lobby render.
test('an avatar id that is not in AVATARS is rejected with BAD_AVATAR')
test('a team id the selected game does not declare is rejected with BAD_TEAM')
test('team: null clears the team and is allowed')
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -F @tg/server exec vitest run src/__tests__/http.test.ts`
Expected: FAIL — 404, no such route.

- [ ] **Step 3: Implement the route** in `registerRoomRoutes`

Resolve the room by code, find the caller by `playerToken` among `live.players` exactly as `/start` does, reject when `live.state !== null`, validate `avatar` with `isAvatarId` and `team` against `getGame(live.gameId)!.teams`, write through `store.setProfile` and `repo.setProfile`, then broadcast a snapshot via `runtimes.get(live.id)?.onConnect(caller.id)`.

- [ ] **Step 4: Run tests**

Run: `pnpm -F @tg/server exec vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(lobby): let a player pick an avatar and a team"
```

---

## Task 5: `thumbnail`, `teams`, `hidden` on the contract

**Files:**
- Modify: `packages/shared/src/game.ts`
- Modify: `packages/server/src/http/rooms.ts:21-28` (`GET /api/games`)
- Modify: `packages/server/src/games/pumpkin/index.ts`
- Create: `packages/web/public/games/pumpkin-carve/thumb.png` (placeholder until Task 19)
- Test: `packages/server/src/__tests__/http.test.ts`

**Interfaces:**
- Produces: `GameModule.thumbnail: string` (required), `.teams?: readonly { id: string; name: string; color: string }[]`, `.hidden?: boolean`.

- [ ] **Step 1: Write the failing tests**

```ts
test('GET /api/games returns thumbnail and teams for each game')
test('GET /api/games omits a module marked hidden')
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -F @tg/server exec vitest run src/__tests__/http.test.ts -t api/games`
Expected: FAIL.

- [ ] **Step 3: Add the three fields to `GameModule`**; give `pumpkinModule` `thumbnail: '/games/pumpkin-carve/thumb.png'`

- [ ] **Step 4: Project and filter in `GET /api/games`**

Add `thumbnail` and `teams` to the returned object; filter with `GAMES.filter(g => !g.hidden)`.

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(portal): give every game a thumbnail, teams and a hidden flag"
```

---

## Task 6: The game picker

**Files:**
- Modify: `packages/web/src/lobby/api.ts`
- Create: `packages/web/src/lobby/GamePicker.tsx`
- Modify: `packages/web/src/lobby/JoinScreen.tsx:38-45` (the `host()` function)
- Test: `packages/web/src/__tests__/game-picker.test.tsx`

**Interfaces:**
- Produces: `listGames(): Promise<GameCard[]>` where `GameCard = { id, name, description, minPlayers, maxPlayers, estimatedMinutes, theme, thumbnail, teams? }`.
- Produces: `<GamePicker onPick={(gameId: string) => void} onCancel={() => void} />`.

- [ ] **Step 1: Write the failing tests**

```ts
test('the picker renders a card per game from /api/games')
test('picking a game calls onPick with its id')
test('a failed fetch shows a retry rather than an empty grid')
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -F @tg/web exec vitest run src/__tests__/game-picker.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Add `listGames` to `api.ts`**

A `GET` helper alongside the existing `post`, same error shape.

- [ ] **Step 4: Build `GamePicker.tsx`**

A grid of cards: thumbnail, name, description, `{minPlayers}–{maxPlayers} players · ~{estimatedMinutes} min`, the card's glow from `theme.accent`. Follow the existing `neon.css` class vocabulary rather than inventing one.

- [ ] **Step 5: Wire it into `JoinScreen`**

"Start a new room" opens the picker instead of calling `createRoom('pumpkin-carve')`; the pick supplies the `gameId`. Joining by code is untouched.

- [ ] **Step 6: Run tests**

Run: `pnpm -F @tg/web exec vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git commit -am "feat(web): choose a game instead of hardcoding the pumpkin"
```

---

## Task 7: Team columns and avatar picking in the lobby

**Files:**
- Modify: `packages/web/src/lobby/api.ts` (add `setProfile`, error strings)
- Modify: `packages/web/src/lobby/Lobby.tsx`
- Test: `packages/web/src/__tests__/lobby.test.tsx`

**Interfaces:**
- Consumes: `POST /api/rooms/:code/me` (Task 4), `AVATARS` (Task 3), `listGames` (Task 6).
- Produces: `setProfile(code, playerToken, patch): Promise<{ ok: true }>`.

- [ ] **Step 1: Write the failing tests**

```ts
test('a game with no declared teams renders the lobby unchanged')   // pumpkin regression
test('a game with teams renders one column per team with a join button')
test('joining a team calls setProfile and shows the player in that column')
test('picking an avatar calls setProfile')
test('start is disabled while either team is empty')
test('a lopsided split shows a nudge but does not block start')
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -F @tg/web exec vitest run src/__tests__/lobby.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Add `setProfile` and its `humanize` strings to `api.ts`**

`BAD_AVATAR`, `BAD_TEAM`, `NOT_A_PLAYER` get human sentences in the existing switch.

- [ ] **Step 4: Extend `Lobby.tsx`**

The team columns render only when the room's game declares `teams`; otherwise the existing single roster is unchanged. Each column lists its members by `labels[id]` with their avatar. An avatar strip sits under the player's own name. Start stays host-only and additionally requires both teams non-empty.

- [ ] **Step 5: Run tests**

Run: `pnpm -F @tg/web exec vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(lobby): pick a team and an avatar before the game starts"
```

---

## Task 8: The pack format, validator and dev pack

**Files:**
- Create: `packages/shared/src/fright-pack.ts`
- Create: `scripts/gen-dev-pack.ts`
- Create: `content/packs/dev/pack.json` + its generated images
- Test: `packages/shared/src/__tests__/fright-pack.test.ts`

**Interfaces:**
- Produces: `type Clue = ImageClue | TextClue`; both carry `value: number`, `prompt: string`, `choices: string[]`, `source: string`, `verifiedAt: string`. `ImageClue` adds `kind: 'image'`, `file: string`, `mosaic: number`. `TextClue` adds `kind: 'text'`.
- Produces: `type Pack = { id: string; name: string; values: number[]; categories: { id: string; name: string; clues: Clue[] }[] }`.
- Produces: `validatePack(pack: unknown): string[]` — a list of human-readable problems, empty when valid. **Messages name a clue by category id and value, never by its text or choices.**
- Produces: `choiceCountFor(value: number, values: number[]): 4 | 6` — 6 for the top two rows, 4 otherwise.
- Produces: `shuffleChoices(choices: string[], seed: number, clueKey: string): { order: string[]; correct: number }` — pure, deterministic.
- Produces: `fiftyFifty(order: string[], correct: number, seed: number, clueKey: string, team: string): number[]` — the indexes to eliminate: half the wrong choices (2 of 4, 3 of 6), never the correct one. Pure and deterministic, keyed by team so the two teams cut differently.

- [ ] **Step 1: Write the failing tests**

```ts
test('a well-formed pack validates clean')
test('a category missing a value is reported by category id and value')
test('a validator message never contains a prompt or a choice')
test('choices of the wrong length for the row are rejected')
test('duplicate choices within a clue are rejected')
test('an image clue with a missing file is rejected')
test('choiceCountFor gives 4 on the bottom three rows and 6 on the top two')
test('shuffleChoices is stable for the same seed and clue key')
test('shuffleChoices differs between two seeds')
test('shuffleChoices always reports the index that holds choices[0]')
test('fiftyFifty removes 2 of 4 and 3 of 6, and never the correct index')
test('fiftyFifty is stable for the same team and differs between the two teams')
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -F @tg/shared exec vitest run src/__tests__/fright-pack.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `fright-pack.ts`**

`shuffleChoices` uses a small seeded PRNG (mulberry32 over a hash of `seed` and `clueKey`) and a Fisher–Yates pass, then reports where `choices[0]` landed. No dependency.

- [ ] **Step 4: Write `scripts/gen-dev-pack.ts` and run it**

Emits 2 categories × 2 rows (values `[200, 400]`): one image category of flat-colour shape PNGs, one text category whose questions are about those shapes ("what colour is the triangle in the 200 clue"), so answers are correct by construction. Include one choice set with an accent and one long enough to test wrapping.

- [ ] **Step 5: Run tests**

Run: `pnpm -F @tg/shared exec vitest run`
Expected: PASS, including validation of the generated dev pack.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/fright-pack.ts packages/shared/src/__tests__/fright-pack.test.ts scripts/gen-dev-pack.ts content/packs/dev
git commit -m "feat(fright): define the clue pack, its validator and a dev pack"
```

---

## Task 9: Game state, `createState`, `setPhase`

**Files:**
- Create: `packages/shared/src/fright.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/__tests__/fright-state.test.ts`

**Interfaces:**
- Produces: `FRIGHT_PHASES = ['lobby','board','reading','clue','steal','answer','reveal','results'] as const`.
- Produces:
```ts
type Tile = { categoryId: string; value: number; spent: boolean }
type ActiveClue = {
  categoryId: string; value: number; kind: 'image' | 'text'
  prompt: string; file?: string; mosaic?: number
  order: string[]; correct: number        // correct NEVER reaches a pre-reveal view
  buzzedBy: PlayerId | null; buzzedTeam: string | null
  spentTeams: string[]; wrongIndexes: number[]
  // Per TEAM, never merged. A viewer gets only their own team's entry (§8.6).
  eliminated: Record<string, number[]>
}
type FrightState = {
  phase: string; seed: number
  teams: Record<PlayerId, string>          // frozen roster, §4.2 of the spec
  scores: Record<string, number>
  lifelines: Record<string, number>        // team id -> remaining, starts at 2
  control: string                          // team id
  tiles: Tile[]; clues: Record<string, ActiveClue>   // key `${categoryId}:${value}`
  active: string | null                    // clue key
  buzzCount: Record<PlayerId, number>; correctCount: Record<PlayerId, number>
}
```
- Produces: `createState(players: Player[], seed: number): FrightState` (curried over a `Pack` by the factory in Task 13), `setPhase(state, phase): FrightState`.

- [ ] **Step 1: Write the failing tests**

```ts
test('createState freezes each player team from the player list')
test('createState builds one tile per category per declared value, none spent')
test('createState shuffles every clue and stores its correct index')
test('createState picks starting control from the seed, deterministically')
test('createState gives each team two lifelines')
test('setPhase to board from reveal clears the active clue and advances control')
test('setPhase to board from anywhere else leaves control alone')
test('a player with team null is not in the teams map')      // spectators
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -F @tg/shared exec vitest run src/__tests__/fright-state.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement state, `createState` and `setPhase`**

`createState` reads `player.team`; `reduce` can never see a `Player`, so this is the only point the roster is captured. Control after a reveal: the team that answered correctly, else the other team.

- [ ] **Step 4: Run tests**

Run: `pnpm -F @tg/shared exec vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(fright): game state, seeded setup and phase entry"
```

---

## Task 10: `reduce`

**Files:**
- Modify: `packages/shared/src/fright.ts`
- Test: `packages/shared/src/__tests__/fright-reduce.test.ts`

**Interfaces:**
- Consumes: `FrightState` (Task 9).
- Produces: `type FrightAction = { type: 'PICK'; categoryId: string; value: number } | { type: 'BUZZ' } | { type: 'CHOOSE'; index: number } | { type: 'LIFELINE' } | { type: 'SKIP' } | { type: 'END' }` and `reduce(state, action, by): FrightState`.

- [ ] **Step 1: Write the failing tests**

```ts
// PICK
test('a player on the controlling team opens a tile')
test('a player on the other team cannot open a tile')
test('a spectator cannot open a tile')
// Review Focus 3
test('PICK on a spent tile changes nothing')
test('PICK on a category or value not on the board changes nothing')
// BUZZ
test('a buzz during reading is ignored')
test('the first buzz in clue wins and records the player and their team')
// Review Focus 1 — the 700ms EARLY_ADVANCE_MS beat
test('a second buzz arriving before the phase changes does not displace the first')
test('a spectator cannot buzz')
test('a team that has spent its shot cannot buzz in steal')
// CHOOSE
test('the buzzing player choosing the correct index scores the tile value')
test('the buzzing player choosing wrong records the wrong index and spends their shot')
// Review Focus 2
test('a CHOOSE from a teammate of the buzzing player is ignored')
test('a CHOOSE from the other team is ignored')
test('an out-of-range index is ignored and does NOT spend the shot')
// LIFELINE (§8.6)
test('the buzzing player spends a lifeline and their team eliminations are recorded')
test('a lifeline before any buzz is ignored')
test('a lifeline from the team that did not buzz is ignored')
test('a second lifeline on the same clue by the same team is ignored')
test('a third lifeline in the game by the same team is ignored')
test('both teams may each spend one on the same clue, with different eliminations')
test('a lifeline never eliminates the correct index')
// counters
test('buzzCount and correctCount track per player')
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -F @tg/shared exec vitest run src/__tests__/fright-reduce.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `reduce`**

Every branch returns `state` unchanged when its guard fails — never throws, per the runtime's contract. `SKIP` marks the active tile spent and routes to `reveal`; `END` marks every tile spent so `nextPhase` falls through to `results`. Authorisation for those two is the runtime's job (Task 2), not the reducer's.

- [ ] **Step 4: Run tests**

Run: `pnpm -F @tg/shared exec vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(fright): pick, buzz and choose"
```

---

## Task 11: `nextPhase`, `phaseComplete`, scoring and control

**Files:**
- Modify: `packages/shared/src/fright.ts`
- Test: `packages/shared/src/__tests__/fright-flow.test.ts`

**Interfaces:**
- Produces: `nextPhase(state, current): string | null`, `phaseComplete(state, phase, players): boolean`, `tally(state): { scores: Record<string, number>; winner: string | null }`.

- [ ] **Step 1: Write the failing tests**

```ts
test('board goes to reading')
test('reading always goes to clue')
test('clue with a buzz goes to answer; with no buzz goes to reveal')
test('steal with a buzz goes to answer; with no buzz goes to reveal')
test('answer goes to reveal when the choice was correct')
test('answer goes to steal when wrong and the other team has a shot left')
test('answer goes to reveal when wrong and both teams have spent their shots')
test('reveal goes to board while tiles remain, and to results when none do')
test('phaseComplete is true in board once a tile is picked')
test('phaseComplete is true in clue once a buzz lands')
test('phaseComplete is true in answer once a choice lands')
test('tally reports a tie as a tie, with no winner')
// Review Focus 4
test('board expiring when the leftmost column is spent auto-picks from the next column that is not')
test('board expiring with every tile spent goes to results without picking')
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -F @tg/shared exec vitest run src/__tests__/fright-flow.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the three functions**

The auto-pick is a `setPhase('reading')` concern rather than `nextPhase`'s: `nextPhase('board')` returns `'reading'`, and `setPhase(state,'reading')` with no `active` selects the lowest remaining value scanning columns left to right — which is where Review Focus 4 is handled.

- [ ] **Step 4: Run tests**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(fright): the phase loop, scoring and board control"
```

---

## Task 12: `viewFor` and redaction

**Files:**
- Modify: `packages/shared/src/fright.ts`
- Test: `packages/shared/src/__tests__/fright-view.test.ts`

**Interfaces:**
- Produces: `FrightView` — a discriminated union on `kind`: `'lobby' | 'board' | 'clue' | 'reveal' | 'results'`. The `clue` view carries `order: string[]`, `canBuzz: boolean`, `canChoose: boolean`, `armed: boolean`, `answeringName: string | null`, `wrongIndexes: number[]`, `lifelines: Record<string, number>`, `myEliminated: number[]`, `canLifeline: boolean`, and **no correct index and no other team's eliminations**. The `reveal` view carries `correct: number`.
- Produces: `viewFor(state, viewer, waiting?): FrightView`.

- [ ] **Step 1: Write the failing tests**

```ts
// The single most important test in the suite.
test('no pre-reveal view for any phase and any viewer contains the correct index')
test('canChoose is true only for the buzzing player')
test('canBuzz is false during reading and true during clue for an eligible team')
test('canBuzz is false for a team that has spent its shot during steal')
test('the board view marks spent tiles and names the controlling team')
test('the reveal view carries the correct index and the image file')
test('a spectator gets a view with canBuzz and canChoose false')
// §8.6 — the rule that makes a lifeline safe to spend.
test('a viewer receives their own team eliminations and never the other team\'s')
test('both teams lifeline counts are public, but only own eliminations are')
```

The first test iterates every phase × every seeded player and asserts `JSON.stringify(view)` never contains a `correct` field — a structural assertion, so a future field cannot leak it past the test.

The eliminations test is the same shape and matters as much: spend a lifeline for blue, then assert a red viewer's serialised view contains none of blue's eliminated indexes under any key.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -F @tg/shared exec vitest run src/__tests__/fright-view.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `viewFor`**

Build each view from scratch per phase. Never spread `ActiveClue` into a view — spreading is how `correct` escapes.

- [ ] **Step 4: Run tests**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(fright): per-viewer views that never carry the answer"
```

---

## Task 13: The module factory, both registry entries, phase config

**Files:**
- Create: `packages/server/src/games/fright/index.ts`
- Modify: `packages/server/src/games/registry.ts`
- Modify: `packages/server/src/rooms/store.ts:23-41` (`roomConfigFromEnv`)
- Create: `packages/web/public/games/fright-night/thumb.png` (placeholder until Task 19)
- Test: `packages/server/src/__tests__/fright-module.test.ts`, `store.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 8–12.
- Produces: `makeFrightModule(opts: { id: string; name: string; pack: Pack; hidden?: boolean }): GameModule<FrightState, FrightAction, FrightView>`, plus `frightNight` and `frightNightDev`.

- [ ] **Step 1: Write the failing tests**

```ts
test('the module declares both teams, hostActions and a thumbnail')
test('the dev module is hidden and names itself as the dev pack')
test('a full dev-pack game runs lobby to results through the real runtime')
test('SKIP from the host spends the tile and reveals')
test('END from the host goes to results')
// store.test.ts
test('roomConfigFromEnv gives every fright phase a duration')
test('an invalid BOARD_MS falls back to the default')
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -F @tg/server exec vitest run`
Expected: FAIL.

- [ ] **Step 3: Add the fright phases to `roomConfigFromEnv`**

`board` 30s/`BOARD_MS`, `reading` 6s/`READ_MS`, `clue` 20s/`CLUE_MS`, `steal` 12s/`STEAL_MS`, `answer` 12s/`ANSWER_MS`, `reveal` 6s/`REVEAL_MS`, each through the existing `envMs` helper.

- [ ] **Step 4: Write the factory and both instances**

`hostActions: ['SKIP','END']`, `teams: [{id:'blue',…},{id:'red',…}]`, `minPlayers: 2`, `maxPlayers: 16`, `theme` from the spec's palette, `hostLines` per phase. `frightNightDev` sets `hidden: true` and `name: 'Fright Night (dev pack)'`. Packs are loaded from `content/packs/*/pack.json` at module construction.

- [ ] **Step 5: Register both** in `registry.ts`

- [ ] **Step 6: Run the whole suite and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git commit -am "feat(fright): register the game over a real pack and a dev pack"
```

---

## Task 14: The set shell and the board

**Files:**
- Create: `packages/web/src/games/fright/Set.tsx`, `Board.tsx`
- Create: `packages/web/src/theme/fright.css`
- Test: `packages/web/src/__tests__/fright-board.test.tsx`

**Interfaces:**
- Consumes: the `board` variant of `FrightView` (Task 12).
- Produces: `<Set scores={…} teams={…} banner={…}>{panel}</Set>` — the persistent proscenium with the bottom score rail, per spec §6.0. `<Board view onPick />`.

- [ ] **Step 1: Write the failing tests**

```ts
test('the board renders a column per category and a tile per value')
test('spent tiles render blank and are not clickable')
test('tiles are live only for a player on the controlling team')
test('a non-controlling player sees the banner naming who picks')
test('clicking a live tile dispatches PICK with its category and value')
test('tiles are reachable and activatable by keyboard')
test('scores for both teams are on the rail')
test('each team shows its remaining lifeline pips on its podium')
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -F @tg/web exec vitest run src/__tests__/fright-board.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Build `Set.tsx`**

A CSS-only placeholder proscenium — pillars, curtain gradients, starfield, lit score rails — sized so Task 19's art drops in without a layout change. Values in Archivo Expanded Black per portal spec §8.2.

- [ ] **Step 4: Build `Board.tsx`**

- [ ] **Step 5: Run tests**

Run: `pnpm -F @tg/web exec vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(web): the fright night set and its board"
```

---

## Task 15: The clue stage, buzzer and choices

**Files:**
- Create: `packages/web/src/games/fright/Stage.tsx`, `ClueCard.tsx`, `PixelImage.tsx`, `ChoiceGrid.tsx`, `Buzzer.tsx`
- Test: `packages/web/src/__tests__/fright-stage.test.tsx`, `pixel-image.test.ts`

**Interfaces:**
- Consumes: the `clue` variant of `FrightView`.
- Produces: `<PixelImage src mosaic revealed />` — canvas, `imageSmoothingEnabled = false`, downscale then upscale; crossfades to the untouched image when `revealed`.

- [ ] **Step 1: Write the failing tests**

```ts
test('the buzzer is dead and labelled during reading')
test('the buzzer is armed during clue and dispatches BUZZ once')
test('a press that began before arming does not buzz')
test('choices render for everyone but are inert until a buzz')
test('after a buzz, only the buzzing player gets live buttons')
test('everyone else sees who is answering and the same countdown')
test('number keys 1-6 select for the buzzing player only')
test('a wrong index from a previous team renders struck through during steal')
test('an image clue renders a mosaic; a text clue renders the prompt')
test('a six-choice clue lays out 3x2 and a four-choice clue 2x2')
// Lifelines, §8.6
test('the Flashlight button is offered only to the buzzing player')
test('the Flashlight is disabled when the team has none left')
test('the Flashlight is disabled once spent on this clue')
test('pressing the Flashlight dispatches LIFELINE and dims the eliminated choices')
test('a dimmed choice cannot be selected by click or number key')
test('the other team sees the pip go dark but no dimmed choices')
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -F @tg/web exec vitest run src/__tests__/fright-stage.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Build the components**

The arm transition is the game's most important animation (spec §6.2): grey, labelled, not a button → full colour with a label change. "Press began after arming" is a `pointerdown` timestamp compared against the phase's start, not a disabled attribute alone. Countdowns come from `remainingMs(endsAt, clockOffset)` in the connection store — never a local timer.

- [ ] **Step 4: Run tests**

Run: `pnpm -F @tg/web exec vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(web): the clue stage, the armed buzzer and the choice grid"
```

---

## Task 16: Reveal, results and routing

**Files:**
- Create: `packages/web/src/games/fright/Reveal.tsx`, `Results.tsx`
- Modify: `packages/web/src/App.tsx:150-160` (the `view.kind` router)
- Test: `packages/web/src/__tests__/fright-reveal.test.tsx`

**Interfaces:**
- Consumes: the `reveal` and `results` variants of `FrightView`.

- [ ] **Step 1: Write the failing tests**

```ts
test('reveal lights the correct choice')
test('reveal distinguishes correct, both teams missed, and nobody buzzed, in words')
test('reveal crossfades an image clue to the full photo')
test('results name the winning team, or a tie as a tie')
test('results list most buzzes and most correct by player')
test('results show every image clue un-pixelated')
test('App routes each fright view kind to its screen')
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -F @tg/web exec vitest run src/__tests__/fright-reveal.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Build both components and extend the router**

Route on `view.kind`, never on `phase` — the comment at the top of `App.tsx` explains why, and it applies here unchanged.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(web): the reveal and the final scoreboard"
```

---

## Task 17: End to end on the dev pack

**Files:**
- Create: `e2e/fright.spec.ts`
- Modify: `e2e/load.ts` (teach the bot the fright actions)
- Test: the spec is the test

**Interfaces:**
- Consumes: `fright-night-dev` (Task 13), the whole web client.

- [ ] **Step 1: Write the failing spec**

Two browsers, one per team. Create a `fright-night-dev` room, both join, each picks a team and an avatar, host starts. Then: pick a tile; press the buzzer during `reading` and assert nothing happens; buzz after arming; spend a Flashlight and assert two choices dim **in this browser and not the other**; choose wrong; assert the steal opens for the other team with the wrong choice struck through and **no dimmed choices**; choose right; assert the score moved by the tile value; clear the remaining tiles; assert results. Derive every wait from `DEFAULT_ROOM_CONFIG`, as `smoke.spec.ts` already does.

The cross-browser lifeline assertion is the only place Review Focus 5 is checked against a real socket rather than a unit-tested view.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm e2e --grep fright`
Expected: FAIL.

- [ ] **Step 3: Fix whatever it catches**

This is the first time the whole stack runs together; expect real bugs here rather than a clean pass.

- [ ] **Step 4: Run the full suite**

Run: `pnpm test && pnpm typecheck && pnpm e2e`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "test(e2e): a full fright night board, buzzer to results"
```

---

## Task 18: The Halloween pack

**Files:**
- Create: `content/packs/halloween/pack.json` and its images
- Create: `docs/superpowers/plans/2026-10-25-pack-report.md` (the spoiler-free report)

**Interfaces:**
- Consumes: `validatePack` (Task 8).

**This task is content, not code, and it is the only task that produces material the repo owner must not read.** Spec §7.2–§7.4 govern it completely. Work it in one sitting and commit it once.

- [ ] **Step 1: Write the four trivia categories**

Six categories × five rows (spec §5.2), ten image clues and twenty text. Every clue: a source checked at write time, a single unambiguous answer, no facts with a shelf life, no trick phrasing. Every distractor: plausible, same-category, not arguably correct, not distinguishable by shape, distinct after normalisation. Four choices on 200/400/600, six on 800/1000. One clue references Twilight (spec decision 22).

- [ ] **Step 2: Source and verify every image**

For each: pull it, **open and look at it**, confirm the subject is unmistakable and alone in frame with no watermark, confirm it clears the no-gore rule, then **render it at its proposed mosaic size and look at that too** — a 200 must be gettable, a 1000 must not be trivially so. Adjust the mosaic or the row, or drop the image. Record `source` and `verifiedAt`.

- [ ] **Step 3: Hash the filenames**

Every image file is named by content hash. A filename must never name its answer — it is visible in the file tree, in `git log`, and in the URL every player's browser requests before the reveal.

- [ ] **Step 4: Validate**

Run: `pnpm -F @tg/shared exec vitest run -t "pack"`
Expected: PASS, with no prompt or choice printed by any assertion.

- [ ] **Step 5: Write the spoiler-free report**

Categories and counts, what was dropped and why, the licensing position from spec §7.4. **No images, no prompts, no choices.**

- [ ] **Step 6: Commit in one commit, clearly labelled**

```bash
git add content/packs/halloween docs/superpowers/plans/2026-10-25-pack-report.md
git commit -m "content(fright): the Halloween pack — SPOILERS, do not open this diff"
```

---

## Task 19: PixelLab art

**Files:**
- Modify: `packages/web/public/games/fright-night/`, `packages/web/public/games/pumpkin-carve/thumb.png`
- Modify: `packages/shared/src/avatars.ts` (swap emoji for art behind the same ids)
- Modify: `packages/web/src/games/fright/Set.tsx`, `theme/fright.css`

**Interfaces:**
- Consumes: the avatar ids from Task 3 and the set layout from Task 14. **Ids and layout do not change** — this task swaps assets behind them.

- [ ] **Step 1: Generate the set**

PixelLab: proscenium with pillars and curtains, spotlights on the back wall, starfield above, per `ref-jeopardy-set.png`. Dark, saturated, work-appropriate.

- [ ] **Step 2: Generate twelve avatars** at the existing ids, readable at 22px

- [ ] **Step 3: Generate both picker thumbnails**

- [ ] **Step 4: Swap the assets in and confirm nothing moved**

Run: `pnpm test && pnpm e2e`
Expected: PASS — every Task 14–16 test still passes, because only assets changed.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(art): dress the fright night set"
```

---

## Self-review notes

- **Spec coverage.** §4.1→T1, §4.2→T3, §4.3→T5/T6, §4.4→T2, §4.5→T13, §5→T8, §6.0/6.1→T14, §6.2/6.3→T15, §6.4/6.6→T16, §6.5→T7, §7.1→T8, §7.2–7.5→T18, §8.1/8.5→T11, §8.2→T8/T9, §8.3/8.4→T10/T15, §8.6→T8/T9/T10/T12/T15, §9→T12, §10→T10/T11/T17, §11→every task, §12→task order, §14 left open deliberately.
- **Review Focus coverage.** 1→T10, 2→T10, 3→T10, 4→T11, 5→T12 and T17, 6→T4.
- **Naming checked across tasks.** `setProfile` (store, repo, api), `validatePack`, `shuffleChoices`, `choiceCountFor`, `makeFrightModule`, `FrightState`/`FrightAction`/`FrightView`, `MAX_PHASE_HOPS` are each used under one name throughout.
- **Known risk.** Task 17 is where the stack meets itself; budget real debugging there, not a formality.
