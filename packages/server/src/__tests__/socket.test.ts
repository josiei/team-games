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
let transport: ReturnType<typeof attachSocketServer>
let sockets: WebSocket[] = []
const inboxes = new Map<WebSocket, ServerMessage[]>()
const waiters = new Map<WebSocket, (m: ServerMessage) => void>()

beforeEach(async () => {
  store = new InMemoryRoomStore()
  // One repo and one runtimes map, shared by the routes and the transport.
  // Two Repo instances on separate in-memory databases would let the runtime
  // write presence to a database that has none of the joined players.
  const deps = { repo: new Repo(createDb(':memory:')), store, runtimes: new Map() }
  app = buildApp(deps)
  transport = attachSocketServer(app, deps)
  Object.assign(deps, { send: transport.sendTo })
  await app.listen({ port: 0, host: '127.0.0.1' })
  port = (app.server.address() as { port: number }).port
})

afterEach(async () => {
  for (const s of sockets) s.terminate()
  sockets = []
  inboxes.clear()
  waiters.clear()
  await transport.close()
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
  // Buffer from the first frame: the server sends its snapshot during the
  // upgrade, which can land before a test attaches a listener after 'open'.
  const inbox: ServerMessage[] = []
  inboxes.set(ws, inbox)
  ws.on('message', raw => {
    const msg = JSON.parse(String(raw)) as ServerMessage
    const waiter = waiters.get(ws)
    if (waiter) { waiters.delete(ws); waiter(msg) } else inbox.push(msg)
  })
  return ws
}

const nextMessage = (ws: WebSocket) =>
  new Promise<ServerMessage>(resolve => {
    const queued = inboxes.get(ws)?.shift()
    if (queued) resolve(queued)
    else waiters.set(ws, resolve)
  })

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

async function joinAs(roomId: string, name: string) {
  const room = store.all().find(r => r.id === roomId)!
  const res = await app.inject({
    method: 'POST', url: `/api/rooms/${room.code}/join`, payload: { displayName: name },
  })
  return res.json() as { roomId: string; playerId: string; playerToken: string }
}

const open = (ws: WebSocket) => new Promise(r => ws.once('open', r))
const settle = () => new Promise(r => setTimeout(r, 40))

describe('presence and host handoff', () => {
  it('marks a reconnecting player connected again (HTTP re-join does not)', async () => {
    const { roomId, playerToken, playerId } = await seed()
    await joinAs(roomId, 'Second')
    const first = connect(roomId, playerToken)
    await open(first)
    first.close()
    await closed(first)
    await settle()
    const room = store.all()[0]!
    expect(room.players.get(playerId as never)?.connected).toBe(false)

    await app.inject({
      method: 'POST', url: `/api/rooms/${room.code}/join`, payload: { playerToken },
    })
    expect(room.players.get(playerId as never)?.connected).toBe(false)

    const again = connect(roomId, playerToken)
    await open(again)
    await nextMessage(again)
    expect(room.players.get(playerId as never)?.connected).toBe(true)
  })

  it('reassigns the host when the host disconnects in the lobby', async () => {
    const host = await seed()
    const second = await joinAs(host.roomId, 'Second')
    const room = store.all()[0]!
    expect(room.hostId).toBe(host.playerId)
    expect(store.all()[0]!.state).toBeNull()  // still a lobby

    const hostWs = connect(host.roomId, host.playerToken)
    const secondWs = connect(host.roomId, second.playerToken)
    await Promise.all([open(hostWs), open(secondWs)])
    await settle()
    hostWs.close()
    await closed(hostWs)
    await settle()

    expect(room.players.get(host.playerId as never)?.connected).toBe(false)
    expect(room.hostId).toBe(second.playerId)
  })

  it('does not let a message body choose who acts', async () => {
    const { roomId, playerToken } = await seed()
    const ws = connect(roomId, playerToken)
    await open(ws)
    await nextMessage(ws)
    ws.send(JSON.stringify({ type: 'action', by: 'someone-else', payload: { type: 'NOPE' } }))
    await settle()
    expect(ws.readyState).toBe(WebSocket.OPEN)
  })
})
