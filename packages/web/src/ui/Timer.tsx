import { useEffect, useState } from 'react'
import { remainingMs, useConnection } from '../store/connection.js'

export function Timer() {
  const endsAt = useConnection(s => s.endsAt)
  const clockOffset = useConnection(s => s.clockOffset)
  const [ms, setMs] = useState(() => remainingMs(endsAt, clockOffset))

  useEffect(() => {
    if (endsAt === null) return
    let frame = 0
    const tick = () => {
      setMs(remainingMs(endsAt, clockOffset))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [endsAt, clockOffset])

  if (endsAt === null) return null
  const total = Math.ceil(ms / 1000)
  return (
    <span aria-live="off" style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>
      {Math.floor(total / 60)}:{String(total % 60).padStart(2, '0')}
    </span>
  )
}
