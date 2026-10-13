import { beforeEach, describe, expect, it } from 'vitest'
import { createDb } from '../db/client.js'
import { Repo } from '../db/repo.js'
import { asRoomCode, newId } from '@tg/shared'

let repo: Repo

beforeEach(() => {
  repo = new Repo(createDb(':memory:'))
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
