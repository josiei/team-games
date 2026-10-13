import { describe, expect, it, vi, afterEach } from 'vitest'
import { createDb } from '../db/client.js'
import { Repo } from '../db/repo.js'
import { InMemoryRoomStore } from '../rooms/store.js'
import { RoomRuntime } from '../rooms/runtime.js'
import { restoreRooms } from '../rooms/snapshot.js'
import { pumpkinModule } from '../games/pumpkin/index.js'
import { asRoomCode, newId, type PumpkinState } from '@tg/shared'

afterEach(() => vi.useRealTimers())

function bootRoom(db: ReturnType<typeof createDb>) {
  const repo = new Repo(db)
  const store = new InMemoryRoomStore()
  const workspaceId = repo.ensureDefaultWorkspace()
  const row = repo.createRoom({
    workspaceId, code: asRoomCode('AB2CD3'), gameId: 'pumpkin-carve',
  })
  const room = store.create({
    workspaceId, code: asRoomCode('AB2CD3'), gameId: 'pumpkin-carve', id: row.id,
  })
  for (const name of ['A', 'B']) {
    const player = store.addPlayer(room, { displayName: name, token: newId() })
    repo.addPlayer({
      workspaceId, roomId: room.id, displayName: name, token: player.token, id: player.id,
    })
  }
  const runtime = new RoomRuntime({
    room, store, repo, module: pumpkinModule, send: () => {},
  })
  return { repo, store, room, runtime, workspaceId }
}

const strokes = [{ tool: 'cut' as const, size: 0.2, points: [[0.3, 0.3]] as [number, number][] }]

describe('snapshot persistence', () => {
  it('writes a snapshot when a phase is entered', () => {
    vi.useFakeTimers()
    const db = createDb(':memory:')
    const { repo, runtime } = bootRoom(db)
    runtime.start()
    const rows = repo.loadSnapshots()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.phase).toBe('carving')
    runtime.dispose()
  })

  it('updates rather than duplicating the snapshot on each phase', () => {
    vi.useFakeTimers()
    const db = createDb(':memory:')
    const { repo, runtime } = bootRoom(db)
    runtime.start()
    vi.advanceTimersByTime(180_000)
    const rows = repo.loadSnapshots()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.phase).toBe('vote-scariest')
    runtime.dispose()
  })

  it('restores rooms, phase, and players into a fresh store', () => {
    vi.useFakeTimers()
    const db = createDb(':memory:')
    const first = bootRoom(db)
    first.runtime.start()
    first.runtime.dispose()

    const store = new InMemoryRoomStore()
    const restored = restoreRooms(new Repo(db), store)

    expect(restored).toBe(1)
    const room = store.byCode(asRoomCode('AB2CD3'))!
    expect(room.id).toBe(first.room.id)
    expect(store.get(first.workspaceId, first.room.id)).toBe(room)   // map keyed by the db id
    expect(room.phase).toBe('carving')
    expect(room.players.size).toBe(2)
    expect([...room.players.values()].every(p => !p.connected)).toBe(true)
    expect(room.state).not.toBeNull()
  })

  it('restores the carved strokes a player had already submitted, under the same player', () => {
    vi.useFakeTimers()
    const db = createDb(':memory:')
    const first = bootRoom(db)
    first.runtime.start()
    const playerId = [...first.room.players.keys()][0]!
    first.runtime.dispatch(playerId, { type: 'SUBMIT', strokes })
    first.runtime.dispose()

    const store = new InMemoryRoomStore()
    restoreRooms(new Repo(db), store)
    const room = store.byCode(asRoomCode('AB2CD3'))!
    const state = room.state as {
      pumpkins: Record<string, { strokes: unknown[]; submitted: boolean }>
    }
    expect(room.players.has(playerId)).toBe(true)
    expect(state.pumpkins[playerId]!.submitted).toBe(true)
    expect(state.pumpkins[playerId]!.strokes).toEqual(strokes)
    const other = [...first.room.players.keys()][1]!
    expect(state.pumpkins[other]!.submitted).toBe(false)
  })

  it('keeps participants as participants, and spectators as spectators, when restoring mid-carve', () => {
    vi.useFakeTimers()
    const db = createDb(':memory:')
    const first = bootRoom(db)
    first.runtime.start()
    // A late joiner arrives mid-carve and is a spectator.
    const late = first.store.addPlayer(first.room, { displayName: 'Late', token: newId() })
    first.repo.addPlayer({
      workspaceId: first.workspaceId, roomId: first.room.id,
      displayName: 'Late', token: late.token, id: late.id,
    })
    expect(late.spectator).toBe(true)
    const originals = [...first.room.players.keys()].filter(id => id !== late.id)
    first.runtime.dispatch(originals[0]!, { type: 'SUBMIT', strokes })
    first.runtime.dispose()

    const store = new InMemoryRoomStore()
    restoreRooms(new Repo(db), store)
    const room = store.byCode(asRoomCode('AB2CD3'))!
    expect(store.participants(room).map(p => p.id).sort()).toEqual([...originals].sort())
    expect(room.players.get(late.id)!.spectator).toBe(true)
    for (const id of originals) {
      expect((pumpkinModule.viewFor(room.state as PumpkinState, id) as { kind: string }).kind)
        .not.toBe('spectator')
    }
    expect((pumpkinModule.viewFor(room.state as PumpkinState, late.id) as { kind: string }).kind)
      .toBe('spectator')
  })

  it('does not restore expired rooms', () => {
    vi.useFakeTimers()
    const db = createDb(':memory:')
    const first = bootRoom(db)
    first.runtime.start()
    first.runtime.dispose()
    vi.setSystemTime(Date.now() + 13 * 60 * 60 * 1000)
    expect(restoreRooms(new Repo(db), new InMemoryRoomStore())).toBe(0)
  })

  it('restores nothing when there are no snapshots', () => {
    expect(restoreRooms(new Repo(createDb(':memory:')), new InMemoryRoomStore())).toBe(0)
  })
})
