import { useConnection } from '../store/connection.js'
import { useSecondsLeft } from './useSecondsLeft.js'

/** The room clock, as m:ss. The counting itself lives in useSecondsLeft. */
export function Timer() {
  const endsAt = useConnection(s => s.endsAt)
  const clockOffset = useConnection(s => s.clockOffset)
  const total = useSecondsLeft(endsAt, clockOffset)

  if (endsAt === null) return null
  return (
    <span aria-live="off" style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>
      {Math.floor(total / 60)}:{String(total % 60).padStart(2, '0')}
    </span>
  )
}
