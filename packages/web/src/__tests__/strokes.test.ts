import { CANVAS_H, CANVAS_W } from '@tg/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  allStrokes, beginStroke, clearDraft, emptyDraft, endStroke,
  extendStroke, loadDraft, saveDraft, undo,
} from '../games/pumpkin/strokes.js'

describe('stroke state machine', () => {
  it('starts empty', () => {
    expect(allStrokes(emptyDraft())).toEqual([])
  })

  it('opens an active stroke on begin', () => {
    const d = beginStroke(emptyDraft(), 'cut', 0.1, undefined, [0.5, 0.5])
    expect(d.active?.points).toEqual([[0.5, 0.5]])
    expect(d.strokes).toHaveLength(0)
  })

  it('appends points while the stroke is active', () => {
    let d = beginStroke(emptyDraft(), 'cut', 0.1, undefined, [0.1, 0.1])
    d = extendStroke(d, [0.2, 0.2])
    d = extendStroke(d, [0.3, 0.3])
    expect(d.active?.points).toHaveLength(3)
  })

  it('ignores extend when no stroke is active', () => {
    const d = extendStroke(emptyDraft(), [0.2, 0.2])
    expect(d.active).toBeNull()
    expect(d.strokes).toHaveLength(0)
  })

  it('commits the active stroke on end', () => {
    let d = beginStroke(emptyDraft(), 'cut', 0.1, undefined, [0.5, 0.5])
    d = endStroke(d)
    expect(d.active).toBeNull()
    expect(d.strokes).toHaveLength(1)
  })

  it('discards a stroke with no points', () => {
    const d = endStroke({ strokes: [], active: { tool: 'cut', size: 0.1, points: [] } })
    expect(d.strokes).toHaveLength(0)
  })

  it('clamps points into the canvas', () => {
    let d = beginStroke(emptyDraft(), 'cut', 0.1, undefined, [-0.5, 1.9])
    d = endStroke(d)
    expect(d.strokes[0]!.points[0]).toEqual([0, 1])
  })

  it('records a stamp with its shape', () => {
    let d = beginStroke(emptyDraft(), 'stamp', 0.2, 'triangle', [0.4, 0.3])
    d = endStroke(d)
    expect(d.strokes[0]).toMatchObject({ tool: 'stamp', shape: 'triangle' })
  })

  it('undo removes the last committed stroke', () => {
    let d = endStroke(beginStroke(emptyDraft(), 'cut', 0.1, undefined, [0.1, 0.1]))
    d = endStroke(beginStroke(d, 'cut', 0.1, undefined, [0.2, 0.2]))
    d = undo(d)
    expect(d.strokes).toHaveLength(1)
    expect(d.strokes[0]!.points[0]).toEqual([0.1, 0.1])
  })

  it('undo on an empty draft is a no-op', () => {
    expect(undo(emptyDraft())).toEqual(emptyDraft())
  })

  it('undo discards an in-progress stroke first', () => {
    let d = endStroke(beginStroke(emptyDraft(), 'cut', 0.1, undefined, [0.1, 0.1]))
    d = beginStroke(d, 'cut', 0.1, undefined, [0.9, 0.9])
    d = undo(d)
    expect(d.active).toBeNull()
    expect(d.strokes).toHaveLength(1)
  })

  it('allStrokes includes the active stroke so the live meter is accurate', () => {
    const d = beginStroke(emptyDraft(), 'cut', 0.1, undefined, [0.5, 0.5])
    expect(allStrokes(d)).toHaveLength(1)
  })
})

// Node's own experimental `localStorage` global can shadow jsdom's (see
// session.test.tsx), so install an explicit in-memory store on a real class
// whose prototype can be spied on.
class MemStorage {
  private m = new Map<string, string>()
  getItem(k: string) { return this.m.get(k) ?? null }
  setItem(k: string, v: string) { this.m.set(k, v) }
  removeItem(k: string) { this.m.delete(k) }
  clear() { this.m.clear() }
}

describe('draft persistence', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', new MemStorage()) })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('round-trips strokes for a room', () => {
    const strokes = [{ tool: 'cut' as const, size: 0.1, points: [[0.5, 0.5]] as [number, number][] }]
    saveDraft('room-1', strokes)
    expect(loadDraft('room-1')).toEqual(strokes)
  })

  it('keeps drafts separate per room', () => {
    saveDraft('room-1', [{ tool: 'cut', size: 0.1, points: [[0.1, 0.1]] }])
    expect(loadDraft('room-2')).toBeNull()
  })

  it('returns null for a room with no draft', () => {
    expect(loadDraft('nope')).toBeNull()
  })

  it('returns null rather than throwing on corrupt data', () => {
    localStorage.setItem('tg:draft:room-1', '{not json')
    expect(loadDraft('room-1')).toBeNull()
  })

  it('clears a draft', () => {
    saveDraft('room-1', [{ tool: 'cut', size: 0.1, points: [[0.1, 0.1]] }])
    clearDraft('room-1')
    expect(loadDraft('room-1')).toBeNull()
  })

  it('does not throw when storage is unavailable', () => {
    const spy = vi.spyOn(MemStorage.prototype, 'setItem')
      .mockImplementation(() => { throw new Error('QuotaExceeded') })
    expect(() => saveDraft('room-1', [])).not.toThrow()
    spy.mockRestore()
  })

  it('does not throw and returns null when reading is denied', () => {
    vi.spyOn(MemStorage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    expect(loadDraft('room-1')).toBeNull()
  })

  it('does not throw when clearing is denied', () => {
    vi.spyOn(MemStorage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied') })
    expect(() => clearDraft('room-1')).not.toThrow()
  })
})

