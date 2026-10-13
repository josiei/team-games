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
    const live = store.create({ workspaceId, code, gameId: game.id, id: row.id })

    return { code, roomId: live.id }
  })

  app.post('/api/rooms/:code/join', async (request, reply) => {
    const code = normalizeCode((request.params as { code: string }).code)
    const { displayName: rawName, playerToken } =
      (request.body ?? {}) as { displayName?: unknown; playerToken?: unknown }

    const live = store.byCode(code)
    if (!live) return reply.code(404).send({ code: 'ROOM_NOT_FOUND' })

    // Idempotent re-join (e.g. a browser refresh): a token that resolves to a
    // player already in THIS room returns that player unchanged. Tokens from
    // other rooms never match because we only search this room's players.
    if (typeof playerToken === 'string' && playerToken.length > 0) {
      const existing = [...live.players.values()].find(p => p.token === playerToken)
      if (existing) {
        return { roomId: live.id, playerId: existing.id, playerToken: existing.token }
      }
    }

    const displayName = typeof rawName === 'string' ? rawName.trim() : ''
    if (displayName.length === 0) return reply.code(400).send({ code: 'NAME_REQUIRED' })
    if (displayName.length > MAX_DISPLAY_NAME) {
      return reply.code(400).send({ code: 'NAME_TOO_LONG' })
    }

    const game = getGame(live.gameId)!
    if (live.players.size >= game.maxPlayers) {
      return reply.code(409).send({ code: 'ROOM_FULL' })
    }

    const token = newId()
    const hostBefore = live.hostId
    const player = store.addPlayer(live, { displayName, token })
    // Same id in both stores: runtime presence updates and a restart rebuild
    // key everything by the store player id.
    repo.addPlayer({
      workspaceId: live.workspaceId, roomId: live.id, displayName, token, id: player.id,
    })
    if (live.hostId !== hostBefore) {
      repo.setHost(live.workspaceId, live.id, live.hostId)
    }

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

    // Reject before creating anything: a restored room (state present, runtime
    // not started) is in progress, and a runtime left in the map unresumed
    // would have no clock and ignore all input.
    if (live.state !== null || runtimes.get(live.id)?.hasStarted) {
      return reply.code(409).send({ code: 'ALREADY_STARTED' })
    }

    let runtime = runtimes.get(live.id)
    if (!runtime) {
      runtime = new RoomRuntime({
        room: live, store, repo, module: game,
        send: (to, message) => deps.send?.(to, message),
      })
      runtimes.set(live.id, runtime)
    }
    // Genuine failures (disposed room, failed phase entry) surface as 500.
    runtime.start()
    return { ok: true }
  })
}
