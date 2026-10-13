import { WebSocketServer, WebSocket } from 'ws'
import type { FastifyInstance } from 'fastify'
import { asRoomId, type ClientMessage, type PlayerId, type RoomId, type ServerMessage } from '@tg/shared'
import { RoomRuntime } from '../rooms/runtime.js'
import { getGame } from '../games/registry.js'
import type { AppDeps } from '../http/rooms.js'

const CLOSE_REPLACED = 4001
const CLOSE_BAD_TOKEN = 4003
const CLOSE_NO_ROOM = 4004

// Largest legitimate frame is a carve stroke list. A quantized 10k-point list
// is ~120 KB and an unquantized one ~400 KB, so 1 MiB leaves headroom for both
// while still bounding a hostile client: anything larger is rejected at the
// protocol level instead of being buffered.
export const MAX_PAYLOAD = 1024 * 1024
export const HEARTBEAT_MS = 30_000

export function attachSocketServer(
  app: FastifyInstance, deps: AppDeps, options: { heartbeatMs?: number } = {},
) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD })
  const alive = new WeakMap<WebSocket, boolean>()

  // A silent socket (carving sends nothing) gets dropped by idle proxies.
  // Ping each socket; one that has not answered the previous ping is dead.
  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (alive.get(client) === false) { client.terminate(); continue }
      alive.set(client, false)
      try { client.ping() } catch { client.terminate() }
    }
  }, options.heartbeatMs ?? HEARTBEAT_MS)
  heartbeat.unref()
  const live = new Map<PlayerId, WebSocket>()

  const sendTo = (playerId: PlayerId, message: ServerMessage) => {
    const socket = live.get(playerId)
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
  }

  // Created on demand, including in the lobby, so a host who leaves before
  // starting still goes through runtime.onDisconnect and hands the room over.
  function runtimeFor(roomId: RoomId): RoomRuntime | null {
    const room = deps.store.all().find(r => r.id === roomId)
    const existing = deps.runtimes.get(roomId)
    if (existing) {
      // Idempotent: covers a runtime that got into the map without being resumed.
      if (room && room.state !== null && !existing.hasStarted) existing.resume()
      return existing
    }
    if (!room) return null
    const game = getGame(room.gameId)
    if (!game) return null
    const runtime = new RoomRuntime({
      room, store: deps.store, repo: deps.repo, module: game, send: sendTo,
    })
    deps.runtimes.set(roomId, runtime)
    // A room restored from a snapshot carries state but has no running clock.
    if (room.state !== null) runtime.resume()
    return runtime
  }

  app.server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (url.pathname !== '/ws') { socket.destroy(); return }

    wss.handleUpgrade(request, socket, head, ws => {
      alive.set(ws, true)
      ws.on('pong', () => alive.set(ws, true))
      // Without a listener, ws rethrows 'error' as an uncaught exception and a
      // single bad frame would kill every game on the process.
      ws.on('error', error => {
        console.error(`[ws] socket error (room ${url.searchParams.get('room')}):`, error)
        try { ws.close(1011, 'error') } catch { ws.terminate() }
      })

      const roomId = asRoomId(url.searchParams.get('room') ?? '')
      const token = url.searchParams.get('token') ?? ''

      const room = deps.store.all().find(r => r.id === roomId)
      if (!room) return ws.close(CLOSE_NO_ROOM, 'room not found')

      const player = [...room.players.values()].find(p => p.token === token)
      if (!player) return ws.close(CLOSE_BAD_TOKEN, 'bad token')

      // One token, one live socket. A second tab replaces the first rather
      // than producing a duplicate presence entry.
      const previous = live.get(player.id)
      live.set(player.id, ws)
      if (previous && previous !== ws) previous.close(CLOSE_REPLACED, 'replaced')

      // The transport alone owns presence: an HTTP re-join never calls onConnect.
      const runtime = runtimeFor(roomId)
      if (runtime) runtime.onConnect(player.id)   // broadcasts, so this socket gets its snapshot
      else sendTo(player.id, { type: 'error', code: 'NO_RUNTIME', message: '' })

      ws.on('message', raw => {
        if (live.get(player.id) !== ws) return
        let parsed: ClientMessage
        try { parsed = JSON.parse(String(raw)) as ClientMessage } catch { return }
        if (parsed?.type !== 'action') return
        // `by` is the authenticated socket's player, never anything in the body.
        try { runtime?.dispatch(player.id, parsed.payload) } catch (error) {
          console.error(`[ws ${roomId}] dispatch failed:`, error)
        }
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
    liveCount: () => live.size,
    async close() {
      clearInterval(heartbeat)
      for (const socket of live.values()) socket.terminate()
      live.clear()
      for (const client of wss.clients) client.terminate()
      await new Promise<void>(resolve => wss.close(() => resolve()))
    },
  }
}
