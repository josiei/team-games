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

/**
 * Live room state. Deliberately holds no sockets: the transport layer keeps
 * its own socket map, so swapping this store is a contained change.
 */
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
  addPlayer(room: LiveRoom, input: { displayName: string; token: string }): RoomPlayer
  setConnected(room: LiveRoom, playerId: PlayerId, connected: boolean): void
  /** Everyone who was present when the game started, in join order. */
  participants(room: LiveRoom): RoomPlayer[]
  /** Host moves to the longest-connected player; null only if nobody is connected. */
  reassignHostIfNeeded(room: LiveRoom): void
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
    // Strictly increasing within a room: two joins in the same millisecond must
    // still have a defined order, or "longest-connected" falls to a random id.
    let latest = 0
    for (const p of room.players.values()) latest = Math.max(latest, p.joinedAt)
    const player: RoomPlayer = {
      id: asPlayerId(newId()),
      displayName: input.displayName,
      connected: true,
      joinedAt: Math.max(Date.now(), latest + 1),
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
