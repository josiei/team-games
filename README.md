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
