import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from '../App.js'
import { useConnection } from '../store/connection.js'
import { SESSION_KEY } from '../lobby/session.js'
import { asPlayerId } from '@tg/shared'

const STORED = {
  code: 'AB2CD3', roomId: 'room-1', playerId: 'me', playerToken: 'tok-1', displayName: 'Jocelyn',
}
const JOIN_OK = { roomId: 'room-1', playerId: 'me', playerToken: 'tok-1' }

const json = (status: number, body: unknown) =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response)

// Node's own experimental `localStorage` global can shadow jsdom's, so tests
// install an explicit in-memory store; `broken` makes every access throw.
function memoryStorage(broken = false) {
  const m = new Map<string, string>()
  const guard = () => { if (broken) throw new Error('denied') }
  return {
    getItem: (k: string) => { guard(); return m.get(k) ?? null },
    setItem: (k: string, v: string) => { guard(); m.set(k, v) },
    removeItem: (k: string) => { guard(); m.delete(k) },
    clear: () => { guard(); m.clear() },
  }
}

let connect: ReturnType<typeof vi.fn>
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  connect = vi.fn()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  useConnection.setState({
    status: 'idle', phase: 'lobby', view: null, players: [], labels: {},
    hostId: null, hostLine: null, endsAt: null, clockOffset: 0, me: null, connect,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('session persistence', () => {
  it('re-joins with the stored token and never shows the join form', async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify(STORED))
    fetchMock.mockReturnValue(json(200, JOIN_OK))
    render(<App />)
    expect(screen.queryByLabelText(/room code/i)).toBeNull()
    await waitFor(() => expect(connect).toHaveBeenCalledWith('room-1', asPlayerId('me'), 'tok-1'))
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/rooms/AB2CD3/join')
    expect(JSON.parse(init.body)).toEqual({ displayName: 'Jocelyn', playerToken: 'tok-1' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(screen.queryByLabelText(/room code/i)).toBeNull()
  })

  it('clears the session and shows the form when the re-join fails', async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify(STORED))
    fetchMock.mockReturnValue(json(404, { code: 'ROOM_NOT_FOUND' }))
    render(<App />)
    expect(await screen.findByLabelText(/room code/i)).toBeTruthy()
    expect(localStorage.getItem(SESSION_KEY)).toBeNull()
    expect(connect).not.toHaveBeenCalled()
  })

  it.each([
    ['a network failure', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['an HTTP 503 with no body code', () => json(503, {})],
  ])('keeps the session and offers a retry after %s, with no token-less form', async (_n, failure) => {
    localStorage.setItem(SESSION_KEY, JSON.stringify(STORED))
    fetchMock.mockImplementationOnce(failure)
    render(<App />)
    const retry = await screen.findByRole('button', { name: /try again/i })
    expect(screen.queryByLabelText(/room code/i)).toBeNull()
    expect(localStorage.getItem(SESSION_KEY)).not.toBeNull()
    fetchMock.mockReturnValue(json(200, JOIN_OK))
    fireEvent.click(retry)
    await waitFor(() => expect(connect).toHaveBeenCalledWith('room-1', asPlayerId('me'), 'tok-1'))
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body).playerToken).toBe('tok-1')
  })

  it('degrades to the join form when storage throws', async () => {
    vi.stubGlobal('localStorage', memoryStorage(true))
    render(<App />)
    expect(await screen.findByLabelText(/room code/i)).toBeTruthy()
    // joining must still work with a broken store
    fetchMock.mockReturnValue(json(200, JOIN_OK))
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Jocelyn' } })
    fireEvent.change(screen.getByLabelText(/room code/i), { target: { value: 'ab2cd3' } })
    fireEvent.click(screen.getByRole('button', { name: /join game/i }))
    await waitFor(() => expect(connect).toHaveBeenCalled())
  })

  it('treats corrupt stored data as no session', async () => {
    localStorage.setItem(SESSION_KEY, '{not json')
    render(<App />)
    expect(await screen.findByLabelText(/room code/i)).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('stores the session after a successful join', async () => {
    fetchMock.mockReturnValue(json(200, JOIN_OK))
    render(<App />)
    fireEvent.change(await screen.findByLabelText(/your name/i), { target: { value: 'Jocelyn' } })
    fireEvent.change(screen.getByLabelText(/room code/i), { target: { value: 'ab2cd3' } })
    fireEvent.click(screen.getByRole('button', { name: /join game/i }))
    await waitFor(() => expect(connect).toHaveBeenCalled())
    expect(JSON.parse(localStorage.getItem(SESSION_KEY)!)).toMatchObject({
      code: 'AB2CD3', roomId: 'room-1', playerId: 'me', playerToken: 'tok-1',
    })
  })

  it('keeps the session when taken over, and can reclaim it with the token', async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify(STORED))
    fetchMock.mockReturnValue(json(200, JOIN_OK))
    render(<App />)
    await waitFor(() => expect(connect).toHaveBeenCalledTimes(1))
    act(() => useConnection.setState({ status: 'taken-over' }))
    expect(screen.getByText(/another tab/i)).toBeTruthy()
    expect(localStorage.getItem(SESSION_KEY)).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /take it back/i }))
    await waitFor(() => expect(connect).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body).playerToken).toBe('tok-1')
  })

  it('offers retry and leave immediately when the socket is closed with no view', async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify(STORED))
    fetchMock.mockReturnValue(json(200, JOIN_OK))
    render(<App />)
    await waitFor(() => expect(connect).toHaveBeenCalled())
    act(() => useConnection.setState({ status: 'closed' }))
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /leave/i })).toBeTruthy()
  })

  it('offers retry and leave when connecting hangs past the grace period', async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify(STORED))
    fetchMock.mockReturnValue(json(200, JOIN_OK))
    render(<App />)
    await waitFor(() => expect(connect).toHaveBeenCalled())
    act(() => useConnection.setState({ status: 'connecting' }))
    expect(screen.queryByRole('button', { name: /leave/i })).toBeNull()
    await new Promise(r => setTimeout(r, 4100))
    expect(await screen.findByRole('button', { name: /leave/i })).toBeTruthy()
  }, 10_000)

  it('clears the session and returns to the form on an explicit leave', async () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify(STORED))
    fetchMock.mockReturnValue(json(200, JOIN_OK))
    const disconnect = vi.fn()
    render(<App />)
    await waitFor(() => expect(connect).toHaveBeenCalled())
    act(() => useConnection.setState({
      status: 'open', view: { kind: 'lobby', playerCount: 1 }, me: asPlayerId('me'),
      players: [{ id: asPlayerId('me'), displayName: 'Jocelyn', connected: true, joinedAt: 1 }],
      labels: { me: 'Jocelyn' }, hostId: asPlayerId('me'), disconnect,
    }))
    fireEvent.click(screen.getByRole('button', { name: /leave/i }))
    expect(disconnect).toHaveBeenCalled()
    expect(localStorage.getItem(SESSION_KEY)).toBeNull()
    expect(await screen.findByLabelText(/room code/i)).toBeTruthy()
  })
})
