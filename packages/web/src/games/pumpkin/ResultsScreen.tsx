import {
  AWARD_KEYS, AWARD_LABELS,
  type AwardKey, type AwardResult, type GalleryEntry, type PlayerId,
} from '@tg/shared'
import { useConnection } from '../../store/connection.js'
import { HostLine } from '../../ui/HostLine.js'
import { Spiral } from '../../ui/Spiral.js'
import { PumpkinThumb } from './PumpkinThumb.js'
import '../../theme/neon.css'

type ResultsView = {
  kind: 'results'
  gallery: GalleryEntry[]
  winners: Record<AwardKey, AwardResult>
  carvers: Record<number, PlayerId>
}

const UNKNOWN_CARVER = 'Unknown carver'

export function ResultsScreen() {
  const view = useConnection(s => s.view) as ResultsView
  const labels = useConnection(s => s.labels)

  // Always the disambiguated label, never displayName: two players called
  // Jocelyn must be told apart exactly when their work is attributed.
  const nameFor = (slot: number): string => {
    const carver = view.carvers[slot]
    const label = carver !== undefined ? labels[carver] : undefined
    // A blank label is as unreadable as a missing one.
    return label && label.trim() !== '' ? label : UNKNOWN_CARVER
  }

  return (
    <main className="game-stage results-stage">
      <Spiral />
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
