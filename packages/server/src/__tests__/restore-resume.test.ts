import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { buildApp } from '../app.js'
import { attachSocketServer } from '../transport/socket.js'
import { InMemoryRoomStore } from '../rooms/store.js'
import { RoomRuntime } from '../rooms/runtime.js'
import { restoreRooms } from '../rooms/snapshot.js'
import { pumpkinModule } from '../games/pumpkin/index.js'
import { Repo } from '../db/repo.js'
import { createDb } from '../db/client.js'
import { asRoomCode, newId, type RoomId } from '@tg/shared'
import type { FastifyInstance } from 'fastify'

// Real timers throughout: the deadline is a few hundred ms out, so a live
// clock shows up as the phase genuinely advancing.
let app: FastifyInstance
let transport: ReturnType<typeof attachSocketServer>
let sockets: WebSocket[] = []

afterEach(async () => {
  for (const s of sockets) s.terminate()
  sockets = []
  await transport?.close()
  await app?.close()
})

/** Run a game to mid-carve, "crash", and boot a fresh server over the same db. */
async function restartedServer(msLeft: number) {
  const db = createDb(':memory:')
  const repo = new Repo(db)
  const oldStore = new InMemoryRoomStore()
  const workspaceId = repo.ensureDefaultWorkspace()
  const row = repo.createRoom({ workspaceId, code: asRoomCode('AB2CD3'), gameId: 'pumpkin-carve' })
  const old = oldStore.create({
    workspaceId, code: row.code, gameId: row.gameId, id: row.id,
  })
  const tokens: string[] = []
  for (const name of ['A', 'B']) {
    const p = oldStore.addPlayer(old, { displayName: name, token: newId() })
    repo.addPlayer({ workspaceId, roomId: old.id, displayName: name, token: p.token, id: p.id })
    tokens.push(p.token)
  }
  repo.setHost(workspaceId, old.id, old.hostId)
  const runtime = new RoomRuntime({
    room: old, store: oldStore, repo, module: pumpkinModule, send: () => {},
  })
  runtime.start()
  runtime.dispose()
  repo.saveSnapshot({
    workspaceId, roomId: old.id, phase: 'carving', state: old.state,
    participants: [...old.players.keys()], endsAt: Date.now() + msLeft,
  })

  const store = new InMemoryRoomStore()
  expect(restoreRooms(repo, store)).toBe(1)
  const deps = { repo, store, runtimes: new Map<RoomId, RoomRuntime>() }
  app = buildApp(deps)
  transport = attachSocketServer(app, deps)
  Object.assign(deps, { send: transport.sendTo })
  await app.listen({ port: 0, host: '127.0.0.1' })
  const port = (app.server.address() as { port: number }).port
  const room = store.byCode(row.code)!
  const hostToken = room.players.get(room.hostId!)!.token
  const connect = (token: string) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${room.id}&token=${token}`)
    sockets.push(ws)
    return new Promise<WebSocket>((res, rej) => { ws.once('open', () => res(ws)); ws.once('error', rej) })
  }
  return { room, deps, hostToken, tokens, connect }
}

async function until(cond: () => boolean, ms = 3000) {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting for condition')
    await new Promise(r => setTimeout(r, 20))
  }
}

describe('a restored room gets its clock back', () => {
  it('via a plain socket connect (runtimeFor path)', async () => {
    const { room, tokens, connect } = await restartedServer(300)
    await connect(tokens[0]!)
    await until(() => room.phase === 'vote-scariest')
  })

  it('after /start was refused with 409, a socket connect still starts the clock', async () => {
    const { room, deps, hostToken, connect } = await restartedServer(300)
    const res = await app.inject({
      method: 'POST', url: `/api/rooms/${room.code}/start`, payload: { playerToken: hostToken },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({ code: 'ALREADY_STARTED' })
    expect(deps.runtimes.size).toBe(0)       // nothing left behind
    expect(room.phase).toBe('carving')

    await connect(hostToken)
    expect(deps.runtimes.get(room.id)!.hasStarted).toBe(true)
    await until(() => room.phase === 'vote-scariest')
  })

  it('resumes an unresumed runtime already sitting in the map', async () => {
    const { room, deps, tokens, connect } = await restartedServer(300)
    deps.runtimes.set(room.id, new RoomRuntime({
      room, store: deps.store, repo: deps.repo, module: pumpkinModule, send: () => {},
    }))
    await connect(tokens[0]!)
    expect(deps.runtimes.get(room.id)!.hasStarted).toBe(true)
    await until(() => room.phase === 'vote-scariest')
  })
})

describe('restore keeps player profiles', () => {
  it('a restored room keeps each player avatar and team', () => {
    const repo = new Repo(createDb(':memory:'))
    const first = new InMemoryRoomStore()
    const workspaceId = repo.ensureDefaultWorkspace()
    const row = repo.createRoom({
      workspaceId, code: asRoomCode('AB2CD3'), gameId: 'pumpkin-carve',
    })
    const room = first.create({
      workspaceId, code: row.code, gameId: row.gameId, id: row.id,
    })
    const a = first.addPlayer(room, { displayName: 'A', token: newId() })
    const b = first.addPlayer(room, { displayName: 'B', token: newId() })
    for (const p of [a, b]) {
      repo.addPlayer({
        workspaceId, roomId: room.id, displayName: p.displayName,
        token: p.token, id: p.id, joinedAt: p.joinedAt,
      })
    }
    first.setProfile(room, a.id, { avatar: 'vampire', team: 'blue' })
    repo.setProfile(workspaceId, a.id, { avatar: 'vampire', team: 'blue' })
    first.setProfile(room, b.id, { avatar: 'pumpkin', team: 'red' })
    repo.setProfile(workspaceId, b.id, { avatar: 'pumpkin', team: 'red' })
    repo.saveSnapshot({
      workspaceId, roomId: room.id, phase: 'carving', state: {},
      participants: [a.id, b.id], endsAt: null,
    })

    const store = new InMemoryRoomStore()
    expect(restoreRooms(repo, store)).toBe(1)
    const restored = store.byCode(asRoomCode('AB2CD3'))!
    expect(restored.players.get(a.id)).toMatchObject({ avatar: 'vampire', team: 'blue' })
    expect(restored.players.get(b.id)).toMatchObject({ avatar: 'pumpkin', team: 'red' })
  })
})
