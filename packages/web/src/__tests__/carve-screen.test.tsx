import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { Stroke } from '@tg/shared'
import { useConnection } from '../store/connection.js'
import * as shared from '@tg/shared'
import { AUTO_SUBMIT_MARGIN_MS, CarveScreen } from '../games/pumpkin/CarveScreen.js'

vi.mock('@tg/shared', async importOriginal => {
  const actual = await importOriginal<typeof import('@tg/shared')>()
  return { ...actual, carvedRatio: vi.fn(actual.carvedRatio) }
})

class MemStorage {
  private m = new Map<string, string>()
  getItem(k: string) { return this.m.get(k) ?? null }
  setItem(k: string, v: string) { this.m.set(k, v) }
  removeItem(k: string) { this.m.delete(k) }
  clear() { this.m.clear() }
}

// jsdom has no PointerEvent; without one RTL falls back to a bare Event that
// drops pointerId/button/clientX. A MouseEvent subclass carries them through.
class TestPointerEvent extends MouseEvent {
  pointerId: number
  constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 0
  }
}

const carvingView = {
  kind: 'carving', myStrokes: [], submitted: false, ratio: 0, integrity: 'solid',
  submittedCount: 0, totalPlayers: 3,
}
const KEY = 'tg:draft:r1'

let dispatch: ReturnType<typeof vi.fn>
const canvas = () => screen.getByLabelText('Pumpkin carving canvas')
const sent = (type: string) =>
  dispatch.mock.calls.map(c => c[0] as { type: string; strokes: Stroke[] }).filter(a => a.type === type)

const down = (id: number, x: number, y: number, button = 0) =>
  fireEvent.pointerDown(canvas(), { pointerId: id, button, clientX: x, clientY: y })
const move = (id: number, x: number, y: number) =>
  fireEvent.pointerMove(canvas(), { pointerId: id, clientX: x, clientY: y })
const up = (id: number) => fireEvent.pointerUp(canvas(), { pointerId: id })

beforeEach(() => {
  vi.stubGlobal('PointerEvent', TestPointerEvent)
  ;(window as unknown as Record<string, unknown>).PointerEvent = TestPointerEvent
  vi.stubGlobal('localStorage', new MemStorage())
  // 1 CSS px == 1 canvas px, so clientX/Y read directly as canvas pixels.
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue(
    { left: 0, top: 0, width: 512, height: 640, right: 512, bottom: 640, x: 0, y: 0, toJSON() {} })
  // jsdom already returns null here (no 2D context); this only silences its "not implemented" log.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  dispatch = vi.fn(() => true) // true == the socket accepted the message
  vi.mocked(shared.carvedRatio).mockClear()
  useConnection.setState({ view: carvingView, dispatch, endsAt: null, clockOffset: 0, status: 'open' } as never)
})
afterEach(() => {
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  useConnection.setState({ view: null, endsAt: null } as never)
})

describe('pointer ownership', () => {
  it('ignores a second pointer: it neither replaces nor extends the active stroke', () => {
    render(<CarveScreen roomId="r1" />)
    down(1, 100, 100)
    down(2, 400, 500)        // palm / second finger
    move(2, 410, 510)
    up(2)                    // must not end pointer 1's stroke
    move(1, 200, 100)
    up(1)
    fireEvent.click(screen.getByText(/Submit pumpkin/))
    const [submit] = sent('SUBMIT')
    expect(submit!.strokes).toHaveLength(1)
    const pts = submit!.strokes[0]!.points
    expect(pts.every(([, y]) => Math.abs(y - 100 / 640) < 0.001)).toBe(true)
    expect(pts.at(-1)![0]).toBeCloseTo(200 / 512, 3)
  })

  it('ignores non-primary buttons', () => {
    render(<CarveScreen roomId="r1" />)
    down(1, 100, 100, 2)     // right click
    move(1, 200, 100)
    up(1)
    fireEvent.click(screen.getByText(/Submit pumpkin/))
    expect(sent('SUBMIT')[0]!.strokes).toHaveLength(0)
  })

  it('shows a visible cue and accepts no input once the pumpkin is full', () => {
    const full = Array.from({ length: 800 }, () => ({ tool: 'cut', size: 0.03, points: [[0.1, 0.1]] }))
    localStorage.setItem(KEY, JSON.stringify(full))
    render(<CarveScreen roomId="r1" />)
    down(1, 300, 300)
    expect(screen.getByRole('status').textContent).toMatch(/full/i)
    up(1)
    fireEvent.click(screen.getByText(/Submit pumpkin/))
    expect(sent('SUBMIT')[0]!.strokes).toHaveLength(800)
  })
})

