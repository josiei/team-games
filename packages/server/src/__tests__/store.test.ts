import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InMemoryRoomStore, roomConfigFromEnv } from '../rooms/store.js'
import { asRoomCode, asWorkspaceId, newId } from '@tg/shared'

const WS_A = asWorkspaceId('ws-a')
const WS_B = asWorkspaceId('ws-b')
let store: InMemoryRoomStore

beforeEach(() => { store = new InMemoryRoomStore() })

const make = (ws = WS_A, code = 'AB2CD3') =>
  store.create({ workspaceId: ws, code: asRoomCode(code), gameId: 'pumpkin-carve' })

describe('create and get', () => {
  it('starts a room in the lobby phase with no players', () => {
    const room = make()
    expect(room.phase).toBe('lobby')
    expect(room.players.size).toBe(0)
    expect(room.hostId).toBeNull()
  })

  it('finds a room by code', () => {
    const room = make()
    expect(store.byCode(asRoomCode('AB2CD3'))?.id).toBe(room.id)
  })

  it('does not return a room to the wrong workspace', () => {
    const room = make(WS_A)
    expect(store.get(WS_A, room.id)).not.toBeNull()
    expect(store.get(WS_B, room.id)).toBeNull()
  })
})

describe('players', () => {
  it('makes the first joiner the host', () => {
    const room = make()
    const first = store.addPlayer(room, { displayName: 'Jocelyn', token: newId() })
    store.addPlayer(room, { displayName: 'Sam', token: newId() })
    expect(room.hostId).toBe(first.id)
  })

  it('marks a player joining after carving starts as a spectator', () => {
    const room = make()
    store.addPlayer(room, { displayName: 'Early', token: newId() })
    room.phase = 'carving'
    const late = store.addPlayer(room, { displayName: 'Late', token: newId() })
    expect(late.spectator).toBe(true)
  })

  it('does not mark a lobby joiner as a spectator', () => {
    const room = make()
    const early = store.addPlayer(room, { displayName: 'Early', token: newId() })
    expect(early.spectator).toBe(false)
  })

  it('transfers the host to the longest-connected player when the host drops', () => {
    const room = make()
    const first = store.addPlayer(room, { displayName: 'A', token: newId() })
    const second = store.addPlayer(room, { displayName: 'B', token: newId() })
    store.addPlayer(room, { displayName: 'C', token: newId() })
    store.setConnected(room, first.id, false)
    store.reassignHostIfNeeded(room)
    expect(room.hostId).toBe(second.id)
  })

  it('leaves the host alone while they are still connected', () => {
    const room = make()
    const first = store.addPlayer(room, { displayName: 'A', token: newId() })
    store.addPlayer(room, { displayName: 'B', token: newId() })
    store.reassignHostIfNeeded(room)
    expect(room.hostId).toBe(first.id)
  })

  it('clears the host when everyone is disconnected', () => {
    const room = make()
    const only = store.addPlayer(room, { displayName: 'A', token: newId() })
    store.setConnected(room, only.id, false)
    store.reassignHostIfNeeded(room)
    expect(room.hostId).toBeNull()
  })

  it('lists participants in join order, excluding spectators', () => {
    const room = make()
    store.addPlayer(room, { displayName: 'A', token: newId() })
    store.addPlayer(room, { displayName: 'B', token: newId() })
    room.phase = 'carving'
    store.addPlayer(room, { displayName: 'Late', token: newId() })
    expect(store.participants(room).map(p => p.displayName)).toEqual(['A', 'B'])
  })
})

