import {
  AWARD_KEYS, AWARD_LABELS,
  type AwardKey, type AwardResult, type GalleryEntry, type PlayerId,
} from '@tg/shared'
import { useState } from 'react'
import { useConnection } from '../../store/connection.js'
import { HostLine } from '../../ui/HostLine.js'
import { Spiral } from '../../ui/Spiral.js'
import { Catwalk, actsFrom, markShowSeen, prefersReducedMotion, showSeen } from './Catwalk.js'
import { PumpkinThumb } from './PumpkinThumb.js'
import '../../theme/neon.css'

type ResultsView = {
  kind: 'results'
  gallery: GalleryEntry[]
  winners: Record<AwardKey, AwardResult>
  carvers: Record<number, PlayerId>
}

const UNKNOWN_CARVER = 'Unknown carver'

export function ResultsScreen({ roomId, onLeave }: { roomId: string; onLeave?: () => void }) {
  const view = useConnection(s => s.view) as ResultsView
  const labels = useConnection(s => s.labels)
  // Decided once per mount, but remembered for this room: a refresh
  // or taking the session back from another tab remounts this screen, and
  // without the stored flag the full thirteen seconds would replay before the
  // grid became reachable — with no skip control to escape it.
  const [showOver, setShowOver] = useState(() => prefersReducedMotion() || showSeen(roomId))

  // Always the disambiguated label, never displayName: two players called
  // Jocelyn must be told apart exactly when their work is attributed.
  const nameFor = (slot: number): string => {
    const carver = view.carvers[slot]
    const label = carver !== undefined ? labels[carver] : undefined
    // A blank label is as unreadable as a missing one.
    return label && label.trim() !== '' ? label : UNKNOWN_CARVER
  }

  const acts = actsFrom(view.winners, view.gallery, nameFor)

  if (!showOver && acts.length > 0) {
    return <Catwalk acts={acts} onDone={() => { markShowSeen(roomId); setShowOver(true) }} />
  }

  return (
    <main className="game-stage results-stage">
      <Spiral />
      {/* Without this the room is a dead end: the game is over, every other
          screen is unreachable, and only clearing storage gets you out. */}
      {onLeave && (
        <div className="results-exit">
          <button className="btn-quiet" onClick={onLeave}>Back to the start</button>
        </div>
      )}
      <div className="game-inner">
      <h2 className="game-title">Results</h2>
      <HostLine />

      <section aria-label="Awards" className="award-grid">
        {AWARD_KEYS.map(award => {
          const winner = view.winners[award]
          const entry = winner ? view.gallery.find(g => g.slot === winner.slot) : undefined
          const headingId = `award-${award}`
          return (
            <div
              key={award} role="group" aria-labelledby={headingId}
              className="award-card"
            >
              <h3 id={headingId} className="award-name">
                {AWARD_LABELS[award]}
              </h3>
              {winner ? (
                <>
                  {entry ? (
                    <PumpkinThumb entry={entry} caption={nameFor(winner.slot)} />
                  ) : (
                    // The award WAS decided; only its pumpkin is missing from
                    // the gallery. Never claim there were no votes.
                    <p style={{ margin: 0 }}>
                      Pumpkin unavailable ({nameFor(winner.slot)})
                    </p>
                  )}
                  <p className="award-votes">
                    {winner.votes} {winner.votes === 1 ? 'vote' : 'votes'}
                  </p>
                </>
              ) : (
                <p className="award-votes">No votes cast</p>
              )}
            </div>
          )
        })}
      </section>

      <section aria-labelledby="all-pumpkins">
        <h3 id="all-pumpkins" className="section-title">Everyone&apos;s pumpkins</h3>
        <div className="gallery-grid">
          {view.gallery.map(entry => (
            <PumpkinThumb
              key={entry.slot}
              entry={entry}
              caption={nameFor(entry.slot)}
            />
          ))}
        </div>
      </section>

      </div>
    </main>
  )
}
