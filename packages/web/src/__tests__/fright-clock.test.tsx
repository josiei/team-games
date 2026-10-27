import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { asPlayerId } from '@tg/shared'
import { FrightGame } from '../games/fright/FrightGame.js'
import { useConnection } from '../store/connection.js'

const ME = asPlayerId('p1')

const clueView = (over: Record<string, unknown> = {}) => ({
  kind: 'fright-clue',
  categoryId: 'killers',
  categoryName: "Who's That Killer?",
  value: 600,
  clueKind: 'text',
  prompt: 'This Transylvanian count first appeared in an 1897 novel.',
  order: ['Dracula', 'Nosferatu', 'Lord Ruthven', 'Carmilla'],
  armed: true,
  canBuzz: true,
  canChoose: false,
  canLifeline: false,
  answeringId: null,
  answeringTeam: null,
  wrongIndexes: [],
  myEliminated: [],
  scores: { blue: 0, red: 0 },
  lifelines: { blue: 2, red: 2 },
  ...over,
})

/** The clock renders its value into an aria-label, so read it from there. */
const clockReads = (secs: number) =>
  screen.queryByLabelText(`${secs} seconds left`) !== null

function seed(over: Record<string, unknown>) {
  useConnection.setState({
    view: clueView(), teams: [{ id: 'blue', name: 'Blue', color: '#3B82F6' }],
    players: [], labels: {}, endsAt: 12_000, clockOffset: 0,
    me: ME, hostId: null, dispatch: () => true, status: 'open',
    ...over,
  } as never)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
})
afterEach(() => {
  // Before the store reset: our hook runs first (afterEach is LIFO), and a
  // mounted component re-rendering against a null view would throw.
  cleanup()
  vi.useRealTimers()
  useConnection.setState({ view: null, endsAt: null } as never)
})

describe('the clue clock', () => {
  it('counts down while the buzzer is armed and no snapshot arrives', () => {
    seed({})
    render(<FrightGame onLeave={() => {}} />)
    expect(clockReads(12)).toBe(true)

    act(() => { vi.advanceTimersByTime(3_000) })
    expect(clockReads(9)).toBe(true)
    expect(clockReads(12)).toBe(false)
  })

  // The window this was actually reported about: between the buzz and the
  // answer the server says nothing, so only a self-driven clock moves.
  it('counts down while someone is answering', () => {
    seed({
      view: clueView({ answeringId: ME, answeringTeam: 'blue', canChoose: true }),
      labels: { [ME]: 'Jocelyn' },
      endsAt: 12_000,
    })
    render(<FrightGame onLeave={() => {}} />)
    expect(clockReads(12)).toBe(true)

    act(() => { vi.advanceTimersByTime(5_000) })
    expect(clockReads(7)).toBe(true)
  })

  it('picks up a fresh deadline when the next phase arrives', () => {
    seed({})
    render(<FrightGame onLeave={() => {}} />)
    act(() => { vi.advanceTimersByTime(4_000) })
    expect(clockReads(8)).toBe(true)

    act(() => { useConnection.setState({ endsAt: 24_000 } as never) })
    expect(clockReads(20)).toBe(true)
  })
})
