import { describe, expect, it } from 'vitest'
import { CANVAS_H, CANVAS_W } from '@tg/shared'
import { CUT_PAINT, FALLBACK_SKIN, STEM_RISE, seamsFor, shade, stemTop } from '../games/pumpkin/canvas.js'
import { VARIETIES, bodyFor, lobesFor, varietyFor } from '../games/pumpkin/varieties.js'

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

  // Its result goes straight into addColorStop, which THROWS on a colour it
  // cannot read — and from the carve screen that is a blank canvas on every
  // animation frame. Grey is wrong and obvious; blank is neither.
  it('falls back to grey rather than handing on something unreadable', () => {
    for (const input of ['orange', '#fff', 'rgb(1,2,3)', '', '#ff751']) {
      expect(shade(input, 0.3)).toBe(FALLBACK_SKIN)
    }
  })
})

describe('the cut paint', () => {
  // A cut is `destination-out`, which removes only as much as the source's own
  // alpha. Inheriting the body's shading (a gradient that is transparent in the
  // middle) left cuts barely cutting.
  it('is opaque', () => {
    expect(CUT_PAINT).toMatch(/^#[0-9a-f]{3,8}$/i)
    expect(CUT_PAINT).not.toMatch(/^#[0-9a-f]{6}00$/i)
  })
})

describe('every variety', () => {
  const inBody = (v: (typeof VARIETIES)[number], x: number, y: number) => {
    const body = bodyFor(v)
    return lobesFor(v).some(lobe => {
      const dx = (x - (body.cx + lobe.dx * body.rx)) / (lobe.rx * body.rx)
      const dy = (y - body.cy) / (lobe.ry * body.ry)
      return dx * dx + dy * dy <= 1
    })
  }

  const area = (v: (typeof VARIETIES)[number]) => {
    let inside = 0
    const step = 2
    for (let y = 0; y < CANVAS_H; y += step) {
      for (let x = 0; x < CANVAS_W; x += step) if (inBody(v, x, y)) inside += step * step
    }
    return inside
  }

  it.each(VARIETIES.map(v => [v.name, v] as const))('%s fits the canvas', (_name, v) => {
    const body = bodyFor(v)
    expect(body.cx - body.rx).toBeGreaterThanOrEqual(0)
    expect(body.cx + body.rx).toBeLessThanOrEqual(CANVAS_W)
    expect(body.cy - body.ry).toBeGreaterThanOrEqual(0)
    expect(body.cy + body.ry).toBeLessThanOrEqual(CANVAS_H)
  })

  // The stem is drawn outside the body's box, so the box fitting is not enough.
  it.each(VARIETIES.map(v => [v.name, v] as const))('%s keeps its stem on screen', (_name, v) => {
    expect(stemTop(v, bodyFor(v))).toBeGreaterThanOrEqual(0)
  })

  it.each(VARIETIES.map(v => [v.name, v] as const))('%s is symmetric', (_name, v) => {
    const lobes = lobesFor(v)
    for (const lobe of lobes) {
      const mirror = lobes.find(l => Math.abs(l.dx + lobe.dx) < 1e-9)
      expect(mirror, `no mirror for dx=${lobe.dx}`).toBeDefined()
      // Mirrored, to the last ULP of Math.pow — not bit-identical.
      expect(mirror!.rx).toBeCloseTo(lobe.rx, 12)
      expect(mirror!.ry).toBeCloseTo(lobe.ry, 12)
    }
    // Each outermost lobe ends exactly on rx: one short of it dents that side.
    const reach = Math.max(...lobes.map(l => Math.abs(l.dx)))
    const outer = lobes.filter(l => Math.abs(l.dx) === reach)
    expect(outer).toHaveLength(2)
    for (const lobe of outer) expect(Math.abs(lobe.dx) + lobe.rx).toBeCloseTo(1, 5)
  })

  it.each(VARIETIES.map(v => [v.name, v] as const))('%s has a seam between each pair of lobes', (_name, v) => {
    expect(seamsFor(v)).toHaveLength(v.lobes - 1)
  })

  /**
   * `carvedRatio` measures cut area against the whole canvas, not against the
   * pumpkin, so a body's area decides how much visible carving it takes to sag
   * or collapse. Nobody may be handed a smaller pumpkin than their neighbour:
   * it would mean more of their carving landing outside it, invisible but
   * still counting toward collapse.
   */
  it('is within 3% of the others in area', () => {
    const areas = VARIETIES.map(area)
    expect(Math.max(...areas) / Math.min(...areas)).toBeLessThan(1.03)
  })

  /**
   * And the whole set sits deliberately ABOVE the plain ellipse these replaced,
   * which moves the integrity thresholds: the old body covered 0.553 of the
   * canvas, under some collapse thresholds, so "collapsed" was unreachable by
   * carving for about half of all seeds. These cover ~0.60, which puts it back
   * within reach for every seed. Tight bounds, so the next art change cannot
   * move the game's difficulty without someone deciding to.
   */
  it('covers the canvas fraction the integrity thresholds were set against', () => {
    const ellipse = Math.PI * (CANVAS_W * 0.44) * (CANVAS_H * 0.4)
    for (const v of VARIETIES) {
      const ratio = area(v) / ellipse
      expect(ratio, v.name).toBeGreaterThan(1.05)
      expect(ratio, v.name).toBeLessThan(1.13)
    }
  })
})

describe('varietyFor', () => {
  it('gives the same slot the same pumpkin every time', () => {
    for (let slot = 0; slot < 8; slot++) {
      expect(varietyFor('ABC123', slot)).toBe(varietyFor('ABC123', slot))
    }
  })

  it('gives the next room a different hand', () => {
    const a = Array.from({ length: 8 }, (_, i) => varietyFor('ABC123', i).name)
    const b = Array.from({ length: 8 }, (_, i) => varietyFor('ZXY987', i).name)
    expect(a).not.toEqual(b)
  })

  it('reaches every variety across rooms, rather than favouring one', () => {
    const seen = new Set<string>()
    for (let room = 0; room < 40; room++) {
      for (let slot = 0; slot < 8; slot++) seen.add(varietyFor(`ROOM${room}`, slot).name)
    }
    expect(seen.size).toBe(VARIETIES.length)
  })

  it('spreads a single room across several varieties', () => {
    // Eight players should not all be handed the same gourd. Checked over many
    // rooms rather than one, so this is about the hash, not about luck.
    let singles = 0
    for (let room = 0; room < 50; room++) {
      const names = new Set(Array.from({ length: 8 }, (_, i) => varietyFor(`R${room}`, i).name))
      if (names.size < 3) singles++
    }
    expect(singles).toBe(0)
  })

  it('never returns something undrawable', () => {
    for (let slot = 0; slot < 50; slot++) {
      const v = varietyFor('ABC123', slot)
      expect(VARIETIES).toContain(v)
      expect(STEM_RISE[v.stem]).toBeGreaterThan(0)
    }
  })
})
