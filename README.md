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
pnpm exec playwright install chromium   # once per machine, before the first pnpm e2e (see "Installing the browser" below if it hangs)
pnpm e2e        # Playwright: builds the web client, starts the server, drives two real browsers through a full round
pnpm playtest 12 [url]   # load script: N headless clients play a round over real HTTP + websockets (url defaults to http://127.0.0.1:3000)
```

### Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | `./data/team-games.sqlite` | SQLite file (parent directory is created if missing); `:memory:` for throwaway runs |
| `PORT` | `3000` | HTTP and websocket port |
| `CARVE_MS` | `180000` | Length of the carving phase, in milliseconds |
| `VOTE_MS` | `15000` | Length of each of the four vote phases, in milliseconds |

`CARVE_MS` and `VOTE_MS` are read once at server startup (restart to change them;
a positive integer, otherwise the default is used). They let you tune timings
after a playtest without a code change, e.g. `VOTE_MS=20000 pnpm -F @tg/server start`.
`pnpm e2e` derives its waits from the same values, so it stays correct if they
are set in the shell that runs it.

### End-to-end tests and the playtest

- `pnpm e2e` takes about 70 seconds (the four vote phases are 15 seconds each).
  It is the only place the carve canvas is actually rasterized; jsdom has no 2D
  context. Phase timings are read from `DEFAULT_ROOM_CONFIG` (which honours `CARVE_MS` / `VOTE_MS`), not hardcoded.
- `pnpm playtest 4` / `pnpm playtest 12` need a running server
  (`pnpm build && pnpm -F @tg/server start`) and print each phase change, then
  `results reached` once every bot has seen results. It exits non-zero otherwise.

**Installing the browser.** Run `pnpm exec playwright install chromium`. Browsers
are cached in `~/Library/Caches/ms-playwright` (macOS); if `chromium-*` and
`chromium_headless_shell-*` directories with an `INSTALLATION_COMPLETE` file are
there, it is already installed. Under Node 26 the installer's extraction step
HUNG (download finished, then no progress for minutes). Use Node 22 (permitted by
`engines`), or unzip the archives by hand from the CDN URLs printed by
`pnpm exec playwright install --dry-run chromium` into those cache directories
and `touch INSTALLATION_COMPLETE` in each. Both the chromium and the
headless-shell archives are needed.

**Stale servers.** `playwright.config.ts` sets `reuseExistingServer` outside CI,
so anything already listening on port 3000 is tested instead of a fresh build.
If results look like old behaviour, run `lsof -i :3000` and kill it first.

**Why the load script sends `connection: close`.** On Node 26, `fetch`
(undici) stalled 15-30 seconds on a kept-alive connection that had sat idle
between requests; the server answered instantly to curl and `node:http`. The
header avoids connection reuse. Do not remove it as a cleanup without re-testing
`/start` timing on the Node version in use.

Not deployed yet. Once someone runs the steps below, the target URL is
`https://team-games.fly.dev` (it changes if the app name changes).

### Running it locally while developing

**Restart the server after every `pnpm build`.** The build deletes and
recreates `packages/web/dist`, so a server started beforehand loses the files
underneath it and answers asset requests with the SPA fallback HTML. The
browser will not execute HTML as a module, so you get a blank white page **and
no console error** — the hardest possible version of this bug to read.

### Deploying

The server is designed to run from source under `tsx` in production
(`@tg/shared` is source-only) and to serve the built web client. Room snapshots
are designed to live in SQLite on a Fly volume mounted at `/data`
(`DATABASE_URL=/data/team-games.sqlite`). None of this has been verified on Fly yet.

> **WARNING: run exactly ONE machine.** Always deploy with `--ha=false`.
> Rooms live in memory, so a second machine splits the party: the same room code
> would resolve to two different rooms, and the volume only attaches to one
> machine. `fly.toml` cannot express a maximum machine count, so nothing in the
> config prevents this; check `fly status` shows one machine and never run
> `fly scale count` above 1.

```bash
fly apps create team-games
fly volumes create team_games_data --region sjc --size 1
fly deploy --ha=false
```

Do not use `fly launch`: with an existing `fly.toml` it prompts and may rewrite
the file, dropping comments and the `[[mounts]]` block.

#### Heroku

The repo also carries a `heroku.yml` that builds the same Dockerfile on
Heroku's container stack, so a deploy needs no local Docker:

```bash
heroku login
heroku create <name> --stack container
heroku config:set DATABASE_URL=/tmp/team-games.sqlite
git push heroku main
```

Heroku differs from Fly in two ways that matter here, and neither is fatal for
a one-off game night:

- **No persistent disk.** `/tmp` is wiped on restart, so the SQLite snapshot is
  a within-process crash net only. A dyno restart ends every room — but so does
  losing the websockets, so nothing is actually lost that would have survived.
- **Dynos cycle about once a day**, and an Eco dyno sleeps after 30 minutes
  idle. Sleeping only costs the first player a cold start, since a live game
  keeps the socket busy. A cycle landing inside a 25-minute game is unlikely
  but would end it.

**Never `heroku ps:scale web=2`.** Rooms live in memory; a second dyno makes one
room code resolve to two different rooms.

The app name `team-games` is globally unique on Fly and may be taken. If
`fly apps create` rejects it, pick another name, set `app` in `fly.toml` to
match, and note the URL becomes `https://<name>.fly.dev`.

`min_machines_running = 1` and `auto_stop_machines = "off"` are deliberate:
rooms live in memory, so a machine that stops or suspends mid-game drops them.
