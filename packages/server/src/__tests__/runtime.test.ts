import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InMemoryRoomStore } from '../rooms/store.js'
import { RoomRuntime } from '../rooms/runtime.js'
import { pumpkinModule } from '../games/pumpkin/index.js'
import { createDb } from '../db/client.js'
import { Repo } from '../db/repo.js'
import { asRoomCode, newId, type ServerMessage, type PlayerId } from '@tg/shared'

let store: InMemoryRoomStore
let repo: Repo
let sent: { to: PlayerId; message: ServerMessage }[]
let runtime: RoomRuntime
let ids: PlayerId[]

beforeEach(() => {
  vi.useFakeTimers()
  store = new InMemoryRoomStore()
  repo = new Repo(createDb(':memory:'))
  sent = []

  const ws = repo.ensureDefaultWorkspace()
  const room = store.create({
    workspaceId: ws, code: asRoomCode('AB2CD3'), gameId: 'pumpkin-carve',
  })
  // saveResult requires the room to exist in the DB under its workspace, so
  // adopt the persisted row's id (the store and repo each mint their own).
  room.id = repo.createRoom({ workspaceId: ws, code: room.code, gameId: room.gameId }).id
  ids = ['A', 'B', 'C'].map(n =>
    store.addPlayer(room, { displayName: n, token: newId() }).id)

  runtime = new RoomRuntime({
    room, store, repo, module: pumpkinModule,
    send: (to, message) => sent.push({ to, message }),
  })
})

afterEach(() => { runtime.dispose(); vi.useRealTimers() })

const strokes = [{ tool: 'cut' as const, size: 0.1, points: [[0.5, 0.5]] as [number, number][] }]

describe('start', () => {
  it('enters the carving phase', () => {
    runtime.start()
    expect(runtime.phase).toBe('carving')
  })

  it('sends every player a snapshot', () => {
    runtime.start()
    const recipients = new Set(
      sent.filter(s => s.message.type === 'snapshot').map(s => s.to))
    for (const id of ids) expect(recipients).toContain(id)
  })

  it('sends the snapshot before the timer, so the deadline is not wiped', () => {
    runtime.start()
    const firstSnapshot = sent.findIndex(s => s.message.type === 'snapshot')
    const firstTimer = sent.findIndex(s => s.message.type === 'timer')
    expect(firstSnapshot).toBeLessThan(firstTimer)
  })

  it('sends an absolute deadline rather than a tick stream', () => {
    runtime.start()
    const timers = sent.filter(s => s.message.type === 'timer')
    expect(timers.length).toBe(ids.length)
    const timer = timers[0]!.message as Extract<ServerMessage, { type: 'timer' }>
    expect(timer.endsAt).toBeGreaterThan(timer.serverNow)
    expect(timer.endsAt - timer.serverNow).toBe(180_000)
  })

  it('sends a host line', () => {
    runtime.start()
    expect(sent.some(s => s.message.type === 'host')).toBe(true)
  })

  it('refuses to start twice', () => {
    runtime.start()
    expect(() => runtime.start()).toThrow(/already started/i)
  })
})

describe('phase advance', () => {
  it('moves to the first vote phase when the carve timer fires', () => {
    runtime.start()
    vi.advanceTimersByTime(180_000)
    expect(runtime.phase).toBe('vote-scariest')
  })

  it('walks all four award phases then lands on results', () => {
    runtime.start()
    vi.advanceTimersByTime(180_000)
    for (let i = 0; i < 4; i++) vi.advanceTimersByTime(15_000)
    expect(runtime.phase).toBe('results')
  })

  it('sets no timer on the terminal phase', () => {
    runtime.start()
    vi.advanceTimersByTime(180_000 + 4 * 15_000)
    const before = runtime.phase
    vi.advanceTimersByTime(600_000)
    expect(runtime.phase).toBe(before)
  })

  it('persists a result when it reaches results', () => {
    const ws = repo.ensureDefaultWorkspace()
    runtime.start()
    vi.advanceTimersByTime(180_000 + 4 * 15_000)
    expect(repo.listResults(ws)).toHaveLength(1)
  })
})

