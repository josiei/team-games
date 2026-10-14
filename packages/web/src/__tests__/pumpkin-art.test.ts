import { describe, expect, it } from 'vitest'
import { CANVAS_H, CANVAS_W } from '@tg/shared'
import { BODY, LOBES, fillFor, shade } from '../games/pumpkin/canvas.js'

describe('shade', () => {
  it('mixes toward white and toward black', () => {
    expect(shade('#808080', 1)).toBe('#ffffff')
    expect(shade('#808080', -1)).toBe('#000000')
    expect(shade('#808080', 0)).toBe('#808080')
  })

  it('clamps rather than wrapping past the ends', () => {
    expect(shade('#ff7518', 5)).toBe('#ffffff')
    expect(shade('#ff7518', -5)).toBe('#000000')
  })

  it('hands back anything it cannot read, so a theme cannot break the render', () => {
    for (const input of ['orange', '#fff', 'rgb(1,2,3)', '', '#ff751']) {
      expect(shade(input, 0.3)).toBe(input)
    }
  })
})

describe('fillFor', () => {
  const flesh = 'GRADIENT' as unknown as CanvasGradient

  // The bug this pins: a cut is `destination-out`, which removes only as much
  // as the source's alpha. Inheriting the body's shading left the cuts barely
  // cutting, and nothing in jsdom can catch that — there is no canvas here.
  it('cuts with an opaque colour, never with the body paint', () => {
    const paint = fillFor('cut', flesh)
    expect(paint).not.toBe(flesh)
    expect(paint).toBe('#000')
  })

  it('restores with the body paint, so an uncarve blends back in', () => {
    expect(fillFor('restore', flesh)).toBe(flesh)
  })
})

describe('the body', () => {
  const inBody = (x: number, y: number) => LOBES.some(lobe => {
    const dx = (x - (BODY.cx + lobe.dx * BODY.rx)) / (lobe.rx * BODY.rx)
    const dy = (y - BODY.cy) / (lobe.ry * BODY.ry)
    return dx * dx + dy * dy <= 1
  })

  it('stays inside the canvas', () => {
    expect(BODY.cx - BODY.rx).toBeGreaterThanOrEqual(0)
    expect(BODY.cx + BODY.rx).toBeLessThanOrEqual(CANVAS_W)
    expect(BODY.cy - BODY.ry).toBeGreaterThanOrEqual(0)
    expect(BODY.cy + BODY.ry).toBeLessThanOrEqual(CANVAS_H)
  })

  it('is symmetric, and both outer lobes reach the edge of its box', () => {
    for (const lobe of LOBES) {
      const mirror = LOBES.find(l => Math.abs(l.dx + lobe.dx) < 1e-9)
      expect(mirror, `no mirror for dx=${lobe.dx}`).toBeDefined()
      expect([mirror!.rx, mirror!.ry]).toEqual([lobe.rx, lobe.ry])
    }
    // Each outermost lobe ends exactly on rx: one short of it dents that side.
    const reach = LOBES.map(l => Math.abs(l.dx) + l.rx)
    expect(Math.max(...reach)).toBeCloseTo(1, 5)
    const outer = LOBES.filter(l => Math.abs(l.dx) === Math.max(...LOBES.map(x => Math.abs(x.dx))))
    expect(outer).toHaveLength(2)
    for (const lobe of outer) expect(Math.abs(lobe.dx) + lobe.rx).toBeCloseTo(1, 5)
  })

  /**
   * `carvedRatio` measures cut area against the whole canvas, not against the
   * pumpkin, so the body's area sets how much visible carving it takes to sag
   * or collapse. Shrinking it silently makes the meter harsher.
   */
  it('keeps the area of the plain ellipse it replaced', () => {
    let inside = 0
    const step = 2
    for (let y = 0; y < CANVAS_H; y += step) {
      for (let x = 0; x < CANVAS_W; x += step) if (inBody(x, y)) inside += step * step
    }
    const before = Math.PI * (CANVAS_W * 0.44) * (CANVAS_H * 0.40)
    expect(inside / before).toBeGreaterThan(0.9)
    expect(inside / before).toBeLessThan(1.1)
  })
})
