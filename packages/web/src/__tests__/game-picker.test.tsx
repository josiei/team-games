import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { GamePicker } from '../lobby/GamePicker.js'

const GAMES = [
  {
    id: 'pumpkin-carve', name: 'Jack-o-Lantern Carving',
    description: 'Carve against the clock, then vote.',
    minPlayers: 2, maxPlayers: 16, estimatedMinutes: 6,
    theme: { accent: '#FF7518', accent2: '#8B5CF6', glow: '#FFC24D', danger: '#84CC16' },
    thumbnail: '/games/pumpkin-carve/thumb.png',
  },
  {
    id: 'fright-night', name: 'Fright Night',
    description: 'Two teams, one spooky board.',
    minPlayers: 2, maxPlayers: 16, estimatedMinutes: 20,
    theme: { accent: '#7C3AED', accent2: '#FF7518', glow: '#C4B5FD', danger: '#EF4444' },
    thumbnail: '/games/fright-night/thumb.png',
    teams: [
      { id: 'blue', name: 'Blue', color: '#3B82F6' },
      { id: 'red', name: 'Red', color: '#EF4444' },
    ],
  },
]

function mockFetch(impl: () => Promise<unknown>) {
  vi.stubGlobal('fetch', vi.fn(async () => {
    const body = await impl()
    return { ok: true, json: async () => body } as unknown as Response
  }))
}

beforeEach(() => { vi.unstubAllGlobals() })
afterEach(() => { vi.unstubAllGlobals() })

describe('GamePicker', () => {
  it('renders a card per game from /api/games', async () => {
    mockFetch(async () => GAMES)
    render(<GamePicker onPick={() => {}} onCancel={() => {}} />)
    expect(await screen.findByText('Jack-o-Lantern Carving')).toBeTruthy()
    expect(screen.getByText('Fright Night')).toBeTruthy()
  })

  it('shows each game player range and length', async () => {
    mockFetch(async () => GAMES)
    const { container } = render(<GamePicker onPick={() => {}} onCancel={() => {}} />)
    await screen.findByText('Fright Night')
    // The meta line is several JSX children, so match the rendered text.
    const meta = [...container.querySelectorAll('.picker-meta')].map(n => n.textContent)
    expect(meta.some(t => /2–16 players/.test(t ?? ''))).toBe(true)
    expect(meta.some(t => /~20 min/.test(t ?? ''))).toBe(true)
  })

  it('renders each thumbnail', async () => {
    mockFetch(async () => GAMES)
    const { container } = render(<GamePicker onPick={() => {}} onCancel={() => {}} />)
    await screen.findByText('Fright Night')
    // alt="" on purpose: the game's name is right beside it, so the image is
    // decorative and must not be announced twice.
    const sources = [...container.querySelectorAll('img')].map(i => i.getAttribute('src'))
    expect(sources).toContain('/games/fright-night/thumb.png')
    expect(sources).toContain('/games/pumpkin-carve/thumb.png')
  })

  it('calls onPick with the chosen game id', async () => {
    mockFetch(async () => GAMES)
    const onPick = vi.fn()
    render(<GamePicker onPick={onPick} onCancel={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /Fright Night/ }))
    expect(onPick).toHaveBeenCalledWith('fright-night')
  })

  it('offers a retry rather than an empty grid when the fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    render(<GamePicker onPick={() => {}} onCancel={() => {}} />)
    expect(await screen.findByRole('button', { name: /try again/i })).toBeTruthy()
  })

  it('retrying re-fetches and then shows the games', async () => {
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1
      if (calls === 1) throw new Error('offline')
      return { ok: true, json: async () => GAMES } as unknown as Response
    }))
    render(<GamePicker onPick={() => {}} onCancel={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /try again/i }))
    expect(await screen.findByText('Fright Night')).toBeTruthy()
  })

  it('cancelling calls onCancel', async () => {
    mockFetch(async () => GAMES)
    const onCancel = vi.fn()
    render(<GamePicker onPick={() => {}} onCancel={onCancel} />)
    fireEvent.click(await screen.findByRole('button', { name: /back/i }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('says so when the server lists no games at all', async () => {
    mockFetch(async () => [])
    render(<GamePicker onPick={() => {}} onCancel={() => {}} />)
    await waitFor(() => expect(screen.getByText(/no games/i)).toBeTruthy())
  })
})
