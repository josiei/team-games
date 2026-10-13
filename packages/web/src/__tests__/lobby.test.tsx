import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Lobby } from '../lobby/Lobby.js'
import { JoinScreen } from '../lobby/JoinScreen.js'
import { useConnection } from '../store/connection.js'
import { asPlayerId, asRoomCode } from '@tg/shared'

const ME = asPlayerId('me')
const OTHER = asPlayerId('other')

const player = (id: ReturnType<typeof asPlayerId>, name: string, joinedAt: number) =>
  ({ id, displayName: name, connected: true, joinedAt })

beforeEach(() => {
  useConnection.setState({
    status: 'open', phase: 'lobby', view: { kind: 'lobby', playerCount: 2 },
    players: [player(ME, 'Jocelyn', 1), player(OTHER, 'Sam', 2)],
    labels: { me: 'Jocelyn', other: 'Sam' },
    hostId: ME, hostLine: null, endsAt: null, clockOffset: 0, me: ME,
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('JoinScreen', () => {
  it('disables join until both fields are filled', () => {
    render(<JoinScreen onJoined={() => {}} />)
    const button = screen.getByRole('button', { name: /join/i })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(/room code/i), { target: { value: 'AB2CD3' } })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: 'Jocelyn' } })
    expect((button as HTMLButtonElement).disabled).toBe(false)
  })

  it('uppercases the code as it is typed', () => {
    render(<JoinScreen onJoined={() => {}} />)
    const input = screen.getByLabelText(/room code/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'ab2cd3' } })
    expect(input.value).toBe('AB2CD3')
  })

  it('caps the display name at 24 characters', () => {
    render(<JoinScreen onJoined={() => {}} />)
    const input = screen.getByLabelText(/your name/i) as HTMLInputElement
    expect(input.maxLength).toBe(24)
  })
})

describe('Lobby', () => {
  it('shows the room code prominently', () => {
    render(<Lobby code={asRoomCode('AB2CD3')} playerToken="t" />)
    expect(screen.getByText('AB2CD3').classList.contains('room-code')).toBe(true)
  })

  it('lists every player by their disambiguated label', () => {
    useConnection.setState({ labels: { me: 'Jocelyn', other: 'Jocelyn (2)' } })
    render(<Lobby code={asRoomCode('AB2CD3')} playerToken="t" />)
    expect(screen.getByText('Jocelyn')).toBeTruthy()
    expect(screen.getByText('Jocelyn (2)')).toBeTruthy()
  })

  it('shows the start button to the host', () => {
    render(<Lobby code={asRoomCode('AB2CD3')} playerToken="t" />)
    expect(screen.getByRole('button', { name: /start/i })).toBeTruthy()
  })

  it('shows waiting text instead of a start button to a non-host', () => {
    useConnection.setState({ hostId: OTHER })
    render(<Lobby code={asRoomCode('AB2CD3')} playerToken="t" />)
    expect(screen.queryByRole('button', { name: /start/i })).toBeNull()
    expect(screen.getByText(/waiting for/i)).toBeTruthy()
  })

  it('disables start below the two-player minimum', () => {
    useConnection.setState({ players: [player(ME, 'Jocelyn', 1)] })
    render(<Lobby code={asRoomCode('AB2CD3')} playerToken="t" />)
    expect((screen.getByRole('button', { name: /start/i }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('marks a disconnected player visually and in text', () => {
    useConnection.setState({
      players: [player(ME, 'Jocelyn', 1), { ...player(OTHER, 'Sam', 2), connected: false }],
    })
    render(<Lobby code={asRoomCode('AB2CD3')} playerToken="t" />)
    expect(screen.getByText(/offline/i)).toBeTruthy()
  })

  it('tells the player when the connection is reconnecting', () => {
    useConnection.setState({ status: 'reconnecting' })
    render(<Lobby code={asRoomCode('AB2CD3')} playerToken="t" />)
    expect(screen.getByRole('status').textContent).toMatch(/reconnect/i)
  })

  it('does not dim the offline marker, only the name', () => {
    useConnection.setState({
      players: [player(ME, 'Jocelyn', 1), { ...player(OTHER, 'Sam', 2), connected: false }],
      labels: { me: 'Jocelyn', other: 'Sam' },
    })
    render(<Lobby code={asRoomCode('AB2CD3')} playerToken="t" />)
    const row = screen.getByText(/offline/i).closest('li') as HTMLElement
    expect(row.style.opacity).toBe('')
    expect((screen.getByText(/offline/i) as HTMLElement).style.opacity).toBe('')
    expect((screen.getByText('Sam') as HTMLElement).style.opacity).toBe('0.5')
  })

  it('sends only one start request on a double click', () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}))
    vi.stubGlobal('fetch', fetchMock)
    render(<Lobby code={asRoomCode('AB2CD3')} playerToken="t" />)
    const button = screen.getByRole('button', { name: /start/i })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })
})
