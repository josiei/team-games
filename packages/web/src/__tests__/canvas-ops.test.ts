import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CANVAS_H, CANVAS_W, carvedRatio, type Stroke } from '@tg/shared'
import { DEFAULT_VARIETY, PumpkinPainter, RESTORE_PAD, strokeOps } from '../games/pumpkin/canvas.js'

// jsdom has no 2D context, so rasterization is covered by the Playwright test.
// What IS pinnable here is ORDER: the painter must apply strokes to the canvas
// in chronological order. A recording context captures every circle the painter
// fills (with its composite op), rebuilds that into strokes, and asks the real
// `carvedRatio` -- the server's judge -- whether the result matches the
// original. No grid rule is reimplemented; carvedRatio is the only oracle.
type Fill = { op: string; style: unknown; x: number; y: number; r: number }

/** Returned by createRadialGradient, so a fill can be told from a flat colour. */
const GRADIENT = { addColorStop() {}, isGradient: true }

function recordingContext() {
  const fills: Fill[] = []
  let pending: { x: number; y: number; r: number } | null = null
  let clipped: { x: number; y: number; r: number } | null = null
  let recorded = false
  let blits = 0
  const ctx = {
    globalCompositeOperation: 'source-over',
    fillStyle: '' as unknown,
    strokeStyle: '' as unknown,
    lineWidth: 0, lineCap: '', lineJoin: '',
    setTransform() {}, clearRect() {}, stroke() {},
    save() {},
    // Leaving the clip in place after a restore would mis-attribute later blits.
    restore() { clipped = null; recorded = false },
    createRadialGradient() { return GRADIENT },
    beginPath() { pending = null },
    arc(x: number, y: number, r: number) { pending = { x, y, r } },
    // An uncarve clips to the brush and blits the untouched body back, so it
    // is a clip+drawImage rather than a fill. Recorded as the same kind of
    // event, so the ordering check still sees every op in sequence.
    clip(path?: unknown) { if (path === undefined && pending) clipped = pending },
    drawImage() {
      // Only counts blits made THROUGH a brush clip: `ensure()` also blits, to
      // snapshot the pristine body, and that one is not a restore.
      if (!clipped) return
      blits++
      if (!recorded) {
        fills.push({ op: 'source-over', style: 'PRISTINE', ...clipped })
        recorded = true
      }
    },
    fill(path?: unknown) {
      if (path === undefined && pending) {
        fills.push({ op: ctx.globalCompositeOperation, style: ctx.fillStyle, ...pending })
      }
    },
  }
  return { ctx, fills, blits: () => blits }
}

const toStrokes = (fills: Fill[]): Stroke[] => fills.map(f => ({
  tool: f.op === 'destination-out' ? 'cut' : 'uncut',
  size: (f.r * 2) / CANVAS_W,
  points: [[f.x / CANVAS_W, f.y / CANVAS_H]] as [number, number][],
}))

