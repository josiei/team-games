# Team Games

A web portal of live, multiplayer team-building games. Teammates join a room
with a shared code and play together from their own laptops.

**Status:** design approved, implementation not started.

## First slice

A Halloween jack-o'-lantern carving game: carve privately against a timer while
a structural integrity meter dares you to cut deeper, then vote anonymously
across four award categories and watch the reveal.

## Design

The full design spec lives at
[`docs/superpowers/specs/2026-10-12-team-games-portal-design.md`](docs/superpowers/specs/2026-10-12-team-games-portal-design.md).

Start there — it covers the tenancy model, the game module contract that every
future game plugs into, the protocol, the visual direction, and the build order.

## Stack

pnpm monorepo · TypeScript · Fastify + `ws` · Drizzle + SQLite · Vite + React ·
Zustand · Three.js (reveal only)

## Running it

```bash
pnpm install
pnpm dev        # server (tsx watch) + web (vite)
pnpm test       # unit and integration suites
pnpm e2e        # Playwright specs (script lands with the e2e task)
pnpm playtest 12 [url]   # load script: N simulated players (script lands with the playtest task)
```

Deployed at <https://team-games.fly.dev> (Fly.io, region `sjc`).

### Deploying

The server runs from source under `tsx` in production (`@tg/shared` is
source-only), and serves the built web client. Room snapshots live in SQLite on
a Fly volume mounted at `/data` (`DATABASE_URL=/data/team-games.sqlite`).

```bash
fly launch --no-deploy --name team-games --region sjc
fly volumes create team_games_data --region sjc --size 1
fly deploy
```

`min_machines_running = 1` is deliberate: rooms live in memory, so a machine
that suspends mid-game drops them.
