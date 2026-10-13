# Team Games Portal — Tier 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a deployed, live multiplayer jack-o'-lantern carving game — join by code, private timed carve with a structural integrity meter, sequential anonymous voting across four awards, 2D lit gallery reveal — on a portal architecture that accepts game #2 without modification.

**Architecture:** A pnpm monorepo with three packages. A single Fastify process owns authoritative game state and serves the built client. Rooms live in memory behind a `RoomStore` interface; each room's `RoomRuntime` drives phases and timers and delegates rules to a `GameModule` whose `reduce` is pure and whose `viewFor` redacts state per viewer. Every persisted row carries `workspaceId`.

**Tech Stack:** TypeScript (strict) · pnpm workspaces · Fastify 5 · `ws` 8 · Drizzle ORM + better-sqlite3 · Vite 7 + React 19 · Zustand 5 · Vitest 3 · Playwright 1.5x · Fly.io

**Spec:** `docs/superpowers/specs/2026-10-12-team-games-portal-design.md`

**Scope:** Spec Tier 1 only, through deployment. Tier 2 (Three.js catwalk) and Tier 3 (guess-who, sound) are a separate plan. Spec §12 items stay out of scope.

## Global Constraints

- Node >= 22. pnpm >= 9. TypeScript `strict: true` in `tsconfig.base.json`, inherited by every package.
- Package names exactly `@tg/shared`, `@tg/server`, `@tg/web`.
- `@tg/shared` is source-only: `exports` points at `./src/index.ts`, no build step, no `dist`, no TypeScript project references.
- No Turborepo. Root pnpm scripts plus `concurrently` only.
- `reduce` must be pure: no I/O, no `Date.now()`, no `Math.random()`. All randomness derives from the `seed` passed to `createState`.
- `by: PlayerId` in `reduce` is always supplied by the server from the authenticated socket, never read from the message body.
- Every persisted row below `workspace` carries `workspaceId`. The repository layer exposes no unscoped lookup.
- Join codes: 6 characters, uppercase, alphabet `ABCDEFGHJKLMNPQRTUVWXYZ2346789` (excludes `O 0 I 1 S 5`).
- Timer messages carry an absolute `endsAt` plus `serverNow`. Never stream per-second ticks.
- Carve strokes are the wire format. Points normalized to 0..1. Never transmit rasterized images.
- Gallery entries are identified by **slot index**, never `playerId`, in every pre-results payload.
- Shell color tokens exactly: `--shell-bg: #0E0D14`, `--shell-surface: #1A1826`, `--shell-border: #2E2B3F`, `--shell-text: #F4F2F8`, `--shell-muted: #9A95AD`.
- Pumpkin theme exactly: `accent #FF7518`, `accent2 #8B5CF6`, `glow #FFC24D`, `danger #84CC16`.
- Fonts: Archivo (display), Inter (UI), Bungee (game accent). All self-hosted via `@fontsource`, no Google Fonts CDN call at runtime.
- Phase timings live in room config, never as inline constants.
- Nothing is encoded in color alone. The integrity meter carries a text label and a crack-count shape change.
- Audio muted by default.

## Review Focus

These are input classes the spec implies but does not call out. Each has a test pinned to the task that owns the code.

1. **Two players with the same display name** — the gallery and results must still attribute pumpkins unambiguously, since a work team will have two Jocelyns. (Task 4)
2. **Joining after the game has started** — a late joiner must get a coherent view rather than a half-initialized player with no pumpkin. (Task 9)
3. **Rooms too small to vote** — with 1 player, every vote is a self-vote and therefore invalid; the tally must not crash or crown a self-voter. (Task 6)
4. **An award with zero valid votes** — everyone abstained or disconnected; the tally must return no winner rather than `undefined` leaking to the client. (Task 6)
5. **The same `playerToken` connecting twice** — a second tab must not produce a duplicate presence entry or let one person vote twice. (Task 12)

---

## File Structure

```
team-games/
  pnpm-workspace.yaml                     # package globs
  package.json                            # root scripts: dev, test, build, lint
  tsconfig.base.json                      # strict, shared compiler options
  packages/
    shared/
      package.json                        # @tg/shared, exports ./src/index.ts
      src/index.ts                        # re-exports everything below
      src/ids.ts                          # branded ids + newId()
      src/events.ts                       # ClientMessage / ServerMessage
      src/game.ts                         # GameModule, RoomContext, Player, GameTheme
      src/carve.ts                        # Stroke type, carvedRatio() — pure, shared by both sides
      src/pumpkin.ts                      # PumpkinState, actions, phases, award keys
      src/code.ts                         # join code alphabet + generator
      src/__tests__/                      # vitest specs for the pure modules
    server/
      package.json                        # @tg/server
      src/index.ts                        # Fastify bootstrap, static serving
      src/db/schema.ts                    # Drizzle tables
      src/db/client.ts                    # better-sqlite3 connection + migrate
      src/db/repo.ts                       # workspace-scoped repository
      src/rooms/store.ts                  # RoomStore interface + InMemoryRoomStore
      src/rooms/runtime.ts                # RoomRuntime: phases, timers, seed, broadcast
      src/rooms/snapshot.ts               # persist/restore room state across restart
      src/http/join.ts                    # POST /api/rooms/:code/join
      src/http/rooms.ts                   # POST /api/rooms (create)
      src/transport/socket.ts             # ws upgrade, auth, message routing
      src/games/registry.ts               # server game registry
      src/games/pumpkin/index.ts          # the GameModule implementation
      src/__tests__/
    web/
      package.json                        # @tg/web
      index.html
      vite.config.ts                      # /ws + /api proxy to server in dev
      src/main.tsx
      src/App.tsx                         # phase router
      src/theme/tokens.css                # shell tokens + fonts
      src/store/connection.ts             # Zustand: socket, snapshot, reconnect, clock offset
      src/lobby/JoinScreen.tsx
      src/lobby/Lobby.tsx
      src/ui/HostLine.tsx
      src/ui/Timer.tsx                    # renders from endsAt + offset
      src/games/pumpkin/CarveScreen.tsx
      src/games/pumpkin/canvas.ts         # imperative rasterizer, outside React
      src/games/pumpkin/IntegrityMeter.tsx
      src/games/pumpkin/VoteScreen.tsx
      src/games/pumpkin/ResultsScreen.tsx
      src/games/registry.ts               # client game registry
  e2e/
    smoke.spec.ts                         # Playwright: two contexts, full round
    load.ts                               # spawns 12 headless clients
  fly.toml
  Dockerfile
```

Files are split by responsibility, not layer: the pumpkin game's rules live in one file in `shared`/`server`, its screens in one folder in `web`. `carve.ts` sits in `shared` because the integrity ratio must be computed identically by the client (live meter) and the server (authoritative collapse).

---

## Task 1: Monorepo skeleton and shared identifiers

**Files:**
- Create: `pnpm-workspace.yaml`, `package.json`, `tsconfig.base.json`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/ids.ts`, `packages/shared/src/index.ts`
- Test: `packages/shared/src/__tests__/ids.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Brand<K,T>`, `WorkspaceId`, `RoomId`, `PlayerId`, `RoomCode` types; `asWorkspaceId(s: string): WorkspaceId`, `asRoomId`, `asPlayerId`, `asRoomCode`; `newId(): string` returning a 21-char URL-safe id.

- [ ] **Step 1: Create the workspace root**

`pnpm-workspace.yaml`:
```yaml
packages:
  - 'packages/*'
```

`package.json`:
```json
{
  "name": "team-games",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22", "pnpm": ">=9" },
  "scripts": {
    "dev": "concurrently -n server,web -c cyan,magenta \"pnpm -F @tg/server dev\" \"pnpm -F @tg/web dev\"",
    "test": "vitest run",
    "build": "pnpm -F @tg/web build && pnpm -F @tg/server build",
    "typecheck": "tsc -b --noEmit packages/shared packages/server packages/web"
  },
  "devDependencies": {
    "concurrently": "9.1.2",
    "typescript": "5.7.3",
    "vitest": "3.0.5"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true
  }
}
```

`noUncheckedIndexedAccess` is deliberate: this codebase indexes records by `PlayerId` constantly, and it forces the absent-player case to be handled rather than crashing at runtime during a game.

- [ ] **Step 2: Create the shared package**

`packages/shared/package.json`:
```json
{
  "name": "@tg/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" }
}
```

`packages/shared/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 3: Write the failing test**

`packages/shared/src/__tests__/ids.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { newId, asPlayerId, asRoomId } from '../ids.js'

describe('newId', () => {
  it('returns a 21-character url-safe id', () => {
    const id = newId()
    expect(id).toHaveLength(21)
    expect(id).toMatch(/^[A-Za-z0-9_-]{21}$/)
  })

  it('does not collide across 10k draws', () => {
    const seen = new Set(Array.from({ length: 10_000 }, () => newId()))
    expect(seen.size).toBe(10_000)
  })
})

describe('branded ids', () => {
  it('round-trips the underlying string', () => {
    expect(asPlayerId('abc')).toBe('abc')
    expect(asRoomId('xyz')).toBe('xyz')
  })
})
```

- [ ] **Step 4: Run the test and confirm it fails**

Run: `pnpm vitest run packages/shared/src/__tests__/ids.test.ts`
Expected: FAIL — `Failed to resolve import "../ids.js"`

- [ ] **Step 5: Implement the identifiers**

`packages/shared/src/ids.ts`:
```ts
import { randomBytes } from 'node:crypto'

declare const brand: unique symbol
export type Brand<K, T> = K & { readonly [brand]: T }

export type WorkspaceId = Brand<string, 'WorkspaceId'>
export type RoomId = Brand<string, 'RoomId'>
export type PlayerId = Brand<string, 'PlayerId'>
export type RoomCode = Brand<string, 'RoomCode'>

export const asWorkspaceId = (s: string): WorkspaceId => s as WorkspaceId
export const asRoomId = (s: string): RoomId => s as RoomId
export const asPlayerId = (s: string): PlayerId => s as PlayerId
export const asRoomCode = (s: string): RoomCode => s as RoomCode

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** 21-char url-safe id. 126 bits of entropy — collision-free at our scale. */
export function newId(): string {
  const bytes = randomBytes(21)
  let out = ''
  for (let i = 0; i < 21; i++) out += ALPHABET[bytes[i]! & 63]
  return out
}
```

`packages/shared/src/index.ts`:
```ts
export * from './ids.js'
```

- [ ] **Step 6: Run the test and confirm it passes**

Run: `pnpm vitest run packages/shared/src/__tests__/ids.test.ts`
Expected: PASS — 3 tests

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Add monorepo skeleton and branded identifiers

Branded ids make it a type error to pass a RoomId where a WorkspaceId
belongs, which is cheap insurance on the tenancy rule that every row
below workspace carries workspaceId."
```

---

## Task 2: Join code generation

**Files:**
- Create: `packages/shared/src/code.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/__tests__/code.test.ts`

**Interfaces:**
- Consumes: `RoomCode`, `asRoomCode` from Task 1.
- Produces: `CODE_ALPHABET: string`, `CODE_LENGTH: 6`, `generateCode(isTaken: (c: RoomCode) => boolean): RoomCode`, `normalizeCode(input: string): RoomCode` (uppercases and strips whitespace and hyphens).

- [ ] **Step 1: Write the failing test**

`packages/shared/src/__tests__/code.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { CODE_ALPHABET, generateCode, normalizeCode } from '../code.js'
import { asRoomCode } from '../ids.js'

describe('CODE_ALPHABET', () => {
  it('excludes characters that are misread off a shared screen', () => {
    for (const c of ['O', '0', 'I', '1', 'S', '5']) {
      expect(CODE_ALPHABET).not.toContain(c)
    }
  })
})

describe('generateCode', () => {
  it('produces a 6-character code from the alphabet', () => {
    const code = generateCode(() => false)
    expect(code).toHaveLength(6)
    for (const c of code) expect(CODE_ALPHABET).toContain(c)
  })

  it('retries until it finds a code that is not taken', () => {
    let calls = 0
    const code = generateCode(() => { calls += 1; return calls < 3 })
    expect(calls).toBe(3)
    expect(code).toHaveLength(6)
  })

  it('throws rather than looping forever when the space is exhausted', () => {
    expect(() => generateCode(() => true)).toThrow(/exhausted/i)
  })
})

