import { and, eq, gt } from 'drizzle-orm'
import {
  asWorkspaceId, newId,
  type PlayerId, type RoomCode, type RoomId, type WorkspaceId,
} from '@tg/shared'
import type { Db } from './client.js'
import { gameResults, players, roomSnapshots, rooms, workspaces } from './schema.js'

const ROOM_TTL_MS = 12 * 60 * 60 * 1000
export const DEFAULT_WORKSPACE_SLUG = 'default'

export type RoomRow = {
  id: RoomId; workspaceId: WorkspaceId; code: RoomCode; gameId: string
  status: 'open' | 'playing' | 'done'; hostPlayerId: PlayerId | null
  createdAt: number; expiresAt: number
}

export type PlayerRow = {
  id: PlayerId; roomId: RoomId; workspaceId: WorkspaceId
  displayName: string; token: string; connected: boolean; joinedAt: number
}

export type GameResultRow = {
  id: string; roomId: RoomId; workspaceId: WorkspaceId
  gameId: string; payload: unknown; createdAt: number
}

export type SnapshotRow = {
  roomId: RoomId; workspaceId: WorkspaceId; phase: string
  state: unknown; participants: PlayerId[] | null; endsAt: number | null; updatedAt: number
}

export class Repo {
  constructor(private readonly db: Db) {}

  createWorkspace(name: string, slug: string): WorkspaceId {
    const id = newId()
    this.db.insert(workspaces)
      .values({ id, name, slug, plan: 'free', createdAt: Date.now() }).run()
    return asWorkspaceId(id)
  }

  ensureDefaultWorkspace(): WorkspaceId {
    const existing = this.db.select().from(workspaces)
      .where(eq(workspaces.slug, DEFAULT_WORKSPACE_SLUG)).get()
    if (existing) return asWorkspaceId(existing.id)
    return this.createWorkspace('Default', DEFAULT_WORKSPACE_SLUG)
  }

  /**
   * Caller must check isCodeTaken first: room_code_idx is non-unique and
   * nothing in the schema stops two live rooms sharing a code. (SQLite cannot
   * express "live" as a partial unique index, since expiresAt > now is not
   * immutable.)
   */
  createRoom(input: {
    workspaceId: WorkspaceId; code: RoomCode; gameId: string; expiresAt?: number
  }): RoomRow {
    const row = {
      id: newId(),
      workspaceId: input.workspaceId,
      code: input.code,
      gameId: input.gameId,
      status: 'open' as const,
      hostPlayerId: null,
      createdAt: Date.now(),
      expiresAt: input.expiresAt ?? Date.now() + ROOM_TTL_MS,
    }
    this.db.insert(rooms).values(row).run()
    return row as RoomRow
  }

  /** Codes are global for joining — the room carries the workspace. */
  findActiveRoomByCode(code: RoomCode): RoomRow | null {
    const row = this.db.select().from(rooms)
      .where(and(eq(rooms.code, code), gt(rooms.expiresAt, Date.now())))
      .get()
    return (row as RoomRow | undefined) ?? null
  }

  isCodeTaken(code: RoomCode): boolean {
    return this.findActiveRoomByCode(code) !== null
  }

  setRoomStatus(workspaceId: WorkspaceId, roomId: RoomId, status: RoomRow['status']) {
    this.db.update(rooms).set({ status })
      .where(and(eq(rooms.workspaceId, workspaceId), eq(rooms.id, roomId))).run()
  }

  setHost(workspaceId: WorkspaceId, roomId: RoomId, hostPlayerId: PlayerId | null) {
    this.db.update(rooms).set({ hostPlayerId })
      .where(and(eq(rooms.workspaceId, workspaceId), eq(rooms.id, roomId))).run()
  }

  /** Throws unless the room exists inside this workspace. Guards the write path. */
  private requireRoom(workspaceId: WorkspaceId, roomId: RoomId): void {
    const room = this.db.select({ id: rooms.id }).from(rooms)
      .where(and(eq(rooms.workspaceId, workspaceId), eq(rooms.id, roomId)))
      .get()
    if (!room) {
      throw new Error(`room ${roomId} does not exist in workspace ${workspaceId}`)
    }
  }

