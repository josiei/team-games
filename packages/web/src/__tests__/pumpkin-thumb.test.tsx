import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { PumpkinThumb } from '../games/pumpkin/PumpkinThumb.js'
import { renderPumpkin } from '../games/pumpkin/canvas.js'

vi.mock('../games/pumpkin/canvas.js', () => ({ renderPumpkin: vi.fn() }))

const strokes = () => JSON.parse(JSON.stringify([
  { tool: 'cut', size: 0.1, points: [[0.5, 0.5], [0.6, 0.6]] },
]))
const entry = (over = {}) => ({ slot: 0, strokes: strokes(), integrity: 'solid' as const, ...over })

beforeEach(() => {
  vi.mocked(renderPumpkin).mockClear()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as never)
})

describe('PumpkinThumb rasterization', () => {
  it('does not repaint when a structurally-equal, newly-parsed entry arrives', () => {
    const { rerender } = render(<PumpkinThumb code="ROOM01" entry={entry()} />)
    expect(renderPumpkin).toHaveBeenCalledTimes(1)
    const next = entry()                                // fresh JSON.parse: new array identity
    expect(next.strokes).not.toBe(entry().strokes)
    rerender(<PumpkinThumb code="ROOM01" entry={next} />)
    rerender(<PumpkinThumb code="ROOM01" entry={entry()} />)
    expect(renderPumpkin).toHaveBeenCalledTimes(1)
  })

  it('repaints when the pumpkin really changes', () => {
    const { rerender } = render(<PumpkinThumb code="ROOM01" entry={entry()} />)
    rerender(<PumpkinThumb code="ROOM01" entry={entry({ integrity: 'collapsed' })} />)
    expect(renderPumpkin).toHaveBeenCalledTimes(2)
  })
})
