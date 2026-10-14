import { useEffect, useState } from 'react'
import { ALL_IN_LINE, WAITING_ROTATE_MS, waitingLine } from './waiting.js'

/**
 * The bar that appears once your vote is in. It sticks to the bottom of the
 * viewport rather than sitting above the grid, because a panel inserted above
 * the pumpkins would shove them down the moment you tapped one — and the vote
 * stays changeable, so the thing you just tapped must not move.
 *
 * Mounted with `key={award}`, so the rotation starts fresh on every award
 * instead of carrying a stale line into the next one.
 */
export function VoteWaiting({ votedCount, totalVoters }: {
  votedCount: number
  totalVoters: number
}) {
  const [tick, setTick] = useState(0)
  const everyoneIn = votedCount >= totalVoters

  useEffect(() => {
    if (everyoneIn) return            // the room is about to move on
    const id = setInterval(() => setTick(t => t + 1), WAITING_ROTATE_MS)
    return () => clearInterval(id)
  }, [everyoneIn])

  // Guard the divide: a voting view with no voters should be impossible, and
  // must not paint NaN across the bar if it ever happens.
  const filled = totalVoters > 0
    ? Math.min(100, Math.max(0, (votedCount / totalVoters) * 100))
    : 0

  return (
    <aside className="vote-wait" aria-label="Your vote is in">
      <p className="vote-wait-line">{everyoneIn ? ALL_IN_LINE : waitingLine(tick)}</p>

      <div className="vote-wait-track" aria-hidden="true">
        <div className="vote-wait-fill" style={{ width: `${filled}%` }} />
      </div>

      {/* The count is the substance, so it is the part that gets announced. */}
      <p className="vote-wait-count" aria-live="polite">
        {votedCount} of {totalVoters} votes in
      </p>

      {/* Only while it is true: once the last vote lands the room moves on in
          well under a second, and inviting a change there is a lie. */}
      {!everyoneIn && (
        <p className="vote-wait-hint">Changed your mind? Tap another pumpkin.</p>
      )}
    </aside>
  )
}
