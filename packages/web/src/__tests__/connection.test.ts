import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backoffMs, remainingMs, useConnection } from '../store/connection.js'
import { asPlayerId } from '@tg/shared'

const ME = asPlayerId('me')

beforeEach(() => {
  useConnection.setState({
    status: 'idle', phase: 'lobby', view: null, players: [], labels: {},
    hostId: null, hostLine: null, endsAt: null, clockOffset: 0, me: ME,
  })
})

afterEach(() => { vi.useRealTimers() })

describe('remainingMs', () => {
  it('counts down from an absolute deadline', () => {
    expect(remainingMs(10_000, 0, 4_000)).toBe(6_000)
  })

  it('never goes negative', () => {
    expect(remainingMs(10_000, 0, 99_000)).toBe(0)
  })

  it('corrects for a client clock running ahead of the server', () => {
    // client is 5s ahead: endsAt is server time, so subtract the offset
    expect(remainingMs(10_000, 5_000, 9_000)).toBe(6_000)
  })

  it('corrects for a client clock running behind the server', () => {
    expect(remainingMs(10_000, -5_000, -1_000)).toBe(6_000)
  })

  it('returns 0 when there is no deadline', () => {
    expect(remainingMs(null, 0, 1_000)).toBe(0)
  })
})

describe('backoffMs', () => {
  it('starts fast so a brief blip is invisible', () => {
    expect(backoffMs(0)).toBeLessThanOrEqual(500)
  })

  it('grows with each attempt', () => {
    expect(backoffMs(3)).toBeGreaterThan(backoffMs(1))
  })

  it('caps so it never gives up on a long outage', () => {
    expect(backoffMs(50)).toBeLessThanOrEqual(10_000)
  })
})

describe('applyMessage', () => {
  const snapshot = (over: Record<string, unknown> = {}) => ({
    type: 'snapshot' as const, phase: 'carving', view: { kind: 'carving' },
    players: [{
      id: ME, displayName: 'Me', connected: true, joinedAt: 1, avatar: '', team: null,
    }],
    labels: { me: 'Me' }, hostId: ME, endsAt: null, serverNow: 0,
    ...over,
  })

  it('applies a snapshot', () => {
    useConnection.getState().applyMessage(snapshot())
    const s = useConnection.getState()
    expect(s.phase).toBe('carving')
    expect(s.players).toHaveLength(1)
    expect(s.hostId).toBe(ME)
  })

  it('computes clock offset from a snapshot', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(1_000_000))
    useConnection.getState().applyMessage(snapshot({ endsAt: 1_180_000, serverNow: 990_000 }))
    // client is 10s ahead of server
    expect(useConnection.getState().clockOffset).toBe(10_000)
  })

  it('sets the deadline from a snapshot that carries one', () => {
    useConnection.getState().applyMessage(snapshot({ endsAt: 1_180_000, serverNow: 990_000 }))
    expect(useConnection.getState().endsAt).toBe(1_180_000)
  })

  it('yields a null deadline from a snapshot with endsAt null', () => {
    useConnection.setState({ endsAt: 123 })
    useConnection.getState().applyMessage(snapshot({
      phase: 'results', view: { kind: 'results' }, players: [], labels: {}, hostId: null,
    }))
    expect(useConnection.getState().endsAt).toBeNull()
  })

  it('stores the latest host line', () => {
    useConnection.getState().applyMessage({ type: 'host', line: 'Three minutes.' })
    expect(useConnection.getState().hostLine).toBe('Three minutes.')
  })

  it('ignores an unknown message type without clearing state', () => {
    useConnection.setState({ phase: 'carving' })
    // @ts-expect-error deliberately invalid
    useConnection.getState().applyMessage({ type: 'who-knows' })
    expect(useConnection.getState().phase).toBe('carving')
  })
})

describe('a room that is gone', () => {
  /** A WebSocket stand-in we can close with a chosen code. */
  class FakeSocket {
    static OPEN = 1
    readyState = 1
    onopen: (() => void) | null = null
    onmessage: ((e: { data: string }) => void) | null = null
    onclose: ((e: { code: number }) => void) | null = null
    close() { /* the test drives onclose directly */ }
    send() { /* no-op */ }
  }

  let sockets: FakeSocket[]

  beforeEach(() => {
    sockets = []
    vi.stubGlobal('WebSocket', class extends FakeSocket {
      constructor() { super(); sockets.push(this) }
    })
    vi.useFakeTimers()
  })

  afterEach(() => { vi.unstubAllGlobals(); useConnection.getState().disconnect() })

  it('stops retrying when the server says the room is gone', () => {
    // Rooms live in memory, so a server restart takes every room with it.
    // Retrying forever leaves the last snapshot on screen looking alive.
    useConnection.getState().connect('room-1', ME, 'tok')
    expect(sockets).toHaveLength(1)
    sockets[0]!.onclose!({ code: 4004 })

    expect(useConnection.getState().status).toBe('room-gone')
    vi.advanceTimersByTime(60_000)
    expect(sockets).toHaveLength(1)          // never dialled again
  })

  it('stops retrying when the token is not recognised', () => {
    useConnection.getState().connect('room-1', ME, 'tok')
    sockets[0]!.onclose!({ code: 4003 })
    expect(useConnection.getState().status).toBe('room-gone')
    vi.advanceTimersByTime(60_000)
    expect(sockets).toHaveLength(1)
  })

  it('still retries an ordinary drop, which is usually transient', () => {
    useConnection.getState().connect('room-1', ME, 'tok')
    sockets[0]!.onclose!({ code: 1006 })
    expect(useConnection.getState().status).toBe('reconnecting')
    vi.advanceTimersByTime(60_000)
    expect(sockets.length).toBeGreaterThan(1)
  })
})
