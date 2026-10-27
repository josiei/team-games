import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { useSecondsLeft } from '../ui/useSecondsLeft.js'

/**
 * A probe that does nothing but print the hook's value.
 *
 * The thing under test is that this number moves on its own. Every other
 * clock in the game is driven by a server snapshot arriving; this one has to
 * keep counting between them, because between a buzz and an answer no
 * snapshot arrives at all.
 */
function Probe({ endsAt, clockOffset = 0 }: { endsAt: number | null; clockOffset?: number }) {
  return <span data-testid="secs">{useSecondsLeft(endsAt, clockOffset)}</span>
}

const shown = () => screen.getByTestId('secs').textContent

/** One second of wall clock, with the frames the hook schedules inside it. */
const passSecond = () => act(() => { vi.advanceTimersByTime(1000) })

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
})
afterEach(() => vi.useRealTimers())

describe('useSecondsLeft', () => {
  it('reports the whole seconds left at the moment it mounts', () => {
    render(<Probe endsAt={12_000} />)
    expect(shown()).toBe('12')
  })

  it('counts down on its own, with no new deadline and no re-render from above', () => {
    render(<Probe endsAt={12_000} />)
    passSecond()
    expect(shown()).toBe('11')
    passSecond()
    expect(shown()).toBe('10')
  })

  it('stops at zero instead of running negative', () => {
    render(<Probe endsAt={2_000} />)
    for (let i = 0; i < 5; i++) passSecond()
    expect(shown()).toBe('0')
  })

  it('is zero when there is no deadline at all', () => {
    render(<Probe endsAt={null} />)
    expect(shown()).toBe('0')
  })

  it('shows the new deadline at once when one arrives, never the stale count', () => {
    const { rerender } = render(<Probe endsAt={12_000} />)
    passSecond()
    expect(shown()).toBe('11')
    // A fresh phase: the server hands down a deadline 20s out from now.
    rerender(<Probe endsAt={21_000} />)
    expect(shown()).toBe('20')
  })

  it('counts in the server clock, not the browser clock', () => {
    // A positive offset means the server clock runs ahead of this browser's,
    // so a deadline stamped 12s out is really 17s of this browser's time.
    render(<Probe endsAt={12_000} clockOffset={5_000} />)
    expect(shown()).toBe('17')
    passSecond()
    expect(shown()).toBe('16')
  })
})
