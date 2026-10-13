import { describe, expect, it } from 'vitest'
import { CANVAS_W, CANVAS_H, carvedRatio, type Stroke } from '@tg/shared'
import { strokeOps } from '../games/pumpkin/canvas.js'

// jsdom has no 2D context, and a test against a mocked one would test the
// mock. The painter only ever executes `strokeOps`, so the ordering contract is
// pinned here: replay the ops into an occupancy grid with carvedRatio's own
// resolution and rule, and require the SAME answer as carvedRatio.
const GX = 64, GY = 80
function replayRatio(strokes: Stroke[]): number {
  const grid = new Uint8Array(GX * GY)
  for (const stroke of strokes) {
    for (const op of strokeOps(stroke)) {
      const px = op.x / CANVAS_W, py = op.y / CANVAS_H, radius = Math.max(op.r / CANVAS_W, 1 / GX)
      for (let gy = 0; gy < GY; gy++) {
        for (let gx = 0; gx < GX; gx++) {
          const dx = (gx + 0.5) / GX - px, dy = (gy + 0.5) / GY - py
          if (dx * dx + dy * dy <= radius * radius) grid[gy * GX + gx] = op.kind === 'cut' ? 1 : 0
        }
      }
    }
  }
  return grid.reduce((n, v) => n + v, 0) / grid.length
}

const at = (tool: Stroke['tool']): Stroke => ({ tool, size: 0.2, points: [[0.5, 0.5]] })

describe('stroke ops follow chronological order', () => {
  it('cut -> uncut -> re-cut leaves the region CUT, matching carvedRatio', () => {
    const strokes = [at('cut'), at('uncut'), at('cut')]
    expect(carvedRatio(strokes)).toBeGreaterThan(0)
    expect(replayRatio(strokes)).toBe(carvedRatio(strokes))
  })

  it('cut -> uncut leaves it restored, matching carvedRatio', () => {
    const strokes = [at('cut'), at('uncut')]
    expect(carvedRatio(strokes)).toBe(0)
    expect(replayRatio(strokes)).toBe(0)
  })

  it('emits ops stroke by stroke in array order, point by point', () => {
    const a: Stroke = { tool: 'cut', size: 0.1, points: [[0.1, 0.1], [0.2, 0.2]] }
    const b: Stroke = { tool: 'uncut', size: 0.1, points: [[0.3, 0.3]] }
    const kinds = [a, b].flatMap(s => strokeOps(s)).map(o => o.kind)
    expect(kinds).toEqual(['cut', 'cut', 'restore'])
  })

  it('resumes from a point index so only new points are applied', () => {
    const s: Stroke = { tool: 'cut', size: 0.1, points: [[0.1, 0.1], [0.2, 0.2], [0.3, 0.3]] }
    expect(strokeOps(s, 2)).toHaveLength(1)
    expect(strokeOps(s, 3)).toHaveLength(0)
  })
})
