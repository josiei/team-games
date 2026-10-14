import { describe, expect, it } from 'vitest'
import { CANVAS_H, CANVAS_W, COLLAPSE_BASE, COLLAPSE_JITTER } from '@tg/shared'
import {
  CUT_PAINT, FALLBACK_SKIN, STEM_RISE, gradientOr, seamsFor, shade, stemTop,
} from '../games/pumpkin/canvas.js'
import { VARIETIES, bodyFor, lobesFor, varietyFor, type Variety } from '../games/pumpkin/varieties.js'

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

  // It used to accept only #rrggbb, so `#f70` — a colour any canvas reads, and
  // the one this repo's own test theme uses — came out grey.
  it('understands every hex form', () => {
    expect(shade('#fff', 0)).toBe('#ffffff')
    expect(shade('#f70', 0)).toBe('#ff7700')
    expect(shade('#808080ff', 1)).toBe('#ffffffff')
    expect(shade('#8888', 0)).toBe('#88888888')   // alpha carried, not mixed
  })

  // Flat-but-right beats shaded-but-grey: a colour this function cannot mix is
  // not necessarily one the canvas cannot draw.
  it('passes a colour it cannot mix through unchanged', () => {
    for (const input of ['orange', 'rgb(1,2,3)', 'hsl(20 90% 55%)', 'color-mix(in srgb, red, blue)']) {
      expect(shade(input, 0.3)).toBe(input)
    }
  })
})

describe('gradientOr', () => {
  const stub = () => ({ addColorStop(_at: number, colour: string) {
    // What a real canvas does: SyntaxError on a colour it cannot read.
    if (!/^(#|rgb|hsl|orange)/.test(colour)) throw new SyntaxError(colour)
  } }) as unknown as CanvasGradient

  it('builds the gradient when every stop is readable', () => {
    expect(gradientOr(stub, [[0, '#fff'], [1, 'orange']])).not.toBeNull()
  })

  /**
   * This is the only place that can tell an unreadable colour from one `shade`
   * simply does not mix, and it is where the damage was: `addColorStop` THROWS,
   * and the throw came from a per-frame render, so an unreadable accent meant a
   * blank canvas sixty times a second. Null here means one flat fill instead.
   */
  it('returns null rather than throwing on a colour the canvas cannot read', () => {
    expect(gradientOr(stub, [[0, '#fff'], [1, 'not-a-colour']])).toBeNull()
    expect(gradientOr(stub, [[0, '']])).toBeNull()
    expect(FALLBACK_SKIN).toMatch(/^#[0-9a-f]{6}$/i)
  })
})

describe('the cut paint', () => {
  // A cut is `destination-out`, which removes only as much as the source's own
  // alpha. Inheriting the body's shading (a gradient that is transparent in the
  // middle) left cuts barely cutting.
  //
  // Checked by PARSING the alpha, not by pattern. The previous pair of regexes
  // accepted `#0000` — four digits matched the first, five characters could not
  // match the second — which is a fully transparent paint: exactly the bug this
  // test is a memorial to, passing green.
  it('is fully opaque', () => {
    const m = /^#([0-9a-f]{3,8})$/i.exec(CUT_PAINT)
    expect(m, CUT_PAINT).not.toBeNull()
    const digits = m![1]!
    expect([3, 4, 6, 8]).toContain(digits.length)
    const alpha = digits.length === 4 ? parseInt(digits[3]!.repeat(2), 16)
      : digits.length === 8 ? parseInt(digits.slice(6), 16)
      : 255
    expect(alpha).toBe(255)
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

  /**
   * The stem is drawn outside the body's box, so the box fitting is not enough.
   *
   * `stemTop >= 0` on its own is a TAUTOLOGY — the clamp's own arithmetic makes
   * it true for every input, so it was a test that could not fail. What is
   * worth pinning is that the stem rises above the body (otherwise it is buried
   * in it) and by its full designed amount (otherwise the clamp is silently
   * eating the shape).
   */
  it.each(VARIETIES.map(v => [v.name, v] as const))('%s keeps its whole stem on screen', (_name, v) => {
    const body = bodyFor(v)
    const top = stemTop(v, body)
    const bodyTop = body.cy - body.ry
    expect(top).toBeGreaterThanOrEqual(0)
    expect(top).toBeLessThan(bodyTop)
    expect(bodyTop - top).toBe(STEM_RISE[v.stem])   // nothing clamped away
  })

  // And the clamp itself, which no shipped variety reaches: a body tall enough
  // to push its stem off the top must lose stem, not canvas.
  it('clamps a stem that would not fit, rather than cropping it', () => {
    const towering: Variety = { ...VARIETIES[0]!, m: 0.8, stem: 2 }
    const body = bodyFor(towering)
    expect(body.cy - body.ry).toBeLessThan(STEM_RISE[2])  // the clamp is engaged
    const top = stemTop(towering, body)
    expect(top).toBeGreaterThanOrEqual(0)
    expect(top).toBeLessThan(body.cy - body.ry)
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

  // Length alone is true by construction (`seamsFor` pushes once per gap), so
  // this checks WHERE each seam lands: strictly between its two lobes, in
  // order, inside the body.
  it.each(VARIETIES.map(v => [v.name, v] as const))('%s has a seam between each pair of lobes', (_name, v) => {
    const lobes = lobesFor(v)
    const seams = seamsFor(v)
    expect(seams).toHaveLength(v.lobes - 1)
    for (let i = 0; i < seams.length; i++) {
      expect(seams[i]!).toBeGreaterThan(lobes[i]!.dx)
      expect(seams[i]!).toBeLessThan(lobes[i + 1]!.dx)
      if (i > 0) expect(seams[i]!).toBeGreaterThan(seams[i - 1]!)
      expect(Math.abs(seams[i]!)).toBeLessThan(1)
    }
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
   * which moves the integrity thresholds. `carvedRatio` is cut area over the
   * WHOLE canvas, and `collapseThresholdFor` returns COLLAPSE_BASE ± JITTER —
   * so a body covering less than the top of that range cannot be collapsed by
   * carving at all for the unluckiest seeds, however much of it you cut away.
   * The old ellipse covered 0.553 and "collapsed" was unreachable for about
   * half of all seeds.
   *
   * The floor is DERIVED from those constants, not written down: it was 1.05x
   * the ellipse, which works out to 0.5806 of the canvas — under the 0.59
   * ceiling, so the exact regression this test exists to catch could have
   * walked past it green.
   */
  it('covers more of the canvas than the hardest collapse threshold', () => {
    const floor = COLLAPSE_BASE + COLLAPSE_JITTER
    for (const v of VARIETIES) {
      expect(area(v) / (CANVAS_W * CANVAS_H), v.name).toBeGreaterThan(floor)
    }
  })

  // And an upper bound, so the next art change cannot quietly make the game
  // easier either: a body that covered everything would put sag out of reach.
  it('stays within a hand\'s width of the body the thresholds were tuned against', () => {
    const ellipse = Math.PI * (CANVAS_W * 0.44) * (CANVAS_H * 0.4)
    for (const v of VARIETIES) {
      expect(area(v) / ellipse, v.name).toBeLessThan(1.13)
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
