import {
  asPlayerId, asRoomId, newId,
  type Player, type PlayerId, type RoomCode, type RoomId, type WorkspaceId,
} from '@tg/shared'

// Note: Player.joinedAt is a monotonic ordering key, not a wall-clock
// timestamp. Never display it or expire on it.
export type RoomPlayer = Player & { token: string; spectator: boolean }

export type RoomConfig = { phaseMs: Record<string, number> }

const FALLBACK_CARVE_MS = 180_000
const FALLBACK_VOTE_MS = 15_000
/** setTimeout cannot take more than a signed 32-bit int. */
const MAX_TIMER_MS = 2 ** 31 - 1

function envMs(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback
  const n = Number(value)
  return Number.isInteger(n) && n > 0 && n <= MAX_TIMER_MS ? n : fallback
}

/**
 * Phase timings, tunable per deploy without a code change: CARVE_MS for the
 * carving phase and VOTE_MS for each of the four vote phases. Unset or invalid
 * values fall back to 180_000 / 15_000.
 */
export function roomConfigFromEnv(env: Record<string, string | undefined> = process.env): RoomConfig {
  const carve = envMs(env.CARVE_MS, FALLBACK_CARVE_MS)
  const vote = envMs(env.VOTE_MS, FALLBACK_VOTE_MS)
  return {
    phaseMs: {
      carving: carve,
      'vote-scariest': vote,
      'vote-funniest': vote,
      'vote-craft': vote,
      'vote-cursed': vote,
    },
  }
}

export const DEFAULT_ROOM_CONFIG: RoomConfig = roomConfigFromEnv()

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
  /**
   * Set only by restoreRooms: the persisted phase deadline, consumed by
   * RoomRuntime.resume(). undefined for rooms that were not restored.
   */
  restoredEndsAt?: number | null
}

export interface RoomStore {
  create(input: {
    workspaceId: WorkspaceId; code: RoomCode; gameId: string; config?: RoomConfig
    /** Register the room under this id (e.g. the database row's id). */
    id?: RoomId
  }): LiveRoom
  get(workspaceId: WorkspaceId, roomId: RoomId): LiveRoom | null
  byCode(code: RoomCode): LiveRoom | null
  remove(workspaceId: WorkspaceId, roomId: RoomId): void
  all(): LiveRoom[]
  addPlayer(room: LiveRoom, input: { displayName: string; token: string }): RoomPlayer
  setConnected(room: LiveRoom, playerId: PlayerId, connected: boolean): void
  /** Lobby profile. An omitted field is left as it was; `team: null` clears it. */
  setProfile(
    room: LiveRoom, playerId: PlayerId,
    patch: { avatar?: string; team?: string | null },
  ): void
  /** Everyone who was present when the game started, in join order. */
  participants(room: LiveRoom): RoomPlayer[]
  /** Host moves to the longest-connected player; null only if nobody is connected. */
  reassignHostIfNeeded(room: LiveRoom): void
}

export class InMemoryRoomStore implements RoomStore {
  private readonly rooms = new Map<RoomId, LiveRoom>()

  create(input: {
    workspaceId: WorkspaceId; code: RoomCode; gameId: string; config?: RoomConfig
    /** Register the room under this id (e.g. the database row's id). */
    id?: RoomId
  }): LiveRoom {
    const room: LiveRoom = {
      id: input.id ?? asRoomId(newId()),
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
      avatar: '',
      team: null,
    }
    room.players.set(player.id, player)
    if (!room.hostId) this.reassignHostIfNeeded(room)
    return player
  }

  setConnected(room: LiveRoom, playerId: PlayerId, connected: boolean): void {
    const player = room.players.get(playerId)
    if (player) player.connected = connected
  }

  setProfile(
    room: LiveRoom, playerId: PlayerId,
    patch: { avatar?: string; team?: string | null },
  ): void {
    const player = room.players.get(playerId)
    if (!player) return
    if (patch.avatar !== undefined) player.avatar = patch.avatar
    if (patch.team !== undefined) player.team = patch.team
  }

  /** Participants are everyone who was present when the game started. */
  participants(room: LiveRoom): RoomPlayer[] {
    return [...room.players.values()]
      .filter(p => !p.spectator)
      .sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id))
  }

  /**
   * A sleeping host must not stall the room. Preference order: earliest-joined
   * connected participant, then earliest-joined connected spectator (someone
   * present must be able to act), then null.
   */
  reassignHostIfNeeded(room: LiveRoom): void {
    const current = room.hostId ? room.players.get(room.hostId) : undefined
    if (current?.connected) return
    const connected = [...room.players.values()]
      .filter(p => p.connected)
      .sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id))
    const next = connected.find(p => !p.spectator) ?? connected[0]
    room.hostId = next?.id ?? null
  }
}
