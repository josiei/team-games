import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useConnection } from '../store/connection.js'
import { asPlayerId } from '@tg/shared'

const ME = asPlayerId('me')

class FakeSocket {
  static OPEN = 1
  static instances: FakeSocket[] = []
  readyState = 0
  closed = false
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e: { code: number }) => void) | null = null
  constructor(public url: string) { FakeSocket.instances.push(this) }
  close() { this.closed = true }
  open() { this.readyState = 1; this.onopen?.() }
  // The browser fires close asynchronously; tests fire it explicitly.
  fireClose(code = 1006) { this.onclose?.({ code }) }
}

const live = () => FakeSocket.instances.filter(s => !s.closed)
const connect = () => useConnection.getState().connect('ROOM', ME, 'tok')

beforeEach(() => {
  vi.useFakeTimers()
  FakeSocket.instances = []
  vi.stubGlobal('WebSocket', FakeSocket)
  useConnection.getState().disconnect()   // resets module-level state
  useConnection.setState({ status: 'idle' })
})

afterEach(() => {
  useConnection.getState().disconnect()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('reconnect', () => {
  it('close code 4001 is terminal: no retry, distinct status', () => {
    connect()
    FakeSocket.instances[0]!.open()
    FakeSocket.instances[0]!.fireClose(4001)
    expect(useConnection.getState().status).toBe('taken-over')
    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.instances).toHaveLength(1)
  })

  it('any other close schedules a retry and reconnects', () => {
    connect()
    FakeSocket.instances[0]!.open()
    FakeSocket.instances[0]!.fireClose(1006)
    expect(useConnection.getState().status).toBe('reconnecting')
    expect(FakeSocket.instances).toHaveLength(1)
    vi.advanceTimersByTime(10_000)
    expect(FakeSocket.instances).toHaveLength(2)
  })

  it('never gives up and caps the delay at 10s', () => {
    connect()
    for (let i = 0; i < 12; i++) {
      FakeSocket.instances.at(-1)!.fireClose(1006)
      vi.advanceTimersByTime(10_000)
    }
    expect(FakeSocket.instances).toHaveLength(13)
  })

  it('resets the backoff after a successful open', () => {
    connect()
    FakeSocket.instances[0]!.fireClose(1006)   // attempt 0 -> 300ms
    vi.advanceTimersByTime(300)
    FakeSocket.instances[1]!.fireClose(1006)   // attempt 1 -> 600ms
    vi.advanceTimersByTime(600)
    FakeSocket.instances[2]!.open()            // success resets
    FakeSocket.instances[2]!.fireClose(1006)   // back to 300ms
    vi.advanceTimersByTime(300)
    expect(FakeSocket.instances).toHaveLength(4)
  })

  it('disconnect() cancels a pending retry', () => {
    connect()
    FakeSocket.instances[0]!.fireClose(1006)
    useConnection.getState().disconnect()
    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.instances).toHaveLength(1)
    expect(useConnection.getState().status).toBe('closed')
  })

  it('a fresh connect after disconnect starts with no stale backoff', () => {
    connect()
    FakeSocket.instances[0]!.fireClose(1006)
    useConnection.getState().disconnect()
    connect()
    expect(useConnection.getState().status).toBe('connecting')
  })

  it('two closes do not leak a retry timer', () => {
    connect()
    const first = FakeSocket.instances[0]!
    first.fireClose(1006)
    first.fireClose(1006)   // duplicate close from the same socket is ignored
    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.instances).toHaveLength(2)
  })
})

describe('stale sockets', () => {
  it('disconnect() then connect() with a late stale close leaves exactly one live socket', () => {
    connect()
    const old = FakeSocket.instances[0]!
    old.open()
    useConnection.getState().disconnect()
    connect()
    const fresh = FakeSocket.instances[1]!
    old.fireClose(1005)   // the old socket's async close arrives late
    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.instances).toHaveLength(2)
    expect(live()).toEqual([fresh])
    expect(useConnection.getState().status).toBe('connecting')
  })

  it('connect() closes any existing socket', () => {
    connect()
    connect()
    expect(FakeSocket.instances[0]!.closed).toBe(true)
    expect(live()).toHaveLength(1)
  })

  it('ignores open and message events from a stale socket', () => {
    connect()
    const old = FakeSocket.instances[0]!
    connect()
    old.open()
    old.onmessage?.({ data: JSON.stringify({ type: 'host', line: 'stale' }) })
    expect(useConnection.getState().status).toBe('connecting')
    expect(useConnection.getState().hostLine).toBeNull()
  })
})