describe('deadline and draft lifecycle', () => {
  it('auto-submits just before the deadline, including a stroke still in progress', () => {
    vi.useFakeTimers()
    useConnection.setState({ endsAt: Date.now() + 5000, clockOffset: 0 } as never)
    render(<CarveScreen roomId="r1" />)
    down(1, 100, 100)
    move(1, 160, 100)        // still holding the pointer when time runs out
    act(() => { vi.advanceTimersByTime(5000 - AUTO_SUBMIT_MARGIN_MS - 1) })
    expect(sent('SUBMIT')).toHaveLength(0)
    act(() => { vi.advanceTimersByTime(2) })
    expect(sent('SUBMIT')).toHaveLength(1)
    expect(sent('SUBMIT')[0]!.strokes).toHaveLength(1)
    expect(sent('SUBMIT')[0]!.strokes[0]!.points.length).toBeGreaterThan(1)
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('does not submit twice when the timer fires after a manual submit', () => {
    vi.useFakeTimers()
    useConnection.setState({ endsAt: Date.now() + 5000, clockOffset: 0 } as never)
    render(<CarveScreen roomId="r1" />)
    fireEvent.click(screen.getByText(/Submit pumpkin/))
    act(() => { vi.advanceTimersByTime(6000) })
    expect(sent('SUBMIT')).toHaveLength(1)
  })

  it('clears the stored draft when the view leaves carving', () => {
    localStorage.setItem(KEY, JSON.stringify([{ tool: 'cut', size: 0.1, points: [[0.5, 0.5]] }]))
    render(<CarveScreen roomId="r1" />)
    expect(localStorage.getItem(KEY)).not.toBeNull()
    act(() => { useConnection.setState({ view: { kind: 'lobby', playerCount: 3 } } as never) })
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('keeps the draft when the screen unmounts while still carving (e.g. tab takeover)', () => {
    localStorage.setItem(KEY, JSON.stringify([{ tool: 'cut', size: 0.1, points: [[0.5, 0.5]] }]))
    const { unmount } = render(<CarveScreen roomId="r1" />)
    unmount()
    expect(localStorage.getItem(KEY)).not.toBeNull()
  })

  it('sends DRAFT only when something changed since the last one', () => {
    vi.useFakeTimers()
    render(<CarveScreen roomId="r1" />)
    act(() => { vi.advanceTimersByTime(10_000) })
    expect(sent('DRAFT')).toHaveLength(0)         // nothing drawn, nothing sent
    down(1, 100, 100); up(1)
    act(() => { vi.advanceTimersByTime(10_000) })
    expect(sent('DRAFT')).toHaveLength(1)
    act(() => { vi.advanceTimersByTime(20_000) })
    expect(sent('DRAFT')).toHaveLength(1)         // unchanged since
  })
})

describe('submit while the socket is down', () => {
  const draw = () => { down(1, 100, 100); move(1, 160, 100); up(1) }

  it('keeps the draft and leaves Submit usable when the send is dropped', () => {
    render(<CarveScreen roomId="r1" />)
    draw()
    act(() => { /* let the debounced local save run */ })
    dispatch.mockReturnValue(false)
    fireEvent.click(screen.getByText(/Submit pumpkin/))
    expect(screen.getByRole('status').textContent).toMatch(/will send when you reconnect/i)
    // second click works once the socket is back
    dispatch.mockReturnValue(true)
    fireEvent.click(screen.getByText(/Submit pumpkin/))
    expect(sent('SUBMIT')).toHaveLength(2)
    expect(sent('SUBMIT')[1]!.strokes).toHaveLength(1)
    expect(localStorage.getItem(KEY)).toBeNull() // cleared only after a send that landed
  })

  it('does not clear the stored draft when the send failed', () => {
    vi.useFakeTimers()
    render(<CarveScreen roomId="r1" />)
    draw()
    act(() => { vi.advanceTimersByTime(500) }) // debounced save
    expect(localStorage.getItem(KEY)).not.toBeNull()
    dispatch.mockReturnValue(false)
    fireEvent.click(screen.getByText(/Submit pumpkin/))
    expect(localStorage.getItem(KEY)).not.toBeNull()
  })

  it('a deadline submit that is dropped lands once the socket reopens', () => {
    vi.useFakeTimers()
    useConnection.setState({ endsAt: Date.now() + 5000, clockOffset: 0, status: 'reconnecting' } as never)
    dispatch.mockReturnValue(false)
    render(<CarveScreen roomId="r1" />)
    draw()
    act(() => { vi.advanceTimersByTime(6000) })   // deadline passes while disconnected
    expect(sent('SUBMIT').length).toBeGreaterThan(0)
    const failedAttempts = sent('SUBMIT').length
    expect(localStorage.getItem(KEY)).not.toBeNull()
    dispatch.mockReturnValue(true)
    act(() => { useConnection.setState({ status: 'open' } as never) }) // reconnect, same deadline
    expect(sent('SUBMIT').length).toBe(failedAttempts + 1)
    expect(sent('SUBMIT').at(-1)!.strokes).toHaveLength(1)
    expect(localStorage.getItem(KEY)).toBeNull()
  })
})

describe('draft safety and live regions', () => {
  it('does not clear the draft for a transient null view', () => {
    localStorage.setItem(KEY, JSON.stringify([{ tool: 'cut', size: 0.1, points: [[0.5, 0.5]] }]))
    render(<CarveScreen roomId="r1" />)
    act(() => { useConnection.setState({ view: null } as never) })
    expect(localStorage.getItem(KEY)).not.toBeNull()
    act(() => { useConnection.setState({ view: carvingView } as never) })
    expect(localStorage.getItem(KEY)).not.toBeNull()
  })

  it('keeps the status region mounted (empty) before it has anything to say', () => {
    render(<CarveScreen roomId="r1" />)
    expect(screen.getByRole('status').textContent).toBe('')
  })
})

describe('meter throttling', () => {
  it('recomputes carvedRatio at ~10Hz during a drag, and settles after it', () => {
    vi.useFakeTimers()
    render(<CarveScreen roomId="r1" />)
    const calls = () => vi.mocked(shared.carvedRatio).mock.calls.length
    const start = calls()
    down(1, 50, 50)
    for (let i = 1; i <= 120; i++) {           // ~2s of 60Hz moves
      move(1, 50 + i * 3, 50 + (i % 5))
      act(() => { vi.advanceTimersByTime(16) })
    }
    const during = calls() - start
    expect(during).toBeGreaterThan(5)
    expect(during).toBeLessThan(30)            // unthrottled would be ~120
    up(1)
    act(() => { vi.advanceTimersByTime(300) })
    const settled = calls()
    act(() => { vi.advanceTimersByTime(1000) })
    expect(calls()).toBe(settled)              // and then goes quiet
  })
})