let fake: ReturnType<typeof recordingContext>
beforeEach(() => {
  fake = recordingContext()
  vi.stubGlobal('Path2D', class {
    ellipse() {} moveTo() {} lineTo() {} arc() {} rect() {} closePath() {} quadraticCurveTo() {}
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fake.ctx as never)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

const at = (tool: Stroke['tool'], size: number): Stroke => ({ tool, size, points: [[0.5, 0.5]] })
const THEME = { accent: '#f70', glow: '#fc4', bg: '#000' }

describe('PumpkinPainter applies strokes in chronological order', () => {
  for (const size of [0.2, 0.03]) { // 0.03 is the slider minimum
    it(`cut -> uncut -> re-cut ends CUT, matching carvedRatio (brush ${size})`, () => {
      const strokes = [at('cut', size), at('uncut', size), at('cut', size)]
      const expected = carvedRatio(strokes)
      expect(expected).toBeGreaterThan(0)

      const painter = new PumpkinPainter()
      painter.sync(strokes, THEME, DEFAULT_VARIETY)
      expect(fake.fills.map(f => f.op)).toEqual(['destination-out', 'source-over', 'destination-out'])
      expect(carvedRatio(toStrokes(fake.fills))).toBe(expected)
    })

    it(`incremental sync and a reset replay agree (brush ${size})`, () => {
      const strokes = [at('cut', size), at('uncut', size), at('cut', size)]
      const incremental = new PumpkinPainter()
      for (let n = 1; n <= strokes.length; n++) incremental.sync(strokes.slice(0, n), THEME, DEFAULT_VARIETY)
      const incrementalFills = [...fake.fills]
      expect(incrementalFills).toHaveLength(3) // each stroke applied exactly once

      fake.fills.length = 0
      incremental.reset()
      incremental.sync(strokes, THEME, DEFAULT_VARIETY)
      expect(fake.fills).toEqual(incrementalFills)
    })
  }

  it('cut -> uncut leaves it restored, matching carvedRatio', () => {
    const strokes = [at('cut', 0.2), at('uncut', 0.2)]
    new PumpkinPainter().sync(strokes, THEME, DEFAULT_VARIETY)
    expect(carvedRatio(toStrokes(fake.fills))).toBe(carvedRatio(strokes))
    expect(carvedRatio(strokes)).toBe(0)
  })

  // A cut is `destination-out`, which removes only as much as the source's own
  // alpha. Inheriting the body's shading (a gradient that is transparent in the
  // middle) left cuts barely cutting, and no screenshot of a static pumpkin
  // shows it — the body looked right and the carving simply stopped.
  it('cuts with an opaque colour, and restores by putting the body back', () => {
    const strokes = [at('cut', 0.2), at('uncut', 0.2)]
    new PumpkinPainter().sync(strokes, THEME, DEFAULT_VARIETY)
    const [cut, restore] = fake.fills
    expect(cut!.op).toBe('destination-out')
    expect(typeof cut!.style).toBe('string')
    expect(cut!.style).not.toBe(GRADIENT)
    // An uncarve blits the untouched body, seams and shaded rim included.
    // Filling it with the flesh gradient instead put a flat bright patch over
    // the outer two thirds of the pumpkin, where the dark edge belongs.
    expect(restore!.style).toBe('PRISTINE')
  })

  /**
   * An unpadded uncarve left a bright 1px ring on the brush perimeter, which no
   * number of extra blits could clear: a cut is an antialiased fill, so the
   * pixels AT its radius are only partly removed, and a clip to that same
   * radius does not cover them. Measured in a real canvas: 254 differing
   * pixels at up to 63/255 before the padding, zero after it.
   */
  it("blits the body back wider than the brush, to cover the cut's antialiased edge", () => {
    const size = 0.2
    new PumpkinPainter().sync([at('cut', size), at('uncut', size)], THEME, DEFAULT_VARIETY)
    const [cut, restore] = fake.fills
    expect(RESTORE_PAD).toBeGreaterThan(0)
    expect(restore!.r).toBeCloseTo(cut!.r + RESTORE_PAD, 6)
    // Only by the padding, though: a restore that grew with the brush would
    // start eating neighbouring cuts the meter still counts.
    expect(restore!.r - cut!.r).toBeLessThan(2)
  })

  it('a stroke that grows between syncs paints only its new points', () => {
    const s: Stroke = { tool: 'cut', size: 0.1, points: [[0.2, 0.2]] }
    const painter = new PumpkinPainter()
    painter.sync([s], THEME, DEFAULT_VARIETY)
    s.points.push([0.3, 0.3], [0.4, 0.4])
    painter.sync([s], THEME, DEFAULT_VARIETY)
    painter.sync([s], THEME, DEFAULT_VARIETY)
    expect(fake.fills).toHaveLength(3)
  })
})

describe('strokeOps', () => {
  it('emits ops stroke by stroke in array order, point by point', () => {
    const a: Stroke = { tool: 'cut', size: 0.1, points: [[0.1, 0.1], [0.2, 0.2]] }
    const b: Stroke = { tool: 'uncut', size: 0.1, points: [[0.3, 0.3]] }
    expect([a, b].flatMap(s => strokeOps(s)).map(o => o.kind)).toEqual(['cut', 'cut', 'restore'])
  })

  it('resumes from a point index so only new points are applied', () => {
    const s: Stroke = { tool: 'cut', size: 0.1, points: [[0.1, 0.1], [0.2, 0.2], [0.3, 0.3]] }
    expect(strokeOps(s, 2)).toHaveLength(1)
    expect(strokeOps(s, 3)).toHaveLength(0)
  })
})
