import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { VoteScreen } from '../games/pumpkin/VoteScreen.js'
import { useConnection } from '../store/connection.js'
import { asPlayerId } from '@tg/shared'

const ME = asPlayerId('me')
const entry = (slot: number) => ({ slot, strokes: [], integrity: 'solid' as const })

const setView = (over: Record<string, unknown> = {}) =>
  useConnection.setState({
    status: 'open', phase: 'vote-scariest', me: ME,
    players: [], labels: {}, hostId: null, hostLine: null,
    endsAt: null, clockOffset: 0,
    view: {
      kind: 'voting', award: 'scariest',
      gallery: [entry(0), entry(1), entry(2)],
      mySlot: 1, myVote: null, ...over,
    },
  })

beforeEach(() => setView())

describe('VoteScreen', () => {
  it('names the current award', () => {
    render(<VoteScreen />)
    expect(screen.getByText(/scariest/i)).toBeTruthy()
  })

  it('shows one card per pumpkin', () => {
    render(<VoteScreen />)
    expect(screen.getAllByRole('button', { name: /pumpkin/i })).toHaveLength(3)
  })

  it('disables the voters own pumpkin', () => {
    render(<VoteScreen />)
    const cards = screen.getAllByRole('button', { name: /pumpkin/i })
    expect((cards[1] as HTMLButtonElement).disabled).toBe(true)
    expect((cards[0] as HTMLButtonElement).disabled).toBe(false)
  })

  it('labels the voters own pumpkin as theirs', () => {
    render(<VoteScreen />)
    expect(screen.getByText(/yours/i)).toBeTruthy()
  })

  it('never shows a carver name during voting', () => {
    useConnection.setState({
      labels: { me: 'Zephyrine Quillfeather', other: 'Bartholomew Gnarlwick' },
      players: [],
    })
    const { container } = render(<VoteScreen />)
    expect(container.textContent).not.toMatch(/Zephyrine|Quillfeather|Bartholomew|Gnarlwick/)
    // Self-check: the same names DO render when something displays labels.
    const probe = render(<p>{useConnection.getState().labels['me']}</p>)
    expect(probe.container.textContent).toMatch(/Zephyrine/)
  })

  it('dispatches a vote for the clicked slot', () => {
    const dispatch = vi.fn()
    useConnection.setState({ dispatch })
    render(<VoteScreen />)
    fireEvent.click(screen.getAllByRole('button', { name: /pumpkin/i })[2]!)
    expect(dispatch).toHaveBeenCalledWith({ type: 'VOTE', award: 'scariest', slot: 2 })
  })

  it('marks the current vote as selected', () => {
    setView({ myVote: 2 })
    render(<VoteScreen />)
    const cards = screen.getAllByRole('button', { name: /pumpkin/i })
    expect(cards[2]!.getAttribute('aria-pressed')).toBe('true')
    expect(cards[0]!.getAttribute('aria-pressed')).toBe('false')
  })

  it('shows a collapsed pumpkin as collapsed in text', () => {
    setView({ gallery: [{ slot: 0, strokes: [], integrity: 'collapsed' }], mySlot: 5 })
    render(<VoteScreen />)
    expect(screen.getByText(/collapsed/i)).toBeTruthy()
  })

  it('slumps a collapsed pumpkin, so shape carries the meaning too', () => {
    setView({ gallery: [{ slot: 0, strokes: [], integrity: 'collapsed' }], mySlot: 5 })
    const { container } = render(<VoteScreen />)
    const card = container.querySelector('[data-integrity="collapsed"]') as HTMLElement
    expect(card).toBeTruthy()
    expect(card.style.transform).toMatch(/rotate/)
  })

  it('leaves a solid pumpkin untransformed', () => {
    const { container } = render(<VoteScreen />)
    const card = container.querySelector('[data-integrity="solid"]') as HTMLElement
    expect(card.style.transform).toBe('none')
  })

  it('tells a spectator they are watching this round', () => {
    useConnection.setState({ view: { kind: 'spectator', phase: 'vote-scariest' } })
    render(<VoteScreen />)
    expect(screen.getByText(/next round/i)).toBeTruthy()
  })

  it('gives a spectator no pumpkins to vote on', () => {
    useConnection.setState({ view: { kind: 'spectator', phase: 'vote-scariest' } })
    render(<VoteScreen />)
    expect(screen.queryAllByRole('button', { name: /pumpkin/i })).toHaveLength(0)
  })
})
