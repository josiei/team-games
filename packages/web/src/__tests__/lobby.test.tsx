import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Lobby } from '../lobby/Lobby.js'
import { JoinScreen } from '../lobby/JoinScreen.js'
import { useConnection } from '../store/connection.js'
import { pipHash } from '../ui/PlayerPip.js'
import { asPlayerId, asRoomCode } from '@tg/shared'

const ME = asPlayerId('me')
const OTHER = asPlayerId('other')

const player = (id: ReturnType<typeof asPlayerId>, name: string, joinedAt: number) =>
  ({ id, displayName: name, connected: true, joinedAt, avatar: '', team: null })

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

describe('Lobby roster', () => {
  it('offers an open seat while the room is short of the minimum', () => {
    useConnection.setState({ players: [player(ME, 'Jocelyn', 1)] })
    render(<Lobby code={asRoomCode('AB2CD3')} playerToken="t" />)
    expect(screen.getAllByText('Open seat').length).toBe(1)
  })

  it('shows no open seats once the minimum is met', () => {
    render(<Lobby code={asRoomCode('AB2CD3')} playerToken="t" />)
    expect(screen.queryByText('Open seat')).toBeNull()
  })

  it('gives every row its own stagger index, so they do not pop in together', () => {
    const { container } = render(<Lobby code={asRoomCode('AB2CD3')} playerToken="t" />)
    const indices = [...container.querySelectorAll('.roster-row')]
      .map(row => (row as HTMLElement).style.getPropertyValue('--i'))
    expect(indices).toEqual(['0', '1'])
  })

  it('counts an open seat into the stagger, so it lands after the players', () => {
    useConnection.setState({ players: [player(ME, 'Jocelyn', 1)] })
    const { container } = render(<Lobby code={asRoomCode('AB2CD3')} playerToken="t" />)
    const indices = [...container.querySelectorAll('.roster-row')]
      .map(row => (row as HTMLElement).style.getPropertyValue('--i'))
    expect(indices).toEqual(['0', '1'])
  })

  it('phases each pumpkin off its own id, not its row, so a leave cannot shift it', () => {
    const { container, rerender } = render(<Lobby code={asRoomCode('AB2CD3')} playerToken="t" />)
    const phaseOf = (i: number) =>
      (container.querySelectorAll('svg.pip')[i] as HTMLElement).style.getPropertyValue('--phase')
    // Pinned to the id's own hash, so a constant or an index would both fail.
    expect(phaseOf(0)).toBe(String(pipHash(ME) % 8))
    expect(phaseOf(1)).toBe(String(pipHash(OTHER) % 8))

    // The player above leaves. Sam's row index drops to 0; the pumpkin's phase
    // must not move with it, or every pumpkin below a leaver jumps mid-bob.
    useConnection.setState({ players: [player(OTHER, 'Sam', 2)] })
    rerender(<Lobby code={asRoomCode('AB2CD3')} playerToken="t" />)
    expect(phaseOf(0)).toBe(String(pipHash(OTHER) % 8))
  })

  it('tags the host and marks an offline player', () => {
    useConnection.setState({
      players: [player(ME, 'Jocelyn', 1), { ...player(OTHER, 'Sam', 2), connected: false }],
    })
    const { container } = render(<Lobby code={asRoomCode('AB2CD3')} playerToken="t" />)
    expect(screen.getByText('host').className).toContain('roster-tag')
    expect(container.querySelector('svg.pip.is-offline')).toBeTruthy()
  })

  it('keeps the pumpkins out of the accessibility tree', () => {
    const { container } = render(<Lobby code={asRoomCode('AB2CD3')} playerToken="t" />)
    const pips = container.querySelectorAll('svg.pip')
    expect(pips.length).toBe(2)
    for (const pip of pips) expect(pip.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('Lobby teams', () => {
  const TEAMS = [
    { id: 'blue', name: 'Blue', color: '#3B82F6' },
    { id: 'red', name: 'Red', color: '#EF4444' },
  ]

  /** Resolves every request so setProfile's await settles. */
  function okFetch() {
    const mock = vi.fn(async () =>
      ({ ok: true, json: async () => ({ ok: true }) }) as unknown as Response)
    vi.stubGlobal('fetch', mock)
    return mock
  }

  it('renders no team columns for a game that declares none', () => {
    useConnection.setState({ teams: undefined })
    render(<Lobby code={asRoomCode('AB2CD3')} playerToken="t" />)
    expect(screen.queryByRole('button', { name: /join blue/i })).toBeNull()
    expect(screen.getByText('Jocelyn')).toBeTruthy()      // the plain roster still renders
  })

  it('renders one column per declared team, each with a join button', () => {
    useConnection.setState({ teams: TEAMS })
    render(<Lobby code={asRoomCode('AB2CD3')} playerToken="t" />)
    expect(screen.getByRole('button', { name: /join blue/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /join red/i })).toBeTruthy()
  })

  it('joining a team posts the choice', async () => {
    const mock = okFetch()
    useConnection.setState({ teams: TEAMS })
    render(<Lobby code={asRoomCode('AB2CD3')} playerToken="t" />)
    fireEvent.click(screen.getByRole('button', { name: /join blue/i }))
    await waitFor(() => expect(mock).toHaveBeenCalled())
    const [url, init] = mock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/rooms/AB2CD3/me')
    expect(JSON.parse(String(init.body))).toMatchObject({ playerToken: 't', team: 'blue' })
  })

  it('shows each player in their own team column', () => {
    useConnection.setState({
      teams: TEAMS,
      players: [
        { ...player(ME, 'Jocelyn', 1), team: 'blue' },
        { ...player(OTHER, 'Sam', 2), team: 'red' },
      ],
    })
    const { container } = render(<Lobby code={asRoomCode('AB2CD3')} playerToken="t" />)
    const columns = [...container.querySelectorAll('.team-column')]
    expect(columns).toHaveLength(2)
    expect(columns[0]!.textContent).toContain('Jocelyn')
    expect(columns[0]!.textContent).not.toContain('Sam')
    expect(columns[1]!.textContent).toContain('Sam')
  })

  it('picking an avatar posts the choice', async () => {
    const mock = okFetch()
    useConnection.setState({ teams: TEAMS })
    render(<Lobby code={asRoomCode('AB2CD3')} playerToken="t" />)
    fireEvent.click(screen.getAllByRole('button', { name: /choose the .* avatar/i })[0]!)
    await waitFor(() => expect(mock).toHaveBeenCalled())
    const [url, init] = mock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/rooms/AB2CD3/me')
    expect(JSON.parse(String(init.body)).avatar).toBeTruthy()
  })

  it('start is disabled while either team is empty', () => {
    useConnection.setState({
      teams: TEAMS,
      players: [
        { ...player(ME, 'Jocelyn', 1), team: 'blue' },
        { ...player(OTHER, 'Sam', 2), team: 'blue' },
      ],
    })
    render(<Lobby code={asRoomCode('AB2CD3')} playerToken="t" />)
    expect((screen.getByRole('button', { name: /start/i }) as HTMLButtonElement).disabled)
      .toBe(true)
    expect(screen.getByText(/both teams need/i)).toBeTruthy()
  })

  it('start is enabled once both teams have someone', () => {
    useConnection.setState({
      teams: TEAMS,
      players: [
        { ...player(ME, 'Jocelyn', 1), team: 'blue' },
        { ...player(OTHER, 'Sam', 2), team: 'red' },
      ],
    })
    render(<Lobby code={asRoomCode('AB2CD3')} playerToken="t" />)
    expect((screen.getByRole('button', { name: /start/i }) as HTMLButtonElement).disabled)
      .toBe(false)
  })

  it('a lopsided split nudges but does not block start', () => {
    const third = asPlayerId('third')
    useConnection.setState({
      teams: TEAMS,
      players: [
        { ...player(ME, 'Jocelyn', 1), team: 'blue' },
        { ...player(OTHER, 'Sam', 2), team: 'blue' },
        { ...player(third, 'Ash', 3), team: 'blue' },
        { ...player(asPlayerId('fourth'), 'Kit', 4), team: 'red' },
      ],
      labels: { me: 'Jocelyn', other: 'Sam', third: 'Ash', fourth: 'Kit' },
    })
    render(<Lobby code={asRoomCode('AB2CD3')} playerToken="t" />)
    expect(screen.getByText(/lopsided|uneven/i)).toBeTruthy()
    expect((screen.getByRole('button', { name: /start/i }) as HTMLButtonElement).disabled)
      .toBe(false)
  })
})
