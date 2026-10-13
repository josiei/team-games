import { describe, expect, it } from 'vitest'
import {
  carvedRatio, integrityState, collapseThresholdFor,
  COLLAPSE_BASE, COLLAPSE_JITTER, type Stroke,
} from '../carve.js'

const cut = (points: [number, number][], size = 0.1): Stroke =>
  ({ tool: 'cut', size, points })

describe('carvedRatio', () => {
  it('is zero for an uncarved pumpkin', () => {
    expect(carvedRatio([])).toBe(0)
  })

  it('memoizes on array identity: a repeat call with the same array does not recompute', () => {
    const strokes = [cut([[0.5, 0.5]], 0.2)]
    const first = carvedRatio(strokes)
    // Mutating in place is outside the contract (submitted arrays are frozen);
    // it is used here only to prove a recompute would have produced a different value.
    strokes.push(cut([[0.2, 0.2], [0.8, 0.8]], 0.3))
    expect(carvedRatio(strokes)).toBe(first)
    // A different array with the same contents is computed fresh and sees the change.
    expect(carvedRatio([...strokes])).toBeGreaterThan(first)
  })

  it('grows as more area is cut', () => {
    const small = carvedRatio([cut([[0.5, 0.5]], 0.05)])
    const large = carvedRatio([cut([[0.5, 0.5]], 0.2)])
    expect(large).toBeGreaterThan(small)
  })

  it('does not double-count overlapping strokes', () => {
    const once = carvedRatio([cut([[0.5, 0.5]], 0.1)])
    const twice = carvedRatio([cut([[0.5, 0.5]], 0.1), cut([[0.5, 0.5]], 0.1)])
    expect(twice).toBeCloseTo(once, 5)
  })

  it('subtracts area restored by the uncarve tool', () => {
    const carved = carvedRatio([cut([[0.5, 0.5]], 0.2)])
    const restored = carvedRatio([
      cut([[0.5, 0.5]], 0.2),
      { tool: 'uncut', size: 0.2, points: [[0.5, 0.5]] },
    ])
    expect(restored).toBeLessThan(carved)
  })

  it('never exceeds 1', () => {
    const everything = cut(
      Array.from({ length: 200 }, (_, i): [number, number] => [i / 200, (i % 20) / 20]),
      0.5,
    )
    expect(carvedRatio([everything])).toBeLessThanOrEqual(1)
  })
})

describe('integrityState', () => {
  it('reports solid below the sag threshold', () => {
    expect(integrityState(0.2, 0.55)).toBe('solid')
  })
  it('reports sagging between sag and collapse', () => {
    expect(integrityState(0.45, 0.55)).toBe('sagging')
  })
  it('reports collapsed at or past the per-pumpkin threshold', () => {
    expect(integrityState(0.56, 0.55)).toBe('collapsed')
  })
})

describe('collapseThresholdFor', () => {
  it('stays within the jitter band', () => {
    for (let i = 0; i < 50; i++) {
      const t = collapseThresholdFor(12345, i)
      expect(t).toBeGreaterThanOrEqual(COLLAPSE_BASE - COLLAPSE_JITTER)
      expect(t).toBeLessThanOrEqual(COLLAPSE_BASE + COLLAPSE_JITTER)
    }
  })

  it('is deterministic for a given seed and index', () => {
    expect(collapseThresholdFor(999, 3)).toBe(collapseThresholdFor(999, 3))
  })

  it('differs across players so nobody can read anothers threshold', () => {
    expect(collapseThresholdFor(999, 3)).not.toBe(collapseThresholdFor(999, 4))
  })
})
