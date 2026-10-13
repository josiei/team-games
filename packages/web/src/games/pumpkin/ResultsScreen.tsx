import {
  AWARD_KEYS, AWARD_LABELS,
  type AwardKey, type AwardResult, type GalleryEntry, type PlayerId,
} from '@tg/shared'
import { useConnection } from '../../store/connection.js'
import { HostLine } from '../../ui/HostLine.js'
import { PumpkinThumb } from './PumpkinThumb.js'

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
    return (carver !== undefined ? labels[carver] : undefined) ?? UNKNOWN_CARVER
  }

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: 16 }}>
      <h2 style={{ fontFamily: 'var(--font-game)' }}>Results</h2>
      <HostLine />

      <section aria-label="Awards" style={{
        display: 'grid', gap: 12,
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      }}>
        {AWARD_KEYS.map(award => {
          const winner = view.winners[award]
          const entry = winner ? view.gallery.find(g => g.slot === winner.slot) : undefined
          const headingId = `award-${award}`
          return (
            <div
              key={award} role="group" aria-labelledby={headingId}
              className="surface" style={{ padding: 12 }}
            >
              <h3 id={headingId} style={{ margin: '0 0 8px', fontSize: 16 }}>
                {AWARD_LABELS[award]}
              </h3>
              {winner && entry ? (
                <>
                  <PumpkinThumb entry={entry} caption={nameFor(winner.slot)} disabled />
                  <p style={{ margin: '8px 0 0', color: 'var(--shell-muted)' }}>
                    {winner.votes} {winner.votes === 1 ? 'vote' : 'votes'}
                  </p>
                </>
              ) : (
                <p style={{ color: 'var(--shell-muted)' }}>No votes cast</p>
              )}
            </div>
          )
        })}
      </section>

      <section aria-labelledby="all-pumpkins">
        <h3 id="all-pumpkins" style={{ marginTop: 32 }}>Everyone&apos;s pumpkins</h3>
        <div style={{
          display: 'grid', gap: 12,
          gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
        }}>
          {view.gallery.map(entry => (
            <PumpkinThumb
              key={entry.slot}
              entry={entry}
              caption={nameFor(entry.slot)}
              disabled
            />
          ))}
        </div>
      </section>
    </main>
  )
}
