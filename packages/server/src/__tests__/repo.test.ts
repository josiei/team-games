import { beforeEach, describe, expect, it } from 'vitest'
import { createDb, type Db } from '../db/client.js'
import { Repo } from '../db/repo.js'
import { asRoomCode, newId } from '@tg/shared'
import { gameResults, players, rooms } from '../db/schema.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'

let repo: Repo
let db: Db

beforeEach(() => {
  db = createDb(':memory:')
  repo = new Repo(db)
})

describe('ensureDefaultWorkspace', () => {
  it('creates the default workspace once and returns it again after', () => {
    const first = repo.ensureDefaultWorkspace()
    const second = repo.ensureDefaultWorkspace()
    expect(first).toBe(second)
  })
})

describe('rooms', () => {
  it('finds an active room by its code', () => {
    const ws = repo.ensureDefaultWorkspace()
    const code = asRoomCode('AB2CD3')
    repo.createRoom({ workspaceId: ws, code, gameId: 'pumpkin-carve' })
    expect(repo.findActiveRoomByCode(code)?.code).toBe(code)
  })

  it('does not find a room whose code has expired', () => {
    const ws = repo.ensureDefaultWorkspace()
    const code = asRoomCode('AB2CD3')
    repo.createRoom({
      workspaceId: ws, code, gameId: 'pumpkin-carve',
      expiresAt: Date.now() - 1000,
    })
    expect(repo.findActiveRoomByCode(code)).toBeNull()
  })

  it('reports an expired code as not taken, so codes recycle', () => {
    const ws = repo.ensureDefaultWorkspace()
    const code = asRoomCode('AB2CD3')
    repo.createRoom({
      workspaceId: ws, code, gameId: 'pumpkin-carve',
      expiresAt: Date.now() - 1000,
    })
    expect(repo.isCodeTaken(code)).toBe(false)
  })

  it('reports a live code as taken', () => {
    const ws = repo.ensureDefaultWorkspace()
    const code = asRoomCode('AB2CD3')
    repo.createRoom({ workspaceId: ws, code, gameId: 'pumpkin-carve' })
    expect(repo.isCodeTaken(code)).toBe(true)
  })
})

describe('tenancy', () => {
  it('does not return another workspaces players', () => {
    const a = repo.createWorkspace('Team A', 'team-a')
    const b = repo.createWorkspace('Team B', 'team-b')
    const roomA = repo.createRoom({
      workspaceId: a, code: asRoomCode('AAA222'), gameId: 'pumpkin-carve',
    })
    repo.addPlayer({
      workspaceId: a, roomId: roomA.id, displayName: 'Jocelyn', token: newId(),
    })
    expect(repo.listPlayers(a, roomA.id)).toHaveLength(1)
    expect(repo.listPlayers(b, roomA.id)).toHaveLength(0)
  })

  it('does not resolve a player token across workspaces', () => {
    const a = repo.createWorkspace('Team A', 'team-a')
    const b = repo.createWorkspace('Team B', 'team-b')
    const room = repo.createRoom({
      workspaceId: a, code: asRoomCode('AAA222'), gameId: 'pumpkin-carve',
    })
    const token = newId()
    repo.addPlayer({ workspaceId: a, roomId: room.id, displayName: 'Jocelyn', token })
    expect(repo.findPlayerByToken(a, token)).not.toBeNull()
    expect(repo.findPlayerByToken(b, token)).toBeNull()
  })

  it('does not return another workspaces results', () => {
    const a = repo.createWorkspace('Team A', 'team-a')
    const b = repo.createWorkspace('Team B', 'team-b')
    const room = repo.createRoom({
      workspaceId: a, code: asRoomCode('AAA222'), gameId: 'pumpkin-carve',
    })
    repo.saveResult({
      workspaceId: a, roomId: room.id, gameId: 'pumpkin-carve', payload: { ok: true },
    })
    expect(repo.listResults(a)).toHaveLength(1)
    expect(repo.listResults(b)).toHaveLength(0)
  })
})

describe('presence', () => {
  it('flips a players connected flag', () => {
    const ws = repo.ensureDefaultWorkspace()
    const room = repo.createRoom({
      workspaceId: ws, code: asRoomCode('AB2CD3'), gameId: 'pumpkin-carve',
    })
    const player = repo.addPlayer({
      workspaceId: ws, roomId: room.id, displayName: 'Jocelyn', token: newId(),
    })
    repo.setConnected(ws, player.id, false)
    expect(repo.listPlayers(ws, room.id)[0]!.connected).toBe(false)
  })
})

