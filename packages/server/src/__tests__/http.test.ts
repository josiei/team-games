import { beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../app.js'
import { InMemoryRoomStore } from '../rooms/store.js'
import { Repo } from '../db/repo.js'
import { RoomRuntime } from '../rooms/runtime.js'
import { getGame } from '../games/registry.js'
import { createDb } from '../db/client.js'
import { asRoomCode } from '@tg/shared'

let app: FastifyInstance
let store: InMemoryRoomStore
let repo: Repo

beforeEach(async () => {
  store = new InMemoryRoomStore()
  repo = new Repo(createDb(':memory:'))
  app = buildApp({
    repo,
    store,
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

  it('carries a thumbnail for every game, so the picker is never half-empty', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/games' })
    const games = res.json() as { id: string; thumbnail?: string }[]
    expect(games.length).toBeGreaterThan(0)
    for (const game of games) expect(game.thumbnail).toMatch(/^\/games\/.+/)
  })

  it('lists no teams for a game that declares none', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/games' })
    const pumpkin = (res.json() as { id: string; teams?: unknown[] }[])
      .find(g => g.id === 'pumpkin-carve')!
    expect(pumpkin.teams).toBeUndefined()
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
  it('persists the store\'s monotonic joinedAt, not a second Date.now()', async () => {
    const { code, roomId } = await createRoom()
    const live = store.byCode(asRoomCode(code))!
    for (const name of ['Sam', 'Sam', 'Sam']) await join(code, name)
    const rows = repo.listPlayersByRoom(roomId as never)
    expect(rows).toHaveLength(3)
    const stamps = [...live.players.values()].map(p => p.joinedAt)
    expect(new Set(stamps).size).toBe(3)            // strictly ordered, even in one ms
    for (const row of rows) expect(row.joinedAt).toBe(live.players.get(row.id as never)!.joinedAt)
  })

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

describe('POST /api/rooms/:code/join with playerToken (idempotent re-join)', () => {
  type Creds = { roomId: string; playerId: string; playerToken: string }
  const rejoin = (code: string, playerToken: string, displayName = 'Jocelyn') =>
    app.inject({
      method: 'POST', url: `/api/rooms/${code}/join`, payload: { displayName, playerToken },
    })

  it('returns the same player for a valid token and adds nobody', async () => {
    const { code } = await createRoom()
    const first = (await join(code, 'Host')).json() as Creds
    await join(code, 'Other')
    const live = store.byCode(code as never)!
    const joinedAt = live.players.get(first.playerId as never)!.joinedAt

    const res = await rejoin(code, first.playerToken)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(first)
    expect(live.players.size).toBe(2)
    expect(live.players.get(first.playerId as never)!.joinedAt).toBe(joinedAt)
    expect(live.hostId).toBe(first.playerId)
  })

  it('does not change the host when a non-host re-joins', async () => {
    const { code } = await createRoom()
    const host = (await join(code, 'Host')).json() as Creds
    const other = (await join(code, 'Other')).json() as Creds
    await rejoin(code, other.playerToken)
    expect(store.byCode(code as never)!.hostId).toBe(host.playerId)
  })

  it('still re-joins when the room is full', async () => {
    const { code } = await createRoom()
    const first = (await join(code, 'p0')).json() as Creds
    for (let i = 1; i < 16; i++) await join(code, `p${i}`)
    const res = await rejoin(code, first.playerToken)
    expect(res.statusCode).toBe(200)
    expect((res.json() as Creds).playerId).toBe(first.playerId)
  })

  it('creates a new player when the token is bogus', async () => {
    const { code } = await createRoom()
    const first = (await join(code, 'Host')).json() as Creds
    const res = await rejoin(code, 'bogus-token')
    expect(res.statusCode).toBe(200)
    const body = res.json() as Creds
    expect(body.playerId).not.toBe(first.playerId)
    expect(body.playerToken).not.toBe('bogus-token')
    expect(store.byCode(code as never)!.players.size).toBe(2)
  })

  it('does not resolve a token that belongs to a different room', async () => {
    const a = await createRoom()
    const b = await createRoom()
    const inA = (await join(a.code, 'Alice')).json() as Creds
    const res = await rejoin(b.code, inA.playerToken, 'Alice')
    expect(res.statusCode).toBe(200)
    const body = res.json() as Creds
    expect(body.roomId).toBe(b.roomId)
    expect(body.playerId).not.toBe(inA.playerId)
    expect(body.playerToken).not.toBe(inA.playerToken)
    expect(store.byCode(a.code as never)!.players.size).toBe(1)
    expect(store.byCode(b.code as never)!.players.size).toBe(1)
  })
})

describe('id consistency between memory and database', () => {
  it('registers the room in the store under the database row id', async () => {
    const { code, roomId } = await createRoom()
    const ws = repo.ensureDefaultWorkspace()
    expect(repo.findActiveRoomByCode(code as never)!.id).toBe(roomId)
    expect(store.get(ws, roomId as never)).not.toBeNull()
    expect(store.get(ws, roomId as never)!.code).toBe(code)
    store.remove(ws, roomId as never)
    expect(store.get(ws, roomId as never)).toBeNull()
    expect(store.byCode(code as never)).toBeNull()
  })

  it('gives the database player row the store player id', async () => {
    const { code } = await createRoom()
    const ws = repo.ensureDefaultWorkspace()
    const p = (await join(code, 'Host')).json() as { playerId: string; playerToken: string }
    const row = repo.findPlayerByToken(ws, p.playerToken)
    expect(row!.id).toBe(p.playerId)
  })

  it('lets repo.setConnected with that id update the row', async () => {
    const { code, roomId } = await createRoom()
    const ws = repo.ensureDefaultWorkspace()
    const p = (await join(code, 'Host')).json() as { playerId: string }
    repo.setConnected(ws, p.playerId as never, false)
    const row = repo.listPlayers(ws, roomId as never).find(r => r.id === p.playerId)
    expect(row!.connected).toBe(false)
  })
})

describe('robustness', () => {
  it('does not report a disposed, unstarted room as ALREADY_STARTED', async () => {
    const runtimes = new Map()
    const localStore = new InMemoryRoomStore()
    const local = buildApp({ repo, store: localStore, runtimes })
    const created = (await local.inject({
      method: 'POST', url: '/api/rooms', payload: { gameId: 'pumpkin-carve' },
    })).json() as { code: string; roomId: string }
    const j = (n: string) => local.inject({
      method: 'POST', url: `/api/rooms/${created.code}/join`, payload: { displayName: n },
    })
    const host = (await j('Host')).json() as { playerToken: string }
    await j('Other')
    const live = localStore.byCode(created.code as never)!
    const rt = new RoomRuntime({
      room: live, store: localStore, repo, module: getGame('pumpkin-carve')!, send: () => {},
    })
    rt.dispose()
    runtimes.set(live.id, rt)
    const res = await local.inject({
      method: 'POST', url: `/api/rooms/${created.code}/start`,
      payload: { playerToken: host.playerToken },
    })
    expect(res.statusCode).toBe(500)
  })

  it('returns 409 ALREADY_STARTED on a second start', async () => {
    const { code } = await createRoom()
    const host = (await join(code, 'Host')).json() as { playerToken: string }
    await join(code, 'Other')
    const start = () => app.inject({
      method: 'POST', url: `/api/rooms/${code}/start`,
      payload: { playerToken: host.playerToken },
    })
    expect((await start()).statusCode).toBe(200)
    const again = await start()
    expect(again.statusCode).toBe(409)
    expect(again.json()).toMatchObject({ code: 'ALREADY_STARTED' })
  })

  it('returns 400 for a non-string displayName', async () => {
    const { code } = await createRoom()
    const res = await app.inject({
      method: 'POST', url: `/api/rooms/${code}/join`, payload: { displayName: 42 },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /api/rooms/:code/me', () => {
  const setProfile = async (code: string, payload: Record<string, unknown>) =>
    await app.inject({ method: 'POST', url: `/api/rooms/${code}/me`, payload })

  it('stores a chosen avatar on the live player and in the database', async () => {
    const room = await createRoom()
    const { playerId, playerToken } = (await join(room.code, 'Jocelyn')).json()
    const res = await setProfile(room.code, { playerToken, avatar: 'vampire' })
    expect(res.statusCode).toBe(200)

    const live = store.byCode(asRoomCode(room.code))!
    expect(live.players.get(playerId)!.avatar).toBe('vampire')
    const stored = repo.listPlayers(live.workspaceId, live.id).find(p => p.id === playerId)!
    expect(stored.avatar).toBe('vampire')
  })

  it('rejects an unknown room code with ROOM_NOT_FOUND', async () => {
    const res = await setProfile('ZZ9ZZ9', { playerToken: 'nope', avatar: 'ghost' })
    expect(res.statusCode).toBe(404)
    expect(res.json().code).toBe('ROOM_NOT_FOUND')
  })

  it('rejects an unknown playerToken with NOT_A_PLAYER', async () => {
    const room = await createRoom()
    await join(room.code, 'Jocelyn')
    const res = await setProfile(room.code, { playerToken: 'not-a-token', avatar: 'ghost' })
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('NOT_A_PLAYER')
  })

  it('rejects a profile change after the game has started with ALREADY_STARTED', async () => {
    const room = await createRoom()
    const host = (await join(room.code, 'Jocelyn')).json()
    await join(room.code, 'Sam')
    await app.inject({
      method: 'POST', url: `/api/rooms/${room.code}/start`,
      payload: { playerToken: host.playerToken },
    })
    const res = await setProfile(room.code, { playerToken: host.playerToken, avatar: 'bat' })
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('ALREADY_STARTED')
  })

  // An unchecked string here renders in every other player's lobby.
  it('rejects an avatar id that is not in AVATARS with BAD_AVATAR', async () => {
    const room = await createRoom()
    const { playerId, playerToken } = (await join(room.code, 'Jocelyn')).json()
    const res = await setProfile(room.code, { playerToken, avatar: '<img src=x>' })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('BAD_AVATAR')
    expect(store.byCode(asRoomCode(room.code))!.players.get(playerId)!.avatar).toBe('')
  })

  it('rejects a team the selected game does not declare with BAD_TEAM', async () => {
    // pumpkin-carve declares no teams at all, so every team id is wrong for it.
    const room = await createRoom()
    const { playerId, playerToken } = (await join(room.code, 'Jocelyn')).json()
    const res = await setProfile(room.code, { playerToken, team: 'blue' })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('BAD_TEAM')
    expect(store.byCode(asRoomCode(room.code))!.players.get(playerId)!.team).toBeNull()
  })

  it('allows team: null, which clears the team', async () => {
    const room = await createRoom()
    const { playerId, playerToken } = (await join(room.code, 'Jocelyn')).json()
    const res = await setProfile(room.code, { playerToken, team: null })
    expect(res.statusCode).toBe(200)
    expect(store.byCode(asRoomCode(room.code))!.players.get(playerId)!.team).toBeNull()
  })
})

// Deferred from Tasks 4 and 5: both needed a registered game that declares
// teams and a registered game that is hidden.
describe('a game that declares teams', () => {
  const createFright = async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/rooms', payload: { gameId: 'fright-night-dev' },
    })
    return res.json() as { code: string; roomId: string }
  }

  it('GET /api/games omits a module marked hidden', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/games' })
    const ids = (res.json() as { id: string }[]).map(g => g.id)
    expect(ids).toContain('pumpkin-carve')
    expect(ids).not.toContain('fright-night-dev')
  })

  it('accepts a team the game declares', async () => {
    const room = await createFright()
    const { playerId, playerToken } = (await join(room.code, 'Jocelyn')).json()
    const res = await app.inject({
      method: 'POST', url: `/api/rooms/${room.code}/me`,
      payload: { playerToken, team: 'blue', avatar: 'vampire' },
    })
    expect(res.statusCode).toBe(200)
    const live = store.byCode(asRoomCode(room.code))!
    expect(live.players.get(playerId)).toMatchObject({ team: 'blue', avatar: 'vampire' })
  })

  it('still rejects a team it does not declare', async () => {
    const room = await createFright()
    const { playerToken } = (await join(room.code, 'Jocelyn')).json()
    const res = await app.inject({
      method: 'POST', url: `/api/rooms/${room.code}/me`,
      payload: { playerToken, team: 'green' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('BAD_TEAM')
  })
})