describe('host preference', () => {
  it('falls back to a connected spectator when no participant is connected', () => {
    const room = make()
    const host = store.addPlayer(room, { displayName: 'A', token: newId() })
    room.phase = 'carving'
    const spec = store.addPlayer(room, { displayName: 'S', token: newId() })
    store.setConnected(room, host.id, false)
    store.reassignHostIfNeeded(room)
    expect(room.hostId).toBe(spec.id)
  })

  it('prefers a connected participant over an earlier-joined spectator', () => {
    const room = make()
    const host = store.addPlayer(room, { displayName: 'A', token: newId() })
    room.phase = 'carving'
    const spec = store.addPlayer(room, { displayName: 'S', token: newId() })
    room.phase = 'lobby'
    const part = store.addPlayer(room, { displayName: 'B', token: newId() })
    part.spectator = false
    expect(spec.joinedAt).toBeLessThan(part.joinedAt)
    store.setConnected(room, host.id, false)
    store.reassignHostIfNeeded(room)
    expect(room.hostId).toBe(part.id)
  })

  it('does not hand a headless room to a spectator while a participant is connected', () => {
    const room = make()
    const host = store.addPlayer(room, { displayName: 'A', token: newId() })
    const part = store.addPlayer(room, { displayName: 'B', token: newId() })
    store.setConnected(room, host.id, false)
    room.hostId = null
    room.phase = 'carving'
    store.addPlayer(room, { displayName: 'S', token: newId() })
    expect(room.hostId).toBe(part.id)
  })

  it('lets a spectator take an empty host seat when nobody connected is a participant', () => {
    const room = make()
    const host = store.addPlayer(room, { displayName: 'A', token: newId() })
    store.setConnected(room, host.id, false)
    store.reassignHostIfNeeded(room)
    expect(room.hostId).toBeNull()
    room.phase = 'carving'
    const spec = store.addPlayer(room, { displayName: 'S', token: newId() })
    expect(room.hostId).toBe(spec.id)
  })

  it('leaves hostId null when nobody is connected', () => {
    const room = make()
    const a = store.addPlayer(room, { displayName: 'A', token: newId() })
    room.phase = 'carving'
    const s = store.addPlayer(room, { displayName: 'S', token: newId() })
    store.setConnected(room, a.id, false)
    store.setConnected(room, s.id, false)
    store.reassignHostIfNeeded(room)
    expect(room.hostId).toBeNull()
  })
})

describe('joinedAt ordering key', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })
  const join = (room: ReturnType<typeof make>, n: string) =>
    store.addPlayer(room, { displayName: n, token: newId() }).joinedAt

  it('is strictly increasing under a frozen clock', () => {
    vi.setSystemTime(1_000_000)
    const room = make()
    const times = ['A', 'B', 'C', 'D'].map(n => join(room, n))
    for (let i = 1; i < times.length; i++) expect(times[i]!).toBeGreaterThan(times[i - 1]!)
  })

  it('stays strictly increasing when the clock goes backwards', () => {
    vi.setSystemTime(2_000_000)
    const room = make()
    const first = join(room, 'A')
    vi.setSystemTime(1_000_000)
    const second = join(room, 'B')
    const third = join(room, 'C')
    expect(second).toBeGreaterThan(first)
    expect(third).toBeGreaterThan(second)
  })

  it('is per room, not a shared global counter', () => {
    vi.setSystemTime(1_000_000)
    const r1 = make(WS_A, 'AB2CD3')
    const r2 = make(WS_A, 'EF4GH5')
    join(r1, 'A'); join(r1, 'B'); join(r1, 'C')
    expect(join(r2, 'X')).toBe(1_000_000)
  })
})

describe('roomConfigFromEnv', () => {
  it('defaults to 180s carving and 15s votes', () => {
    const c = roomConfigFromEnv({})
    expect(c.phaseMs).toEqual({
      carving: 180_000, 'vote-scariest': 15_000, 'vote-funniest': 15_000,
      'vote-craft': 15_000, 'vote-cursed': 15_000,
    })
  })

  it('honours CARVE_MS and VOTE_MS', () => {
    const c = roomConfigFromEnv({ CARVE_MS: '60000', VOTE_MS: '20000' })
    expect(c.phaseMs.carving).toBe(60_000)
    for (const p of ['vote-scariest', 'vote-funniest', 'vote-craft', 'vote-cursed']) {
      expect(c.phaseMs[p]).toBe(20_000)
    }
  })

  it('ignores junk, zero, negative and over-large values', () => {
    for (const bad of ['abc', '0', '-5', '1.5', '', '99999999999']) {
      const c = roomConfigFromEnv({ CARVE_MS: bad, VOTE_MS: bad })
      expect(c.phaseMs.carving).toBe(180_000)
      expect(c.phaseMs['vote-craft']).toBe(15_000)
    }
  })
})
