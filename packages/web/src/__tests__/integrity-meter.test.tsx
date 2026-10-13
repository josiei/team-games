import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { IntegrityMeter } from '../games/pumpkin/IntegrityMeter.js'

describe('IntegrityMeter', () => {
  it('labels a solid pumpkin in words, not only color', () => {
    render(<IntegrityMeter ratio={0.1} integrity="solid" />)
    expect(screen.getByText(/solid/i)).toBeTruthy()
  })

  it('labels a sagging pumpkin in words', () => {
    render(<IntegrityMeter ratio={0.45} integrity="sagging" />)
    expect(screen.getByText(/sagging/i)).toBeTruthy()
  })

  it('labels a collapsed pumpkin in words', () => {
    render(<IntegrityMeter ratio={0.6} integrity="collapsed" />)
    expect(screen.getByText(/collapsed/i)).toBeTruthy()
  })

  it('shows cracks as a shape cue alongside the color shift', () => {
    const { container } = render(<IntegrityMeter ratio={0.45} integrity="sagging" />)
    expect(container.querySelectorAll('[data-crack]').length).toBeGreaterThan(0)
  })

  it('shows no cracks while solid', () => {
    const { container } = render(<IntegrityMeter ratio={0.1} integrity="solid" />)
    expect(container.querySelectorAll('[data-crack]')).toHaveLength(0)
  })

  it('exposes progress to assistive tech without revealing the threshold', () => {
    render(<IntegrityMeter ratio={0.45} integrity="sagging" />)
    const meter = screen.getByRole('meter')
    expect(meter.getAttribute('aria-valuetext')).toMatch(/sagging/i)
    expect(meter.hasAttribute('aria-valuenow')).toBe(false)
  })
})
