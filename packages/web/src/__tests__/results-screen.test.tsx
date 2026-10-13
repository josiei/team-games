import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import { ResultsScreen } from '../games/pumpkin/ResultsScreen.js'
import { markShowSeen } from '../games/pumpkin/Catwalk.js'
import { useConnection } from '../store/connection.js'
import { asPlayerId } from '@tg/shared'

const ME = asPlayerId('me')
const OTHER = asPlayerId('other')
const entry = (slot: number) => ({ slot, strokes: [], integrity: 'solid' as const })

const setView = (over: Record<string, unknown> = {}) =>
  useConnection.setState({
    status: 'open', phase: 'results', me: ME,
    players: [
      { id: ME, displayName: 'Jocelyn', connected: true, joinedAt: 1 },
      { id: OTHER, displayName: 'Jocelyn', connected: true, joinedAt: 2 },
    ],
    labels: { me: 'Jocelyn', other: 'Jocelyn (2)' },
    hostId: ME, hostLine: null, endsAt: null, clockOffset: 0,
    view: {
      kind: 'results',
      gallery: [entry(0), entry(1)],
      winners: {
        scariest: { slot: 0, votes: 2 },
        funniest: null,
        craft: { slot: 1, votes: 1 },
        cursed: null,
      },
      carvers: { 0: ME, 1: OTHER },
      ...over,
    },
  })

/** The card for one award, found by its heading. */
const card = (name: RegExp) => within(screen.getByRole('group', { name }))
const gallery = () => within(screen.getByRole('region', { name: /everyone/i }))

beforeEach(() => setView())

describe('ResultsScreen', () => {
  it('names the winner of each decided award by its disambiguated label', () => {
    render(<ResultsScreen />)
    expect(card(/scariest/i).getByText('Jocelyn')).toBeTruthy()
    expect(card(/craftsmanship/i).getByText('Jocelyn (2)')).toBeTruthy()
  })

  it('shows the vote count for a decided award', () => {
    render(<ResultsScreen />)
    expect(card(/scariest/i).getByText(/2 votes/i)).toBeTruthy()
  })

  it('says no votes were cast for an award nobody voted on', () => {
    render(<ResultsScreen />)
    expect(screen.getAllByText(/no votes cast/i).length).toBe(2)
    expect(card(/funniest/i).getByText(/no votes cast/i)).toBeTruthy()
  })

  it('uses the singular for a one-vote win', () => {
    render(<ResultsScreen />)
    expect(card(/craftsmanship/i).getByText(/1 vote\b/i)).toBeTruthy()
    expect(screen.queryByText(/1 votes/i)).toBeNull()
  })

  it('reveals the carver under every pumpkin, not only winners', () => {
    setView({ gallery: [entry(0), entry(1), entry(2)], carvers: { 0: ME, 1: OTHER, 2: OTHER } })
    render(<ResultsScreen />)
    const thumbs = gallery().getAllByRole('img', { name: /pumpkin/i })
    expect(thumbs).toHaveLength(3)
    expect(thumbs.map(b => b.textContent)).toEqual(['Jocelyn', 'Jocelyn (2)', 'Jocelyn (2)'])
    // Display-only: not focusable toggle buttons, and not dimmed.
    expect(gallery().queryAllByRole('button')).toHaveLength(0)
    expect(thumbs.every(b => b.getAttribute('aria-pressed') === null)).toBe(true)
    expect(thumbs.every(b => b.style.opacity === '1')).toBe(true)
    // The winner cards' thumbs are display-only too.
    const cardThumbs = [/scariest/i, /craftsmanship/i].flatMap(n => card(n).getAllByRole('img'))
    expect(cardThumbs).toHaveLength(2)
    expect(cardThumbs.every(b => b.getAttribute('aria-pressed') === null)).toBe(true)
    expect(cardThumbs.every(b => b.style.opacity === '1')).toBe(true)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('does not crash when a winning slot has no carver recorded', () => {
    setView({ carvers: {} })
    expect(() => render(<ResultsScreen />)).not.toThrow()
    expect(card(/scariest/i).getByText(/unknown carver/i)).toBeTruthy()
  })

  it('falls back when the carver has no label', () => {
    setView({ carvers: { 0: asPlayerId('ghost'), 1: OTHER } })
    render(<ResultsScreen />)
    expect(card(/scariest/i).getByText(/unknown carver/i)).toBeTruthy()
  })

  it('renders all four award headings even when undecided', () => {
    setView({ winners: { scariest: null, funniest: null, craft: null, cursed: null } })
    render(<ResultsScreen />)
    for (const name of [/scariest/i, /funniest/i, /craftsmanship/i, /cursed/i]) {
      expect(screen.getByRole('heading', { name })).toBeTruthy()
    }
    expect(screen.getAllByText(/no votes cast/i).length).toBe(4)
    // The gallery must survive an all-undecided room.
    expect(gallery().getAllByRole('img', { name: /pumpkin/i })).toHaveLength(2)
  })

  it('does not claim "No votes cast" for a winner whose pumpkin is missing from the gallery', () => {
    setView({ gallery: [entry(1)] }) // scariest won slot 0 with 2 votes; slot 0 is absent
    render(<ResultsScreen />)
    const scariest = card(/scariest/i)
    expect(scariest.getByText(/2 votes/i)).toBeTruthy()
    expect(scariest.queryByText(/no votes cast/i)).toBeNull()
    expect(scariest.getByText(/pumpkin unavailable/i).textContent).toContain('Jocelyn')
  })

  it('treats a blank label as missing', () => {
    useConnection.setState({ labels: { me: '  ', other: 'Jocelyn (2)' } })
    render(<ResultsScreen />)
    expect(card(/scariest/i).getByText(/unknown carver/i)).toBeTruthy()
  })
})

describe('ResultsScreen reveal gate', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); sessionStorage.clear() })

  const allowMotion = () => vi.stubGlobal('matchMedia', () => ({ matches: false }))

  it('runs the catwalk first, then hands the screen to the grid', () => {
    // Every other test in this file takes the reduced-motion path, because
    // jsdom has no matchMedia — so without this one the gate itself, and the
    // handover that ends the show, are never exercised at all.
    allowMotion()
    vi.useFakeTimers()
    setView()
    render(<ResultsScreen />)

    expect(screen.getByLabelText('Awards reveal')).toBeTruthy()
    expect(screen.queryByRole('group', { name: /Scariest/ })).toBeNull()

    for (let i = 0; i < 4; i++) act(() => { vi.advanceTimersByTime(3200) })

    expect(screen.queryByLabelText('Awards reveal')).toBeNull()
    expect(screen.getByRole('group', { name: /Scariest/ })).toBeTruthy()
  })

  it('does not replay the show for a viewer who has already sat through it', () => {
    // A refresh or a session takeover remounts this screen. Replaying thirteen
    // seconds with no skip control would lock them out of their own results.
    allowMotion()
    setView()
    const first = render(<ResultsScreen />)
    expect(screen.getByLabelText('Awards reveal')).toBeTruthy()
    act(() => { markShowSeen() })
    first.unmount()

    render(<ResultsScreen />)
    expect(screen.queryByLabelText('Awards reveal')).toBeNull()
    expect(screen.getByRole('group', { name: /Scariest/ })).toBeTruthy()
  })

  it('skips the show entirely when the system asks for less motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    setView()
    render(<ResultsScreen />)
    expect(screen.queryByLabelText('Awards reveal')).toBeNull()
    expect(screen.getByRole('group', { name: /Scariest/ })).toBeTruthy()
  })
})
