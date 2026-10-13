# Team Games

A web portal of live, multiplayer team-building games. Teammates join a room
with a shared code and play together from their own laptops.

**Status:** implementation nearly complete; the Fly deployment files exist but nothing has been deployed yet.

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

Not deployed yet. Once someone runs the steps below, the target URL is
`https://team-games.fly.dev` (it changes if the app name changes).

### Deploying

The server runs from source under `tsx` in production (`@tg/shared` is
source-only), and serves the built web client. Room snapshots live in SQLite on
a Fly volume mounted at `/data` (`DATABASE_URL=/data/team-games.sqlite`).

```bash
fly apps create team-games
fly volumes create team_games_data --region sjc --size 1
fly deploy --ha=false
```

> **WARNING: run exactly ONE machine.** Always deploy with `--ha=false`.
> Rooms live in memory, so a second machine splits the party: the same room code
> would resolve to two different rooms, and the volume only attaches to one
> machine. `fly.toml` cannot express a maximum machine count, so nothing in the
> config prevents this; check `fly status` shows one machine and never run
> `fly scale count` above 1.

Do not use `fly launch`: with an existing `fly.toml` it prompts and may rewrite
the file, dropping comments and the `[[mounts]]` block.

The app name `team-games` is globally unique on Fly and may be taken. If
`fly apps create` rejects it, pick another name, set `app` in `fly.toml` to
match, and note the URL becomes `https://<name>.fly.dev`.

`min_machines_running = 1` and `auto_stop_machines = "off"` are deliberate:
rooms live in memory, so a machine that stops or suspends mid-game drops them.
