import { CANVAS_H, CANVAS_W, type Stroke } from '@tg/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  allStrokes, beginStroke, clearDraft, emptyDraft, endStroke,
  extendStroke, isFull, loadDraft, MAX_POINTS, MAX_STROKES, saveDraft, undo,
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
    // Steps larger than a brush radius are interpolated, so there may be more
    // than three points, but the path still ends exactly where the pointer did.
    expect(d.active!.points.length).toBeGreaterThanOrEqual(3)
    expect(d.active!.points.at(-1)).toEqual([0.3, 0.3])
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
    let d = beginStroke(emptyDraft(), 'cut', 0.002, undefined, [0.5, 0.5])
    d = extendStroke(d, [0.5 + 1.4 / CANVAS_W, 0.5])
    expect(d.active!.points).toHaveLength(2)
  })

  it('measures the gap against the last KEPT point, so a slow drag still advances', () => {
    let d = beginStroke(emptyDraft(), 'cut', 0.002, undefined, [0.1, 0.5])
    for (let i = 1; i <= 100; i++) d = extendStroke(d, [0.1 + (i * 0.3) / CANVAS_W, 0.5])
    expect(d.active!.points.length).toBeGreaterThan(20)
  })

  const radiusPx = (size: number) => (size * CANVAS_W) / 2

  it('makes the minimum step proportional to brush radius (about r/4)', () => {
    const small = beginStroke(emptyDraft(), 'cut', 0.002, undefined, [0.5, 0.5])
    const big = beginStroke(emptyDraft(), 'cut', 0.2, undefined, [0.5, 0.5]) // r = 51px, step ~12.8px
    for (const d of [small, big]) extendStroke(d, [0.5 + 1.4 / CANVAS_W, 0.5])
    expect(small.active!.points).toHaveLength(2)
    expect(big.active!.points).toHaveLength(1)
  })

  it('raises the minimum step as the pumpkin fills, without touching earlier points', () => {
    const fresh = beginStroke(emptyDraft(), 'cut', 0.03, undefined, [0.5, 0.5])
    const filler: Stroke[] = [{ tool: 'cut', size: 0.03, points: Array.from({ length: MAX_POINTS * 0.8 }, () => [0.1, 0.1] as [number, number]) }]
    const loaded = beginStroke({ strokes: filler, active: null }, 'cut', 0.03, undefined, [0.5, 0.5])
    const before = filler[0]!.points.length
    const gap = 3 / CANVAS_W // above the fresh step (~1.9px), below the loaded one (~4.9px)
    extendStroke(fresh, [0.5 + gap, 0.5])
    extendStroke(loaded, [0.5 + gap, 0.5])
    expect(fresh.active!.points).toHaveLength(2)
    expect(loaded.active!.points).toHaveLength(1)
    expect(filler[0]!.points).toHaveLength(before)
  })

  it('interpolates a fast flick in the data so the line has no gaps', () => {
    let d = beginStroke(emptyDraft(), 'cut', 0.03, undefined, [0.1, 0.5])
    d = extendStroke(d, [0.9, 0.5]) // 410px in one sample, radius 7.7px
    const pts = d.active!.points
    expect(pts.at(-1)).toEqual([0.9, 0.5])
    for (let i = 1; i < pts.length; i++) {
      const gap = Math.hypot((pts[i]![0] - pts[i - 1]![0]) * CANVAS_W, (pts[i]![1] - pts[i - 1]![1]) * CANVAS_H)
      expect(gap).toBeLessThanOrEqual(radiusPx(0.03) + 0.1)
    }
  })

  it('mutates the in-progress stroke instead of copying it per sample', () => {
    const d0 = beginStroke(emptyDraft(), 'cut', 0.03, undefined, [0.1, 0.1])
    const pts = d0.active!.points
    extendStroke(d0, [0.2, 0.2])
    expect(d0.active!.points).toBe(pts)
  })

  /** One continuous drag: a serpentine of `samples` pointer samples, `stepPx` apart. */
  function serpentine(samples: number, stepPx: number, size = 0.03) {
    let d = beginStroke(emptyDraft(), 'cut', size, undefined, [0.001, 0.001])
    let x = 0.001, y = 0.001, dir = 1
    const step = stepPx / CANVAS_W
    for (let i = 0; i < samples; i++) {
      x += dir * step * (1 + Math.sin(i) * 1e-3) // irrational-ish floats, like a real pointer
      if (x > 0.999 || x < 0.001) {
        dir = -dir
        y += 6 / CANVAS_H
        x = Math.min(0.999, Math.max(0.001, x))
        if (y > 0.999) { // keep sweeping: start another stroke at the top
          d = beginStroke(endStroke(d), 'cut', size, undefined, [0.001, 0.001]); y = 0.001
        }
      }
      d = extendStroke(d, [x, y])
    }
    d = endStroke(d)
    const bytes = new TextEncoder().encode(JSON.stringify({ type: 'SUBMIT', strokes: d.strokes })).length
    const points = d.strokes.reduce((n, s) => n + s.points.length, 0)
    return { d, points, bytes }
  }

  const MIB = 1024 * 1024

  it('worst case 1: 3 min at 60Hz with the smallest brush stays far under 1 MiB', () => {
    const { points, bytes } = serpentine(3 * 60 * 60, 2)
    console.log(`60Hz minimum-brush: ${points} points, ${bytes} bytes`)
    expect(points).toBeGreaterThan(5_000) // the drag was genuinely dense
    expect(bytes).toBeLessThan(256 * 1024)
  })

  it('worst case 2: 3 min at 1000Hz hits the point ceiling and stays under 400 KB', () => {
    const { d, points, bytes } = serpentine(3 * 60 * 1000, 2)
    console.log(`1000Hz minimum-brush: ${points} points, ${bytes} bytes`)
    expect(points).toBeLessThanOrEqual(MAX_POINTS)
    expect(isFull(d)).toBe(true)
    expect(bytes).toBeLessThan(400 * 1024)
    expect(bytes).toBeLessThan(MIB / 2)
  })

  it('worst case 3: tap spam cannot exceed the stroke ceiling', () => {
    let d = emptyDraft()
    for (let i = 0; i < 20_000; i++) {
      d = endStroke(beginStroke(d, 'stamp', 0.03, 'zigzag', [(i % 97) / 97, (i % 89) / 89]))
    }
    const bytes = JSON.stringify({ type: 'SUBMIT', strokes: d.strokes }).length
    console.log(`tap spam: ${d.strokes.length} strokes, ${bytes} bytes`)
    expect(d.strokes).toHaveLength(MAX_STROKES)
    expect(isFull(d)).toBe(true)
    expect(beginStroke(d, 'cut', 0.1, undefined, [0.5, 0.5]).active).toBeNull()
    expect(bytes).toBeLessThan(200 * 1024)
  })

  it('worst case 4: many strokes each at the ceiling together stay under budget', () => {
    let d = emptyDraft()
    for (let s = 0; s < MAX_STROKES; s++) {
      d = beginStroke(d, 'cut', 0.03, undefined, [0.01, (s % 600) / 640 + 0.01])
      for (let i = 1; i <= 40; i++) d = extendStroke(d, [0.01 + (i * 2.5) / CANVAS_W, (s % 600) / 640 + 0.01])
      d = endStroke(d)
    }
    const bytes = JSON.stringify({ type: 'SUBMIT', strokes: d.strokes }).length
    const points = d.strokes.reduce((n, s) => n + s.points.length, 0)
    console.log(`multi-stroke: ${d.strokes.length} strokes, ${points} points, ${bytes} bytes`)
    expect(points).toBeLessThanOrEqual(MAX_POINTS)
    expect(bytes).toBeLessThan(400 * 1024)
  })

  it('rejects malformed drafts instead of handing them to the renderer', () => {
    const bad = [
      [{ tool: 'cut' }],
      [{ tool: 'cut', size: 0.1, points: [[2, 0.5]] }],
      [{ tool: 'melt', size: 0.1, points: [[0.5, 0.5]] }],
      [{ tool: 'stamp', size: 0.1, shape: 'dragon', points: [[0.5, 0.5]] }],
      [{ tool: 'cut', size: 0.1, points: [[0.5]] }],
      { not: 'an array' },
    ]
    vi.stubGlobal('localStorage', new MemStorage())
    for (const b of bad) {
      localStorage.setItem('tg:draft:room-1', JSON.stringify(b))
      expect(loadDraft('room-1')).toBeNull()
    }
    vi.unstubAllGlobals()
  })

  it('serializes quantized points far smaller than raw floats would', () => {
    const raw = JSON.stringify([[0.123456789012345, 0.987654321098765]])
    let d = beginStroke(emptyDraft(), 'cut', 0.1, undefined, [0.123456789012345, 0.987654321098765])
    d = endStroke(d)
    expect(JSON.stringify(d.strokes[0]!.points).length).toBeLessThan(raw.length - 10)
  })
})
