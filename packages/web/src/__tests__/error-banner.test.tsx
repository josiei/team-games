import { beforeEach, describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { ErrorBanner } from '../App.js'
import { useConnection } from '../store/connection.js'

beforeEach(() => useConnection.setState({ error: null }))

describe('ErrorBanner', () => {
  it('renders nothing without an error', () => {
    render(<ErrorBanner />)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('surfaces an error frame as an alert, then removes it on a new phase', () => {
    render(<ErrorBanner />)
    act(() => {
      useConnection.getState().applyMessage(
        { type: 'error', code: 'PHASE_FAILED', message: 'The game hit a problem and had to end.' } as never)
    })
    expect(screen.getByRole('alert').textContent).toMatch(/hit a problem and had to end/)
    const snap = (phase: string) => ({
      type: 'snapshot', phase, view: { kind: 'lobby' }, players: [], labels: {},
      hostId: null, endsAt: null, serverNow: Date.now(),
    }) as never
    act(() => { useConnection.getState().applyMessage(snap('results')) })
    expect(screen.getByRole('alert')).toBeTruthy()      // the terminal snapshot does not hide it
    act(() => { useConnection.getState().applyMessage(snap('lobby')) })
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
