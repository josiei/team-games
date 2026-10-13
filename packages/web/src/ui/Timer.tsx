import { useEffect, useState } from 'react'
import { remainingMs, useConnection } from '../store/connection.js'

const secondsLeft = (endsAt: number | null, clockOffset: number) =>
  Math.ceil(remainingMs(endsAt, clockOffset) / 1000)

export function Timer() {
  const endsAt = useConnection(s => s.endsAt)
  const clockOffset = useConnection(s => s.clockOffset)
  // Keyed by deadline: when the deadline changes, the stale value is ignored
  // on the very first render instead of flashing until the first frame.
  const [shown, setShown] = useState<{ key: string; secs: number } | null>(null)
  const key = `${endsAt}:${clockOffset}`

  useEffect(() => {
    if (endsAt === null) return
    let frame = 0
    const tick = () => {
      const secs = secondsLeft(endsAt, clockOffset)
      // Whole seconds: React bails out when unchanged, so ~1 render/second.
      setShown(prev => (prev && prev.key === key && prev.secs === secs ? prev : { key, secs }))
      if (secs > 0) frame = requestAnimationFrame(tick)   // stop at zero
    }
    tick()
    return () => cancelAnimationFrame(frame)
  }, [endsAt, clockOffset, key])

  if (endsAt === null) return null
  const total = shown && shown.key === key ? shown.secs : secondsLeft(endsAt, clockOffset)
  return (
    <span aria-live="off" style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>
      {Math.floor(total / 60)}:{String(total % 60).padStart(2, '0')}
    </span>
  )
}