describe('tenancy: writes', () => {
  function twoTenants() {
    const a = repo.createWorkspace('Team A', 'team-a')
    const b = repo.createWorkspace('Team B', 'team-b')
    const roomA = repo.createRoom({
      workspaceId: a, code: asRoomCode('AAA222'), gameId: 'pumpkin-carve',
    })
    const player = repo.addPlayer({
      workspaceId: a, roomId: roomA.id, displayName: 'Jocelyn', token: newId(),
    })
    return { a, b, roomA, player }
  }
  const roomRow = (id: string) => db.select().from(rooms).all().find(r => r.id === id)!

  it('refuses to add a player to a room in another workspace', () => {
    const { b, roomA } = twoTenants()
    expect(() => repo.addPlayer({
      workspaceId: b, roomId: roomA.id, displayName: 'Mallory', token: newId(),
    })).toThrow(/does not exist in workspace/)
    expect(db.select().from(players).all()).toHaveLength(1)
  })

  it('refuses to save a result for a room in another workspace', () => {
    const { b, roomA } = twoTenants()
    expect(() => repo.saveResult({
      workspaceId: b, roomId: roomA.id, gameId: 'pumpkin-carve', payload: {},
    })).toThrow(/does not exist in workspace/)
    expect(db.select().from(gameResults).all()).toHaveLength(0)
  })

  it('does not let another workspace change a room status', () => {
    const { b, roomA } = twoTenants()
    repo.setRoomStatus(b, roomA.id, 'done')
    expect(roomRow(roomA.id).status).toBe('open')
  })

  it('does not let another workspace reassign a room host', () => {
    const { b, roomA, player } = twoTenants()
    repo.setHost(b, roomA.id, player.id)
    expect(roomRow(roomA.id).hostPlayerId).toBeNull()
  })

  it('does not let another workspace change player presence', () => {
    const { a, b, roomA, player } = twoTenants()
    repo.setConnected(b, player.id, false)
    expect(repo.listPlayers(a, roomA.id)[0]!.connected).toBe(true)
  })
})

describe('foreign keys', () => {
  it('rejects a room in a workspace that does not exist', () => {
    expect(() => repo.createRoom({
      workspaceId: 'nope' as never, code: asRoomCode('AAA222'), gameId: 'pumpkin-carve',
    })).toThrow(/FOREIGN KEY/)
  })
})

describe('player avatar and team', () => {
  it('a player is stored with no avatar and no team', () => {
    const ws = repo.ensureDefaultWorkspace()
    const room = repo.createRoom({ workspaceId: ws, code: asRoomCode('AB2CD3'), gameId: 'g' })
    const p = repo.addPlayer({
      workspaceId: ws, roomId: room.id, displayName: 'A', token: newId(),
    })
    const stored = repo.listPlayers(ws, room.id).find(r => r.id === p.id)!
    expect(stored.avatar).toBe('')
    expect(stored.team).toBeNull()
  })

  it('setProfile persists avatar and team', () => {
    const ws = repo.ensureDefaultWorkspace()
    const room = repo.createRoom({ workspaceId: ws, code: asRoomCode('AB2CD3'), gameId: 'g' })
    const p = repo.addPlayer({
      workspaceId: ws, roomId: room.id, displayName: 'A', token: newId(),
    })
    repo.setProfile(ws, p.id, { avatar: 'witch', team: 'red' })
    const stored = repo.listPlayers(ws, room.id).find(r => r.id === p.id)!
    expect(stored.avatar).toBe('witch')
    expect(stored.team).toBe('red')
  })

  it('a database file created before these columns gains them on open', () => {
    // The room_snapshot columns are already migrated this way; the player
    // table now needs the same, or an existing data/ file breaks on boot.
    const dir = mkdtempSync(join(tmpdir(), 'tg-migrate-'))
    const file = join(dir, 'old.sqlite')
    const legacy = new Database(file)
    legacy.exec(`CREATE TABLE player (
      id TEXT PRIMARY KEY, room_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
      display_name TEXT NOT NULL, user_id TEXT, token TEXT NOT NULL,
      connected INTEGER NOT NULL DEFAULT 1, joined_at INTEGER NOT NULL)`)
    legacy.close()

    createDb(file)
    const reopened = new Database(file)
    const cols = (reopened.pragma('table_info(player)') as { name: string }[])
      .map(c => c.name)
    reopened.close()
    rmSync(dir, { recursive: true, force: true })
    expect(cols).toContain('avatar')
    expect(cols).toContain('team')
  })
})
