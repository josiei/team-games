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

describe('resume after restore', () => {
  /** Crash mid-carve with the deadline `leftMs` away, then restore into a fresh store. */
  function crashAndRestore(leftMs: number) {
    vi.useFakeTimers()
    const db = createDb(':memory:')
    const first = bootRoom(db)
    first.runtime.start()
    const playerId = [...first.room.players.keys()][0]!
    first.runtime.dispatch(playerId, { type: 'SUBMIT', strokes })
    first.runtime.dispose()
    // Move the saved deadline: 180s phase, so rewrite it to the wanted offset.
    first.repo.saveSnapshot({
      workspaceId: first.workspaceId, roomId: first.room.id, phase: 'carving',
      state: first.room.state, participants: [...first.room.players.keys()],
      endsAt: Date.now() + leftMs,
    })
    const store = new InMemoryRoomStore()
    const repo = new Repo(db)
    restoreRooms(repo, store)
    const room = store.byCode(asRoomCode('AB2CD3'))!
    const sent: unknown[] = []
    const runtime = new RoomRuntime({
      room, store, repo, module: pumpkinModule, send: (_to, m) => sent.push(m),
    })
    return { room, runtime, sent, playerId, store }
  }

  it('persists the phase deadline with the snapshot', () => {
    vi.useFakeTimers()
    const first = bootRoom(createDb(':memory:'))
    first.runtime.start()
    expect(first.repo.loadSnapshots()[0]!.endsAt).toBe(Date.now() + 180_000)
    first.runtime.dispose()
  })

  it('ends the phase when it originally would have', () => {
    const { room, runtime } = crashAndRestore(60_000)
    runtime.resume()
    expect(runtime.hasStarted).toBe(true)
    vi.advanceTimersByTime(59_000)
    expect(room.phase).toBe('carving')
    vi.advanceTimersByTime(1_000)
    expect(room.phase).toBe('vote-scariest')
    runtime.dispose()
  })

  it('advances immediately when the deadline passed during the outage', () => {
    const { room, runtime } = crashAndRestore(-5_000)
    runtime.resume()
    expect(room.phase).toBe('vote-scariest')
    runtime.dispose()
  })

  // The process can die in the 700ms between the last submit and the advance.
  // Nobody is going to dispatch again, so unless coming back re-checks, the
  // restored room sits on a finished phase for the rest of its clock.
  it('moves on once the room is back, when the phase finished during the outage', () => {
    vi.useFakeTimers()
    const db = createDb(':memory:')
    const first = bootRoom(db)
    first.runtime.start()
    const playerIds = [...first.room.players.keys()]
    for (const id of playerIds) first.runtime.dispatch(id, { type: 'SUBMIT', strokes })
    first.runtime.dispose()          // the beat dies with the process

    const store = new InMemoryRoomStore()
    const repo = new Repo(db)
    restoreRooms(repo, store)
    const room = store.byCode(asRoomCode('AB2CD3'))!
    const runtime = new RoomRuntime({ room, store, repo, module: pumpkinModule, send: () => {} })
    runtime.resume()
    expect(room.phase).toBe('carving')      // nobody is back yet

    // The rule waits on whoever is here, so the first player back is enough:
    // the phase really was finished, and everyone else reconnects into voting.
    runtime.onConnect(playerIds[0]!)
    vi.advanceTimersByTime(1_000)
    expect(room.phase).toBe('vote-scariest')
    runtime.dispose()
  })

  it('does not move on for a player who comes back still unfinished', () => {
    // Only the first player submitted before the crash.
    const { room, runtime } = crashAndRestore(60_000)
    runtime.resume()
    const unfinished = [...room.players.keys()][1]!
    runtime.onConnect(unfinished)
    vi.advanceTimersByTime(1_000)
    expect(room.phase).toBe('carving')
    runtime.dispose()
  })

  it('does not arm a second timer when resumed twice', () => {
    const { runtime } = crashAndRestore(60_000)
    runtime.resume()
    const timers = vi.getTimerCount()
    runtime.resume()
    expect(vi.getTimerCount()).toBe(timers)
    expect(timers).toBe(1)
    runtime.dispose()
  })

  it('sends clients the remaining time, not a stale or null deadline', () => {
    const { runtime, sent, playerId } = crashAndRestore(60_000)
    runtime.resume()
    const snap = runtime.snapshotFor(playerId) as { endsAt: number | null; serverNow: number }
    expect(snap.endsAt).toBe(Date.now() + 60_000)
    expect(snap.endsAt! - snap.serverNow).toBe(60_000)
    expect(sent).toEqual([])   // resume itself is silent; onConnect broadcasts
    runtime.dispose()
  })

  it('does nothing for a room that was never started', () => {
    vi.useFakeTimers()
    const { runtime } = bootRoom(createDb(':memory:'))
    runtime.resume()
    expect(runtime.hasStarted).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('resume clamps the remaining time', () => {
  it('never arms longer than the configured phase, even if the clock moved back', () => {
    vi.useFakeTimers()
    const db = createDb(':memory:')
    const first = bootRoom(db)
    first.runtime.start()
    first.runtime.dispose()
    first.repo.saveSnapshot({
      workspaceId: first.workspaceId, roomId: first.room.id, phase: 'carving',
      state: first.room.state, participants: [...first.room.players.keys()],
      endsAt: Date.now() + 10 * 24 * 60 * 60 * 1000,   // absurd: ~10 days out
    })
    const store = new InMemoryRoomStore()
    const repo = new Repo(db)
    restoreRooms(repo, store)
    const room = store.byCode(asRoomCode('AB2CD3'))!
    const runtime = new RoomRuntime({ room, store, repo, module: pumpkinModule, send: () => {} })
    runtime.resume()
    vi.advanceTimersByTime(179_999)
    expect(room.phase).toBe('carving')
    vi.advanceTimersByTime(1)
    expect(room.phase).toBe('vote-scariest')
    runtime.dispose()
  })
})