describe('normalizeCode', () => {
  it('uppercases and strips separators so typed input matches', () => {
    expect(normalizeCode(' ab2-cd3 ')).toBe(asRoomCode('AB2CD3'))
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm vitest run packages/shared/src/__tests__/code.test.ts`
Expected: FAIL — cannot resolve `../code.js`

- [ ] **Step 3: Implement the generator**

`packages/shared/src/code.ts`:
```ts
import { randomBytes } from 'node:crypto'
import { asRoomCode, type RoomCode } from './ids.js'

/** Excludes O 0 I 1 S 5 — the pairs people misread off a shared screen. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXYZ2346789'
export const CODE_LENGTH = 6
const MAX_ATTEMPTS = 100

export function generateCode(isTaken: (code: RoomCode) => boolean): RoomCode {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const bytes = randomBytes(CODE_LENGTH)
    let out = ''
    for (let i = 0; i < CODE_LENGTH; i++) {
      out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length]
    }
    const code = asRoomCode(out)
    if (!isTaken(code)) return code
  }
  throw new Error(`Join code space exhausted after ${MAX_ATTEMPTS} attempts`)
}

export function normalizeCode(input: string): RoomCode {
  return asRoomCode(input.replace(/[\s-]/g, '').toUpperCase())
}
```

Add to `packages/shared/src/index.ts`:
```ts
export * from './code.js'
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm vitest run packages/shared/src/__tests__/code.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add join code generation with unambiguous alphabet

Codes are checked for uniqueness among active rooms only, via an
injected predicate, so codes recycle as rooms expire and stay 6
characters forever."
```

---

## Task 3: Carve geometry and the integrity ratio

**Files:**
- Create: `packages/shared/src/carve.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/__tests__/carve.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `StampShape` union, `Stroke` type, `CANVAS_W: 512`, `CANVAS_H: 640`, `SAG_THRESHOLD: 0.40`, `COLLAPSE_BASE: 0.55`, `COLLAPSE_JITTER: 0.04`, `carvedRatio(strokes: Stroke[]): number`, `integrityState(ratio: number, collapseAt: number): 'solid' | 'sagging' | 'collapsed'`, `collapseThresholdFor(seed: number, index: number): number`.

- [ ] **Step 1: Write the failing test**

`packages/shared/src/__tests__/carve.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import {
  carvedRatio, integrityState, collapseThresholdFor,
  COLLAPSE_BASE, COLLAPSE_JITTER, type Stroke,
} from '../carve.js'

const cut = (points: [number, number][], size = 0.1): Stroke =>
  ({ tool: 'cut', size, points })

describe('carvedRatio', () => {
  it('is zero for an uncarved pumpkin', () => {
    expect(carvedRatio([])).toBe(0)
  })

  it('grows as more area is cut', () => {
    const small = carvedRatio([cut([[0.5, 0.5]], 0.05)])
    const large = carvedRatio([cut([[0.5, 0.5]], 0.2)])
    expect(large).toBeGreaterThan(small)
  })

  it('does not double-count overlapping strokes', () => {
    const once = carvedRatio([cut([[0.5, 0.5]], 0.1)])
    const twice = carvedRatio([cut([[0.5, 0.5]], 0.1), cut([[0.5, 0.5]], 0.1)])
    expect(twice).toBeCloseTo(once, 5)
  })

  it('subtracts area restored by the uncarve tool', () => {
    const carved = carvedRatio([cut([[0.5, 0.5]], 0.2)])
    const restored = carvedRatio([
      cut([[0.5, 0.5]], 0.2),
      { tool: 'uncut', size: 0.2, points: [[0.5, 0.5]] },
    ])
    expect(restored).toBeLessThan(carved)
  })

  it('never exceeds 1', () => {
    const everything = cut(
      Array.from({ length: 200 }, (_, i): [number, number] => [i / 200, (i % 20) / 20]),
      0.5,
    )
    expect(carvedRatio([everything])).toBeLessThanOrEqual(1)
  })
})

describe('integrityState', () => {
  it('reports solid below the sag threshold', () => {
    expect(integrityState(0.2, 0.55)).toBe('solid')
  })
  it('reports sagging between sag and collapse', () => {
    expect(integrityState(0.45, 0.55)).toBe('sagging')
  })
  it('reports collapsed at or past the per-pumpkin threshold', () => {
    expect(integrityState(0.56, 0.55)).toBe('collapsed')
  })
})

describe('collapseThresholdFor', () => {
  it('stays within the jitter band', () => {
    for (let i = 0; i < 50; i++) {
      const t = collapseThresholdFor(12345, i)
      expect(t).toBeGreaterThanOrEqual(COLLAPSE_BASE - COLLAPSE_JITTER)
      expect(t).toBeLessThanOrEqual(COLLAPSE_BASE + COLLAPSE_JITTER)
    }
  })

  it('is deterministic for a given seed and index', () => {
    expect(collapseThresholdFor(999, 3)).toBe(collapseThresholdFor(999, 3))
  })

  it('differs across players so nobody can read anothers threshold', () => {
    expect(collapseThresholdFor(999, 3)).not.toBe(collapseThresholdFor(999, 4))
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm vitest run packages/shared/src/__tests__/carve.test.ts`
Expected: FAIL — cannot resolve `../carve.js`

- [ ] **Step 3: Implement the geometry**

Rasterize to a coarse occupancy grid rather than doing real polygon area. It is pure, fast, deterministic, and identical on both sides — which is what matters, since the client's live meter must agree with the server's authoritative collapse.

`packages/shared/src/carve.ts`:
```ts
export type StampShape = 'triangle' | 'circle' | 'crescent' | 'zigzag' | 'snaggletooth'

export type Stroke = {
  tool: 'cut' | 'uncut' | 'stamp'
  shape?: StampShape
  size: number                    // normalized brush diameter, 0..1
  points: [number, number][]      // normalized 0..1
}

export const CANVAS_W = 512
export const CANVAS_H = 640

export const SAG_THRESHOLD = 0.40
export const COLLAPSE_BASE = 0.55
export const COLLAPSE_JITTER = 0.04

/** Grid resolution for area estimation. 64x80 keeps the aspect ratio and costs ~5k cells. */
const GX = 64
const GY = 80

/**
 * Fraction of the pumpkin face that has been cut away.
 * Occupancy grid, so overlapping strokes cannot double-count.
 */
export function carvedRatio(strokes: Stroke[]): number {
  if (strokes.length === 0) return 0
  const grid = new Uint8Array(GX * GY)

  for (const stroke of strokes) {
    const value = stroke.tool === 'uncut' ? 0 : 1
    const radius = Math.max(stroke.size, 1 / GX) / 2
    for (const [px, py] of stroke.points) {
      const minX = Math.max(0, Math.floor((px - radius) * GX))
      const maxX = Math.min(GX - 1, Math.ceil((px + radius) * GX))
      const minY = Math.max(0, Math.floor((py - radius) * GY))
      const maxY = Math.min(GY - 1, Math.ceil((py + radius) * GY))
      for (let gy = minY; gy <= maxY; gy++) {
        for (let gx = minX; gx <= maxX; gx++) {
          const dx = (gx + 0.5) / GX - px
          const dy = (gy + 0.5) / GY - py
          if (dx * dx + dy * dy <= radius * radius) grid[gy * GX + gx] = value
        }
      }
    }
  }

  let cut = 0
  for (let i = 0; i < grid.length; i++) if (grid[i] === 1) cut += 1
  return cut / grid.length
}

export function integrityState(
  ratio: number,
  collapseAt: number,
): 'solid' | 'sagging' | 'collapsed' {
  if (ratio >= collapseAt) return 'collapsed'
  if (ratio >= SAG_THRESHOLD) return 'sagging'
  return 'solid'
}

/**
 * Per-pumpkin collapse threshold, jittered so the unlabeled meter is a
 * genuine gamble rather than a number to read. Deterministic from the
 * room seed, which is why reduce can stay pure.
 */
export function collapseThresholdFor(seed: number, index: number): number {
  let h = (seed ^ (index * 0x9e3779b9)) >>> 0
  h ^= h << 13; h >>>= 0
  h ^= h >>> 17
  h ^= h << 5;  h >>>= 0
  const unit = h / 0xffffffff              // 0..1
  return COLLAPSE_BASE + (unit * 2 - 1) * COLLAPSE_JITTER
}
```

Add to `packages/shared/src/index.ts`:
```ts
export * from './carve.js'
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm vitest run packages/shared/src/__tests__/carve.test.ts`
Expected: PASS — 11 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add carve geometry and structural integrity ratio

Area is estimated on an occupancy grid so overlapping strokes cannot
double-count, and the whole module is pure and deterministic. That
matters because the client's live meter and the server's authoritative
collapse decision must agree exactly, and because reduce must stay pure."
```

---

## Task 4: Game module contract, wire events, and player labels

**Files:**
- Create: `packages/shared/src/game.ts`, `packages/shared/src/events.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/__tests__/labels.test.ts`

**Interfaces:**
- Consumes: `PlayerId` from Task 1.
- Produces: `Player`, `GameTheme`, `RoomContext`, `GameModule<State, Action, View>`, `ServerMessage`, `ClientMessage`, `labelPlayers(players: Player[]): Record<PlayerId, string>`.

> **Deviation from the spec, deliberate:** the spec's contract lists four methods. This adds a fifth, `setPhase(state, phase): State`. The runtime owns phase transitions, but `viewFor` and `reduce` both need to know the current phase to redact and to validate — and `reduce` is reserved for player actions. A pure `setPhase` is the honest way to let the runtime write phase into state without smuggling a fake player action through `reduce`.

- [ ] **Step 1: Write the failing test**

`packages/shared/src/__tests__/labels.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { labelPlayers } from '../game.js'
import { asPlayerId } from '../ids.js'

const p = (id: string, displayName: string, joinedAt: number) =>
  ({ id: asPlayerId(id), displayName, connected: true, joinedAt })

describe('labelPlayers', () => {
  it('leaves unique names alone', () => {
    const labels = labelPlayers([p('a', 'Jocelyn', 1), p('b', 'Sam', 2)])
    expect(labels[asPlayerId('a')]).toBe('Jocelyn')
    expect(labels[asPlayerId('b')]).toBe('Sam')
  })

  it('disambiguates duplicates by join order', () => {
    const labels = labelPlayers([p('a', 'Jocelyn', 1), p('b', 'Jocelyn', 2)])
    expect(labels[asPlayerId('a')]).toBe('Jocelyn')
    expect(labels[asPlayerId('b')]).toBe('Jocelyn (2)')
  })

  it('is case- and whitespace-insensitive when detecting duplicates', () => {
    const labels = labelPlayers([p('a', 'Jocelyn', 1), p('b', '  jocelyn ', 2)])
    expect(labels[asPlayerId('b')]).toBe('  jocelyn  (2)')
  })

  it('numbers a third duplicate correctly', () => {
    const labels = labelPlayers([
      p('a', 'Sam', 1), p('b', 'Sam', 2), p('c', 'Sam', 3),
    ])
    expect(Object.values(labels)).toEqual(['Sam', 'Sam (2)', 'Sam (3)'])
  })

  it('is stable regardless of input array order', () => {
    const a = labelPlayers([p('a', 'Sam', 1), p('b', 'Sam', 2)])
    const b = labelPlayers([p('b', 'Sam', 2), p('a', 'Sam', 1)])
    expect(a).toEqual(b)
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm vitest run packages/shared/src/__tests__/labels.test.ts`
Expected: FAIL — cannot resolve `../game.js`

- [ ] **Step 3: Write the contract and the label helper**

`packages/shared/src/game.ts`:
```ts
import type { PlayerId } from './ids.js'
import type { ServerMessage } from './events.js'

export type Player = {
  id: PlayerId
  displayName: string
  connected: boolean
  joinedAt: number
}

export type GameTheme = {
  accent: string
  accent2: string
  glow: string
  danger: string
}

export interface RoomContext {
  broadcast(message: ServerMessage): void
  setTimer(ms: number, fn: () => void): void
  advancePhase(): void
  hostLine(line: string): void
  saveResult(payload: unknown): void
}

export interface GameModule<State, Action, View> {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly minPlayers: number
  readonly maxPlayers: number
  readonly estimatedMinutes: number
  readonly phases: readonly string[]
  readonly theme: GameTheme
  readonly hostLines: Record<string, string[]>

  createState(players: Player[], seed: number): State
  setPhase(state: State, phase: string): State
  reduce(state: State, action: Action, by: PlayerId): State
  onPhaseEnter(state: State, phase: string, ctx: RoomContext): void
  viewFor(state: State, viewer: PlayerId): View
}

/**
 * Display names are player-chosen and a work team will contain two
 * Jocelyns. Labels disambiguate by join order so the gallery and results
 * attribute pumpkins unambiguously.
 */
export function labelPlayers(players: Player[]): Record<PlayerId, string> {
  const ordered = [...players].sort((a, b) =>
    a.joinedAt - b.joinedAt || a.id.localeCompare(b.id))
  const seen = new Map<string, number>()
  const labels: Record<PlayerId, string> = {}

  for (const player of ordered) {
    const key = player.displayName.trim().toLowerCase()
    const n = (seen.get(key) ?? 0) + 1
    seen.set(key, n)
    labels[player.id] = n === 1 ? player.displayName : `${player.displayName} (${n})`
  }
  return labels
}
```

`packages/shared/src/events.ts`:
```ts
import type { PlayerId } from './ids.js'
import type { Player } from './game.js'

export type ServerMessage =
  | {
      type: 'snapshot'
      phase: string
      view: unknown
      players: Player[]
      labels: Record<string, string>
      hostId: PlayerId | null
    }
  | { type: 'timer'; endsAt: number; serverNow: number }
  | { type: 'host'; line: string }
  | { type: 'error'; code: string; message: string }

export type ClientMessage =
  | { type: 'action'; payload: unknown }
  | { type: 'ping' }
```

Add to `packages/shared/src/index.ts`:
```ts
export * from './game.js'
export * from './events.js'
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm vitest run packages/shared/src/__tests__/labels.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add game module contract, wire events, and player labels

The contract gains setPhase beyond the spec's four methods: the runtime
owns phase transitions but reduce is reserved for player actions, so a
pure setPhase is how phase reaches state without faking an action.

labelPlayers exists because display names are player-chosen and a work
team will have two Jocelyns."
```

---

## Task 5: Pumpkin state, carving, and submission

**Files:**
- Create: `packages/shared/src/pumpkin.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/__tests__/pumpkin-carve.test.ts`

**Interfaces:**
- Consumes: `Player`, `PlayerId`, `Stroke`, `carvedRatio`, `collapseThresholdFor`, `integrityState`.
- Produces: `PUMPKIN_PHASES`, `PumpkinPhase`, `AwardKey`, `AWARD_BY_PHASE`, `AWARD_LABELS`, `PumpkinState`, `PumpkinAction`, `createState(players, seed)`, `setPhase(state, phase)`, `reduce(state, action, by)`, `seededShuffle<T>(items: T[], seed: number): T[]`, `slotOf(state, player): number`.

- [ ] **Step 1: Write the failing test**

`packages/shared/src/__tests__/pumpkin-carve.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { createState, reduce, setPhase, seededShuffle, slotOf } from '../pumpkin.js'
import { asPlayerId } from '../ids.js'
import type { Stroke } from '../carve.js'

const player = (id: string, joinedAt: number) =>
  ({ id: asPlayerId(id), displayName: id, connected: true, joinedAt })

const three = [player('a', 1), player('b', 2), player('c', 3)]
const base = () => setPhase(createState(three, 42), 'carving')
const strokes: Stroke[] = [{ tool: 'cut', size: 0.1, points: [[0.5, 0.5]] }]

describe('createState', () => {
  it('gives every player an empty unsubmitted pumpkin', () => {
    const s = createState(three, 42)
    for (const p of three) {
      expect(s.pumpkins[p.id]).toEqual(
        expect.objectContaining({ strokes: [], submitted: false }))
    }
  })

  it('assigns each player a distinct jittered collapse threshold', () => {
    const s = createState(three, 42)
    const thresholds = three.map(p => s.pumpkins[p.id]!.collapseAt)
    expect(new Set(thresholds).size).toBe(3)
  })

  it('shuffles gallery slots deterministically from the seed', () => {
    expect(createState(three, 42).slots).toEqual(createState(three, 42).slots)
    expect(createState(three, 42).slots).not.toEqual(createState(three, 7).slots)
  })

  it('includes every player exactly once in the slot order', () => {
    const s = createState(three, 42)
    expect([...s.slots].sort()).toEqual(three.map(p => p.id).sort())
  })
})

describe('reduce SUBMIT', () => {
  it('stores the submitting players strokes and marks them submitted', () => {
    const s = reduce(base(), { type: 'SUBMIT', strokes }, asPlayerId('a'))
    expect(s.pumpkins[asPlayerId('a')]!.submitted).toBe(true)
    expect(s.pumpkins[asPlayerId('a')]!.strokes).toEqual(strokes)
  })

  it('does not touch another players pumpkin', () => {
    const s = reduce(base(), { type: 'SUBMIT', strokes }, asPlayerId('a'))
    expect(s.pumpkins[asPlayerId('b')]!.submitted).toBe(false)
  })

  it('ignores a second submission so a player cannot revise after the fact', () => {
    const once = reduce(base(), { type: 'SUBMIT', strokes }, asPlayerId('a'))
    const twice = reduce(once, { type: 'SUBMIT', strokes: [] }, asPlayerId('a'))
    expect(twice.pumpkins[asPlayerId('a')]!.strokes).toEqual(strokes)
  })

  it('ignores submissions outside the carving phase', () => {
    const voting = setPhase(createState(three, 42), 'vote-scariest')
    const s = reduce(voting, { type: 'SUBMIT', strokes }, asPlayerId('a'))
    expect(s.pumpkins[asPlayerId('a')]!.submitted).toBe(false)
  })

  it('ignores an unknown player id', () => {
    const s = reduce(base(), { type: 'SUBMIT', strokes }, asPlayerId('nobody'))
    expect(s).toEqual(base())
  })

  it('does not mutate the input state', () => {
    const before = base()
    reduce(before, { type: 'SUBMIT', strokes }, asPlayerId('a'))
    expect(before.pumpkins[asPlayerId('a')]!.submitted).toBe(false)
  })
})

describe('reduce DRAFT', () => {
  it('stores strokes without marking the pumpkin submitted', () => {
    const s = reduce(base(), { type: 'DRAFT', strokes }, asPlayerId('a'))
    expect(s.pumpkins[asPlayerId('a')]!.strokes).toEqual(strokes)
    expect(s.pumpkins[asPlayerId('a')]!.submitted).toBe(false)
  })

  it('is ignored once the player has submitted', () => {
    const submitted = reduce(base(), { type: 'SUBMIT', strokes }, asPlayerId('a'))
    const s = reduce(submitted, { type: 'DRAFT', strokes: [] }, asPlayerId('a'))
    expect(s.pumpkins[asPlayerId('a')]!.strokes).toEqual(strokes)
  })
})

describe('seededShuffle', () => {
  it('is a permutation', () => {
    const out = seededShuffle([1, 2, 3, 4, 5], 99)
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5])
  })
  it('is deterministic', () => {
    expect(seededShuffle([1, 2, 3, 4, 5], 99)).toEqual(seededShuffle([1, 2, 3, 4, 5], 99))
  })
})

describe('slotOf', () => {
  it('returns the players index in the shuffled order', () => {
    const s = createState(three, 42)
    expect(s.slots[slotOf(s, asPlayerId('a'))]).toBe(asPlayerId('a'))
  })
  it('returns -1 for a player who is not in the game', () => {
    expect(slotOf(createState(three, 42), asPlayerId('nobody'))).toBe(-1)
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm vitest run packages/shared/src/__tests__/pumpkin-carve.test.ts`
Expected: FAIL — cannot resolve `../pumpkin.js`

- [ ] **Step 3: Implement state, phases, and the carve half of reduce**

`packages/shared/src/pumpkin.ts`:
```ts
import { collapseThresholdFor, type Stroke } from './carve.js'
import type { Player } from './game.js'
import type { PlayerId } from './ids.js'

export const PUMPKIN_PHASES = [
  'lobby', 'carving',
  'vote-scariest', 'vote-funniest', 'vote-craft', 'vote-cursed',
  'results',
] as const
export type PumpkinPhase = (typeof PUMPKIN_PHASES)[number]

export type AwardKey = 'scariest' | 'funniest' | 'craft' | 'cursed'
export const AWARD_KEYS: readonly AwardKey[] = ['scariest', 'funniest', 'craft', 'cursed']

export const AWARD_BY_PHASE: Partial<Record<PumpkinPhase, AwardKey>> = {
  'vote-scariest': 'scariest',
  'vote-funniest': 'funniest',
  'vote-craft': 'craft',
  'vote-cursed': 'cursed',
}

export const AWARD_LABELS: Record<AwardKey, string> = {
  scariest: '🎃 Scariest',
  funniest: '😂 Funniest',
  craft: '🏆 Best Craftsmanship',
  cursed: '🫠 Most Cursed',
}

export type Pumpkin = { strokes: Stroke[]; submitted: boolean; collapseAt: number }

export type PumpkinState = {
  seed: number
  phase: PumpkinPhase
  slots: PlayerId[]                                   // slot index -> owner
  pumpkins: Record<PlayerId, Pumpkin>
  votes: Record<AwardKey, Record<PlayerId, number>>   // award -> voter -> slot
}

export type PumpkinAction =
  | { type: 'DRAFT'; strokes: Stroke[] }
  | { type: 'SUBMIT'; strokes: Stroke[] }
  | { type: 'VOTE'; award: AwardKey; slot: number }

/** mulberry32 — small, fast, deterministic. Keeps reduce pure. */
function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function seededShuffle<T>(items: T[], seed: number): T[] {
  const out = [...items]
  const rand = prng(seed)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

export function createState(players: Player[], seed: number): PumpkinState {
  const ordered = [...players].sort((a, b) =>
    a.joinedAt - b.joinedAt || a.id.localeCompare(b.id))

  const pumpkins: Record<PlayerId, Pumpkin> = {}
  ordered.forEach((player, index) => {
    pumpkins[player.id] = {
      strokes: [],
      submitted: false,
      collapseAt: collapseThresholdFor(seed, index),
    }
  })

  return {
    seed,
    phase: 'lobby',
    slots: seededShuffle(ordered.map(p => p.id), seed),
    pumpkins,
    votes: { scariest: {}, funniest: {}, craft: {}, cursed: {} },
  }
}

export function setPhase(state: PumpkinState, phase: string): PumpkinState {
  return { ...state, phase: phase as PumpkinPhase }
}

export function slotOf(state: PumpkinState, player: PlayerId): number {
  return state.slots.indexOf(player)
}

export function reduce(
  state: PumpkinState,
  action: PumpkinAction,
  by: PlayerId,
): PumpkinState {
  const mine = state.pumpkins[by]
  if (!mine) return state                       // unknown player: ignore

  switch (action.type) {
    case 'DRAFT': {
      if (state.phase !== 'carving' || mine.submitted) return state
      return {
        ...state,
        pumpkins: { ...state.pumpkins, [by]: { ...mine, strokes: action.strokes } },
      }
    }
    case 'SUBMIT': {
      if (state.phase !== 'carving' || mine.submitted) return state
      return {
        ...state,
        pumpkins: {
          ...state.pumpkins,
          [by]: { ...mine, strokes: action.strokes, submitted: true },
        },
      }
    }
    default:
      return state                              // VOTE handled in Task 6
  }
}
```

Add to `packages/shared/src/index.ts`:
```ts
export * from './pumpkin.js'
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm vitest run packages/shared/src/__tests__/pumpkin-carve.test.ts`
Expected: PASS — 16 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add pumpkin state, phases, and carve actions

Voting is modeled as four separate phases rather than one voting phase
with an internal award cursor. That keeps phase transitions declarative,
lets the runtime's timer advance each award with no game-specific
machinery, and gives viewFor a single key to redact against.

Gallery slots are shuffled deterministically from the room seed, so
reduce stays pure and a restart reproduces the same order."
```

---

## Task 6: Voting and the tally

**Files:**
- Modify: `packages/shared/src/pumpkin.ts`
- Test: `packages/shared/src/__tests__/pumpkin-vote.test.ts`

**Interfaces:**
- Consumes: `PumpkinState`, `PumpkinAction`, `reduce`, `setPhase`, `slotOf`, `AWARD_BY_PHASE`.
- Produces: `AwardResult = { slot: number; votes: number } | null`, `tally(state: PumpkinState): Record<AwardKey, AwardResult>`.

- [ ] **Step 1: Write the failing test**

`packages/shared/src/__tests__/pumpkin-vote.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { createState, reduce, setPhase, slotOf, tally } from '../pumpkin.js'
import { asPlayerId } from '../ids.js'

const player = (id: string, joinedAt: number) =>
  ({ id: asPlayerId(id), displayName: id, connected: true, joinedAt })

const A = asPlayerId('a'), B = asPlayerId('b'), C = asPlayerId('c')
const three = [player('a', 1), player('b', 2), player('c', 3)]
const voting = () => setPhase(createState(three, 42), 'vote-scariest')

describe('reduce VOTE', () => {
  it('records a vote for another players slot', () => {
    const s0 = voting()
    const target = slotOf(s0, B)
    const s = reduce(s0, { type: 'VOTE', award: 'scariest', slot: target }, A)
    expect(s.votes.scariest[A]).toBe(target)
  })

  it('rejects a vote for the voters own slot', () => {
    const s0 = voting()
    const s = reduce(s0, { type: 'VOTE', award: 'scariest', slot: slotOf(s0, A) }, A)
    expect(s.votes.scariest[A]).toBeUndefined()
  })

  it('lets a voter change their mind within the phase', () => {
    const s0 = voting()
    const s1 = reduce(s0, { type: 'VOTE', award: 'scariest', slot: slotOf(s0, B) }, A)
    const s2 = reduce(s1, { type: 'VOTE', award: 'scariest', slot: slotOf(s0, C) }, A)
    expect(s2.votes.scariest[A]).toBe(slotOf(s0, C))
    expect(Object.keys(s2.votes.scariest)).toHaveLength(1)
  })

  it('rejects a vote for an award whose phase is not current', () => {
    const s0 = voting()
    const s = reduce(s0, { type: 'VOTE', award: 'funniest', slot: slotOf(s0, B) }, A)
    expect(s.votes.funniest[A]).toBeUndefined()
  })

  it('rejects an out-of-range slot', () => {
    const s0 = voting()
    for (const slot of [-1, 3, 99]) {
      expect(reduce(s0, { type: 'VOTE', award: 'scariest', slot }, A).votes.scariest[A])
        .toBeUndefined()
    }
  })

  it('rejects a vote during the carving phase', () => {
    const s0 = setPhase(createState(three, 42), 'carving')
    const s = reduce(s0, { type: 'VOTE', award: 'scariest', slot: slotOf(s0, B) }, A)
    expect(s.votes.scariest[A]).toBeUndefined()
  })
})

describe('tally', () => {
  it('returns null for an award with no votes at all', () => {
    expect(tally(voting()).scariest).toBeNull()
  })

  it('returns null for every award when nobody voted', () => {
    const results = tally(voting())
    expect(Object.values(results).every(r => r === null)).toBe(true)
  })

  it('crowns the slot with the most votes', () => {
    const s0 = voting()
    const target = slotOf(s0, C)
    let s = reduce(s0, { type: 'VOTE', award: 'scariest', slot: target }, A)
    s = reduce(s, { type: 'VOTE', award: 'scariest', slot: target }, B)
    expect(tally(s).scariest).toEqual({ slot: target, votes: 2 })
  })

  it('breaks ties by lower slot index, deterministically', () => {
    const s0 = voting()
    let s = reduce(s0, { type: 'VOTE', award: 'scariest', slot: slotOf(s0, B) }, A)
    s = reduce(s, { type: 'VOTE', award: 'scariest', slot: slotOf(s0, A) }, B)
    const expected = Math.min(slotOf(s0, A), slotOf(s0, B))
    expect(tally(s).scariest).toEqual({ slot: expected, votes: 1 })
  })

  it('handles a single-player room where every vote would be a self-vote', () => {
    const solo = setPhase(createState([player('a', 1)], 42), 'vote-scariest')
    const s = reduce(solo, { type: 'VOTE', award: 'scariest', slot: 0 }, A)
    expect(s.votes.scariest[A]).toBeUndefined()
    expect(tally(s).scariest).toBeNull()
  })

  it('tallies each award independently', () => {
    const s0 = voting()
    let s = reduce(s0, { type: 'VOTE', award: 'scariest', slot: slotOf(s0, B) }, A)
    s = reduce(setPhase(s, 'vote-cursed'),
      { type: 'VOTE', award: 'cursed', slot: slotOf(s0, C) }, A)
    const results = tally(s)
    expect(results.scariest).toEqual({ slot: slotOf(s0, B), votes: 1 })
    expect(results.cursed).toEqual({ slot: slotOf(s0, C), votes: 1 })
    expect(results.funniest).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm vitest run packages/shared/src/__tests__/pumpkin-vote.test.ts`
Expected: FAIL — `tally` is not exported; the VOTE tests fail because `reduce` falls through to `default`

- [ ] **Step 3: Implement voting and the tally**

In `packages/shared/src/pumpkin.ts`, replace the `default:` branch of `reduce` with the `VOTE` case:

```ts
    case 'VOTE': {
      const award = AWARD_BY_PHASE[state.phase]
      if (!award || award !== action.award) return state      // wrong phase for this award
      if (!Number.isInteger(action.slot)) return state
      if (action.slot < 0 || action.slot >= state.slots.length) return state
      if (state.slots[action.slot] === by) return state        // no self-votes
      return {
        ...state,
        votes: {
          ...state.votes,
          [award]: { ...state.votes[award], [by]: action.slot },
        },
      }
    }
```

Append the tally:

```ts
export type AwardResult = { slot: number; votes: number } | null

/**
 * Winner per award. Ties break to the lower slot index so results are
 * reproducible. Returns null when an award drew no valid votes — which
 * happens in a one-player room, or when everyone disconnects mid-vote.
 */
export function tally(state: PumpkinState): Record<AwardKey, AwardResult> {
  const results = {} as Record<AwardKey, AwardResult>

  for (const award of AWARD_KEYS) {
    const counts = new Map<number, number>()
    for (const slot of Object.values(state.votes[award])) {
      counts.set(slot, (counts.get(slot) ?? 0) + 1)
    }

    let best: AwardResult = null
    for (const [slot, votes] of counts) {
      if (!best || votes > best.votes || (votes === best.votes && slot < best.slot)) {
        best = { slot, votes }
      }
    }
    results[award] = best
  }
  return results
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm vitest run packages/shared/src/__tests__/pumpkin-vote.test.ts`
Expected: PASS — 13 tests

- [ ] **Step 5: Run the whole shared suite to check nothing regressed**

Run: `pnpm vitest run packages/shared`
Expected: PASS — all tests from Tasks 1–6

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add voting and award tally

Votes address a slot index, never a playerId, which is what lets the
voting payload omit carver identity entirely.

tally returns null rather than undefined for an award with no valid
votes. That case is real: a one-player room makes every vote a
self-vote, and a mid-vote disconnect can empty an award."
```

---

## Task 7: `viewFor` redaction — the anonymity guarantee

**Files:**
- Modify: `packages/shared/src/pumpkin.ts`
- Test: `packages/shared/src/__tests__/pumpkin-view.test.ts`

**Interfaces:**
- Consumes: `PumpkinState`, `AwardResult`, `tally`, `slotOf`, `carvedRatio`, `integrityState`.
- Produces: `GalleryEntry = { slot: number; strokes: Stroke[]; integrity: 'solid' | 'sagging' | 'collapsed' }`, `PumpkinView` discriminated union, `viewFor(state: PumpkinState, viewer: PlayerId): PumpkinView`.

These are **security tests**, not feature tests. Anonymous voting is a property of what the server transmits, so the suite asserts on the serialized payload. If someone later adds a convenient `ownerId` field to a gallery entry, the build must fail.

- [ ] **Step 1: Write the failing test**

`packages/shared/src/__tests__/pumpkin-view.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { createState, reduce, setPhase, slotOf, viewFor } from '../pumpkin.js'
import { asPlayerId } from '../ids.js'
import type { Stroke } from '../carve.js'

// Distinctive ids, so "does this id appear in the payload" is a real check.
const IDS = ['PLAYER_ALPHA_0001', 'PLAYER_BRAVO_0002', 'PLAYER_CHARLIE_003'] as const
const [A, B, C] = IDS.map(asPlayerId) as [
  ReturnType<typeof asPlayerId>, ReturnType<typeof asPlayerId>, ReturnType<typeof asPlayerId>,
]
const players = IDS.map((id, i) =>
  ({ id: asPlayerId(id), displayName: `p${i}`, connected: true, joinedAt: i + 1 }))

const deep: Stroke[] = Array.from({ length: 40 }, (_, i) => ({
  tool: 'cut' as const, size: 0.3,
  points: [[(i % 8) / 8, Math.floor(i / 8) / 5]] as [number, number][],
}))
const shallow: Stroke[] = [{ tool: 'cut', size: 0.08, points: [[0.4, 0.4]] }]

function carved() {
  let s = setPhase(createState(players, 42), 'carving')
  s = reduce(s, { type: 'SUBMIT', strokes: shallow }, A)
  s = reduce(s, { type: 'SUBMIT', strokes: deep }, B)
  s = reduce(s, { type: 'SUBMIT', strokes: shallow }, C)
  return s
}

describe('viewFor during carving', () => {
  it('returns only the viewers own strokes', () => {
    const view = viewFor(carved(), A)
    expect(view.kind).toBe('carving')
    if (view.kind !== 'carving') throw new Error('wrong view')
    expect(view.myStrokes).toEqual(shallow)
  })

  it('never includes another players strokes', () => {
    const payload = JSON.stringify(viewFor(carved(), A))
    // B carved 40 strokes; A carved 1. A's payload must not carry B's volume.
    expect(payload.match(/"tool"/g) ?? []).toHaveLength(shallow.length)
  })

  it('reports progress as a count, not as identities', () => {
    const view = viewFor(carved(), A)
    if (view.kind !== 'carving') throw new Error('wrong view')
    expect(view.submittedCount).toBe(3)
    expect(view.totalPlayers).toBe(3)
  })

  it('reports the viewers own integrity state', () => {
    const view = viewFor(carved(), B)
    if (view.kind !== 'carving') throw new Error('wrong view')
    expect(view.integrity).toBe('collapsed')
    expect(view.ratio).toBeGreaterThan(0.5)
  })
})

describe('viewFor during voting', () => {
  const state = () => setPhase(carved(), 'vote-scariest')

  it('transmits no player id for any viewer', () => {
    for (const viewer of [A, B, C]) {
      const payload = JSON.stringify(viewFor(state(), viewer))
      for (const id of IDS) expect(payload).not.toContain(id)
    }
  })

  it('exposes no owner-shaped key on gallery entries', () => {
    const view = viewFor(state(), A)
    if (view.kind !== 'voting') throw new Error('wrong view')
    for (const entry of view.gallery) {
      expect(Object.keys(entry).sort()).toEqual(['integrity', 'slot', 'strokes'])
    }
  })

  it('shows every pumpkin in shuffled slot order', () => {
    const view = viewFor(state(), A)
    if (view.kind !== 'voting') throw new Error('wrong view')
    expect(view.gallery.map(g => g.slot)).toEqual([0, 1, 2])
  })

  it('tells the viewer their own slot so they cannot self-vote', () => {
    const s = state()
    const view = viewFor(s, A)
    if (view.kind !== 'voting') throw new Error('wrong view')
    expect(view.mySlot).toBe(slotOf(s, A))
  })

  it('reports only the viewers own vote', () => {
    let s = state()
    s = reduce(s, { type: 'VOTE', award: 'scariest', slot: slotOf(s, B) }, A)
    s = reduce(s, { type: 'VOTE', award: 'scariest', slot: slotOf(s, C) }, B)

    const aView = viewFor(s, A)
    const bView = viewFor(s, B)
    if (aView.kind !== 'voting' || bView.kind !== 'voting') throw new Error('wrong view')
    expect(aView.myVote).toBe(slotOf(s, B))
    expect(bView.myVote).toBe(slotOf(s, C))
  })

  it('does not leak running vote counts mid-phase', () => {
    let s = state()
    s = reduce(s, { type: 'VOTE', award: 'scariest', slot: slotOf(s, B) }, A)
    const payload = JSON.stringify(viewFor(s, C))
    expect(payload).not.toContain('votes')
  })
})

describe('viewFor at results', () => {
  it('finally reveals which player carved each slot', () => {
    const s = setPhase(carved(), 'results')
    const view = viewFor(s, A)
    if (view.kind !== 'results') throw new Error('wrong view')
    expect(view.carvers[slotOf(s, B)]).toBe(B)
  })

  it('includes the winner per award', () => {
    let s = setPhase(carved(), 'vote-scariest')
    s = reduce(s, { type: 'VOTE', award: 'scariest', slot: slotOf(s, B) }, A)
    const view = viewFor(setPhase(s, 'results'), A)
    if (view.kind !== 'results') throw new Error('wrong view')
    expect(view.winners.scariest).toEqual({ slot: slotOf(s, B), votes: 1 })
    expect(view.winners.funniest).toBeNull()
  })

  it('is identical for every viewer, since nothing is secret any more', () => {
    const s = setPhase(carved(), 'results')
    expect(viewFor(s, A)).toEqual(viewFor(s, B))
  })
})

describe('viewFor in the lobby', () => {
  it('reports the player count and nothing else', () => {
    const view = viewFor(createState(players, 42), A)
    expect(view).toEqual({ kind: 'lobby', playerCount: 3 })
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm vitest run packages/shared/src/__tests__/pumpkin-view.test.ts`
Expected: FAIL — `viewFor` is not exported from `../pumpkin.js`

- [ ] **Step 3: Implement the redaction**

Append to `packages/shared/src/pumpkin.ts`:
```ts
import { carvedRatio, integrityState } from './carve.js'

export type Integrity = 'solid' | 'sagging' | 'collapsed'

/** Deliberately has no owner field. See the security tests. */
export type GalleryEntry = { slot: number; strokes: Stroke[]; integrity: Integrity }

export type PumpkinView =
  | { kind: 'lobby'; playerCount: number }
  | {
      kind: 'carving'
      myStrokes: Stroke[]
      submitted: boolean
      ratio: number
      integrity: Integrity
      submittedCount: number
      totalPlayers: number
    }
  | {
      kind: 'voting'
      award: AwardKey
      gallery: GalleryEntry[]
      mySlot: number
      myVote: number | null
    }
  | {
      kind: 'results'
      gallery: GalleryEntry[]
      winners: Record<AwardKey, AwardResult>
      carvers: Record<number, PlayerId>
    }

function gallery(state: PumpkinState): GalleryEntry[] {
  return state.slots.map((owner, slot) => {
    const pumpkin = state.pumpkins[owner]
    const strokes = pumpkin?.strokes ?? []
    return {
      slot,
      strokes,
      integrity: integrityState(carvedRatio(strokes), pumpkin?.collapseAt ?? COLLAPSE_BASE),
    }
  })
}

export function viewFor(state: PumpkinState, viewer: PlayerId): PumpkinView {
  const totalPlayers = state.slots.length

  if (state.phase === 'lobby') {
    return { kind: 'lobby', playerCount: totalPlayers }
  }

  if (state.phase === 'carving') {
    const mine = state.pumpkins[viewer]
    const strokes = mine?.strokes ?? []
    const ratio = carvedRatio(strokes)
    return {
      kind: 'carving',
      myStrokes: strokes,
      submitted: mine?.submitted ?? false,
      ratio,
      integrity: integrityState(ratio, mine?.collapseAt ?? COLLAPSE_BASE),
      submittedCount: Object.values(state.pumpkins).filter(p => p.submitted).length,
      totalPlayers,
    }
  }

  if (state.phase === 'results') {
    const carvers: Record<number, PlayerId> = {}
    state.slots.forEach((owner, slot) => { carvers[slot] = owner })
    return { kind: 'results', gallery: gallery(state), winners: tally(state), carvers }
  }

  const award = AWARD_BY_PHASE[state.phase]!
  return {
    kind: 'voting',
    award,
    gallery: gallery(state),
    mySlot: slotOf(state, viewer),
    myVote: state.votes[award][viewer] ?? null,
  }
}
```

Also add `COLLAPSE_BASE` to the existing `./carve.js` import at the top of the file.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm vitest run packages/shared/src/__tests__/pumpkin-view.test.ts`
Expected: PASS — 14 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add viewFor redaction with anonymity as security tests

The voting payload carries slot indices and never a playerId, so
anonymous voting is a property of what crosses the wire rather than a
client-side promise. A viewer can inspect every byte and learn nothing.

The tests assert on the serialized payload and pin the exact key set of
a gallery entry, so adding a convenient ownerId later fails the build."
```

---

## Task 8: Database schema and the workspace-scoped repository

**Files:**
- Create: `packages/server/package.json`, `packages/server/tsconfig.json`, `packages/server/src/db/schema.ts`, `packages/server/src/db/client.ts`, `packages/server/src/db/repo.ts`, `packages/server/drizzle.config.ts`
- Test: `packages/server/src/__tests__/repo.test.ts`

**Interfaces:**
- Consumes: `WorkspaceId`, `RoomId`, `PlayerId`, `RoomCode`, `newId` from Task 1.
- Produces: Drizzle tables `workspaces`, `users`, `memberships`, `rooms`, `players`, `gameResults`; `createDb(url: string): Db`; `Repo` class with `ensureDefaultWorkspace(): WorkspaceId`, `createRoom(input): RoomRow`, `findActiveRoomByCode(code): RoomRow | null`, `isCodeTaken(code): boolean`, `addPlayer(input): PlayerRow`, `findPlayerByToken(workspaceId, token): PlayerRow | null`, `listPlayers(workspaceId, roomId): PlayerRow[]`, `setConnected(workspaceId, playerId, connected): void`, `saveResult(input): void`, `listResults(workspaceId): GameResultRow[]`.

**Every** `Repo` read takes `workspaceId` as its first argument. There is no method that reads a room, player, or result without one.

- [ ] **Step 1: Create the server package**

`packages/server/package.json`:
```json
{
  "name": "@tg/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.build.json",
    "db:generate": "drizzle-kit generate"
  },
  "dependencies": {
    "@tg/shared": "workspace:*",
    "better-sqlite3": "11.8.1",
    "drizzle-orm": "0.39.3",
    "fastify": "5.2.1",
    "@fastify/static": "8.0.4",
    "ws": "8.18.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "7.6.12",
    "@types/ws": "8.5.14",
    "drizzle-kit": "0.30.4",
    "tsx": "4.19.2"
  }
}
```

`packages/server/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

Run: `pnpm install`

- [ ] **Step 2: Write the failing test**

`packages/server/src/__tests__/repo.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { createDb } from '../db/client.js'
import { Repo } from '../db/repo.js'
import { asRoomCode, newId } from '@tg/shared'

let repo: Repo

beforeEach(() => {
  repo = new Repo(createDb(':memory:'))
})

describe('ensureDefaultWorkspace', () => {
  it('creates the default workspace once and returns it again after', () => {
    const first = repo.ensureDefaultWorkspace()
    const second = repo.ensureDefaultWorkspace()
    expect(first).toBe(second)
  })
})

describe('rooms', () => {
  it('finds an active room by its code', () => {
    const ws = repo.ensureDefaultWorkspace()
    const code = asRoomCode('AB2CD3')
    repo.createRoom({ workspaceId: ws, code, gameId: 'pumpkin-carve' })
    expect(repo.findActiveRoomByCode(code)?.code).toBe(code)
  })

  it('does not find a room whose code has expired', () => {
    const ws = repo.ensureDefaultWorkspace()
    const code = asRoomCode('AB2CD3')
    repo.createRoom({
      workspaceId: ws, code, gameId: 'pumpkin-carve',
      expiresAt: Date.now() - 1000,
    })
    expect(repo.findActiveRoomByCode(code)).toBeNull()
  })

  it('reports an expired code as not taken, so codes recycle', () => {
    const ws = repo.ensureDefaultWorkspace()
    const code = asRoomCode('AB2CD3')
    repo.createRoom({
      workspaceId: ws, code, gameId: 'pumpkin-carve',
      expiresAt: Date.now() - 1000,
    })
    expect(repo.isCodeTaken(code)).toBe(false)
  })

  it('reports a live code as taken', () => {
    const ws = repo.ensureDefaultWorkspace()
    const code = asRoomCode('AB2CD3')
    repo.createRoom({ workspaceId: ws, code, gameId: 'pumpkin-carve' })
    expect(repo.isCodeTaken(code)).toBe(true)
  })
})

describe('tenancy', () => {
  it('does not return another workspaces players', () => {
    const a = repo.createWorkspace('Team A', 'team-a')
    const b = repo.createWorkspace('Team B', 'team-b')
    const roomA = repo.createRoom({
      workspaceId: a, code: asRoomCode('AAA222'), gameId: 'pumpkin-carve',
    })
    repo.addPlayer({
      workspaceId: a, roomId: roomA.id, displayName: 'Jocelyn', token: newId(),
    })
    expect(repo.listPlayers(a, roomA.id)).toHaveLength(1)
    expect(repo.listPlayers(b, roomA.id)).toHaveLength(0)
  })

  it('does not resolve a player token across workspaces', () => {
    const a = repo.createWorkspace('Team A', 'team-a')
    const b = repo.createWorkspace('Team B', 'team-b')
    const room = repo.createRoom({
      workspaceId: a, code: asRoomCode('AAA222'), gameId: 'pumpkin-carve',
    })
    const token = newId()
    repo.addPlayer({ workspaceId: a, roomId: room.id, displayName: 'Jocelyn', token })
    expect(repo.findPlayerByToken(a, token)).not.toBeNull()
    expect(repo.findPlayerByToken(b, token)).toBeNull()
  })

  it('does not return another workspaces results', () => {
    const a = repo.createWorkspace('Team A', 'team-a')
    const b = repo.createWorkspace('Team B', 'team-b')
    const room = repo.createRoom({
      workspaceId: a, code: asRoomCode('AAA222'), gameId: 'pumpkin-carve',
    })
    repo.saveResult({
      workspaceId: a, roomId: room.id, gameId: 'pumpkin-carve', payload: { ok: true },
    })
    expect(repo.listResults(a)).toHaveLength(1)
    expect(repo.listResults(b)).toHaveLength(0)
  })
})

describe('presence', () => {
  it('flips a players connected flag', () => {
    const ws = repo.ensureDefaultWorkspace()
    const room = repo.createRoom({
      workspaceId: ws, code: asRoomCode('AB2CD3'), gameId: 'pumpkin-carve',
    })
    const player = repo.addPlayer({
      workspaceId: ws, roomId: room.id, displayName: 'Jocelyn', token: newId(),
    })
    repo.setConnected(ws, player.id, false)
    expect(repo.listPlayers(ws, room.id)[0]!.connected).toBe(false)
  })
})
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `pnpm vitest run packages/server/src/__tests__/repo.test.ts`
Expected: FAIL — cannot resolve `../db/client.js`

- [ ] **Step 4: Write the schema**

`packages/server/src/db/schema.ts`:
```ts
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const workspaces = sqliteTable('workspace', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  plan: text('plan').notNull().default('free'),
  createdAt: integer('created_at').notNull(),
})

// Schema only in Tier 1. Defined now so auth is additive rather than a
// migration that rewrites every foreign key.
export const users = sqliteTable('user', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),
  createdAt: integer('created_at').notNull(),
})

export const memberships = sqliteTable('membership', {
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  userId: text('user_id').notNull().references(() => users.id),
  role: text('role', { enum: ['admin', 'member'] }).notNull().default('member'),
}, t => [uniqueIndex('membership_unique').on(t.workspaceId, t.userId)])

export const rooms = sqliteTable('room', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  code: text('code').notNull(),
  gameId: text('game_id').notNull(),
  status: text('status', { enum: ['open', 'playing', 'done'] }).notNull().default('open'),
  hostPlayerId: text('host_player_id'),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, t => [index('room_code_idx').on(t.code), index('room_ws_idx').on(t.workspaceId)])

export const players = sqliteTable('player', {
  id: text('id').primaryKey(),
  roomId: text('room_id').notNull().references(() => rooms.id),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  displayName: text('display_name').notNull(),
  userId: text('user_id').references(() => users.id),
  token: text('token').notNull(),
  connected: integer('connected', { mode: 'boolean' }).notNull().default(true),
  joinedAt: integer('joined_at').notNull(),
}, t => [index('player_token_idx').on(t.workspaceId, t.token)])

export const gameResults = sqliteTable('game_result', {
  id: text('id').primaryKey(),
  roomId: text('room_id').notNull().references(() => rooms.id),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  gameId: text('game_id').notNull(),
  payload: text('payload', { mode: 'json' }).notNull(),
  createdAt: integer('created_at').notNull(),
}, t => [index('result_ws_idx').on(t.workspaceId)])
```

- [ ] **Step 5: Write the client**

`packages/server/src/db/client.ts`:
```ts
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.js'

export type Db = ReturnType<typeof createDb>

const DDL = `
CREATE TABLE IF NOT EXISTS workspace (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'free', created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT,
  created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS membership (
  workspace_id TEXT NOT NULL, user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member');
CREATE UNIQUE INDEX IF NOT EXISTS membership_unique ON membership(workspace_id, user_id);
CREATE TABLE IF NOT EXISTS room (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, code TEXT NOT NULL,
  game_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
  host_player_id TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS room_code_idx ON room(code);
CREATE INDEX IF NOT EXISTS room_ws_idx ON room(workspace_id);
CREATE TABLE IF NOT EXISTS player (
  id TEXT PRIMARY KEY, room_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
  display_name TEXT NOT NULL, user_id TEXT, token TEXT NOT NULL,
  connected INTEGER NOT NULL DEFAULT 1, joined_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS player_token_idx ON player(workspace_id, token);
CREATE TABLE IF NOT EXISTS game_result (
  id TEXT PRIMARY KEY, room_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
  game_id TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS result_ws_idx ON game_result(workspace_id);
CREATE TABLE IF NOT EXISTS room_snapshot (
  room_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, phase TEXT NOT NULL,
  state TEXT NOT NULL, updated_at INTEGER NOT NULL);
`

export function createDb(url: string) {
  const sqlite = new Database(url)
  sqlite.pragma('journal_mode = WAL')
  sqlite.exec(DDL)
  return drizzle(sqlite, { schema })
}
```

Applying DDL directly keeps `:memory:` test databases and the deployed volume on one code path. Drizzle Kit migrations arrive when the schema first changes in production; `drizzle.config.ts` is committed now so that is a one-command step later.

`packages/server/drizzle.config.ts`:
```ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
})
```

- [ ] **Step 6: Write the scoped repository**

`packages/server/src/db/repo.ts`:
```ts
import { and, eq, gt, isNull, or } from 'drizzle-orm'
import {
  asPlayerId, asRoomId, asWorkspaceId, newId,
  type PlayerId, type RoomCode, type RoomId, type WorkspaceId,
} from '@tg/shared'
import type { Db } from './client.js'
import { gameResults, players, rooms, workspaces } from './schema.js'

const ROOM_TTL_MS = 12 * 60 * 60 * 1000
export const DEFAULT_WORKSPACE_SLUG = 'default'

export type RoomRow = {
  id: RoomId; workspaceId: WorkspaceId; code: RoomCode; gameId: string
  status: 'open' | 'playing' | 'done'; hostPlayerId: PlayerId | null
  createdAt: number; expiresAt: number
}

export type PlayerRow = {
  id: PlayerId; roomId: RoomId; workspaceId: WorkspaceId
  displayName: string; token: string; connected: boolean; joinedAt: number
}

export type GameResultRow = {
  id: string; roomId: RoomId; workspaceId: WorkspaceId
  gameId: string; payload: unknown; createdAt: number
}

export class Repo {
  constructor(private readonly db: Db) {}

  createWorkspace(name: string, slug: string): WorkspaceId {
    const id = newId()
    this.db.insert(workspaces)
      .values({ id, name, slug, plan: 'free', createdAt: Date.now() }).run()
    return asWorkspaceId(id)
  }

  ensureDefaultWorkspace(): WorkspaceId {
    const existing = this.db.select().from(workspaces)
      .where(eq(workspaces.slug, DEFAULT_WORKSPACE_SLUG)).get()
    if (existing) return asWorkspaceId(existing.id)
    return this.createWorkspace('Default', DEFAULT_WORKSPACE_SLUG)
  }

  createRoom(input: {
    workspaceId: WorkspaceId; code: RoomCode; gameId: string; expiresAt?: number
  }): RoomRow {
    const row = {
      id: newId(),
      workspaceId: input.workspaceId,
      code: input.code,
      gameId: input.gameId,
      status: 'open' as const,
      hostPlayerId: null,
      createdAt: Date.now(),
      expiresAt: input.expiresAt ?? Date.now() + ROOM_TTL_MS,
    }
    this.db.insert(rooms).values(row).run()
    return row as RoomRow
  }

  /** Codes are global for joining — the room carries the workspace. */
  findActiveRoomByCode(code: RoomCode): RoomRow | null {
    const row = this.db.select().from(rooms)
      .where(and(eq(rooms.code, code), gt(rooms.expiresAt, Date.now())))
      .get()
    return (row as RoomRow | undefined) ?? null
  }

  isCodeTaken(code: RoomCode): boolean {
    return this.findActiveRoomByCode(code) !== null
  }

  setRoomStatus(workspaceId: WorkspaceId, roomId: RoomId, status: RoomRow['status']) {
    this.db.update(rooms).set({ status })
      .where(and(eq(rooms.workspaceId, workspaceId), eq(rooms.id, roomId))).run()
  }

  setHost(workspaceId: WorkspaceId, roomId: RoomId, hostPlayerId: PlayerId | null) {
    this.db.update(rooms).set({ hostPlayerId })
      .where(and(eq(rooms.workspaceId, workspaceId), eq(rooms.id, roomId))).run()
  }

  addPlayer(input: {
    workspaceId: WorkspaceId; roomId: RoomId; displayName: string; token: string
  }): PlayerRow {
    const row = {
      id: newId(),
      roomId: input.roomId,
      workspaceId: input.workspaceId,
      displayName: input.displayName,
      userId: null,
      token: input.token,
      connected: true,
      joinedAt: Date.now(),
    }
    this.db.insert(players).values(row).run()
    return row as unknown as PlayerRow
  }

  findPlayerByToken(workspaceId: WorkspaceId, token: string): PlayerRow | null {
    const row = this.db.select().from(players)
      .where(and(eq(players.workspaceId, workspaceId), eq(players.token, token)))
      .get()
    return (row as PlayerRow | undefined) ?? null
  }

  listPlayers(workspaceId: WorkspaceId, roomId: RoomId): PlayerRow[] {
    return this.db.select().from(players)
      .where(and(eq(players.workspaceId, workspaceId), eq(players.roomId, roomId)))
      .all() as unknown as PlayerRow[]
  }

  setConnected(workspaceId: WorkspaceId, playerId: PlayerId, connected: boolean) {
    this.db.update(players).set({ connected })
      .where(and(eq(players.workspaceId, workspaceId), eq(players.id, playerId))).run()
  }

  saveResult(input: {
    workspaceId: WorkspaceId; roomId: RoomId; gameId: string; payload: unknown
  }) {
    this.db.insert(gameResults).values({
      id: newId(),
      roomId: input.roomId,
      workspaceId: input.workspaceId,
      gameId: input.gameId,
      payload: input.payload,
      createdAt: Date.now(),
    }).run()
  }

  listResults(workspaceId: WorkspaceId): GameResultRow[] {
    return this.db.select().from(gameResults)
      .where(eq(gameResults.workspaceId, workspaceId))
      .all() as unknown as GameResultRow[]
  }
}
```

- [ ] **Step 7: Run the test and confirm it passes**

Run: `pnpm vitest run packages/server/src/__tests__/repo.test.ts`
Expected: PASS — 11 tests

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Add database schema and workspace-scoped repository

Every read below workspace takes workspaceId as its first argument;
there is no unscoped lookup to reach for. The tenancy tests assert the
negative case directly, because the failure mode is a cross-tenant leak
rather than a crash.

Room codes are looked up globally so a bare code is enough to join,
while the room it resolves to carries its workspaceId. Expired rooms
are invisible to both lookup and the taken check, so codes recycle."
```

---

## Task 9: RoomStore and late joiners

**Files:**
- Create: `packages/server/src/rooms/store.ts`
- Modify: `packages/shared/src/pumpkin.ts` (spectator view)
- Test: `packages/server/src/__tests__/store.test.ts`, `packages/shared/src/__tests__/pumpkin-spectator.test.ts`

**Interfaces:**
- Consumes: `Player`, `PlayerId`, `RoomId`, `RoomCode`, `WorkspaceId`, `newId`.
- Produces: `LiveRoom`, `RoomConfig`, `DEFAULT_ROOM_CONFIG`, `RoomStore` interface, `InMemoryRoomStore`; and in shared, a `{ kind: 'spectator'; phase: string }` arm on `PumpkinView`.

`LiveRoom` holds no sockets. The transport keeps its own socket map, which is what makes the later swap of this store for Durable Objects a contained change.

**Late-joiner decision:** a player who joins after `carving` has begun becomes a **spectator** — present in presence, excluded from the game state, and shown a "you're in the next round" view. The alternative (quietly adding them to a game whose state was built without them) yields a player with no pumpkin and no slot who could nonetheless vote.

- [ ] **Step 1: Write the failing store test**

`packages/server/src/__tests__/store.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { InMemoryRoomStore } from '../rooms/store.js'
import { asRoomCode, asWorkspaceId, newId } from '@tg/shared'

const WS_A = asWorkspaceId('ws-a')
const WS_B = asWorkspaceId('ws-b')
let store: InMemoryRoomStore

beforeEach(() => { store = new InMemoryRoomStore() })

const make = (ws = WS_A, code = 'AB2CD3') =>
  store.create({ workspaceId: ws, code: asRoomCode(code), gameId: 'pumpkin-carve' })

describe('create and get', () => {
  it('starts a room in the lobby phase with no players', () => {
    const room = make()
    expect(room.phase).toBe('lobby')
    expect(room.players.size).toBe(0)
    expect(room.hostId).toBeNull()
  })

  it('finds a room by code', () => {
    const room = make()
    expect(store.byCode(asRoomCode('AB2CD3'))?.id).toBe(room.id)
  })

  it('does not return a room to the wrong workspace', () => {
    const room = make(WS_A)
    expect(store.get(WS_A, room.id)).not.toBeNull()
    expect(store.get(WS_B, room.id)).toBeNull()
  })
})

describe('players', () => {
  it('makes the first joiner the host', () => {
    const room = make()
    const first = store.addPlayer(room, { displayName: 'Jocelyn', token: newId() })
    store.addPlayer(room, { displayName: 'Sam', token: newId() })
    expect(room.hostId).toBe(first.id)
  })

  it('marks a player joining after carving starts as a spectator', () => {
    const room = make()
    store.addPlayer(room, { displayName: 'Early', token: newId() })
    room.phase = 'carving'
    const late = store.addPlayer(room, { displayName: 'Late', token: newId() })
    expect(late.spectator).toBe(true)
  })

  it('does not mark a lobby joiner as a spectator', () => {
    const room = make()
    const early = store.addPlayer(room, { displayName: 'Early', token: newId() })
    expect(early.spectator).toBe(false)
  })

  it('transfers the host to the longest-connected player when the host drops', () => {
    const room = make()
    const first = store.addPlayer(room, { displayName: 'A', token: newId() })
    const second = store.addPlayer(room, { displayName: 'B', token: newId() })
    store.addPlayer(room, { displayName: 'C', token: newId() })
    store.setConnected(room, first.id, false)
    store.reassignHostIfNeeded(room)
    expect(room.hostId).toBe(second.id)
  })

  it('leaves the host alone while they are still connected', () => {
    const room = make()
    const first = store.addPlayer(room, { displayName: 'A', token: newId() })
    store.addPlayer(room, { displayName: 'B', token: newId() })
    store.reassignHostIfNeeded(room)
    expect(room.hostId).toBe(first.id)
  })

  it('clears the host when everyone is disconnected', () => {
    const room = make()
    const only = store.addPlayer(room, { displayName: 'A', token: newId() })
    store.setConnected(room, only.id, false)
    store.reassignHostIfNeeded(room)
    expect(room.hostId).toBeNull()
  })

  it('lists participants in join order, excluding spectators', () => {
    const room = make()
    store.addPlayer(room, { displayName: 'A', token: newId() })
    store.addPlayer(room, { displayName: 'B', token: newId() })
    room.phase = 'carving'
    store.addPlayer(room, { displayName: 'Late', token: newId() })
    expect(store.participants(room).map(p => p.displayName)).toEqual(['A', 'B'])
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run packages/server/src/__tests__/store.test.ts`
Expected: FAIL — cannot resolve `../rooms/store.js`

- [ ] **Step 3: Implement the store**

`packages/server/src/rooms/store.ts`:
```ts
import {
  asPlayerId, asRoomId, newId,
  type Player, type PlayerId, type RoomCode, type RoomId, type WorkspaceId,
} from '@tg/shared'

export type RoomPlayer = Player & { token: string; spectator: boolean }

export type RoomConfig = { phaseMs: Record<string, number> }

export const DEFAULT_ROOM_CONFIG: RoomConfig = {
  phaseMs: {
    carving: 180_000,
    'vote-scariest': 15_000,
    'vote-funniest': 15_000,
    'vote-craft': 15_000,
    'vote-cursed': 15_000,
  },
}

export type LiveRoom = {
  id: RoomId
  workspaceId: WorkspaceId
  code: RoomCode
  gameId: string
  phase: string
  seed: number
  state: unknown
  hostId: PlayerId | null
  players: Map<PlayerId, RoomPlayer>
  config: RoomConfig
}

export interface RoomStore {
  create(input: {
    workspaceId: WorkspaceId; code: RoomCode; gameId: string; config?: RoomConfig
  }): LiveRoom
  get(workspaceId: WorkspaceId, roomId: RoomId): LiveRoom | null
  byCode(code: RoomCode): LiveRoom | null
  remove(workspaceId: WorkspaceId, roomId: RoomId): void
  all(): LiveRoom[]
}

export class InMemoryRoomStore implements RoomStore {
  private readonly rooms = new Map<RoomId, LiveRoom>()

  create(input: {
    workspaceId: WorkspaceId; code: RoomCode; gameId: string; config?: RoomConfig
  }): LiveRoom {
    const room: LiveRoom = {
      id: asRoomId(newId()),
      workspaceId: input.workspaceId,
      code: input.code,
      gameId: input.gameId,
      phase: 'lobby',
      seed: (Math.random() * 0xffffffff) >>> 0,
      state: null,
      hostId: null,
      players: new Map(),
      config: input.config ?? DEFAULT_ROOM_CONFIG,
    }
    this.rooms.set(room.id, room)
    return room
  }

  get(workspaceId: WorkspaceId, roomId: RoomId): LiveRoom | null {
    const room = this.rooms.get(roomId)
    return room && room.workspaceId === workspaceId ? room : null
  }

  byCode(code: RoomCode): LiveRoom | null {
    for (const room of this.rooms.values()) if (room.code === code) return room
    return null
  }

  remove(workspaceId: WorkspaceId, roomId: RoomId): void {
    const room = this.rooms.get(roomId)
    if (room && room.workspaceId === workspaceId) this.rooms.delete(roomId)
  }

  all(): LiveRoom[] { return [...this.rooms.values()] }

  addPlayer(
    room: LiveRoom,
    input: { displayName: string; token: string },
  ): RoomPlayer {
    const player: RoomPlayer = {
      id: asPlayerId(newId()),
      displayName: input.displayName,
      connected: true,
      joinedAt: Date.now(),
      token: input.token,
      spectator: room.phase !== 'lobby',
    }
    room.players.set(player.id, player)
    if (!room.hostId) room.hostId = player.id
    return player
  }

  setConnected(room: LiveRoom, playerId: PlayerId, connected: boolean): void {
    const player = room.players.get(playerId)
    if (player) player.connected = connected
  }

  /** Participants are everyone who was present when the game started. */
  participants(room: LiveRoom): RoomPlayer[] {
    return [...room.players.values()]
      .filter(p => !p.spectator)
      .sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id))
  }

  /** A sleeping host must not stall the room. */
  reassignHostIfNeeded(room: LiveRoom): void {
    const current = room.hostId ? room.players.get(room.hostId) : undefined
    if (current?.connected) return
    const next = [...room.players.values()]
      .filter(p => p.connected)
      .sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id))[0]
    room.hostId = next?.id ?? null
  }
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `pnpm vitest run packages/server/src/__tests__/store.test.ts`
Expected: PASS — 11 tests

- [ ] **Step 5: Write the failing spectator-view test**

`packages/shared/src/__tests__/pumpkin-spectator.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { createState, setPhase, viewFor } from '../pumpkin.js'
import { asPlayerId } from '../ids.js'

const players = [
  { id: asPlayerId('a'), displayName: 'A', connected: true, joinedAt: 1 },
  { id: asPlayerId('b'), displayName: 'B', connected: true, joinedAt: 2 },
]
const LATE = asPlayerId('late')

describe('viewFor a player who is not in the game', () => {
  it('returns a spectator view during carving', () => {
    const s = setPhase(createState(players, 42), 'carving')
    expect(viewFor(s, LATE)).toEqual({ kind: 'spectator', phase: 'carving' })
  })

  it('returns a spectator view during voting, so they cannot vote', () => {
    const s = setPhase(createState(players, 42), 'vote-scariest')
    expect(viewFor(s, LATE)).toEqual({ kind: 'spectator', phase: 'vote-scariest' })
  })

  it('still shows them the results, since nothing is secret then', () => {
    const s = setPhase(createState(players, 42), 'results')
    expect(viewFor(s, LATE).kind).toBe('results')
  })

  it('still shows them the lobby', () => {
    expect(viewFor(createState(players, 42), LATE).kind).toBe('lobby')
  })
})
```

- [ ] **Step 6: Run it and confirm it fails**

Run: `pnpm vitest run packages/shared/src/__tests__/pumpkin-spectator.test.ts`
Expected: FAIL — carving returns a `carving` view with empty strokes instead of `spectator`

- [ ] **Step 7: Add the spectator arm to `viewFor`**

In `packages/shared/src/pumpkin.ts`, add to the `PumpkinView` union:
```ts
  | { kind: 'spectator'; phase: string }
```

And in `viewFor`, immediately after the `lobby` branch:
```ts
  // A late joiner has no pumpkin and no slot. Anything else would let them
  // vote on a round they did not carve in.
  if (!state.pumpkins[viewer] && state.phase !== 'results') {
    return { kind: 'spectator', phase: state.phase }
  }
```

- [ ] **Step 8: Run the full suite**

Run: `pnpm vitest run`
Expected: PASS — all tests from Tasks 1–9

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Add RoomStore and spectator handling for late joiners

A player who joins after carving begins becomes a spectator: present in
presence, absent from game state, and given a coherent view. Adding them
to a game whose state was built without them would produce a player with
no pumpkin and no slot who could still vote.

LiveRoom holds no sockets. The transport keeps its own socket map, which
is what keeps the eventual Durable Objects swap contained.

Host reassignment is here because one person's screensaver must not
stall the room."
```

---

## Task 10: RoomRuntime and the pumpkin game module

**Files:**
- Create: `packages/server/src/rooms/runtime.ts`, `packages/server/src/games/pumpkin/index.ts`, `packages/server/src/games/registry.ts`
- Test: `packages/server/src/__tests__/runtime.test.ts`

**Interfaces:**
- Consumes: `LiveRoom`, `RoomStore`, `InMemoryRoomStore`, `GameModule`, `RoomContext`, `ServerMessage`, `labelPlayers`, the pumpkin pure functions, `Repo`.
- Produces: `RoomRuntime` with `start(): void`, `dispatch(by: PlayerId, action: unknown): void`, `advancePhase(): void`, `snapshotFor(playerId: PlayerId): ServerMessage`, `onConnect(playerId): void`, `onDisconnect(playerId): void`, `dispose(): void`; `pumpkinModule: GameModule<PumpkinState, PumpkinAction, PumpkinView>`; `getGame(id: string)`.

- [ ] **Step 1: Write the failing test**

`packages/server/src/__tests__/runtime.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InMemoryRoomStore } from '../rooms/store.js'
import { RoomRuntime } from '../rooms/runtime.js'
import { pumpkinModule } from '../games/pumpkin/index.js'
import { createDb } from '../db/client.js'
import { Repo } from '../db/repo.js'
import { asRoomCode, newId, type ServerMessage, type PlayerId } from '@tg/shared'

let store: InMemoryRoomStore
let repo: Repo
let sent: { to: PlayerId; message: ServerMessage }[]
let runtime: RoomRuntime
let ids: PlayerId[]

beforeEach(() => {
  vi.useFakeTimers()
  store = new InMemoryRoomStore()
  repo = new Repo(createDb(':memory:'))
  sent = []

  const ws = repo.ensureDefaultWorkspace()
  const room = store.create({
    workspaceId: ws, code: asRoomCode('AB2CD3'), gameId: 'pumpkin-carve',
  })
  ids = ['A', 'B', 'C'].map(n =>
    store.addPlayer(room, { displayName: n, token: newId() }).id)

  runtime = new RoomRuntime({
    room, store, repo, module: pumpkinModule,
    send: (to, message) => sent.push({ to, message }),
  })
})

afterEach(() => { runtime.dispose(); vi.useRealTimers() })

const strokes = [{ tool: 'cut' as const, size: 0.1, points: [[0.5, 0.5]] as [number, number][] }]

describe('start', () => {
  it('enters the carving phase', () => {
    runtime.start()
    expect(runtime.phase).toBe('carving')
  })

  it('sends every player a snapshot', () => {
    runtime.start()
    const recipients = new Set(
      sent.filter(s => s.message.type === 'snapshot').map(s => s.to))
    for (const id of ids) expect(recipients).toContain(id)
  })

  it('sends the snapshot before the timer, so the deadline is not wiped', () => {
    runtime.start()
    const firstSnapshot = sent.findIndex(s => s.message.type === 'snapshot')
    const firstTimer = sent.findIndex(s => s.message.type === 'timer')
    expect(firstSnapshot).toBeLessThan(firstTimer)
  })

  it('sends an absolute deadline rather than a tick stream', () => {
    runtime.start()
    const timers = sent.filter(s => s.message.type === 'timer')
    expect(timers.length).toBe(ids.length)
    const timer = timers[0]!.message as Extract<ServerMessage, { type: 'timer' }>
    expect(timer.endsAt).toBeGreaterThan(timer.serverNow)
    expect(timer.endsAt - timer.serverNow).toBe(180_000)
  })

  it('sends a host line', () => {
    runtime.start()
    expect(sent.some(s => s.message.type === 'host')).toBe(true)
  })

  it('refuses to start twice', () => {
    runtime.start()
    expect(() => runtime.start()).toThrow(/already started/i)
  })
})

describe('phase advance', () => {
  it('moves to the first vote phase when the carve timer fires', () => {
    runtime.start()
    vi.advanceTimersByTime(180_000)
    expect(runtime.phase).toBe('vote-scariest')
  })

  it('walks all four award phases then lands on results', () => {
    runtime.start()
    vi.advanceTimersByTime(180_000)
    for (let i = 0; i < 4; i++) vi.advanceTimersByTime(15_000)
    expect(runtime.phase).toBe('results')
  })

  it('sets no timer on the terminal phase', () => {
    runtime.start()
    vi.advanceTimersByTime(180_000 + 4 * 15_000)
    const before = runtime.phase
    vi.advanceTimersByTime(600_000)
    expect(runtime.phase).toBe(before)
  })

  it('persists a result when it reaches results', () => {
    const ws = repo.ensureDefaultWorkspace()
    runtime.start()
    vi.advanceTimersByTime(180_000 + 4 * 15_000)
    expect(repo.listResults(ws)).toHaveLength(1)
  })
})

describe('early exit', () => {
  it('ends carving as soon as every connected player has submitted', () => {
    runtime.start()
    for (const id of ids) runtime.dispatch(id, { type: 'SUBMIT', strokes })
    expect(runtime.phase).toBe('vote-scariest')
  })

  it('does not wait on a disconnected player', () => {
    runtime.start()
    runtime.onDisconnect(ids[2]!)
    runtime.dispatch(ids[0]!, { type: 'SUBMIT', strokes })
    runtime.dispatch(ids[1]!, { type: 'SUBMIT', strokes })
    expect(runtime.phase).toBe('vote-scariest')
  })

  it('keeps waiting while someone connected has not submitted', () => {
    runtime.start()
    runtime.dispatch(ids[0]!, { type: 'SUBMIT', strokes })
    expect(runtime.phase).toBe('carving')
  })
})

describe('dispatch', () => {
  it('ignores a malformed action without throwing', () => {
    runtime.start()
    expect(() => runtime.dispatch(ids[0]!, { type: 'NONSENSE' })).not.toThrow()
    expect(() => runtime.dispatch(ids[0]!, null)).not.toThrow()
    expect(runtime.phase).toBe('carving')
  })

  it('attributes the action to the authenticated player, not the payload', () => {
    runtime.start()
    runtime.dispatch(ids[0]!, { type: 'SUBMIT', strokes, by: ids[1]! })
    const snap = runtime.snapshotFor(ids[1]!) as Extract<ServerMessage, { type: 'snapshot' }>
    expect((snap.view as { submitted: boolean }).submitted).toBe(false)
  })
})

describe('snapshotFor', () => {
  it('includes disambiguated player labels', () => {
    const room = store.all()[0]!
    const dup = store.addPlayer(room, { displayName: 'A', token: newId() })
    runtime.start()
    const snap = runtime.snapshotFor(ids[0]!) as Extract<ServerMessage, { type: 'snapshot' }>
    expect(Object.values(snap.labels)).toContain('A (2)')
    expect(dup.spectator).toBe(true)
  })

  it('names the current host', () => {
    runtime.start()
    const snap = runtime.snapshotFor(ids[0]!) as Extract<ServerMessage, { type: 'snapshot' }>
    expect(snap.hostId).toBe(ids[0]!)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run packages/server/src/__tests__/runtime.test.ts`
Expected: FAIL — cannot resolve `../rooms/runtime.js`

- [ ] **Step 3: Write the pumpkin module**

`packages/server/src/games/pumpkin/index.ts`:
```ts
import {
  AWARD_LABELS, PUMPKIN_PHASES, createState, reduce, setPhase, tally, viewFor,
  type GameModule, type PumpkinAction, type PumpkinState, type PumpkinView,
  type RoomContext,
} from '@tg/shared'

export const pumpkinModule: GameModule<PumpkinState, PumpkinAction, PumpkinView> = {
  id: 'pumpkin-carve',
  name: 'Jack-o-Lantern Carving',
  description:
    'Carve a pumpkin against the clock without collapsing it, then vote on everyone elses.',
  minPlayers: 2,
  maxPlayers: 16,
  estimatedMinutes: 6,
  phases: PUMPKIN_PHASES,

  theme: { accent: '#FF7518', accent2: '#8B5CF6', glow: '#FFC24D', danger: '#84CC16' },

  hostLines: {
    carving: [
      'Three minutes. Try not to maim it.',
      'Carve deep for drama. Carve too deep and it folds.',
    ],
    'vote-scariest': ['Which of these would you not want on your porch?'],
    'vote-funniest': ['Now the one that made you snort.'],
    'vote-craft': ['Credit where it is due. Who actually tried?'],
    'vote-cursed': ['And finally. The one that should not exist.'],
    results: ['Votes are in. Some of you should be ashamed.'],
  },

  createState,
  setPhase,
  reduce,
  viewFor,

  onPhaseEnter(state, phase, ctx) {
    const line = this.hostLines[phase]?.[0]
    if (line) ctx.hostLine(line)

    if (phase === 'results') {
      ctx.saveResult({
        winners: tally(state),
        awards: AWARD_LABELS,
        slots: state.slots,
      })
    }
  },
}
```

`packages/server/src/games/registry.ts`:
```ts
import { pumpkinModule } from './pumpkin/index.js'

export const GAMES = [pumpkinModule] as const

export function getGame(id: string) {
  return GAMES.find(g => g.id === id) ?? null
}
```

Adding game #2 is one module file plus one entry in `GAMES`. Nothing in the lobby, transport, or data model changes.

- [ ] **Step 4: Write the runtime**

`packages/server/src/rooms/runtime.ts`:
```ts
import {
  labelPlayers,
  type GameModule, type PlayerId, type RoomContext, type ServerMessage,
} from '@tg/shared'
import type { Repo } from '../db/repo.js'
import type { InMemoryRoomStore, LiveRoom } from './store.js'

type Send = (to: PlayerId, message: ServerMessage) => void

export class RoomRuntime {
  private readonly room: LiveRoom
  private readonly store: InMemoryRoomStore
  private readonly repo: Repo
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly module: GameModule<any, any, any>
  private readonly send: Send
  private timer: ReturnType<typeof setTimeout> | null = null
  private started = false

  constructor(deps: {
    room: LiveRoom
    store: InMemoryRoomStore
    repo: Repo
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    module: GameModule<any, any, any>
    send: Send
  }) {
    this.room = deps.room
    this.store = deps.store
    this.repo = deps.repo
    this.module = deps.module
    this.send = deps.send
  }

  get phase(): string { return this.room.phase }

  start(): void {
    if (this.started) throw new Error('Room already started')
    this.started = true

    const participants = this.store.participants(this.room)
    this.room.state = this.module.createState(participants, this.room.seed)
    this.repo.setRoomStatus(this.room.workspaceId, this.room.id, 'playing')
    this.enterPhase(this.module.phases[1]!)      // phases[0] is 'lobby'
  }

  dispatch(by: PlayerId, action: unknown): void {
    if (!this.started || action === null || typeof action !== 'object') return
    if (!('type' in action) || typeof action.type !== 'string') return
    if (!this.room.players.has(by)) return

    // `by` comes from the authenticated socket. Any `by` in the payload is ignored.
    this.room.state = this.module.reduce(this.room.state, action, by)
    this.broadcastSnapshot()

    if (this.room.phase === 'carving' && this.allConnectedSubmitted()) {
      this.advancePhase()
    }
  }

  advancePhase(): void {
    const index = this.module.phases.indexOf(this.room.phase)
    const next = this.module.phases[index + 1]
    if (!next) return
    this.enterPhase(next)
  }

  onConnect(playerId: PlayerId): void {
    this.store.setConnected(this.room, playerId, true)
    this.repo.setConnected(this.room.workspaceId, playerId, true)
    this.broadcastSnapshot()
  }

  onDisconnect(playerId: PlayerId): void {
    this.store.setConnected(this.room, playerId, false)
    this.repo.setConnected(this.room.workspaceId, playerId, false)
    this.store.reassignHostIfNeeded(this.room)
    this.repo.setHost(this.room.workspaceId, this.room.id, this.room.hostId)
    this.broadcastSnapshot()

    if (this.room.phase === 'carving' && this.allConnectedSubmitted()) {
      this.advancePhase()
    }
  }

  snapshotFor(playerId: PlayerId): ServerMessage {
    const players = [...this.room.players.values()].map(p =>
      ({ id: p.id, displayName: p.displayName, connected: p.connected, joinedAt: p.joinedAt }))
    return {
      type: 'snapshot',
      phase: this.room.phase,
      view: this.room.state === null
        ? { kind: 'lobby', playerCount: players.length }
        : this.module.viewFor(this.room.state, playerId),
      players,
      labels: labelPlayers(players),
      hostId: this.room.hostId,
    }
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private enterPhase(phase: string): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null

    this.room.phase = phase
    this.room.state = this.module.setPhase(this.room.state, phase)

    const ms = this.room.config.phaseMs[phase]
    if (ms !== undefined) {
      const endsAt = Date.now() + ms
      this.broadcast({ type: 'timer', endsAt, serverNow: Date.now() })
      this.timer = setTimeout(() => this.advancePhase(), ms)
    }

    this.module.onPhaseEnter(this.room.state, phase, this.context())
    this.broadcastSnapshot()
  }

  private context(): RoomContext {
    return {
      broadcast: message => this.broadcast(message),
      setTimer: (ms, fn) => { this.timer = setTimeout(fn, ms) },
      advancePhase: () => this.advancePhase(),
      hostLine: line => this.broadcast({ type: 'host', line }),
      saveResult: payload => this.repo.saveResult({
        workspaceId: this.room.workspaceId,
        roomId: this.room.id,
        gameId: this.room.gameId,
        payload,
      }),
    }
  }

  private allConnectedSubmitted(): boolean {
    const waiting = this.store.participants(this.room).filter(p => p.connected)
    if (waiting.length === 0) return true
    const state = this.room.state as { pumpkins: Record<string, { submitted: boolean }> }
    return waiting.every(p => state.pumpkins[p.id]?.submitted === true)
  }

  private broadcast(message: ServerMessage): void {
    for (const id of this.room.players.keys()) this.send(id, message)
  }

  private broadcastSnapshot(): void {
    for (const id of this.room.players.keys()) this.send(id, this.snapshotFor(id))
  }
}
```

- [ ] **Step 5: Run it and confirm it passes**

Run: `pnpm vitest run packages/server/src/__tests__/runtime.test.ts`
Expected: PASS — 16 tests

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add RoomRuntime and the pumpkin game module

The runtime owns the clock, the sockets, and phase transitions; the
module owns the rules. It walks module.phases in order, so modeling the
four awards as four phases means the award cursor needs no
game-specific machinery.

Carving exits early once every *connected* participant has submitted,
and a disconnect re-checks that, so one closed laptop cannot make nine
people watch a timer run down.

dispatch ignores any `by` in the payload and uses the authenticated
socket's player id."
```

---

## Task 11: HTTP room creation and join

**Files:**
- Create: `packages/server/src/http/rooms.ts`, `packages/server/src/app.ts`
- Test: `packages/server/src/__tests__/http.test.ts`

**Interfaces:**
- Consumes: `Repo`, `InMemoryRoomStore`, `RoomRuntime`, `getGame`, `generateCode`, `normalizeCode`.
- Produces: `buildApp(deps: AppDeps): FastifyInstance`; `AppDeps = { repo: Repo; store: InMemoryRoomStore; runtimes: Map<RoomId, RoomRuntime> }`; routes `GET /api/games`, `POST /api/rooms`, `POST /api/rooms/:code/join`, `POST /api/rooms/:code/start`.
- `MAX_DISPLAY_NAME = 24`.

- [ ] **Step 1: Write the failing test**

`packages/server/src/__tests__/http.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../app.js'
import { InMemoryRoomStore } from '../rooms/store.js'
import { Repo } from '../db/repo.js'
import { createDb } from '../db/client.js'

let app: FastifyInstance

beforeEach(async () => {
  app = buildApp({
    repo: new Repo(createDb(':memory:')),
    store: new InMemoryRoomStore(),
    runtimes: new Map(),
  })
  await app.ready()
})

const createRoom = async () => {
  const res = await app.inject({
    method: 'POST', url: '/api/rooms', payload: { gameId: 'pumpkin-carve' },
  })
  return res.json() as { code: string; roomId: string }
}

const join = (code: string, displayName: string) =>
  app.inject({ method: 'POST', url: `/api/rooms/${code}/join`, payload: { displayName } })

describe('GET /api/games', () => {
  it('lists the registered games for the dashboard', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/games' })
    expect(res.statusCode).toBe(200)
    const games = res.json() as { id: string; name: string; theme: unknown }[]
    expect(games.map(g => g.id)).toContain('pumpkin-carve')
    expect(games[0]!.theme).toBeDefined()
  })
})

describe('POST /api/rooms', () => {
  it('returns a 6-character code', async () => {
    const { code } = await createRoom()
    expect(code).toHaveLength(6)
  })

  it('rejects an unknown game', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/rooms', payload: { gameId: 'nope' },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('POST /api/rooms/:code/join', () => {
  it('returns credentials for the joining player', async () => {
    const { code, roomId } = await createRoom()
    const res = await join(code, 'Jocelyn')
    expect(res.statusCode).toBe(200)
    const body = res.json() as { roomId: string; playerId: string; playerToken: string }
    expect(body.roomId).toBe(roomId)
    expect(body.playerToken).toHaveLength(21)
  })

  it('accepts a lowercase, hyphenated code the way a person would type it', async () => {
    const { code } = await createRoom()
    const typed = `${code.slice(0, 3).toLowerCase()}-${code.slice(3).toLowerCase()}`
    expect((await join(typed, 'Jocelyn')).statusCode).toBe(200)
  })

  it('404s on an unknown code', async () => {
    expect((await join('ZZZZZZ', 'Jocelyn')).statusCode).toBe(404)
  })

  it('rejects an empty or whitespace-only display name', async () => {
    const { code } = await createRoom()
    expect((await join(code, '   ')).statusCode).toBe(400)
    expect((await join(code, '')).statusCode).toBe(400)
  })

  it('rejects a display name over 24 characters', async () => {
    const { code } = await createRoom()
    expect((await join(code, 'x'.repeat(25))).statusCode).toBe(400)
  })

  it('trims surrounding whitespace from the display name', async () => {
    const { code } = await createRoom()
    const res = await join(code, '  Jocelyn  ')
    expect(res.statusCode).toBe(200)
  })

  it('rejects a join once the room is at maxPlayers', async () => {
    const { code } = await createRoom()
    for (let i = 0; i < 16; i++) expect((await join(code, `p${i}`)).statusCode).toBe(200)
    const overflow = await join(code, 'one-too-many')
    expect(overflow.statusCode).toBe(409)
    expect(overflow.json()).toMatchObject({ code: 'ROOM_FULL' })
  })
})

describe('POST /api/rooms/:code/start', () => {
  it('lets the host start the game', async () => {
    const { code } = await createRoom()
    const host = (await join(code, 'Host')).json() as { playerToken: string }
    await join(code, 'Other')
    const res = await app.inject({
      method: 'POST', url: `/api/rooms/${code}/start`,
      payload: { playerToken: host.playerToken },
    })
    expect(res.statusCode).toBe(200)
  })

  it('refuses a non-host', async () => {
    const { code } = await createRoom()
    await join(code, 'Host')
    const other = (await join(code, 'Other')).json() as { playerToken: string }
    const res = await app.inject({
      method: 'POST', url: `/api/rooms/${code}/start`,
      payload: { playerToken: other.playerToken },
    })
    expect(res.statusCode).toBe(403)
  })

  it('refuses to start below minPlayers', async () => {
    const { code } = await createRoom()
    const host = (await join(code, 'Host')).json() as { playerToken: string }
    const res = await app.inject({
      method: 'POST', url: `/api/rooms/${code}/start`,
      payload: { playerToken: host.playerToken },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ code: 'NOT_ENOUGH_PLAYERS' })
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run packages/server/src/__tests__/http.test.ts`
Expected: FAIL — cannot resolve `../app.js`

- [ ] **Step 3: Implement the app and routes**

`packages/server/src/http/rooms.ts`:
```ts
import type { FastifyInstance } from 'fastify'
import { generateCode, newId, normalizeCode, type RoomId } from '@tg/shared'
import { GAMES, getGame } from '../games/registry.js'
import { RoomRuntime } from '../rooms/runtime.js'
import type { InMemoryRoomStore } from '../rooms/store.js'
import type { Repo } from '../db/repo.js'

export const MAX_DISPLAY_NAME = 24

export type AppDeps = {
  repo: Repo
  store: InMemoryRoomStore
  runtimes: Map<RoomId, RoomRuntime>
  send?: (to: string, message: unknown) => void
}

export function registerRoomRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { repo, store, runtimes } = deps

  app.get('/api/games', async () =>
    GAMES.map(g => ({
      id: g.id, name: g.name, description: g.description,
      minPlayers: g.minPlayers, maxPlayers: g.maxPlayers,
      estimatedMinutes: g.estimatedMinutes, theme: g.theme,
    })))

  app.post('/api/rooms', async (request, reply) => {
    const { gameId } = (request.body ?? {}) as { gameId?: string }
    const game = gameId ? getGame(gameId) : null
    if (!game) return reply.code(404).send({ code: 'UNKNOWN_GAME' })

    const workspaceId = repo.ensureDefaultWorkspace()
    const code = generateCode(c => repo.isCodeTaken(c) || store.byCode(c) !== null)
    const row = repo.createRoom({ workspaceId, code, gameId: game.id })
    const live = store.create({ workspaceId, code, gameId: game.id })
    live.id = row.id                                  // keep memory and db aligned

    return { code, roomId: live.id }
  })

  app.post('/api/rooms/:code/join', async (request, reply) => {
    const code = normalizeCode((request.params as { code: string }).code)
    const raw = ((request.body ?? {}) as { displayName?: string }).displayName ?? ''
    const displayName = raw.trim()

    if (displayName.length === 0) return reply.code(400).send({ code: 'NAME_REQUIRED' })
    if (displayName.length > MAX_DISPLAY_NAME) {
      return reply.code(400).send({ code: 'NAME_TOO_LONG' })
    }

    const live = store.byCode(code)
    if (!live) return reply.code(404).send({ code: 'ROOM_NOT_FOUND' })

    const game = getGame(live.gameId)!
    if (live.players.size >= game.maxPlayers) {
      return reply.code(409).send({ code: 'ROOM_FULL' })
    }

    const token = newId()
    const player = store.addPlayer(live, { displayName, token })
    repo.addPlayer({
      workspaceId: live.workspaceId, roomId: live.id, displayName, token,
    })
    repo.setHost(live.workspaceId, live.id, live.hostId)

    runtimes.get(live.id)?.onConnect(player.id)

    return { roomId: live.id, playerId: player.id, playerToken: token }
  })

  app.post('/api/rooms/:code/start', async (request, reply) => {
    const code = normalizeCode((request.params as { code: string }).code)
    const { playerToken } = (request.body ?? {}) as { playerToken?: string }

    const live = store.byCode(code)
    if (!live) return reply.code(404).send({ code: 'ROOM_NOT_FOUND' })

    const caller = [...live.players.values()].find(p => p.token === playerToken)
    if (!caller || caller.id !== live.hostId) {
      return reply.code(403).send({ code: 'NOT_HOST' })
    }

    const game = getGame(live.gameId)!
    if (store.participants(live).length < game.minPlayers) {
      return reply.code(409).send({ code: 'NOT_ENOUGH_PLAYERS' })
    }

    let runtime = runtimes.get(live.id)
    if (!runtime) {
      runtime = new RoomRuntime({
        room: live, store, repo, module: game,
        send: (to, message) => deps.send?.(to, message),
      })
      runtimes.set(live.id, runtime)
    }
    runtime.start()
    return { ok: true }
  })
}
```

`packages/server/src/app.ts`:
```ts
import Fastify, { type FastifyInstance } from 'fastify'
import { registerRoomRoutes, type AppDeps } from './http/rooms.js'

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false })
  registerRoomRoutes(app, deps)
  return app
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `pnpm vitest run packages/server/src/__tests__/http.test.ts`
Expected: PASS — 13 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add HTTP room creation, join, and start

Join normalizes the code the way a person types it off a shared screen:
lowercase and hyphens both work.

Start is gated on the caller being the host and on minPlayers, because
a one-player round makes every vote a self-vote and produces no winners."
```

---

## Task 12: WebSocket transport

**Files:**
- Create: `packages/server/src/transport/socket.ts`, `packages/server/src/index.ts`
- Modify: `packages/server/src/app.ts`
- Test: `packages/server/src/__tests__/socket.test.ts`

**Interfaces:**
- Consumes: `AppDeps`, `Repo`, `InMemoryRoomStore`, `RoomRuntime`, `ClientMessage`, `ServerMessage`.
- Produces: `attachSocketServer(app: FastifyInstance, deps: AppDeps): { sendTo(playerId: PlayerId, message: ServerMessage): void; close(): Promise<void> }`.

**Duplicate-token rule:** a second connection with the same `playerToken` **replaces** the first — the older socket is closed with code 4001. One token means one live socket, so a second tab cannot create a duplicate presence entry, and because votes are keyed by `PlayerId` it cannot vote twice either.

- [ ] **Step 1: Write the failing test**

`packages/server/src/__tests__/socket.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { buildApp } from '../app.js'
import { attachSocketServer } from '../transport/socket.js'
import { InMemoryRoomStore } from '../rooms/store.js'
import { Repo } from '../db/repo.js'
import { createDb } from '../db/client.js'
import type { FastifyInstance } from 'fastify'
import type { ServerMessage } from '@tg/shared'

let app: FastifyInstance
let store: InMemoryRoomStore
let port: number
let sockets: WebSocket[] = []

beforeEach(async () => {
  store = new InMemoryRoomStore()
  // One repo and one runtimes map, shared by the routes and the transport.
  // Two Repo instances on separate in-memory databases would let the runtime
  // write presence to a database that has none of the joined players.
  const deps = { repo: new Repo(createDb(':memory:')), store, runtimes: new Map() }
  app = buildApp(deps)
  const transport = attachSocketServer(app, deps)
  Object.assign(deps, { send: transport.sendTo })
  await app.listen({ port: 0, host: '127.0.0.1' })
  port = (app.server.address() as { port: number }).port
})

afterEach(async () => {
  for (const s of sockets) s.close()
  sockets = []
  await app.close()
})

async function seed() {
  const created = await app.inject({
    method: 'POST', url: '/api/rooms', payload: { gameId: 'pumpkin-carve' },
  })
  const { code } = created.json() as { code: string }
  const joined = await app.inject({
    method: 'POST', url: `/api/rooms/${code}/join`, payload: { displayName: 'Jocelyn' },
  })
  return joined.json() as { roomId: string; playerId: string; playerToken: string }
}

function connect(roomId: string, token: string): WebSocket {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${roomId}&token=${token}`)
  sockets.push(ws)
  return ws
}

const nextMessage = (ws: WebSocket) =>
  new Promise<ServerMessage>(resolve =>
    ws.once('message', raw => resolve(JSON.parse(String(raw)) as ServerMessage)))

const closed = (ws: WebSocket) =>
  new Promise<number>(resolve => ws.once('close', code => resolve(code)))

describe('authentication', () => {
  it('sends a snapshot on connect', async () => {
    const { roomId, playerToken } = await seed()
    const ws = connect(roomId, playerToken)
    await new Promise(r => ws.once('open', r))
    expect((await nextMessage(ws)).type).toBe('snapshot')
  })

  it('closes a connection with an unknown token', async () => {
    const { roomId } = await seed()
    const ws = connect(roomId, 'not-a-real-token')
    expect(await closed(ws)).toBe(4003)
  })

  it('closes a connection for an unknown room', async () => {
    const { playerToken } = await seed()
    const ws = connect('no-such-room', playerToken)
    expect(await closed(ws)).toBe(4004)
  })
})

describe('duplicate tokens', () => {
  it('closes the older socket when the same token connects again', async () => {
    const { roomId, playerToken } = await seed()
    const first = connect(roomId, playerToken)
    await new Promise(r => first.once('open', r))
    await nextMessage(first)

    const second = connect(roomId, playerToken)
    await new Promise(r => second.once('open', r))

    expect(await closed(first)).toBe(4001)
  })

  it('does not create a second presence entry', async () => {
    const { roomId, playerToken } = await seed()
    const first = connect(roomId, playerToken)
    await new Promise(r => first.once('open', r))
    const second = connect(roomId, playerToken)
    await new Promise(r => second.once('open', r))
    await nextMessage(second)

    const room = store.byCode(store.all()[0]!.code)!
    expect(room.players.size).toBe(1)
  })

  it('keeps the player connected after the older socket is replaced', async () => {
    const { roomId, playerToken, playerId } = await seed()
    const first = connect(roomId, playerToken)
    await new Promise(r => first.once('open', r))
    const second = connect(roomId, playerToken)
    await new Promise(r => second.once('open', r))
    await closed(first)
    await new Promise(r => setTimeout(r, 20))

    const room = store.all()[0]!
    expect(room.players.get(playerId as never)?.connected).toBe(true)
  })
})

describe('message handling', () => {
  it('ignores malformed json without closing the socket', async () => {
    const { roomId, playerToken } = await seed()
    const ws = connect(roomId, playerToken)
    await new Promise(r => ws.once('open', r))
    await nextMessage(ws)
    ws.send('not json at all')
    await new Promise(r => setTimeout(r, 30))
    expect(ws.readyState).toBe(WebSocket.OPEN)
  })

  it('ignores an unknown message type', async () => {
    const { roomId, playerToken } = await seed()
    const ws = connect(roomId, playerToken)
    await new Promise(r => ws.once('open', r))
    await nextMessage(ws)
    ws.send(JSON.stringify({ type: 'definitely-not-a-thing' }))
    await new Promise(r => setTimeout(r, 30))
    expect(ws.readyState).toBe(WebSocket.OPEN)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run packages/server/src/__tests__/socket.test.ts`
Expected: FAIL — cannot resolve `../transport/socket.js`

- [ ] **Step 3: Implement the transport**

`packages/server/src/transport/socket.ts`:
```ts
import { WebSocketServer, type WebSocket } from 'ws'
import type { FastifyInstance } from 'fastify'
import { asRoomId, type ClientMessage, type PlayerId, type ServerMessage } from '@tg/shared'
import { RoomRuntime } from '../rooms/runtime.js'
import { getGame } from '../games/registry.js'
import type { AppDeps } from '../http/rooms.js'

const CLOSE_REPLACED = 4001
const CLOSE_BAD_TOKEN = 4003
const CLOSE_NO_ROOM = 4004

export function attachSocketServer(app: FastifyInstance, deps: AppDeps) {
  const wss = new WebSocketServer({ noServer: true })
  const live = new Map<PlayerId, WebSocket>()

  const sendTo = (playerId: PlayerId, message: ServerMessage) => {
    const socket = live.get(playerId)
    if (socket?.readyState === socket?.OPEN) socket!.send(JSON.stringify(message))
  }

  function runtimeFor(roomId: ReturnType<typeof asRoomId>): RoomRuntime | null {
    const existing = deps.runtimes.get(roomId)
    if (existing) return existing
    const room = [...deps.store.all()].find(r => r.id === roomId)
    if (!room) return null
    const game = getGame(room.gameId)
    if (!game) return null
    const runtime = new RoomRuntime({
      room, store: deps.store, repo: deps.repo, module: game, send: sendTo,
    })
    deps.runtimes.set(roomId, runtime)
    return runtime
  }

  app.server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (url.pathname !== '/ws') return

    wss.handleUpgrade(request, socket, head, ws => {
      const roomId = asRoomId(url.searchParams.get('room') ?? '')
      const token = url.searchParams.get('token') ?? ''

      const room = deps.store.all().find(r => r.id === roomId)
      if (!room) return ws.close(CLOSE_NO_ROOM, 'room not found')

      const player = [...room.players.values()].find(p => p.token === token)
      if (!player) return ws.close(CLOSE_BAD_TOKEN, 'bad token')

      // One token, one live socket. A second tab replaces the first rather
      // than producing a duplicate presence entry.
      const previous = live.get(player.id)
      if (previous && previous !== ws) previous.close(CLOSE_REPLACED, 'replaced')
      live.set(player.id, ws)

      const runtime = runtimeFor(roomId)
      runtime?.onConnect(player.id)
      ws.send(JSON.stringify(
        runtime?.snapshotFor(player.id) ?? { type: 'error', code: 'NO_RUNTIME', message: '' },
      ))

      ws.on('message', raw => {
        let parsed: ClientMessage
        try { parsed = JSON.parse(String(raw)) as ClientMessage } catch { return }
        if (parsed?.type === 'action') runtime?.dispatch(player.id, parsed.payload)
      })

      ws.on('close', () => {
        // Only tear down presence if this is still the player's current socket.
        if (live.get(player.id) !== ws) return
        live.delete(player.id)
        runtime?.onDisconnect(player.id)
      })
    })
  })

  return {
    sendTo,
    async close() {
      for (const socket of live.values()) socket.close()
      live.clear()
      await new Promise<void>(resolve => wss.close(() => resolve()))
    },
  }
}
```

`packages/server/src/index.ts`:
```ts
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fastifyStatic from '@fastify/static'
import { buildApp } from './app.js'
import { attachSocketServer } from './transport/socket.js'
import { InMemoryRoomStore } from './rooms/store.js'
import { Repo } from './db/repo.js'
import { createDb } from './db/client.js'
import type { RoomId } from '@tg/shared'
import type { RoomRuntime } from './rooms/runtime.js'

const DB_URL = process.env.DATABASE_URL ?? './data/team-games.sqlite'
const PORT = Number(process.env.PORT ?? 3000)

const repo = new Repo(createDb(DB_URL))
const store = new InMemoryRoomStore()
const runtimes = new Map<RoomId, RoomRuntime>()

const deps = { repo, store, runtimes }
const app = buildApp(deps)
const transport = attachSocketServer(app, deps)
Object.assign(deps, { send: transport.sendTo })

const webDist = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '../../web/dist')
await app.register(fastifyStatic, { root: webDist, wildcard: false })
app.setNotFoundHandler((_request, reply) => reply.sendFile('index.html'))

await app.listen({ port: PORT, host: '0.0.0.0' })
console.log(`team-games listening on :${PORT}`)
```

Add `'./transport/socket.js'` wiring to `buildApp` only via `index.ts`; `app.ts` stays transport-free so HTTP tests need no socket server.

- [ ] **Step 4: Run it and confirm it passes**

Run: `pnpm vitest run packages/server/src/__tests__/socket.test.ts`
Expected: PASS — 8 tests

- [ ] **Step 5: Run the whole suite**

Run: `pnpm vitest run`
Expected: PASS — all tests from Tasks 1–12

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add websocket transport with single-socket-per-token

A second connection on the same token replaces the first rather than
adding presence, so an accidental second tab cannot double a player's
vote or show them twice in the lobby. The close handler checks it is
still the current socket before tearing down presence, so the replaced
socket's close event does not mark a connected player offline.

Malformed json and unknown message types are dropped silently; a bad
frame must not take down someone's game."
```

---

## Task 13: Room state persistence across restart

**Files:**
- Create: `packages/server/src/rooms/snapshot.ts`
- Modify: `packages/server/src/db/repo.ts`, `packages/server/src/rooms/runtime.ts`, `packages/server/src/index.ts`
- Test: `packages/server/src/__tests__/snapshot.test.ts`

**Interfaces:**
- Consumes: `Repo`, `LiveRoom`, `InMemoryRoomStore`, `RoomRuntime`.
- Produces: `Repo.saveSnapshot(input)`, `Repo.loadSnapshots()`, `restoreRooms(repo, store): number`.

- [ ] **Step 1: Write the failing test**

`packages/server/src/__tests__/snapshot.test.ts`:
```ts
import { describe, expect, it, vi, afterEach } from 'vitest'
import { createDb } from '../db/client.js'
import { Repo } from '../db/repo.js'
import { InMemoryRoomStore } from '../rooms/store.js'
import { RoomRuntime } from '../rooms/runtime.js'
import { restoreRooms } from '../rooms/snapshot.js'
import { pumpkinModule } from '../games/pumpkin/index.js'
import { asRoomCode, newId } from '@tg/shared'

afterEach(() => vi.useRealTimers())

function bootRoom(db: ReturnType<typeof createDb>) {
  const repo = new Repo(db)
  const store = new InMemoryRoomStore()
  const workspaceId = repo.ensureDefaultWorkspace()
  const row = repo.createRoom({
    workspaceId, code: asRoomCode('AB2CD3'), gameId: 'pumpkin-carve',
  })
  const room = store.create({ workspaceId, code: asRoomCode('AB2CD3'), gameId: 'pumpkin-carve' })
  room.id = row.id
  for (const name of ['A', 'B']) {
    const player = store.addPlayer(room, { displayName: name, token: newId() })
    repo.addPlayer({ workspaceId, roomId: room.id, displayName: name, token: player.token })
  }
  const runtime = new RoomRuntime({
    room, store, repo, module: pumpkinModule, send: () => {},
  })
  return { repo, store, room, runtime, workspaceId }
}

describe('snapshot persistence', () => {
  it('writes a snapshot when a phase is entered', () => {
    vi.useFakeTimers()
    const db = createDb(':memory:')
    const { repo, runtime } = bootRoom(db)
    runtime.start()
    const rows = repo.loadSnapshots()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.phase).toBe('carving')
    runtime.dispose()
  })

  it('updates rather than duplicating the snapshot on each phase', () => {
    vi.useFakeTimers()
    const db = createDb(':memory:')
    const { repo, runtime } = bootRoom(db)
    runtime.start()
    vi.advanceTimersByTime(180_000)
    const rows = repo.loadSnapshots()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.phase).toBe('vote-scariest')
    runtime.dispose()
  })

  it('restores rooms, phase, and players into a fresh store', () => {
    vi.useFakeTimers()
    const db = createDb(':memory:')
    const first = bootRoom(db)
    first.runtime.start()
    first.runtime.dispose()

    const repo = new Repo(db)
    const store = new InMemoryRoomStore()
    const restored = restoreRooms(repo, store)

    expect(restored).toBe(1)
    const room = store.byCode(asRoomCode('AB2CD3'))!
    expect(room.phase).toBe('carving')
    expect(room.players.size).toBe(2)
    expect(room.state).not.toBeNull()
  })

  it('restores the carved strokes a player had already submitted', () => {
    vi.useFakeTimers()
    const db = createDb(':memory:')
    const first = bootRoom(db)
    first.runtime.start()
    const playerId = [...first.room.players.keys()][0]!
    const strokes = [{ tool: 'cut' as const, size: 0.2, points: [[0.3, 0.3]] as [number, number][] }]
    first.runtime.dispatch(playerId, { type: 'SUBMIT', strokes })
    first.runtime.dispose()

    const store = new InMemoryRoomStore()
    restoreRooms(new Repo(db), store)
    const state = store.byCode(asRoomCode('AB2CD3'))!.state as {
      pumpkins: Record<string, { strokes: unknown[]; submitted: boolean }>
    }
    expect(state.pumpkins[playerId]!.submitted).toBe(true)
    expect(state.pumpkins[playerId]!.strokes).toEqual(strokes)
  })

  it('restores nothing when there are no snapshots', () => {
    expect(restoreRooms(new Repo(createDb(':memory:')), new InMemoryRoomStore())).toBe(0)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run packages/server/src/__tests__/snapshot.test.ts`
Expected: FAIL — `repo.loadSnapshots` is not a function

- [ ] **Step 3: Add snapshot persistence to the repository**

Add to `packages/server/src/db/schema.ts`:
```ts
export const roomSnapshots = sqliteTable('room_snapshot', {
  roomId: text('room_id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  phase: text('phase').notNull(),
  state: text('state', { mode: 'json' }).notNull(),
  updatedAt: integer('updated_at').notNull(),
})
```

Add to `packages/server/src/db/repo.ts` (importing `roomSnapshots`):
```ts
export type SnapshotRow = {
  roomId: RoomId; workspaceId: WorkspaceId; phase: string
  state: unknown; updatedAt: number
}

  saveSnapshot(input: {
    workspaceId: WorkspaceId; roomId: RoomId; phase: string; state: unknown
  }): void {
    this.db.insert(roomSnapshots).values({
      roomId: input.roomId,
      workspaceId: input.workspaceId,
      phase: input.phase,
      state: input.state,
      updatedAt: Date.now(),
    }).onConflictDoUpdate({
      target: roomSnapshots.roomId,
      set: { phase: input.phase, state: input.state, updatedAt: Date.now() },
    }).run()
  }

  loadSnapshots(): SnapshotRow[] {
    return this.db.select().from(roomSnapshots).all() as unknown as SnapshotRow[]
  }

  listRooms(): RoomRow[] {
    return this.db.select().from(rooms)
      .where(gt(rooms.expiresAt, Date.now())).all() as RoomRow[]
  }

  listPlayersByRoom(roomId: RoomId): PlayerRow[] {
    return this.db.select().from(players)
      .where(eq(players.roomId, roomId)).all() as unknown as PlayerRow[]
  }
```

`listRooms` and `listPlayersByRoom` are the two deliberate exceptions to the scoped-read rule: they run only at boot, before any request has a workspace context, and each row carries its own `workspaceId` which is what gets loaded into the store. They are not reachable from any route.

- [ ] **Step 4: Persist on phase entry**

In `packages/server/src/rooms/runtime.ts`, at the end of `enterPhase`, after `broadcastSnapshot()`:
```ts
    this.repo.saveSnapshot({
      workspaceId: this.room.workspaceId,
      roomId: this.room.id,
      phase,
      state: this.room.state,
    })
```

And at the end of `dispatch`, after the early-exit check, so a submitted pumpkin survives a crash mid-phase:
```ts
    this.repo.saveSnapshot({
      workspaceId: this.room.workspaceId,
      roomId: this.room.id,
      phase: this.room.phase,
      state: this.room.state,
    })
```

- [ ] **Step 5: Implement restore**

`packages/server/src/rooms/snapshot.ts`:
```ts
import { asPlayerId } from '@tg/shared'
import type { Repo } from '../db/repo.js'
import type { InMemoryRoomStore, RoomPlayer } from './store.js'

/**
 * Rebuild live rooms from the database at boot. A crash then costs the
 * time to restart rather than the whole game night.
 */
export function restoreRooms(repo: Repo, store: InMemoryRoomStore): number {
  const snapshots = new Map(repo.loadSnapshots().map(s => [s.roomId, s]))
  let restored = 0

  for (const row of repo.listRooms()) {
    const snapshot = snapshots.get(row.id)
    if (!snapshot) continue

    const room = store.create({
      workspaceId: row.workspaceId, code: row.code, gameId: row.gameId,
    })
    room.id = row.id
    room.phase = snapshot.phase
    room.state = snapshot.state
    room.hostId = row.hostPlayerId

    for (const player of repo.listPlayersByRoom(row.id)) {
      const entry: RoomPlayer = {
        id: asPlayerId(player.id),
        displayName: player.displayName,
        connected: false,                 // everyone reconnects
        joinedAt: player.joinedAt,
        token: player.token,
        spectator: false,
      }
      room.players.set(entry.id, entry)
    }
    if (!room.hostId) store.reassignHostIfNeeded(room)
    restored += 1
  }
  return restored
}
```

Wire it into `packages/server/src/index.ts`, immediately after the store is constructed:
```ts
const restored = restoreRooms(repo, store)
if (restored > 0) console.log(`restored ${restored} room(s) from snapshot`)
```

- [ ] **Step 6: Run it and confirm it passes**

Run: `pnpm vitest run packages/server/src/__tests__/snapshot.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 7: Run the whole suite**

Run: `pnpm vitest run`
Expected: PASS — all tests from Tasks 1–13

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Persist room state across restart

Snapshots are written on phase entry and after each action, so a crash
costs a reconnect rather than the game. Restored players come back
disconnected and re-establish presence on reconnect.

listRooms and listPlayersByRoom are the two unscoped reads in the
repository. They run only at boot, before any request has workspace
context, and each row carries the workspaceId that gets loaded."
```

---

## Task 14: Web shell, design tokens, and the connection store

**Files:**
- Create: `packages/web/package.json`, `packages/web/tsconfig.json`, `packages/web/vite.config.ts`, `packages/web/index.html`, `packages/web/src/main.tsx`, `packages/web/src/App.tsx`, `packages/web/src/theme/tokens.css`, `packages/web/src/store/connection.ts`, `packages/web/src/ui/Timer.tsx`, `packages/web/src/ui/HostLine.tsx`
- Test: `packages/web/src/__tests__/connection.test.ts`

**Interfaces:**
- Consumes: `ServerMessage`, `ClientMessage`, `Player`, `PlayerId` from `@tg/shared`.
- Produces: `useConnection` Zustand store with state `{ status, phase, view, players, labels, hostId, hostLine, endsAt, clockOffset, me }` and actions `connect(roomId, playerId, token)`, `disconnect()`, `dispatch(action)`, `applyMessage(message)`; `remainingMs(endsAt, clockOffset, now): number`; `backoffMs(attempt: number): number`; `<Timer />`; `<HostLine />`.

Socket state lives in this external store rather than a context provider, so a server message does not re-render the whole tree. That is a Global Constraint, not a preference.

- [ ] **Step 1: Create the web package**

`packages/web/package.json`:
```json
{
  "name": "@tg/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": { "dev": "vite", "build": "vite build", "preview": "vite preview" },
  "dependencies": {
    "@tg/shared": "workspace:*",
    "@fontsource-variable/archivo": "5.1.1",
    "@fontsource-variable/inter": "5.1.1",
    "@fontsource/bungee": "5.1.1",
    "react": "19.0.0",
    "react-dom": "19.0.0",
    "zustand": "5.0.3"
  },
  "devDependencies": {
    "@testing-library/react": "16.2.0",
    "@types/react": "19.0.8",
    "@types/react-dom": "19.0.3",
    "@vitejs/plugin-react": "4.3.4",
    "jsdom": "26.0.0",
    "vite": "7.0.0"
  }
}
```

`packages/web/vite.config.ts`:
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
  test: { environment: 'jsdom', globals: true },
})
```

`packages/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "jsx": "react-jsx", "lib": ["ES2023", "DOM", "DOM.Iterable"] },
  "include": ["src"]
}
```

Run: `pnpm install`

- [ ] **Step 2: Write the design tokens**

`packages/web/src/theme/tokens.css`:
```css
@import '@fontsource-variable/archivo/index.css';
@import '@fontsource-variable/inter/index.css';
@import '@fontsource/bungee/400.css';

:root {
  --shell-bg: #0E0D14;
  --shell-surface: #1A1826;
  --shell-border: #2E2B3F;
  --shell-text: #F4F2F8;
  --shell-muted: #9A95AD;

  /* Overridden per game from GameModule.theme */
  --accent: #FF7518;
  --accent-2: #8B5CF6;
  --glow: #FFC24D;
  --danger: #84CC16;

  --font-display: 'Archivo Variable', system-ui, sans-serif;
  --font-ui: 'Inter Variable', system-ui, sans-serif;
  --font-game: 'Bungee', var(--font-display);
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--shell-bg);
  color: var(--shell-text);
  font-family: var(--font-ui);
  -webkit-font-smoothing: antialiased;
}

h1, h2, h3 { font-family: var(--font-display); font-weight: 800; letter-spacing: -0.02em; }

.room-code {
  font-family: var(--font-display);
  font-weight: 900;
  font-stretch: 125%;
  font-size: clamp(2rem, 6vw, 4rem);
  letter-spacing: 0.08em;
  color: var(--accent);
}

.surface {
  background: var(--shell-surface);
  border: 1px solid var(--shell-border);
  border-radius: 12px;
}
```

Fonts are self-hosted via `@fontsource`, so the game does not depend on a Google Fonts request succeeding on a corporate network.

- [ ] **Step 3: Write the failing test**

`packages/web/src/__tests__/connection.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { backoffMs, remainingMs, useConnection } from '../store/connection.js'
import { asPlayerId } from '@tg/shared'

const ME = asPlayerId('me')

beforeEach(() => {
  useConnection.setState({
    status: 'idle', phase: 'lobby', view: null, players: [], labels: {},
    hostId: null, hostLine: null, endsAt: null, clockOffset: 0, me: ME,
  })
})

describe('remainingMs', () => {
  it('counts down from an absolute deadline', () => {
    expect(remainingMs(10_000, 0, 4_000)).toBe(6_000)
  })

  it('never goes negative', () => {
    expect(remainingMs(10_000, 0, 99_000)).toBe(0)
  })

  it('corrects for a client clock running ahead of the server', () => {
    // client is 5s ahead: endsAt is server time, so subtract the offset
    expect(remainingMs(10_000, 5_000, 9_000)).toBe(6_000)
  })

  it('corrects for a client clock running behind the server', () => {
    expect(remainingMs(10_000, -5_000, -1_000)).toBe(6_000)
  })

  it('returns 0 when there is no deadline', () => {
    expect(remainingMs(null, 0, 1_000)).toBe(0)
  })
})

describe('backoffMs', () => {
  it('starts fast so a brief blip is invisible', () => {
    expect(backoffMs(0)).toBeLessThanOrEqual(500)
  })

  it('grows with each attempt', () => {
    expect(backoffMs(3)).toBeGreaterThan(backoffMs(1))
  })

  it('caps so it never gives up on a long outage', () => {
    expect(backoffMs(50)).toBeLessThanOrEqual(10_000)
  })
})

describe('applyMessage', () => {
  it('applies a snapshot', () => {
    useConnection.getState().applyMessage({
      type: 'snapshot', phase: 'carving', view: { kind: 'carving' },
      players: [{ id: ME, displayName: 'Me', connected: true, joinedAt: 1 }],
      labels: { me: 'Me' }, hostId: ME,
    })
    const s = useConnection.getState()
    expect(s.phase).toBe('carving')
    expect(s.players).toHaveLength(1)
    expect(s.hostId).toBe(ME)
  })

  it('computes clock offset from a timer message', () => {
    vi.setSystemTime(new Date(1_000_000))
    useConnection.getState().applyMessage({
      type: 'timer', endsAt: 1_180_000, serverNow: 990_000,
    })
    // client is 10s ahead of server
    expect(useConnection.getState().clockOffset).toBe(10_000)
    expect(useConnection.getState().endsAt).toBe(1_180_000)
    vi.useRealTimers()
  })

  it('stores the latest host line', () => {
    useConnection.getState().applyMessage({ type: 'host', line: 'Three minutes.' })
    expect(useConnection.getState().hostLine).toBe('Three minutes.')
  })

  it('clears the deadline when a snapshot arrives for a phase without one', () => {
    useConnection.setState({ endsAt: 123 })
    useConnection.getState().applyMessage({
      type: 'snapshot', phase: 'results', view: { kind: 'results' },
      players: [], labels: {}, hostId: null,
    })
    expect(useConnection.getState().endsAt).toBeNull()
  })

  it('ignores an unknown message type without clearing state', () => {
    useConnection.setState({ phase: 'carving' })
    // @ts-expect-error deliberately invalid
    useConnection.getState().applyMessage({ type: 'who-knows' })
    expect(useConnection.getState().phase).toBe('carving')
  })
})
```

- [ ] **Step 4: Run it and confirm it fails**

Run: `pnpm -F @tg/web vitest run src/__tests__/connection.test.ts`
Expected: FAIL — cannot resolve `../store/connection.js`

- [ ] **Step 5: Implement the store**

`packages/web/src/store/connection.ts`:
```ts
import { create } from 'zustand'
import type { ClientMessage, Player, PlayerId, ServerMessage } from '@tg/shared'

export type Status = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed'

type State = {
  status: Status
  phase: string
  view: unknown
  players: Player[]
  labels: Record<string, string>
  hostId: PlayerId | null
  hostLine: string | null
  endsAt: number | null
  clockOffset: number
  me: PlayerId | null
}

type Actions = {
  connect(roomId: string, playerId: PlayerId, token: string): void
  disconnect(): void
  dispatch(action: unknown): void
  applyMessage(message: ServerMessage): void
}

/** Absolute deadlines plus a measured offset. No tick stream to miss. */
export function remainingMs(
  endsAt: number | null,
  clockOffset: number,
  now: number = Date.now(),
): number {
  if (endsAt === null) return 0
  return Math.max(0, endsAt - (now - clockOffset))
}

export function backoffMs(attempt: number): number {
  return Math.min(10_000, 300 * 2 ** attempt)
}

let socket: WebSocket | null = null
let attempt = 0
let retry: ReturnType<typeof setTimeout> | null = null
let lastArgs: { roomId: string; playerId: PlayerId; token: string } | null = null

export const useConnection = create<State & Actions>((set, get) => ({
  status: 'idle',
  phase: 'lobby',
  view: null,
  players: [],
  labels: {},
  hostId: null,
  hostLine: null,
  endsAt: null,
  clockOffset: 0,
  me: null,

  connect(roomId, playerId, token) {
    lastArgs = { roomId, playerId, token }
    if (retry) { clearTimeout(retry); retry = null }
    set({ status: attempt === 0 ? 'connecting' : 'reconnecting', me: playerId })

    const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
    socket = new WebSocket(
      `${protocol}://${location.host}/ws?room=${roomId}&token=${token}`)

    socket.onopen = () => { attempt = 0; set({ status: 'open' }) }

    socket.onmessage = event => {
      try { get().applyMessage(JSON.parse(String(event.data)) as ServerMessage) }
      catch { /* a malformed frame must not break the game */ }
    }

    socket.onclose = event => {
      socket = null
      if (event.code === 4001) return set({ status: 'closed' })   // replaced by another tab
      if (!lastArgs) return set({ status: 'closed' })
      set({ status: 'reconnecting' })
      const delay = backoffMs(attempt++)
      retry = setTimeout(() => {
        const args = lastArgs!
        get().connect(args.roomId, args.playerId, args.token)
      }, delay)
    }
  },

  disconnect() {
    lastArgs = null
    if (retry) { clearTimeout(retry); retry = null }
    socket?.close()
    socket = null
    set({ status: 'closed' })
  },

  dispatch(action) {
    if (socket?.readyState !== WebSocket.OPEN) return
    const message: ClientMessage = { type: 'action', payload: action }
    socket.send(JSON.stringify(message))
  },

  applyMessage(message) {
    switch (message.type) {
      case 'snapshot':
        return set({
          phase: message.phase,
          view: message.view,
          players: message.players,
          labels: message.labels,
          hostId: message.hostId,
          endsAt: null,
        })
      case 'timer':
        return set({
          endsAt: message.endsAt,
          clockOffset: Date.now() - message.serverNow,
        })
      case 'host':
        return set({ hostLine: message.line })
      default:
        return
    }
  },
}))
```

**One ordering contract to settle here.** The store clears `endsAt` on every
snapshot, so if the runtime sent `timer` *before* the phase snapshot, the
snapshot would immediately wipe the deadline it had just announced. Fix it on
the server side rather than complicating the reducer: in
`packages/server/src/rooms/runtime.ts`, move the
`broadcast({ type: 'timer', ... })` call in `enterPhase` to *after*
`broadcastSnapshot()`.

The resulting order per phase entry is: snapshot, then timer, then the host
line. Re-run the Task 10 runtime tests after the move — they assert the timer's
contents, not its position, so they should still pass.

- [ ] **Step 6: Write the timer and host-line components**

`packages/web/src/ui/Timer.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { remainingMs, useConnection } from '../store/connection.js'

export function Timer() {
  const endsAt = useConnection(s => s.endsAt)
  const clockOffset = useConnection(s => s.clockOffset)
  const [ms, setMs] = useState(() => remainingMs(endsAt, clockOffset))

  useEffect(() => {
    if (endsAt === null) return
    let frame = 0
    const tick = () => {
      setMs(remainingMs(endsAt, clockOffset))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [endsAt, clockOffset])

  if (endsAt === null) return null
  const total = Math.ceil(ms / 1000)
  return (
    <span aria-live="off" style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>
      {Math.floor(total / 60)}:{String(total % 60).padStart(2, '0')}
    </span>
  )
}
```

`packages/web/src/ui/HostLine.tsx`:
```tsx
import { useConnection } from '../store/connection.js'

export function HostLine() {
  const line = useConnection(s => s.hostLine)
  if (!line) return null
  return (
    <p style={{ color: 'var(--shell-muted)', fontStyle: 'italic', textAlign: 'center' }}>
      {line}
    </p>
  )
}
```

- [ ] **Step 7: Write the entry point and phase router**

`packages/web/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Team Games</title>
  </head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
```

`packages/web/src/main.tsx`:
```tsx
import { createRoot } from 'react-dom/client'
import './theme/tokens.css'
import { App } from './App.js'

createRoot(document.getElementById('root')!).render(<App />)
```

`packages/web/src/App.tsx` — a placeholder router filled in by Tasks 15–18:
```tsx
import { useConnection } from './store/connection.js'

export function App() {
  const status = useConnection(s => s.status)
  if (status === 'idle') return <p>Join screen arrives in Task 15.</p>
  return <p>Phase: {useConnection.getState().phase}</p>
}
```

- [ ] **Step 8: Run the test and confirm it passes**

Run: `pnpm -F @tg/web vitest run src/__tests__/connection.test.ts`
Expected: PASS — 12 tests

- [ ] **Step 9: Run the whole suite**

Run: `pnpm vitest run`
Expected: PASS — all tests from Tasks 1–14, including the Task 10 runtime tests after the timer/snapshot ordering change

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "Add web shell, design tokens, and the connection store

Socket state lives in a Zustand store rather than a context provider, so
a server message does not re-render the tree.

The timer renders from an absolute deadline plus a measured clock
offset, on requestAnimationFrame. Nothing streams ticks, so a network
hiccup cannot stall the countdown.

Reconnect backs off from 300ms to a 10s cap and never gives up, except
on close code 4001, which means another tab took over this player."
```

---

## Task 15: Join screen and lobby

**Files:**
- Create: `packages/web/src/lobby/JoinScreen.tsx`, `packages/web/src/lobby/Lobby.tsx`, `packages/web/src/lobby/api.ts`
- Modify: `packages/web/src/App.tsx`
- Test: `packages/web/src/__tests__/lobby.test.tsx`

**Interfaces:**
- Consumes: `useConnection`, `normalizeCode`, `MAX_DISPLAY_NAME` behavior (24).
- Produces: `createRoom(gameId): Promise<{code, roomId}>`, `joinRoom(code, displayName): Promise<JoinResult>`, `startGame(code, playerToken): Promise<void>`, `<JoinScreen />`, `<Lobby />`.

- [ ] **Step 1: Write the failing test**

`packages/web/src/__tests__/lobby.test.tsx`:
```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Lobby } from '../lobby/Lobby.js'
import { JoinScreen } from '../lobby/JoinScreen.js'
import { useConnection } from '../store/connection.js'
import { asPlayerId, asRoomCode } from '@tg/shared'

const ME = asPlayerId('me')
const OTHER = asPlayerId('other')

const player = (id: ReturnType<typeof asPlayerId>, name: string, joinedAt: number) =>
  ({ id, displayName: name, connected: true, joinedAt })

beforeEach(() => {
  useConnection.setState({
    status: 'open', phase: 'lobby', view: { kind: 'lobby', playerCount: 2 },
    players: [player(ME, 'Jocelyn', 1), player(OTHER, 'Sam', 2)],
    labels: { me: 'Jocelyn', other: 'Sam' },
    hostId: ME, hostLine: null, endsAt: null, clockOffset: 0, me: ME,
  })
})

describe('JoinScreen', () => {
  it('disables join until both fields are filled', () => {
    render(<JoinScreen onJoined={() => {}} />)
    const button = screen.getByRole('button', { name: /join/i })
    expect(button).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/room code/i), { target: { value: 'AB2CD3' } })
    expect(button).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Jocelyn' } })
    expect(button).not.toBeDisabled()
  })

  it('uppercases the code as it is typed', () => {
    render(<JoinScreen onJoined={() => {}} />)
    const input = screen.getByLabelText(/room code/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'ab2cd3' } })
    expect(input.value).toBe('AB2CD3')
  })

  it('caps the display name at 24 characters', () => {
    render(<JoinScreen onJoined={() => {}} />)
    const input = screen.getByLabelText(/your name/i) as HTMLInputElement
    expect(input.maxLength).toBe(24)
  })
})

describe('Lobby', () => {
  it('shows the room code prominently', () => {
    render(<Lobby code={asRoomCode('AB2CD3')} playerToken="t" />)
    expect(screen.getByText('AB2CD3')).toBeTruthy()
  })

  it('lists every player by their disambiguated label', () => {
    useConnection.setState({ labels: { me: 'Jocelyn', other: 'Jocelyn (2)' } })
    render(<Lobby code={asRoomCode('AB2CD3')} playerToken="t" />)
    expect(screen.getByText('Jocelyn')).toBeTruthy()
    expect(screen.getByText('Jocelyn (2)')).toBeTruthy()
  })

  it('shows the start button to the host', () => {
    render(<Lobby code={asRoomCode('AB2CD3')} playerToken="t" />)
    expect(screen.getByRole('button', { name: /start/i })).toBeTruthy()
  })

  it('shows waiting text instead of a start button to a non-host', () => {
    useConnection.setState({ hostId: OTHER })
    render(<Lobby code={asRoomCode('AB2CD3')} playerToken="t" />)
    expect(screen.queryByRole('button', { name: /start/i })).toBeNull()
    expect(screen.getByText(/waiting for/i)).toBeTruthy()
  })

  it('disables start below the two-player minimum', () => {
    useConnection.setState({ players: [player(ME, 'Jocelyn', 1)] })
    render(<Lobby code={asRoomCode('AB2CD3')} playerToken="t" />)
    expect(screen.getByRole('button', { name: /start/i })).toBeDisabled()
  })

  it('marks a disconnected player visually and in text', () => {
    useConnection.setState({
      players: [player(ME, 'Jocelyn', 1), { ...player(OTHER, 'Sam', 2), connected: false }],
    })
    render(<Lobby code={asRoomCode('AB2CD3')} playerToken="t" />)
    expect(screen.getByText(/offline/i)).toBeTruthy()
  })

  it('tells the player when the connection is reconnecting', () => {
    useConnection.setState({ status: 'reconnecting' })
    render(<Lobby code={asRoomCode('AB2CD3')} playerToken="t" />)
    expect(screen.getByRole('status')).toHaveTextContent(/reconnect/i)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm -F @tg/web vitest run src/__tests__/lobby.test.tsx`
Expected: FAIL — cannot resolve `../lobby/Lobby.js`

- [ ] **Step 3: Write the API client**

`packages/web/src/lobby/api.ts`:
```ts
import { normalizeCode, type PlayerId } from '@tg/shared'

export type JoinResult = { roomId: string; playerId: PlayerId; playerToken: string }

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { code?: string }
    throw new Error(detail.code ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export const createRoom = (gameId: string) =>
  post<{ code: string; roomId: string }>('/api/rooms', { gameId })

export const joinRoom = (code: string, displayName: string) =>
  post<JoinResult>(`/api/rooms/${normalizeCode(code)}/join`, { displayName })

export const startGame = (code: string, playerToken: string) =>
  post<{ ok: true }>(`/api/rooms/${normalizeCode(code)}/start`, { playerToken })
```

- [ ] **Step 4: Write the join screen**

`packages/web/src/lobby/JoinScreen.tsx`:
```tsx
import { useState } from 'react'
import { CODE_LENGTH } from '@tg/shared'
import { createRoom, joinRoom, type JoinResult } from './api.js'

export const MAX_DISPLAY_NAME = 24

export function JoinScreen({
  onJoined,
}: { onJoined(code: string, result: JoinResult): void }) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const ready = code.trim().length > 0 && name.trim().length > 0 && !busy

  async function submit(target: string) {
    setBusy(true); setError(null)
    try { onJoined(target, await joinRoom(target, name.trim())) }
    catch (e) { setError(message(e)) }
    finally { setBusy(false) }
  }

  async function host() {
    setBusy(true); setError(null)
    try {
      const room = await createRoom('pumpkin-carve')
      setCode(room.code)
      onJoined(room.code, await joinRoom(room.code, name.trim()))
    } catch (e) { setError(message(e)) } finally { setBusy(false) }
  }

  return (
    <main style={{ maxWidth: 420, margin: '12vh auto', padding: 16 }}>
      <h1 style={{ fontFamily: 'var(--font-game)', color: 'var(--accent)' }}>Team Games</h1>

      <label htmlFor="name">Your name</label>
      <input id="name" value={name} maxLength={MAX_DISPLAY_NAME}
        onChange={e => setName(e.target.value)} />

      <label htmlFor="code">Room code</label>
      <input id="code" value={code} maxLength={CODE_LENGTH + 1}
        onChange={e => setCode(e.target.value.toUpperCase())}
        style={{ fontFamily: 'var(--font-display)', letterSpacing: '0.2em' }} />

      <button disabled={!ready} onClick={() => submit(code)}>Join game</button>
      <button disabled={name.trim().length === 0 || busy} onClick={host}>
        Start a new room
      </button>

      {error && <p role="alert" style={{ color: 'var(--accent)' }}>{humanize(error)}</p>}
    </main>
  )
}

const message = (e: unknown) => (e instanceof Error ? e.message : 'UNKNOWN')

function humanize(code: string): string {
  switch (code) {
    case 'ROOM_NOT_FOUND': return "No room with that code. Check it against the host's screen."
    case 'ROOM_FULL': return 'That room is full.'
    case 'NAME_REQUIRED': return 'Pick a name first.'
    case 'NAME_TOO_LONG': return 'That name is too long.'
    default: return 'Something went wrong. Try again.'
  }
}
```

- [ ] **Step 5: Write the lobby**

`packages/web/src/lobby/Lobby.tsx`:
```tsx
import { useState } from 'react'
import type { RoomCode } from '@tg/shared'
import { useConnection } from '../store/connection.js'
import { HostLine } from '../ui/HostLine.js'
import { startGame } from './api.js'

const MIN_PLAYERS = 2

export function Lobby({ code, playerToken }: { code: RoomCode; playerToken: string }) {
  const players = useConnection(s => s.players)
  const labels = useConnection(s => s.labels)
  const hostId = useConnection(s => s.hostId)
  const me = useConnection(s => s.me)
  const status = useConnection(s => s.status)
  const [error, setError] = useState<string | null>(null)

  const isHost = me !== null && me === hostId
  const ordered = [...players].sort((a, b) => a.joinedAt - b.joinedAt)

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}>
      <header>
        <p style={{ color: 'var(--shell-muted)', margin: 0 }}>Room code</p>
        <p className="room-code" style={{ margin: 0 }}>{code}</p>
      </header>

      {status === 'reconnecting' && (
        <p role="status" style={{ color: 'var(--glow)' }}>Reconnecting…</p>
      )}

      <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 8 }}>
        {ordered.map(player => (
          <li key={player.id} className="surface" style={{ padding: 12, opacity: player.connected ? 1 : 0.5 }}>
            <strong>{labels[player.id] ?? player.displayName}</strong>
            {player.id === hostId && <span> · host</span>}
            {!player.connected && <span> · offline</span>}
          </li>
        ))}
      </ul>

      <HostLine />

      {isHost ? (
        <>
          <button
            disabled={players.length < MIN_PLAYERS}
            onClick={async () => {
              try { await startGame(code, playerToken) }
              catch (e) { setError(e instanceof Error ? e.message : 'UNKNOWN') }
            }}
          >
            Start carving
          </button>
          {players.length < MIN_PLAYERS && (
            <p style={{ color: 'var(--shell-muted)' }}>Need at least {MIN_PLAYERS} players.</p>
          )}
        </>
      ) : (
        <p>Waiting for the host to start…</p>
      )}

      {error && <p role="alert">{error}</p>}
    </main>
  )
}
```

- [ ] **Step 6: Wire the router**

`packages/web/src/App.tsx`:
```tsx
import { useState } from 'react'
import { asRoomCode, type RoomCode } from '@tg/shared'
import { useConnection } from './store/connection.js'
import { JoinScreen } from './lobby/JoinScreen.js'
import { Lobby } from './lobby/Lobby.js'
import type { JoinResult } from './lobby/api.js'

export function App() {
  const [session, setSession] = useState<{ code: RoomCode; join: JoinResult } | null>(null)
  const phase = useConnection(s => s.phase)
  const connect = useConnection(s => s.connect)

  if (!session) {
    return (
      <JoinScreen
        onJoined={(code, join) => {
          setSession({ code: asRoomCode(code), join })
          connect(join.roomId, join.playerId, join.playerToken)
        }}
      />
    )
  }

  if (phase === 'lobby') {
    return <Lobby code={session.code} playerToken={session.join.playerToken} />
  }

  // Carve, vote, and results screens are wired in Tasks 16-18.
  return <p>Phase: {phase}</p>
}
```

- [ ] **Step 7: Run the test and confirm it passes**

Run: `pnpm -F @tg/web vitest run src/__tests__/lobby.test.tsx`
Expected: PASS — 10 tests

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Add join screen and lobby

The room code is the highest-traffic element in the product, since late
joiners read it off a shared screen, so it gets the largest type on the
page.

Players are listed by their disambiguated label, not their raw display
name, so two Jocelyns are distinguishable. Disconnected players are
marked in text as well as opacity, because nothing may be encoded in
color or styling alone."
```

---

## Task 16: Carve screen

**Files:**
- Create: `packages/web/src/games/pumpkin/strokes.ts`, `packages/web/src/games/pumpkin/canvas.ts`, `packages/web/src/games/pumpkin/IntegrityMeter.tsx`, `packages/web/src/games/pumpkin/CarveScreen.tsx`
- Modify: `packages/web/src/App.tsx`
- Test: `packages/web/src/__tests__/strokes.test.ts`, `packages/web/src/__tests__/integrity-meter.test.tsx`

**Interfaces:**
- Consumes: `Stroke`, `StampShape`, `carvedRatio`, `integrityState`, `SAG_THRESHOLD`, `useConnection`.
- Produces: `DraftState`, `emptyDraft()`, `beginStroke(d, tool, size, shape, point)`, `extendStroke(d, point)`, `endStroke(d)`, `undo(d)`, `allStrokes(d)`, `saveDraft(roomId, strokes)`, `loadDraft(roomId)`, `clearDraft(roomId)`, `renderPumpkin(ctx, strokes, theme)`, `<IntegrityMeter ratio integrity />`, `<CarveScreen roomId />`.

The stroke state machine is pure and fully tested here. Canvas rasterization is DOM work verified by the Playwright test in Task 19 — jsdom has no 2D context, so unit-testing it would test a mock.

- [ ] **Step 1: Write the failing stroke test**

`packages/web/src/__tests__/strokes.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  allStrokes, beginStroke, clearDraft, emptyDraft, endStroke,
  extendStroke, loadDraft, saveDraft, undo,
} from '../games/pumpkin/strokes.js'

describe('stroke state machine', () => {
  it('starts empty', () => {
    expect(allStrokes(emptyDraft())).toEqual([])
  })

  it('opens an active stroke on begin', () => {
    const d = beginStroke(emptyDraft(), 'cut', 0.1, undefined, [0.5, 0.5])
    expect(d.active?.points).toEqual([[0.5, 0.5]])
    expect(d.strokes).toHaveLength(0)
  })

  it('appends points while the stroke is active', () => {
    let d = beginStroke(emptyDraft(), 'cut', 0.1, undefined, [0.1, 0.1])
    d = extendStroke(d, [0.2, 0.2])
    d = extendStroke(d, [0.3, 0.3])
    expect(d.active?.points).toHaveLength(3)
  })

  it('ignores extend when no stroke is active', () => {
    const d = extendStroke(emptyDraft(), [0.2, 0.2])
    expect(d.active).toBeNull()
    expect(d.strokes).toHaveLength(0)
  })

  it('commits the active stroke on end', () => {
    let d = beginStroke(emptyDraft(), 'cut', 0.1, undefined, [0.5, 0.5])
    d = endStroke(d)
    expect(d.active).toBeNull()
    expect(d.strokes).toHaveLength(1)
  })

  it('discards a stroke with no points', () => {
    const d = endStroke({ strokes: [], active: { tool: 'cut', size: 0.1, points: [] } })
    expect(d.strokes).toHaveLength(0)
  })

  it('clamps points into the canvas', () => {
    let d = beginStroke(emptyDraft(), 'cut', 0.1, undefined, [-0.5, 1.9])
    d = endStroke(d)
    expect(d.strokes[0]!.points[0]).toEqual([0, 1])
  })

  it('records a stamp with its shape', () => {
    let d = beginStroke(emptyDraft(), 'stamp', 0.2, 'triangle', [0.4, 0.3])
    d = endStroke(d)
    expect(d.strokes[0]).toMatchObject({ tool: 'stamp', shape: 'triangle' })
  })

  it('undo removes the last committed stroke', () => {
    let d = endStroke(beginStroke(emptyDraft(), 'cut', 0.1, undefined, [0.1, 0.1]))
    d = endStroke(beginStroke(d, 'cut', 0.1, undefined, [0.2, 0.2]))
    d = undo(d)
    expect(d.strokes).toHaveLength(1)
    expect(d.strokes[0]!.points[0]).toEqual([0.1, 0.1])
  })

  it('undo on an empty draft is a no-op', () => {
    expect(undo(emptyDraft())).toEqual(emptyDraft())
  })

  it('undo discards an in-progress stroke first', () => {
    let d = endStroke(beginStroke(emptyDraft(), 'cut', 0.1, undefined, [0.1, 0.1]))
    d = beginStroke(d, 'cut', 0.1, undefined, [0.9, 0.9])
    d = undo(d)
    expect(d.active).toBeNull()
    expect(d.strokes).toHaveLength(1)
  })

  it('allStrokes includes the active stroke so the live meter is accurate', () => {
    const d = beginStroke(emptyDraft(), 'cut', 0.1, undefined, [0.5, 0.5])
    expect(allStrokes(d)).toHaveLength(1)
  })
})

describe('draft persistence', () => {
  beforeEach(() => localStorage.clear())

  it('round-trips strokes for a room', () => {
    const strokes = [{ tool: 'cut' as const, size: 0.1, points: [[0.5, 0.5]] as [number, number][] }]
    saveDraft('room-1', strokes)
    expect(loadDraft('room-1')).toEqual(strokes)
  })

  it('keeps drafts separate per room', () => {
    saveDraft('room-1', [{ tool: 'cut', size: 0.1, points: [[0.1, 0.1]] }])
    expect(loadDraft('room-2')).toBeNull()
  })

  it('returns null for a room with no draft', () => {
    expect(loadDraft('nope')).toBeNull()
  })

  it('returns null rather than throwing on corrupt data', () => {
    localStorage.setItem('tg:draft:room-1', '{not json')
    expect(loadDraft('room-1')).toBeNull()
  })

  it('clears a draft', () => {
    saveDraft('room-1', [{ tool: 'cut', size: 0.1, points: [[0.1, 0.1]] }])
    clearDraft('room-1')
    expect(loadDraft('room-1')).toBeNull()
  })

  it('does not throw when storage is unavailable', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => { throw new Error('QuotaExceeded') })
    expect(() => saveDraft('room-1', [])).not.toThrow()
    spy.mockRestore()
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm -F @tg/web vitest run src/__tests__/strokes.test.ts`
Expected: FAIL — cannot resolve `../games/pumpkin/strokes.js`

- [ ] **Step 3: Implement the stroke machine and draft storage**

`packages/web/src/games/pumpkin/strokes.ts`:
```ts
import type { Stroke, StampShape } from '@tg/shared'

export type DraftState = { strokes: Stroke[]; active: Stroke | null }

export const emptyDraft = (): DraftState => ({ strokes: [], active: null })

const clamp = ([x, y]: [number, number]): [number, number] =>
  [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))]

export function beginStroke(
  draft: DraftState,
  tool: Stroke['tool'],
  size: number,
  shape: StampShape | undefined,
  point: [number, number],
): DraftState {
  const active: Stroke = shape
    ? { tool, shape, size, points: [clamp(point)] }
    : { tool, size, points: [clamp(point)] }
  return { strokes: draft.strokes, active }
}

export function extendStroke(draft: DraftState, point: [number, number]): DraftState {
  if (!draft.active) return draft
  return {
    strokes: draft.strokes,
    active: { ...draft.active, points: [...draft.active.points, clamp(point)] },
  }
}

export function endStroke(draft: DraftState): DraftState {
  if (!draft.active || draft.active.points.length === 0) {
    return { strokes: draft.strokes, active: null }
  }
  return { strokes: [...draft.strokes, draft.active], active: null }
}

export function undo(draft: DraftState): DraftState {
  if (draft.active) return { strokes: draft.strokes, active: null }
  return { strokes: draft.strokes.slice(0, -1), active: null }
}

/** Includes the in-progress stroke, so the live integrity meter is accurate. */
export function allStrokes(draft: DraftState): Stroke[] {
  return draft.active ? [...draft.strokes, draft.active] : draft.strokes
}

const key = (roomId: string) => `tg:draft:${roomId}`

export function saveDraft(roomId: string, strokes: Stroke[]): void {
  try { localStorage.setItem(key(roomId), JSON.stringify(strokes)) } catch { /* private mode */ }
}

export function loadDraft(roomId: string): Stroke[] | null {
  try {
    const raw = localStorage.getItem(key(roomId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as Stroke[]) : null
  } catch { return null }
}

export function clearDraft(roomId: string): void {
  try { localStorage.removeItem(key(roomId)) } catch { /* ignore */ }
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `pnpm -F @tg/web vitest run src/__tests__/strokes.test.ts`
Expected: PASS — 18 tests

- [ ] **Step 5: Write the failing integrity meter test**

`packages/web/src/__tests__/integrity-meter.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { IntegrityMeter } from '../games/pumpkin/IntegrityMeter.js'

describe('IntegrityMeter', () => {
  it('labels a solid pumpkin in words, not only color', () => {
    render(<IntegrityMeter ratio={0.1} integrity="solid" />)
    expect(screen.getByText(/solid/i)).toBeTruthy()
  })

  it('labels a sagging pumpkin in words', () => {
    render(<IntegrityMeter ratio={0.45} integrity="sagging" />)
    expect(screen.getByText(/sagging/i)).toBeTruthy()
  })

  it('labels a collapsed pumpkin in words', () => {
    render(<IntegrityMeter ratio={0.6} integrity="collapsed" />)
    expect(screen.getByText(/collapsed/i)).toBeTruthy()
  })

  it('shows cracks as a shape cue alongside the color shift', () => {
    const { container } = render(<IntegrityMeter ratio={0.45} integrity="sagging" />)
    expect(container.querySelectorAll('[data-crack]').length).toBeGreaterThan(0)
  })

  it('shows no cracks while solid', () => {
    const { container } = render(<IntegrityMeter ratio={0.1} integrity="solid" />)
    expect(container.querySelectorAll('[data-crack]')).toHaveLength(0)
  })

  it('exposes progress to assistive tech without revealing the threshold', () => {
    render(<IntegrityMeter ratio={0.45} integrity="sagging" />)
    const meter = screen.getByRole('meter')
    expect(meter).toHaveAttribute('aria-valuetext', expect.stringMatching(/sagging/i))
    expect(meter).not.toHaveAttribute('aria-valuenow')
  })
})
```

- [ ] **Step 6: Run it and confirm it fails**

Run: `pnpm -F @tg/web vitest run src/__tests__/integrity-meter.test.tsx`
Expected: FAIL — cannot resolve `../games/pumpkin/IntegrityMeter.js`

- [ ] **Step 7: Implement the meter**

`packages/web/src/games/pumpkin/IntegrityMeter.tsx`:
```tsx
type Integrity = 'solid' | 'sagging' | 'collapsed'

const LABEL: Record<Integrity, string> = {
  solid: 'Solid',
  sagging: 'Sagging',
  collapsed: 'Collapsed',
}

const COLOR: Record<Integrity, string> = {
  solid: 'var(--danger)',
  sagging: 'var(--glow)',
  collapsed: 'var(--accent)',
}

const CRACKS: Record<Integrity, number> = { solid: 0, sagging: 2, collapsed: 5 }

/**
 * Deliberately unlabeled numerically: the bar shows how far you have gone,
 * never how far you may go, so over-carving stays a gamble. aria-valuenow is
 * omitted for the same reason; aria-valuetext carries the qualitative state.
 */
export function IntegrityMeter({
  ratio, integrity,
}: { ratio: number; integrity: Integrity }) {
  return (
    <div>
      <div
        role="meter"
        aria-label="Structural integrity"
        aria-valuetext={LABEL[integrity]}
        style={{
          height: 10, borderRadius: 999, overflow: 'hidden',
          background: 'var(--shell-surface)', border: '1px solid var(--shell-border)',
          position: 'relative',
        }}
      >
        <div style={{
          width: `${Math.min(100, ratio * 100 / 0.6)}%`,
          height: '100%', background: COLOR[integrity],
          transition: 'width 80ms linear',
        }} />
        {Array.from({ length: CRACKS[integrity] }, (_, i) => (
          <span key={i} data-crack style={{
            position: 'absolute', top: 0, bottom: 0,
            left: `${12 + i * 16}%`, width: 2,
            background: 'var(--shell-bg)', transform: 'rotate(12deg)',
          }} />
        ))}
      </div>
      <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--shell-muted)' }}>
        {LABEL[integrity]}
      </p>
    </div>
  )
}
```

- [ ] **Step 8: Write the canvas renderer and carve screen**

`packages/web/src/games/pumpkin/canvas.ts`:
```ts
import { CANVAS_H, CANVAS_W, type Stroke } from '@tg/shared'

/** The pumpkin outline. Strokes are clipped to it so you cannot carve the background. */
export function pumpkinPath(): Path2D {
  const path = new Path2D()
  path.ellipse(CANVAS_W / 2, CANVAS_H / 2 + 20, CANVAS_W * 0.44, CANVAS_H * 0.40, 0, 0, Math.PI * 2)
  return path
}

function stampPath(stroke: Stroke, x: number, y: number, r: number): Path2D {
  const path = new Path2D()
  switch (stroke.shape) {
    case 'triangle':
      path.moveTo(x, y - r); path.lineTo(x + r, y + r); path.lineTo(x - r, y + r); path.closePath()
      break
    case 'crescent':
      path.arc(x, y, r, 0, Math.PI); path.closePath()
      break
    case 'zigzag':
      path.moveTo(x - r, y)
      for (let i = 0; i < 4; i++) {
        path.lineTo(x - r + (r / 2) * (i * 2 + 1), y + (i % 2 ? r : -r) * 0.6)
      }
      path.lineTo(x + r, y); path.lineTo(x + r, y + r); path.lineTo(x - r, y + r); path.closePath()
      break
    case 'snaggletooth':
      path.rect(x - r, y - r * 0.4, r * 2, r * 0.8)
      path.rect(x - r * 0.2, y - r * 0.4, r * 0.4, r)
      break
    default:
      path.arc(x, y, r, 0, Math.PI * 2)
  }
  return path
}

/**
 * Two layers: a candle glow beneath, the pumpkin body above. Carving punches
 * holes in the body with destination-out, so the light shows through.
 */
export function renderPumpkin(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  theme: { accent: string; glow: string; bg: string },
): void {
  const silhouette = pumpkinPath()

  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)

  // candle
  const glow = ctx.createRadialGradient(
    CANVAS_W / 2, CANVAS_H / 2, 10, CANVAS_W / 2, CANVAS_H / 2, CANVAS_W * 0.5)
  glow.addColorStop(0, '#FFFFFF')
  glow.addColorStop(0.35, theme.glow)
  glow.addColorStop(1, theme.bg)
  ctx.fillStyle = glow
  ctx.fill(silhouette)

  // body, with the carve mask punched out
  const body = document.createElement('canvas')
  body.width = CANVAS_W; body.height = CANVAS_H
  const bctx = body.getContext('2d')!
  bctx.fillStyle = theme.accent
  bctx.fill(silhouette)

  bctx.globalCompositeOperation = 'destination-out'
  for (const stroke of strokes) {
    if (stroke.tool === 'uncut') continue
    const radius = (stroke.size * CANVAS_W) / 2
    for (const [nx, ny] of stroke.points) {
      const x = nx * CANVAS_W, y = ny * CANVAS_H
      bctx.fill(stroke.tool === 'stamp' ? stampPath(stroke, x, y, radius) : circle(x, y, radius))
    }
  }

  // uncut restores flesh
  bctx.globalCompositeOperation = 'source-over'
  bctx.fillStyle = theme.accent
  for (const stroke of strokes) {
    if (stroke.tool !== 'uncut') continue
    const radius = (stroke.size * CANVAS_W) / 2
    for (const [nx, ny] of stroke.points) {
      bctx.save(); bctx.clip(silhouette)
      bctx.fill(circle(nx * CANVAS_W, ny * CANVAS_H, radius))
      bctx.restore()
    }
  }

  ctx.drawImage(body, 0, 0)
}

function circle(x: number, y: number, r: number): Path2D {
  const path = new Path2D()
  path.arc(x, y, r, 0, Math.PI * 2)
  return path
}
```

`packages/web/src/games/pumpkin/CarveScreen.tsx`:
```tsx
import { useEffect, useRef, useState } from 'react'
import {
  CANVAS_H, CANVAS_W, carvedRatio, integrityState,
  type StampShape, type Stroke,
} from '@tg/shared'
import { useConnection } from '../../store/connection.js'
import { Timer } from '../../ui/Timer.js'
import { HostLine } from '../../ui/HostLine.js'
import { IntegrityMeter } from './IntegrityMeter.js'
import { renderPumpkin } from './canvas.js'
import {
  allStrokes, beginStroke, clearDraft, emptyDraft, endStroke,
  extendStroke, loadDraft, saveDraft, undo, type DraftState,
} from './strokes.js'

const DRAFT_AUTOSAVE_MS = 10_000
const STAMPS: StampShape[] = ['triangle', 'circle', 'crescent', 'zigzag', 'snaggletooth']
const THEME = { accent: '#FF7518', glow: '#FFC24D', bg: '#0E0D14' }

type View = { kind: 'carving'; submitted: boolean; submittedCount: number; totalPlayers: number }

export function CarveScreen({ roomId }: { roomId: string }) {
  const view = useConnection(s => s.view) as View
  const dispatch = useConnection(s => s.dispatch)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  // The draft lives in a ref, not React state: pointermove must never re-render.
  const draftRef = useRef<DraftState>(emptyDraft())
  const [ratio, setRatio] = useState(0)
  const [tool, setTool] = useState<'cut' | 'uncut' | 'stamp'>('cut')
  const [shape, setShape] = useState<StampShape>('triangle')
  const [size, setSize] = useState(0.08)

  const redraw = () => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const strokes = allStrokes(draftRef.current)
    renderPumpkin(ctx, strokes, THEME)
    setRatio(carvedRatio(strokes))
  }

  // Restore a draft after a crash or refresh.
  useEffect(() => {
    const saved = loadDraft(roomId)
    if (saved) draftRef.current = { strokes: saved, active: null }
    redraw()
  }, [roomId])

  // Unicast autosave. A save, not a broadcast: nothing fans out mid-carve.
  useEffect(() => {
    const id = setInterval(() => {
      const strokes = draftRef.current.strokes
      saveDraft(roomId, strokes)
      dispatch({ type: 'DRAFT', strokes })
    }, DRAFT_AUTOSAVE_MS)
    return () => clearInterval(id)
  }, [roomId, dispatch])

  const toPoint = (e: React.PointerEvent): [number, number] => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return [(e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height]
  }

  if (view?.submitted) {
    return (
      <main style={{ textAlign: 'center', padding: 24 }}>
        <h2>Carved.</h2>
        <p>{view.submittedCount} of {view.totalPlayers} done.</p>
        <HostLine />
      </main>
    )
  }

  const strokes = allStrokes(draftRef.current)
  const integrity = integrityState(ratio, 0.55)

  return (
    <main style={{ maxWidth: 560, margin: '0 auto', padding: 16 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <h2 style={{ fontFamily: 'var(--font-game)', margin: 0 }}>Carve</h2>
        <Timer />
      </header>

      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        style={{ width: '100%', touchAction: 'none', cursor: 'crosshair' }}
        onPointerDown={e => {
          e.currentTarget.setPointerCapture(e.pointerId)
          draftRef.current = beginStroke(
            draftRef.current, tool, size,
            tool === 'stamp' ? shape : undefined, toPoint(e))
          redraw()
        }}
        onPointerMove={e => {
          if (!draftRef.current.active) return
          // Coalesced events keep fast drags smooth without extra renders.
          const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]
          for (const raw of events) {
            const rect = canvasRef.current!.getBoundingClientRect()
            draftRef.current = extendStroke(draftRef.current, [
              (raw.clientX - rect.left) / rect.width,
              (raw.clientY - rect.top) / rect.height,
            ])
          }
          redraw()
        }}
        onPointerUp={() => { draftRef.current = endStroke(draftRef.current); redraw() }}
      />

      <IntegrityMeter ratio={ratio} integrity={integrity} />

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        <button aria-pressed={tool === 'cut'} onClick={() => setTool('cut')}>Cut</button>
        <button aria-pressed={tool === 'uncut'} onClick={() => setTool('uncut')}>Uncarve</button>
        <button aria-pressed={tool === 'stamp'} onClick={() => setTool('stamp')}>Stamp</button>
        {tool === 'stamp' && STAMPS.map(s => (
          <button key={s} aria-pressed={shape === s} onClick={() => setShape(s)}>{s}</button>
        ))}
        <label>Size
          <input type="range" min={0.03} max={0.25} step={0.01} value={size}
            onChange={e => setSize(Number(e.target.value))} />
        </label>
        <button onClick={() => { draftRef.current = undo(draftRef.current); redraw() }}>
          Undo
        </button>
      </div>

      <button
        style={{ marginTop: 16, width: '100%' }}
        onClick={() => {
          const committed = endStroke(draftRef.current).strokes
          dispatch({ type: 'SUBMIT', strokes: committed })
          clearDraft(roomId)
        }}
      >
        Submit pumpkin ({strokes.length} strokes)
      </button>

      <HostLine />
    </main>
  )
}
```

Add to the router in `packages/web/src/App.tsx`:
```tsx
  if (phase === 'carving') return <CarveScreen roomId={session.join.roomId} />
```

- [ ] **Step 9: Run both tests and confirm they pass**

Run: `pnpm -F @tg/web vitest run src/__tests__/strokes.test.ts src/__tests__/integrity-meter.test.tsx`
Expected: PASS — 24 tests

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "Add carve screen with stroke machine and integrity meter

The draft lives in a ref and the canvas is drawn imperatively, so a
pointermove never triggers a React render. Coalesced pointer events keep
fast drags smooth. React renders only the chrome.

The meter shows how far you have gone and never how far you may go, so
over-carving stays a gamble. It carries a text label and crack marks, so
nothing is encoded in color alone.

Drafts are saved to localStorage on autosave and unicast to the server
every 10s, so a browser crash mid-carve does not lose the pumpkin."
```

---

## Task 17: Voting screen

**Files:**
- Create: `packages/web/src/games/pumpkin/PumpkinThumb.tsx`, `packages/web/src/games/pumpkin/VoteScreen.tsx`
- Modify: `packages/web/src/App.tsx`
- Test: `packages/web/src/__tests__/vote-screen.test.tsx`

**Interfaces:**
- Consumes: `AWARD_LABELS`, `AwardKey`, `GalleryEntry`, `useConnection`, `renderPumpkin`.
- Produces: `<PumpkinThumb entry label onClick selected disabled />`, `<VoteScreen />`.

- [ ] **Step 1: Write the failing test**

`packages/web/src/__tests__/vote-screen.test.tsx`:
```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { VoteScreen } from '../games/pumpkin/VoteScreen.js'
import { useConnection } from '../store/connection.js'
import { asPlayerId } from '@tg/shared'

const ME = asPlayerId('me')
const entry = (slot: number) => ({ slot, strokes: [], integrity: 'solid' as const })

const setView = (over: Record<string, unknown> = {}) =>
  useConnection.setState({
    status: 'open', phase: 'vote-scariest', me: ME,
    players: [], labels: {}, hostId: null, hostLine: null,
    endsAt: null, clockOffset: 0,
    view: {
      kind: 'voting', award: 'scariest',
      gallery: [entry(0), entry(1), entry(2)],
      mySlot: 1, myVote: null, ...over,
    },
  })

beforeEach(() => setView())

describe('VoteScreen', () => {
  it('names the current award', () => {
    render(<VoteScreen />)
    expect(screen.getByText(/scariest/i)).toBeTruthy()
  })

  it('shows one card per pumpkin', () => {
    render(<VoteScreen />)
    expect(screen.getAllByRole('button', { name: /pumpkin/i })).toHaveLength(3)
  })

  it('disables the voters own pumpkin', () => {
    render(<VoteScreen />)
    const cards = screen.getAllByRole('button', { name: /pumpkin/i })
    expect(cards[1]).toBeDisabled()
  })

  it('labels the voters own pumpkin as theirs', () => {
    render(<VoteScreen />)
    expect(screen.getByText(/yours/i)).toBeTruthy()
  })

  it('never shows a carver name during voting', () => {
    useConnection.setState({ labels: { me: 'Jocelyn', other: 'Sam' } })
    render(<VoteScreen />)
    expect(screen.queryByText('Jocelyn')).toBeNull()
    expect(screen.queryByText('Sam')).toBeNull()
  })

  it('dispatches a vote for the clicked slot', () => {
    const dispatch = vi.fn()
    useConnection.setState({ dispatch })
    render(<VoteScreen />)
    fireEvent.click(screen.getAllByRole('button', { name: /pumpkin/i })[2]!)
    expect(dispatch).toHaveBeenCalledWith({ type: 'VOTE', award: 'scariest', slot: 2 })
  })

  it('marks the current vote as selected', () => {
    setView({ myVote: 2 })
    render(<VoteScreen />)
    expect(screen.getAllByRole('button', { name: /pumpkin/i })[2]!)
      .toHaveAttribute('aria-pressed', 'true')
  })

  it('shows a collapsed pumpkin as collapsed in text', () => {
    setView({ gallery: [{ slot: 0, strokes: [], integrity: 'collapsed' }], mySlot: 5 })
    render(<VoteScreen />)
    expect(screen.getByText(/collapsed/i)).toBeTruthy()
  })

  it('slumps a collapsed pumpkin, so shape carries the meaning too', () => {
    setView({ gallery: [{ slot: 0, strokes: [], integrity: 'collapsed' }], mySlot: 5 })
    const { container } = render(<VoteScreen />)
    const card = container.querySelector('[data-integrity="collapsed"]') as HTMLElement
    expect(card).toBeTruthy()
    expect(card.style.transform).toMatch(/rotate/)
  })

  it('leaves a solid pumpkin untransformed', () => {
    const { container } = render(<VoteScreen />)
    const card = container.querySelector('[data-integrity="solid"]') as HTMLElement
    expect(card.style.transform).toBe('none')
  })

  it('tells a spectator they are watching this round', () => {
    useConnection.setState({ view: { kind: 'spectator', phase: 'vote-scariest' } })
    render(<VoteScreen />)
    expect(screen.getByText(/next round/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm -F @tg/web vitest run src/__tests__/vote-screen.test.tsx`
Expected: FAIL — cannot resolve `../games/pumpkin/VoteScreen.js`

- [ ] **Step 3: Implement the thumbnail**

`packages/web/src/games/pumpkin/PumpkinThumb.tsx`:
```tsx
import { useEffect, useRef } from 'react'
import { CANVAS_H, CANVAS_W, type GalleryEntry } from '@tg/shared'
import { renderPumpkin } from './canvas.js'

const THEME = { accent: '#FF7518', glow: '#FFC24D', bg: '#0E0D14' }

const INTEGRITY_TEXT = {
  solid: '', sagging: 'Sagging', collapsed: 'Collapsed',
} as const

export function PumpkinThumb({
  entry, caption, selected, disabled, onClick,
}: {
  entry: GalleryEntry
  caption?: string
  selected?: boolean
  disabled?: boolean
  onClick?(): void
}) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return                   // jsdom has no 2D context; e2e covers rendering
    renderPumpkin(ctx, entry.strokes, THEME)
  }, [entry.strokes])

  return (
    <button
      aria-label={`Pumpkin ${entry.slot + 1}`}
      aria-pressed={selected ?? false}
      disabled={disabled ?? false}
      onClick={onClick}
      className="surface"
      data-integrity={entry.integrity}
      style={{
        padding: 8, cursor: disabled ? 'default' : 'pointer',
        outline: selected ? '3px solid var(--accent)' : 'none',
        opacity: disabled ? 0.55 : 1,
        // A collapsed pumpkin slumps, so it reads as failed before the
        // caption is read. Shape, not colour, carries the meaning.
        transform: entry.integrity === 'collapsed'
          ? 'rotate(-6deg) scaleY(0.86)'
          : entry.integrity === 'sagging' ? 'scaleY(0.96)' : 'none',
        transition: 'transform 200ms ease-out',
      }}
    >
      <canvas ref={ref} width={CANVAS_W} height={CANVAS_H} style={{ width: '100%' }} />
      <span style={{ display: 'block', fontSize: 13, color: 'var(--shell-muted)' }}>
        {caption ?? INTEGRITY_TEXT[entry.integrity]}
      </span>
    </button>
  )
}
```

- [ ] **Step 4: Implement the vote screen**

`packages/web/src/games/pumpkin/VoteScreen.tsx`:
```tsx
import { AWARD_LABELS, type AwardKey, type GalleryEntry } from '@tg/shared'
import { useConnection } from '../../store/connection.js'
import { Timer } from '../../ui/Timer.js'
import { HostLine } from '../../ui/HostLine.js'
import { PumpkinThumb } from './PumpkinThumb.js'

type VotingView = {
  kind: 'voting'; award: AwardKey; gallery: GalleryEntry[]
  mySlot: number; myVote: number | null
}

export function VoteScreen() {
  const view = useConnection(s => s.view) as VotingView | { kind: 'spectator' }
  const dispatch = useConnection(s => s.dispatch)

  if (view?.kind === 'spectator') {
    return (
      <main style={{ textAlign: 'center', padding: 32 }}>
        <h2>Watching this one</h2>
        <p>You joined mid-game — you&apos;re in the next round.</p>
        <HostLine />
      </main>
    )
  }

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: 16 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ fontFamily: 'var(--font-game)', margin: 0 }}>
          {AWARD_LABELS[view.award]}
        </h2>
        <Timer />
      </header>

      <HostLine />

      <div style={{
        display: 'grid', gap: 12, marginTop: 16,
        gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
      }}>
        {view.gallery.map(entry => {
          const isMine = entry.slot === view.mySlot
          return (
            <PumpkinThumb
              key={entry.slot}
              entry={entry}
              caption={isMine ? 'Yours' : undefined}
              selected={view.myVote === entry.slot}
              disabled={isMine}
              onClick={() => dispatch({ type: 'VOTE', award: view.award, slot: entry.slot })}
            />
          )
        })}
      </div>
    </main>
  )
}
```

Add to the router in `packages/web/src/App.tsx`:
```tsx
  if (phase.startsWith('vote-')) return <VoteScreen />
```

One award at a time, which is Jackbox's "one decision at a time" rule applied: four categories as four phases rather than one four-field form.

- [ ] **Step 5: Run it and confirm it passes**

Run: `pnpm -F @tg/web vitest run src/__tests__/vote-screen.test.tsx`
Expected: PASS — 9 tests

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add sequential award voting screen

Cards address slots, never player ids, so the component has no carver
identity available to leak. One award per phase keeps the screen to a
single decision at a time.

A spectator who joined mid-game gets an explanation rather than a
voting grid they should not be filling in."
```

---

## Task 18: Results screen

**Files:**
- Create: `packages/web/src/games/pumpkin/ResultsScreen.tsx`
- Modify: `packages/web/src/App.tsx`
- Test: `packages/web/src/__tests__/results-screen.test.tsx`

**Interfaces:**
- Consumes: `AWARD_KEYS`, `AWARD_LABELS`, `AwardResult`, `GalleryEntry`, `useConnection`, `<PumpkinThumb />`.
- Produces: `<ResultsScreen />`.

- [ ] **Step 1: Write the failing test**

`packages/web/src/__tests__/results-screen.test.tsx`:
```tsx
import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ResultsScreen } from '../games/pumpkin/ResultsScreen.js'
import { useConnection } from '../store/connection.js'
import { asPlayerId } from '@tg/shared'

const ME = asPlayerId('me')
const OTHER = asPlayerId('other')
const entry = (slot: number) => ({ slot, strokes: [], integrity: 'solid' as const })

const setView = (over: Record<string, unknown> = {}) =>
  useConnection.setState({
    status: 'open', phase: 'results', me: ME,
    players: [
      { id: ME, displayName: 'Jocelyn', connected: true, joinedAt: 1 },
      { id: OTHER, displayName: 'Jocelyn', connected: true, joinedAt: 2 },
    ],
    labels: { me: 'Jocelyn', other: 'Jocelyn (2)' },
    hostId: ME, hostLine: null, endsAt: null, clockOffset: 0,
    view: {
      kind: 'results',
      gallery: [entry(0), entry(1)],
      winners: {
        scariest: { slot: 0, votes: 2 },
        funniest: null,
        craft: { slot: 1, votes: 1 },
        cursed: null,
      },
      carvers: { 0: ME, 1: OTHER },
      ...over,
    },
  })

beforeEach(() => setView())

describe('ResultsScreen', () => {
  it('names the winner of each decided award by label', () => {
    render(<ResultsScreen />)
    expect(screen.getByText(/scariest/i)).toBeTruthy()
    expect(screen.getByText('Jocelyn')).toBeTruthy()
    expect(screen.getByText('Jocelyn (2)')).toBeTruthy()
  })

  it('shows the vote count for a decided award', () => {
    render(<ResultsScreen />)
    expect(screen.getByText(/2 votes/i)).toBeTruthy()
  })

  it('says no winner for an award nobody voted on', () => {
    render(<ResultsScreen />)
    expect(screen.getAllByText(/no votes/i).length).toBe(2)
  })

  it('uses the singular for a one-vote win', () => {
    render(<ResultsScreen />)
    expect(screen.getByText(/1 vote\b/i)).toBeTruthy()
  })

  it('reveals the carver under every pumpkin, not only winners', () => {
    render(<ResultsScreen />)
    expect(screen.getAllByRole('button', { name: /pumpkin/i })).toHaveLength(2)
  })

  it('does not crash when a winning slot has no carver recorded', () => {
    setView({ carvers: {} })
    expect(() => render(<ResultsScreen />)).not.toThrow()
  })

  it('renders all four award headings even when undecided', () => {
    render(<ResultsScreen />)
    for (const name of [/scariest/i, /funniest/i, /craftsmanship/i, /cursed/i]) {
      expect(screen.getByText(name)).toBeTruthy()
    }
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm -F @tg/web vitest run src/__tests__/results-screen.test.tsx`
Expected: FAIL — cannot resolve `../games/pumpkin/ResultsScreen.js`

- [ ] **Step 3: Implement the screen**

`packages/web/src/games/pumpkin/ResultsScreen.tsx`:
```tsx
import {
  AWARD_KEYS, AWARD_LABELS,
  type AwardKey, type AwardResult, type GalleryEntry, type PlayerId,
} from '@tg/shared'
import { useConnection } from '../../store/connection.js'
import { HostLine } from '../../ui/HostLine.js'
import { PumpkinThumb } from './PumpkinThumb.js'

type ResultsView = {
  kind: 'results'
  gallery: GalleryEntry[]
  winners: Record<AwardKey, AwardResult>
  carvers: Record<number, PlayerId>
}

export function ResultsScreen() {
  const view = useConnection(s => s.view) as ResultsView
  const labels = useConnection(s => s.labels)

  const nameFor = (slot: number) => {
    const carver = view.carvers[slot]
    return carver ? (labels[carver] ?? 'Unknown') : 'Unknown'
  }

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: 16 }}>
      <h2 style={{ fontFamily: 'var(--font-game)' }}>Results</h2>
      <HostLine />

      <section style={{
        display: 'grid', gap: 12,
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      }}>
        {AWARD_KEYS.map(award => {
          const winner = view.winners[award]
          const entry = winner ? view.gallery.find(g => g.slot === winner.slot) : undefined
          return (
            <div key={award} className="surface" style={{ padding: 12 }}>
              <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>{AWARD_LABELS[award]}</h3>
              {winner && entry ? (
                <>
                  <PumpkinThumb entry={entry} caption={nameFor(winner.slot)} disabled />
                  <p style={{ margin: '8px 0 0', color: 'var(--shell-muted)' }}>
                    {winner.votes} {winner.votes === 1 ? 'vote' : 'votes'}
                  </p>
                </>
              ) : (
                <p style={{ color: 'var(--shell-muted)' }}>No votes cast</p>
              )}
            </div>
          )
        })}
      </section>

      <h3 style={{ marginTop: 32 }}>Everyone&apos;s pumpkins</h3>
      <div style={{
        display: 'grid', gap: 12,
        gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
      }}>
        {view.gallery.map(entry => (
          <PumpkinThumb
            key={entry.slot}
            entry={entry}
            caption={nameFor(entry.slot)}
            disabled
          />
        ))}
      </div>
    </main>
  )
}
```

Add to the router in `packages/web/src/App.tsx`:
```tsx
  if (phase === 'results') return <ResultsScreen />
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `pnpm -F @tg/web vitest run src/__tests__/results-screen.test.tsx`
Expected: PASS — 7 tests

- [ ] **Step 5: Run the whole suite**

Run: `pnpm vitest run`
Expected: PASS — all tests from Tasks 1–18

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add results screen with four awards and full gallery

Carvers are shown by their disambiguated label, so two Jocelyns are
distinguishable at the moment it matters most.

An undecided award says so plainly rather than rendering an empty card,
and every pumpkin is shown with its carver, not only the winners, so
nobody's work disappears."
```

---

## Task 19: End-to-end smoke test and a twelve-client playtest script

**Files:**
- Create: `e2e/smoke.spec.ts`, `e2e/load.ts`, `playwright.config.ts`
- Modify: root `package.json`
- Test: the Playwright spec is itself the test

**Interfaces:**
- Consumes: the running app (`pnpm build` then `pnpm -F @tg/server dev`).
- Produces: `pnpm e2e`, `pnpm playtest` scripts.

- [ ] **Step 1: Install Playwright and configure it**

```bash
pnpm add -Dw @playwright/test@1.50.1
pnpm exec playwright install chromium
```

`playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: { baseURL: 'http://127.0.0.1:3000' },
  webServer: {
    command: 'pnpm build && pnpm -F @tg/server start',
    url: 'http://127.0.0.1:3000',
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: { DATABASE_URL: ':memory:', PORT: '3000' },
  },
})
```

Add to the root `package.json` scripts:
```json
    "e2e": "playwright test",
    "playtest": "tsx e2e/load.ts"
```

- [ ] **Step 2: Write the smoke test**

`e2e/smoke.spec.ts`:
```ts
import { expect, test } from '@playwright/test'

test('two players carve, vote, and see results', async ({ browser }) => {
  const hostContext = await browser.newContext()
  const guestContext = await browser.newContext()
  const host = await hostContext.newPage()
  const guest = await guestContext.newPage()

  // Host creates a room
  await host.goto('/')
  await host.getByLabel('Your name').fill('Host')
  await host.getByRole('button', { name: /start a new room/i }).click()

  const code = (await host.locator('.room-code').textContent())?.trim()
  expect(code).toMatch(/^[A-Z2-9]{6}$/)

  // Guest joins with the code
  await guest.goto('/')
  await guest.getByLabel('Your name').fill('Guest')
  await guest.getByLabel('Room code').fill(code!)
  await guest.getByRole('button', { name: /join game/i }).click()

  // Both see both players
  await expect(host.getByText('Guest')).toBeVisible()
  await expect(guest.getByText('Host')).toBeVisible()

  // Host starts
  await host.getByRole('button', { name: /start carving/i }).click()
  await expect(host.locator('canvas')).toBeVisible()
  await expect(guest.locator('canvas')).toBeVisible()

  // Both carve a few strokes and submit
  for (const page of [host, guest]) {
    const canvas = page.locator('canvas')
    const box = (await canvas.boundingBox())!
    await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.4)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45, { steps: 8 })
    await page.mouse.up()
    await expect(page.getByRole('meter', { name: /structural integrity/i })).toBeVisible()
    await page.getByRole('button', { name: /submit pumpkin/i }).click()
  }

  // Early exit: both submitted, so voting starts without waiting out the clock
  await expect(host.getByText(/scariest/i)).toBeVisible({ timeout: 10_000 })

  // Nobody can vote for their own pumpkin
  const ownCard = host.getByRole('button', { name: /pumpkin/i }).filter({ hasText: /yours/i })
  await expect(ownCard).toBeDisabled()

  // Carver names must not appear during voting
  await expect(host.getByText('Guest', { exact: true })).toHaveCount(0)

  // Vote in each of the four award phases
  for (const award of [/scariest/i, /funniest/i, /craftsmanship/i, /cursed/i]) {
    await expect(host.getByText(award)).toBeVisible({ timeout: 20_000 })
    const enabled = host.getByRole('button', { name: /pumpkin/i }).and(
      host.locator('button:not([disabled])'))
    await enabled.first().click()
    await host.waitForTimeout(16_000)         // phases are 15s
  }

  // Results reveal carvers
  await expect(host.getByRole('heading', { name: /^results$/i })).toBeVisible({ timeout: 20_000 })
  await expect(host.getByText('Guest')).toBeVisible()

  await hostContext.close()
  await guestContext.close()
})

test('a bad room code shows a helpful error', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Your name').fill('Nobody')
  await page.getByLabel('Room code').fill('ZZZZZZ')
  await page.getByRole('button', { name: /join game/i }).click()
  await expect(page.getByRole('alert')).toContainText(/no room with that code/i)
})
```

- [ ] **Step 3: Run the smoke test**

Run: `pnpm e2e`
Expected: PASS — 2 tests. If the four-award walk times out, the phase timings are the thing to check first: `DEFAULT_ROOM_CONFIG.phaseMs` must match the 16s waits.

- [ ] **Step 4: Write the twelve-client playtest script**

`e2e/load.ts`:
```ts
/**
 * Spawns N headless clients against a running server so the game can be
 * played at real size before game night. Jackbox tests at 3 and 8; this
 * project's range is 4 and 12.
 *
 * Usage: pnpm playtest [playerCount] [baseUrl]
 */
import WebSocket from 'ws'

const COUNT = Number(process.argv[2] ?? 12)
const BASE = process.argv[3] ?? 'http://127.0.0.1:3000'

type Join = { roomId: string; playerId: string; playerToken: string }

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`)
  return res.json() as Promise<T>
}

const strokes = Array.from({ length: 12 }, (_, i) => ({
  tool: 'cut' as const,
  size: 0.06 + (i % 4) * 0.02,
  points: [[0.3 + (i % 5) * 0.08, 0.35 + Math.floor(i / 5) * 0.12]] as [number, number][],
}))

async function main() {
  const { code } = await post<{ code: string }>('/api/rooms', { gameId: 'pumpkin-carve' })
  console.log(`room ${code} — ${COUNT} clients`)

  const joins: Join[] = []
  for (let i = 0; i < COUNT; i++) {
    joins.push(await post<Join>(`/api/rooms/${code}/join`, { displayName: `bot-${i + 1}` }))
  }

  const sockets = joins.map(join => {
    const ws = new WebSocket(
      `${BASE.replace('http', 'ws')}/ws?room=${join.roomId}&token=${join.playerToken}`)
    let submitted = false
    const voted = new Set<string>()

    ws.on('message', raw => {
      const message = JSON.parse(String(raw)) as
        { type: string; phase?: string; view?: Record<string, unknown> }
      if (message.type !== 'snapshot') return

      if (message.phase === 'carving' && !submitted) {
        submitted = true
        setTimeout(() => ws.send(JSON.stringify({
          type: 'action', payload: { type: 'SUBMIT', strokes },
        })), 500 + Math.random() * 3000)
      }

      if (message.phase?.startsWith('vote-') && !voted.has(message.phase)) {
        voted.add(message.phase)
        const view = message.view as { award: string; gallery: { slot: number }[]; mySlot: number }
        const options = view.gallery.filter(g => g.slot !== view.mySlot)
        const pick = options[Math.floor(Math.random() * options.length)]
        if (pick) {
          setTimeout(() => ws.send(JSON.stringify({
            type: 'action',
            payload: { type: 'VOTE', award: view.award, slot: pick.slot },
          })), 300 + Math.random() * 2000)
        }
      }

      if (message.phase === 'results') console.log('results reached')
    })
    return ws
  })

  await new Promise(r => setTimeout(r, 2000))
  await post(`/api/rooms/${code}/start`, { playerToken: joins[0]!.playerToken })
  console.log('started; watching until results')

  await new Promise(r => setTimeout(r, 120_000))
  for (const ws of sockets) ws.close()
}

main().catch(e => { console.error(e); process.exit(1) })
```

- [ ] **Step 5: Run the playtest at both sizes**

```bash
pnpm build && pnpm -F @tg/server start &
pnpm playtest 4
pnpm playtest 12
```

Expected: both runs print `results reached`. Watch for a phase that never advances, which would mean the early-exit check is counting a disconnected bot.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add end-to-end smoke test and a 12-client playtest script

The smoke test asserts the anonymity property from the outside: during
voting, a carver's name must not appear anywhere on the page.

The load script exists so the game is played at real size before game
night rather than at it. Jackbox tests at 3 and 8; the sizes that matter
here are 4 and 12."
```

---

## Task 20: Deploy to Fly.io

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `fly.toml`
- Modify: `packages/server/package.json` (add `tsconfig.build.json`), root `README.md`

**Interfaces:**
- Consumes: `pnpm build` output from both packages.
- Produces: a deployed app with a persistent volume at `/data` and `DATABASE_URL=/data/team-games.sqlite`.

- [ ] **Step 1: Add a server build config**

`packages/server/tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "noEmit": false,
    "module": "NodeNext",
    "moduleResolution": "nodenext"
  },
  "exclude": ["src/__tests__"]
}
```

Because `@tg/shared` is source-only, the server build must compile it too. The simplest reliable approach is to run the server under `tsx` in production as well, which removes the cross-package build-order problem entirely at the cost of a slightly slower boot. Change the server's start path accordingly:

```json
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "build": "echo 'server runs from source via tsx'"
  }
```

Move `tsx` from `devDependencies` to `dependencies` in `packages/server/package.json`, since production now needs it.

- [ ] **Step 2: Write the Dockerfile**

`Dockerfile`:
```dockerfile
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm -F @tg/web build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
RUN pnpm install --frozen-lockfile --prod --filter @tg/server... && \
    mkdir -p /data
ENV DATABASE_URL=/data/team-games.sqlite PORT=8080
EXPOSE 8080
CMD ["pnpm", "-F", "@tg/server", "start"]
```

`.dockerignore`:
```
node_modules
**/node_modules
**/dist
.git
*.sqlite
playwright-report
test-results
coverage
```

- [ ] **Step 3: Write the Fly config**

`fly.toml`:
```toml
app = "team-games"
primary_region = "sjc"

[build]

[env]
  PORT = "8080"
  DATABASE_URL = "/data/team-games.sqlite"

[[mounts]]
  source = "team_games_data"
  destination = "/data"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "suspend"
  auto_start_machines = true
  min_machines_running = 1

[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"
```

`min_machines_running = 1` is deliberate and the one setting worth not economizing on: rooms live in memory, so a machine that stops mid-game drops every live room. The snapshot from Task 13 would recover it, but a 30-second stall during the reveal is not what you want on game night. `sjc` is the region nearest the team.

- [ ] **Step 4: Create the app and volume**

```bash
fly launch --no-deploy --name team-games --region sjc
fly volumes create team_games_data --region sjc --size 1
```

- [ ] **Step 5: Deploy and verify**

```bash
fly deploy
fly logs
```

Then verify by hand, which is the actual acceptance test for this task:

```bash
curl -s https://team-games.fly.dev/api/games | head -c 200
```

Expected: JSON containing `"id":"pumpkin-carve"`.

- [ ] **Step 6: Run one full round on production**

Open the deployed URL in two browser windows, create a room, carve, vote through all four awards, and reach results. Then run the load script against it:

```bash
pnpm playtest 12 https://team-games.fly.dev
```

Expected: `results reached`. This is the step the build order reserves day 7 for; do not skip it.

- [ ] **Step 7: Update the README and commit**

Add a "Running it" section to `README.md` covering `pnpm install`, `pnpm dev`, `pnpm test`, `pnpm e2e`, `pnpm playtest`, and the deployed URL.

```bash
git add -A
git commit -m "Add Dockerfile, Fly config, and deploy docs

The server runs from source under tsx in production too, which removes
the cross-package build-order problem created by shared being a
source-only package. Boot is marginally slower; nothing else is.

min_machines_running is 1 on purpose: rooms live in memory, so a machine
suspending mid-game would drop every live room. The snapshot recovers
it, but not fast enough to be invisible during a reveal."
```

---

## Done when

- `pnpm test` passes every suite from Tasks 1–18
- `pnpm e2e` passes both Playwright specs
- `pnpm playtest 4` and `pnpm playtest 12` both reach results
- A full round has been played by two humans on the deployed URL
- Every Review Focus item has a passing test in its owning task