describe('quantization and thinning', () => {
  const decimals = (n: number) => (String(n).split('.')[1] ?? '').length

  it('rounds stored coordinates to 4 decimal places', () => {
    let d = beginStroke(emptyDraft(), 'cut', 0.1, undefined, [1 / 3, 2 / 3])
    d = extendStroke(d, [Math.PI / 4, Math.E / 4])
    for (const [x, y] of d.active!.points) {
      expect(decimals(x)).toBeLessThanOrEqual(4)
      expect(decimals(y)).toBeLessThanOrEqual(4)
    }
    expect(d.active!.points[0]).toEqual([0.3333, 0.6667])
  })

  it('skips a point closer than one canvas pixel to the previous point', () => {
    let d = beginStroke(emptyDraft(), 'cut', 0.1, undefined, [0.5, 0.5])
    for (let i = 0; i < 300; i++) d = extendStroke(d, [0.5 + 0.1 / CANVAS_W, 0.5])
    expect(d.active!.points).toHaveLength(1)
  })

  it('keeps a point at least one canvas pixel away', () => {
    let d = beginStroke(emptyDraft(), 'cut', 0.1, undefined, [0.5, 0.5])
    d = extendStroke(d, [0.5 + 1.5 / CANVAS_W, 0.5])
    expect(d.active!.points).toHaveLength(2)
  })

  it('measures the gap against the last KEPT point, so a slow drag still advances', () => {
    let d = beginStroke(emptyDraft(), 'cut', 0.1, undefined, [0.1, 0.5])
    for (let i = 1; i <= 100; i++) d = extendStroke(d, [0.1 + (i * 0.3) / CANVAS_W, 0.5])
    expect(d.active!.points.length).toBeGreaterThan(20)
  })

  /** One continuous drag: a serpentine of `samples` pointer samples, `stepPx` apart. */
  function serpentine(samples: number, stepPx: number) {
    let d = beginStroke(emptyDraft(), 'cut', 0.08, undefined, [0.001, 0.001])
    let x = 0.001, y = 0.001, dir = 1
    const step = stepPx / CANVAS_W
    for (let i = 0; i < samples; i++) {
      x += dir * step * (1 + Math.sin(i) * 1e-3) // irrational-ish floats, like a real pointer
      if (x > 0.999 || x < 0.001) {
        dir = -dir
        y += 6 / CANVAS_H
        x = Math.min(0.999, Math.max(0.001, x))
        if (y > 0.999) { // keep sweeping: start another stroke at the top
          d = beginStroke(endStroke(d), 'cut', 0.08, undefined, [0.001, 0.001]); y = 0.001
        }
      }
      d = extendStroke(d, [x, y])
    }
    const strokes = allStrokes(endStroke(d))
    const points = strokes.reduce((n, s) => n + s.points.length, 0)
    const bytes = new TextEncoder().encode(JSON.stringify({ type: 'SUBMIT', strokes })).length
    return { points, bytes }
  }

  it('keeps the stated worst case (3 min at 60Hz, every sample kept) well under 1 MiB', () => {
    const { points, bytes } = serpentine(3 * 60 * 60, 1.7)
    console.log(`60Hz worst-case: ${points} points, ${bytes} bytes`)
    expect(points).toBeGreaterThan(10_000) // the input really was dense, not thinned to nothing
    expect(bytes).toBeLessThan(256 * 1024) // under a quarter of the 1 MiB frame limit
  })

  it('stays under the limit even at 240Hz coalesced sampling for 3 minutes', () => {
    const { points, bytes } = serpentine(3 * 60 * 240, 1.7)
    console.log(`240Hz worst-case: ${points} points, ${bytes} bytes`)
    expect(points).toBeGreaterThan(40_000)
    expect(bytes).toBeLessThan(768 * 1024) // 75% of 1 MiB at 4x the stated rate
  })

  it('serializes quantized points far smaller than raw floats would', () => {
    const raw = JSON.stringify([[0.123456789012345, 0.987654321098765]])
    let d = beginStroke(emptyDraft(), 'cut', 0.1, undefined, [0.123456789012345, 0.987654321098765])
    d = endStroke(d)
    expect(JSON.stringify(d.strokes[0]!.points).length).toBeLessThan(raw.length - 10)
  })
})