describe('early exit', () => {
  it('ends carving as soon as every connected player has submitted', () => {
    runtime.start()
    for (const id of ids) runtime.dispatch(id, { type: 'SUBMIT', strokes })
    expect(runtime.phase).toBe('vote-scariest')
  })

  it('does not wait on a disconnected player', () => {
    runtime.start()
    runtime.onDisconnect(ids[2]!)
    runtime.dispatch(ids[0]!, { type: 'SUBMIT', strokes })
    runtime.dispatch(ids[1]!, { type: 'SUBMIT', strokes })
    expect(runtime.phase).toBe('vote-scariest')
  })

  it('re-checks on disconnect when the last holdout leaves', () => {
    runtime.start()
    runtime.dispatch(ids[0]!, { type: 'SUBMIT', strokes })
    runtime.dispatch(ids[1]!, { type: 'SUBMIT', strokes })
    expect(runtime.phase).toBe('carving')
    runtime.onDisconnect(ids[2]!)
    expect(runtime.phase).toBe('vote-scariest')
  })

  it('keeps waiting while someone connected has not submitted', () => {
    runtime.start()
    runtime.dispatch(ids[0]!, { type: 'SUBMIT', strokes })
    expect(runtime.phase).toBe('carving')
  })
})

describe('dispatch', () => {
  it('ignores a malformed action without throwing', () => {
    runtime.start()
    expect(() => runtime.dispatch(ids[0]!, { type: 'NONSENSE' })).not.toThrow()
    expect(() => runtime.dispatch(ids[0]!, null)).not.toThrow()
    expect(runtime.phase).toBe('carving')
  })

  it('attributes the action to the authenticated player, not the payload', () => {
    runtime.start()
    runtime.dispatch(ids[0]!, { type: 'SUBMIT', strokes, by: ids[1]! })
    const snap = runtime.snapshotFor(ids[1]!) as Extract<ServerMessage, { type: 'snapshot' }>
    expect((snap.view as { submitted: boolean }).submitted).toBe(false)
  })

  it('saves a DRAFT without broadcasting anything', () => {
    runtime.start()
    sent.length = 0
    runtime.dispatch(ids[0]!, { type: 'DRAFT', strokes })
    expect(sent).toHaveLength(0)
    const snap = runtime.snapshotFor(ids[0]!) as Extract<ServerMessage, { type: 'snapshot' }>
    expect((snap.view as { myStrokes: unknown[] }).myStrokes).toHaveLength(1)
  })
})

describe('snapshotFor', () => {
  it('includes disambiguated player labels', () => {
    const room = store.all()[0]!
    runtime.start()
    const dup = store.addPlayer(room, { displayName: 'A', token: newId() })
    const snap = runtime.snapshotFor(ids[0]!) as Extract<ServerMessage, { type: 'snapshot' }>
    expect(Object.values(snap.labels)).toContain('A (2)')
    expect(dup.spectator).toBe(true)
  })

  it('names the current host', () => {
    runtime.start()
    const snap = runtime.snapshotFor(ids[0]!) as Extract<ServerMessage, { type: 'snapshot' }>
    expect(snap.hostId).toBe(ids[0]!)
  })

  it('does not leak carver identities before results', () => {
    runtime.start()
    vi.advanceTimersByTime(180_000)
    const snap = runtime.snapshotFor(ids[0]!) as Extract<ServerMessage, { type: 'snapshot' }>
    expect(snap.view).not.toHaveProperty('carvers')
    expect(JSON.stringify(snap.view)).not.toContain(ids[1]!)
  })

  it('gives a late joiner no slot', () => {
    const room = store.all()[0]!
    runtime.start()
    const late = store.addPlayer(room, { displayName: 'Late', token: newId() })
    const snap = runtime.snapshotFor(late.id) as Extract<ServerMessage, { type: 'snapshot' }>
    expect((snap.view as { kind: string }).kind).toBe('spectator')
  })
})
