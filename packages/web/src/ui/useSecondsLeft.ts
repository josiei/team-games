import { useEffect, useState } from 'react'
import { remainingMs } from '../store/connection.js'

/**
 * Four times a second. The displayed value is whole seconds, so this only
 * sets how late the display can be crossing a boundary, not how often it
 * re-renders.
 */
const TICK_MS = 250

const wholeSeconds = (endsAt: number | null, clockOffset: number) =>
  Math.ceil(remainingMs(endsAt, clockOffset) / 1000)

/**
 * Whole seconds left on the current deadline, counting down on its own.
 *
 * Deadlines arrive as absolute timestamps, so the number is derivable at any
 * moment — but only if something re-renders. Between a buzz and an answer the
 * server sends nothing at all, so a component that computes this once per
 * render shows a frozen number for the entire window: the player reads "12"
 * and cannot tell whether they have twelve seconds left or one. This hook is
 * what makes the number move.
 *
 * An interval rather than `requestAnimationFrame`: frames stop in a
 * background tab, and a player who tabs away mid-clue should find the clock
 * telling the truth when they come back, not resuming from where it froze.
 *
 * Keyed by deadline so a new phase shows its own count on the very first
 * render instead of flashing the previous phase's remainder for a tick.
 */
export function useSecondsLeft(endsAt: number | null, clockOffset: number): number {
  const [shown, setShown] = useState<{ key: string; secs: number } | null>(null)
  const key = `${endsAt}:${clockOffset}`

  useEffect(() => {
    if (endsAt === null) return
    const tick = () => {
      const secs = wholeSeconds(endsAt, clockOffset)
      // Whole seconds only: React bails out when the value is unchanged, so
      // this costs about one render per second rather than four.
      setShown(prev => (prev && prev.key === key && prev.secs === secs ? prev : { key, secs }))
      // Nothing left to count, and no reason to hold a timer open while the
      // room waits on the next snapshot.
      if (secs <= 0) clearInterval(id)
    }
    const id = setInterval(tick, TICK_MS)
    tick()
    return () => clearInterval(id)
  }, [endsAt, clockOffset, key])

  // On the render where the deadline changes the stored value still belongs
  // to the old one, so read fresh until its key catches up.
  return shown && shown.key === key ? shown.secs : wholeSeconds(endsAt, clockOffset)
}
