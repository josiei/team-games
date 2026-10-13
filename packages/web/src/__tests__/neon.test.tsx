import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DEFAULT_TAGLINE, TAGLINES, pickTagline } from '../lobby/taglines.js'
import { NeonSign } from '../ui/NeonSign.js'
import { Spiral } from '../ui/Spiral.js'
import { pipColor } from '../ui/PlayerPip.js'

describe('taglines', () => {
  it('leads with the default, which is what a screenshot catches', () => {
    expect(TAGLINES[0]).toBe(DEFAULT_TAGLINE)
    expect(pickTagline(() => 0)).toBe(DEFAULT_TAGLINE)
  })

  it('can reach the last line', () => {
    expect(pickTagline(() => 0.9999)).toBe(TAGLINES[TAGLINES.length - 1])
  })

  it('spreads across the pool rather than always serving the first line', () => {
    // Returning TAGLINES[0] unconditionally would satisfy both the default and
    // the out-of-range cases, so pin an interior draw too.
    expect(pickTagline(() => 0.5)).toBe(TAGLINES[Math.floor(0.5 * TAGLINES.length)])
    expect(pickTagline(() => 0.5)).not.toBe(DEFAULT_TAGLINE)
  })

  it('falls back to the default rather than returning nothing', () => {
    // A random source returning exactly 1 (or worse) indexes past the end.
    expect(pickTagline(() => 1)).toBe(DEFAULT_TAGLINE)
    expect(pickTagline(() => -1)).toBe(DEFAULT_TAGLINE)
    expect(pickTagline(() => NaN)).toBe(DEFAULT_TAGLINE)
  })

  it('keeps every line within the house copy budget', () => {
    // Not a layout guarantee -- the script does not shrink, it wraps. This is
    // the editorial limit that keeps the sign to one script row at phone width.
    for (const line of TAGLINES) expect(line.length).toBeLessThanOrEqual(26)
  })
})

describe('NeonSign', () => {
  it('exposes one accessible name, whatever an engine makes of the split spans', () => {
    render(<NeonSign tagline={DEFAULT_TAGLINE} />)
    expect(screen.getByRole('heading', { name: 'Team Games' })).toBeTruthy()
    // The visible text is still the unsplit wordmark.
    expect(screen.getByRole('heading').textContent).toBe('TEAM GAMES')
  })

  it('shows the tagline it is given', () => {
    render(<NeonSign tagline="Fun, Allegedly" />)
    expect(screen.getByText('Fun, Allegedly')).toBeTruthy()
  })
})

function spiralPoints(): [number, number][] {
  const { container } = render(<Spiral />)
  return container.querySelector('path')!.getAttribute('d')!
    .replace(/^M /, '').split(' L ').map(p => p.split(',').map(Number) as [number, number])
}

const spiralRadii = () => spiralPoints().map(([x, y]) => Math.hypot(x - 100, y - 100))

describe('Spiral', () => {
  it('is decoration, so it stays out of the accessibility tree', () => {
    const { container } = render(<Spiral />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.getAttribute('focusable')).toBe('false')
  })

  it('starts the spiral at the centre of a non-negative viewBox', () => {
    // The spin rotates about the viewBox centre. If the spiral's own origin is
    // anywhere else, the whole figure orbits off the screen instead of turning
    // in place -- and a negative viewBox min makes browsers disagree about
    // where that centre is.
    const { container } = render(<Spiral />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('viewBox')).toBe('0 0 200 200')
    expect(container.querySelector('path')!.getAttribute('d')!.startsWith('M 100.00,100.00')).toBe(true)
  })

  it('reaches the corners, so a turning spiral never exposes a bare edge', () => {
    const radii = spiralRadii()
    expect(Math.max(...radii)).toBeGreaterThanOrEqual(100 * Math.SQRT2 - 1)
  })

  it('keeps an even gap between turns, so the bands stay regular', () => {
    // Max radius alone would pass even if the growth rate skipped turns. Sample
    // the radius each time the curve crosses the same ray (angle 0) and check
    // the gap: it must equal twice the 5-unit stroke, so band and gap match.
    const points = spiralPoints()
    const crossings: number[] = []
    for (let i = 1; i < points.length; i++) {
      const [px, py] = points[i - 1]!
      const [x, y] = points[i]!
      // The ray at angle 0 is y == 100 with x to the right of centre.
      if (x > 100 && (py < 100) !== (y < 100)) {
        crossings.push(Math.hypot(x - 100, y - 100))
      }
    }
    expect(crossings.length).toBeGreaterThan(5)
    const gaps = crossings.slice(1).map((r, i) => r - crossings[i]!)
    for (const gap of gaps) expect(gap).toBeCloseTo(10, 0)
  })

  it('steps by an even arc, so the outer turns are not visibly polygonal', () => {
    const points = spiralPoints()
    const chords = points.slice(1).map(([x, y], i) =>
      Math.hypot(x - points[i]![0], y - points[i]![1]))
    // A fixed angular step makes the outer chords grow with radius; an even arc
    // keeps them bounded. 6 units is the target, so nothing should far exceed it.
    expect(Math.max(...chords)).toBeLessThan(8)
  })

  it('draws one continuous path rather than per-turn segments', () => {
    const { container } = render(<Spiral />)
    const paths = container.querySelectorAll('path')
    expect(paths.length).toBe(1)
    expect(paths[0]!.getAttribute('d')!.length).toBeGreaterThan(1000)
  })
})

describe('pipColor', () => {
  it('gives the same player the same pumpkin every time', () => {
    expect(pipColor('player-one')).toBe(pipColor('player-one'))
  })

  it('returns a colour from the palette, never undefined', () => {
    for (const id of ['', 'a', 'player-one', '☃', 'x'.repeat(200)]) {
      expect(pipColor(id)).toMatch(/^#[0-9A-F]{6}$/)
    }
  })

  it('spreads ids across the whole palette rather than clustering', () => {
    const seen = new Set(
      Array.from({ length: 400 }, (_, i) => pipColor(`player-${i}`)))
    expect(seen.size).toBe(8)
  })
})
