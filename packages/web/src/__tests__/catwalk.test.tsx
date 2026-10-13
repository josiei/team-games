import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import type { AwardKey, GalleryEntry } from '@tg/shared'
import { ACT_MS, Catwalk, actsFrom, prefersReducedMotion } from '../games/pumpkin/Catwalk.js'

const entry = (slot: number): GalleryEntry =>
  ({ slot, strokes: [], integrity: 'solid' }) as GalleryEntry

const WINNERS = {
  scariest: { slot: 0, votes: 3 },
  funniest: { slot: 1, votes: 2 },
  craft: { slot: 2, votes: 1 },
  cursed: { slot: 3, votes: 4 },
} satisfies Partial<Record<AwardKey, { slot: number; votes: number }>>

const GALLERY = [entry(0), entry(1), entry(2), entry(3)]
const nameFor = (slot: number) => `Carver ${slot}`

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

/**
 * One act. The next timer is only scheduled once React has committed the new
 * index, so a single advance moves the show exactly one walker on however far
 * the clock is pushed.
 */
const step = () => act(() => { vi.advanceTimersByTime(ACT_MS) })

describe('actsFrom', () => {
  it('runs the show in its own order, not the grid order', () => {
    expect(actsFrom(WINNERS, GALLERY, nameFor).map(a => a.award))
      .toEqual(['cursed', 'scariest', 'craft', 'funniest'])
  })

  it('leaves out an award nobody won', () => {
    const { craft: _omitted, ...rest } = WINNERS
    expect(actsFrom(rest, GALLERY, nameFor).map(a => a.award))
      .toEqual(['cursed', 'scariest', 'funniest'])
  })

  it('leaves out a winner whose pumpkin is missing rather than throwing', () => {
    // The award was decided; only its pumpkin is absent from the gallery. The
    // show is a flourish and must never be what breaks the results screen.
    const acts = actsFrom(WINNERS, [entry(0), entry(1)], nameFor)
    expect(acts.map(a => a.award)).toEqual(['scariest', 'funniest'])
  })

  it('carries the carver and the vote count onto the plate', () => {
    const [first] = actsFrom(WINNERS, GALLERY, nameFor)
    expect(first).toMatchObject({ award: 'cursed', carver: 'Carver 3', votes: 4 })
  })

  it('returns nothing when no award was decided', () => {
    expect(actsFrom({}, GALLERY, nameFor)).toEqual([])
  })

  it('treats a null award the way the server sends one', () => {
    // tally() returns AwardResult = { slot, votes } | null, not undefined: an
    // award with no votes arrives as an explicit null.
    expect(actsFrom({ ...WINNERS, craft: null }, GALLERY, nameFor).map(a => a.award))
      .toEqual(['cursed', 'scariest', 'funniest'])
  })
})

describe('prefersReducedMotion', () => {
  it('skips the show where matchMedia cannot answer', () => {
    // jsdom has no matchMedia. Somewhere that cannot answer the question should
    // not be handed a 13-second animation.
    vi.stubGlobal('matchMedia', undefined)
    expect(prefersReducedMotion()).toBe(true)
  })

  it('follows the system setting when it can be read', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce') }))
    expect(prefersReducedMotion()).toBe(true)
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    expect(prefersReducedMotion()).toBe(false)
  })
})

describe('Catwalk', () => {
  it('walks one winner at a time, in order, then hands back', () => {
    vi.useFakeTimers()
    const acts = actsFrom(WINNERS, GALLERY, nameFor)
    const onDone = vi.fn()
    render(<Catwalk acts={acts} onDone={onDone} />)

    expect(screen.getByText(/Most Cursed/)).toBeTruthy()
    expect(screen.getByText('Carver 3')).toBeTruthy()
    expect(screen.getByText('4 votes')).toBeTruthy()

    step()
    expect(screen.getByText(/Scariest/)).toBeTruthy()
    expect(screen.queryByText(/Most Cursed/)).toBeNull()

    step()
    expect(screen.getByText(/Best Craftsmanship/)).toBeTruthy()

    step()
    expect(screen.getByText(/Funniest/)).toBeTruthy()
    expect(onDone).not.toHaveBeenCalled()

    // Only after the last walker leaves does the grid get its turn.
    step()
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('says "vote" for a single vote', () => {
    vi.useFakeTimers()
    const acts = actsFrom({ craft: { slot: 2, votes: 1 } }, GALLERY, nameFor)
    render(<Catwalk acts={acts} onDone={() => {}} />)
    expect(screen.getByText('1 vote')).toBeTruthy()
  })

  it('restarts the animations for each walker rather than reusing the nodes', () => {
    vi.useFakeTimers()
    const acts = actsFrom(WINNERS, GALLERY, nameFor)
    const { container } = render(<Catwalk acts={acts} onDone={() => {}} />)
    const first = container.querySelector('.walker')
    step()
    // A reused node would keep its animation mid-flight, so the second walker
    // would appear already standing on her mark.
    expect(container.querySelector('.walker')).not.toBe(first)
  })

  it('marks progress so the room can see the show has an end', () => {
    vi.useFakeTimers()
    const acts = actsFrom(WINNERS, GALLERY, nameFor)
    const { container } = render(<Catwalk acts={acts} onDone={() => {}} />)
    const classesAt = () => [...container.querySelectorAll('.catwalk-dots li')]
      .map(li => li.className)
    expect(classesAt()).toEqual(['is-now', '', '', ''])
    step(); step()
    expect(classesAt()).toEqual(['is-done', 'is-done', 'is-now', ''])
  })
})