  addPlayer(input: {
    workspaceId: WorkspaceId; roomId: RoomId; displayName: string; token: string
    /** Share the id of the live-room player so both stores agree on identity. */
    id?: PlayerId
  }): PlayerRow {
    this.requireRoom(input.workspaceId, input.roomId)
    const row = {
      id: input.id ?? newId(),
      roomId: input.roomId,
      workspaceId: input.workspaceId,
      displayName: input.displayName,
      userId: null,
      token: input.token,
      connected: true,
      joinedAt: Date.now(),
    }
    this.db.insert(players).values(row).run()
    return row as unknown as PlayerRow
  }

  findPlayerByToken(workspaceId: WorkspaceId, token: string): PlayerRow | null {
    const row = this.db.select().from(players)
      .where(and(eq(players.workspaceId, workspaceId), eq(players.token, token)))
      .get()
    return (row as PlayerRow | undefined) ?? null
  }

  listPlayers(workspaceId: WorkspaceId, roomId: RoomId): PlayerRow[] {
    return this.db.select().from(players)
      .where(and(eq(players.workspaceId, workspaceId), eq(players.roomId, roomId)))
      .all() as unknown as PlayerRow[]
  }

  setConnected(workspaceId: WorkspaceId, playerId: PlayerId, connected: boolean) {
    this.db.update(players).set({ connected })
      .where(and(eq(players.workspaceId, workspaceId), eq(players.id, playerId))).run()
  }

  saveResult(input: {
    workspaceId: WorkspaceId; roomId: RoomId; gameId: string; payload: unknown
  }) {
    this.requireRoom(input.workspaceId, input.roomId)
    this.db.insert(gameResults).values({
      id: newId(),
      roomId: input.roomId,
      workspaceId: input.workspaceId,
      gameId: input.gameId,
      payload: input.payload,
      createdAt: Date.now(),
    }).run()
  }

  listResults(workspaceId: WorkspaceId): GameResultRow[] {
    return this.db.select().from(gameResults)
      .where(eq(gameResults.workspaceId, workspaceId))
      .all() as unknown as GameResultRow[]
  }

  /** One row per room: repeated saves update in place. */
  saveSnapshot(input: {
    workspaceId: WorkspaceId; roomId: RoomId; phase: string; state: unknown
    /** Ids of players who were participants (not spectators). */
    participants?: PlayerId[]
    /** Phase deadline, epoch ms; null when the phase is untimed. */
    endsAt?: number | null
  }): void {
    const now = Date.now()
    const participants = input.participants ?? null
    const endsAt = input.endsAt ?? null
    this.db.insert(roomSnapshots).values({
      roomId: input.roomId,
      workspaceId: input.workspaceId,
      phase: input.phase,
      state: input.state,
      participants,
      endsAt,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: roomSnapshots.roomId,
      set: { phase: input.phase, state: input.state, participants, endsAt, updatedAt: now },
    }).run()
  }

  // loadSnapshots, listRooms and listPlayersByRoom are the deliberate
  // exceptions to the workspace-scoping rule: they run only at boot (via
  // restoreRooms), before any request has a workspace context, and each row
  // carries its own workspaceId, which is what gets loaded into the store.
  // They must never be called from a route.
  loadSnapshots(): SnapshotRow[] {
    return this.db.select().from(roomSnapshots).all() as unknown as SnapshotRow[]
  }

  listRooms(): RoomRow[] {
    return this.db.select().from(rooms)
      .where(gt(rooms.expiresAt, Date.now())).all() as RoomRow[]
  }

  listPlayersByRoom(roomId: RoomId): PlayerRow[] {
    return this.db.select().from(players)
      .where(eq(players.roomId, roomId)).all() as unknown as PlayerRow[]
  }
}
