import { and, eq, gt } from 'drizzle-orm'
import {
  asWorkspaceId, newId,
  type PlayerId, type RoomCode, type RoomId, type WorkspaceId,
} from '@tg/shared'
import type { Db } from './client.js'
import { gameResults, players, rooms, workspaces } from './schema.js'

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

  addPlayer(input: {
    workspaceId: WorkspaceId; roomId: RoomId; displayName: string; token: string
  }): PlayerRow {
    const row = {
      id: newId(),
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
}
