import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DEFAULT_TAGLINE, TAGLINES, pickTagline } from '../lobby/taglines.js'
import { NeonSign } from '../ui/NeonSign.js'
import { Spiral } from '../ui/Spiral.js'

describe('taglines', () => {
  it('leads with the default, which is what a screenshot catches', () => {
    expect(TAGLINES[0]).toBe(DEFAULT_TAGLINE)
    expect(pickTagline(() => 0)).toBe(DEFAULT_TAGLINE)
  })

  it('can reach the last line', () => {
    expect(pickTagline(() => 0.9999)).toBe(TAGLINES[TAGLINES.length - 1])
  })

  it('falls back to the default rather than returning nothing', () => {
    // A random source returning exactly 1 (or worse) indexes past the end.
    expect(pickTagline(() => 1)).toBe(DEFAULT_TAGLINE)
    expect(pickTagline(() => -1)).toBe(DEFAULT_TAGLINE)
  })

  it('keeps every line inside the width the sign gives the script', () => {
    for (const line of TAGLINES) expect(line.length).toBeLessThanOrEqual(26)
  })
})

describe('NeonSign', () => {
  it('reads as one name despite the flickering letter being its own span', () => {
    // Without the explicit label the split spans compute as "TEAM G A MES".
    render(<NeonSign tagline={DEFAULT_TAGLINE} />)
    expect(screen.getByRole('heading', { name: 'Team Games' })).toBeTruthy()
  })

  it('shows the tagline it is given', () => {
    render(<NeonSign tagline="Fun, Allegedly" />)
    expect(screen.getByText('Fun, Allegedly')).toBeTruthy()
  })
})

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
    const { container } = render(<Spiral />)
    const points = container.querySelector('path')!.getAttribute('d')!
      .replace(/^M /, '').split(' L ').map(p => p.split(',').map(Number) as [number, number])
    const furthest = Math.max(...points.map(([x, y]) => Math.hypot(x - 100, y - 100)))
    expect(furthest).toBeGreaterThanOrEqual(100 * Math.SQRT2 - 1)
  })

  it('draws one continuous path rather than per-turn segments', () => {
    const { container } = render(<Spiral />)
    const paths = container.querySelectorAll('path')
    expect(paths.length).toBe(1)
    expect(paths[0]!.getAttribute('d')!.length).toBeGreaterThan(1000)
  })
})
