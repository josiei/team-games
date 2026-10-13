import { useState } from 'react'
import { AWARD_LABELS, type PumpkinView } from '@tg/shared'
import { useConnection } from '../../store/connection.js'
import { Timer } from '../../ui/Timer.js'
import { HostLine } from '../../ui/HostLine.js'
import { PumpkinThumb } from './PumpkinThumb.js'

export function VoteScreen() {
  const view = useConnection(s => s.view) as PumpkinView | null
  const dispatch = useConnection(s => s.dispatch)
  const [unsentAward, setUnsentAward] = useState<string | null>(null)

  if (view?.kind === 'spectator') {
    return (
      <main style={{ textAlign: 'center', padding: 32 }}>
        <h2>Watching this one</h2>
        <p>You joined mid-game — you&apos;re in the next round.</p>
        <HostLine />
      </main>
    )
  }

  // Anything but a voting view (including null) has nothing to vote on.
  // Narrowing on `kind` also means `mySlot: -1` can never reach the grid.
  if (view?.kind !== 'voting') return null

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: 16 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ fontFamily: 'var(--font-game)', margin: 0 }}>
          {AWARD_LABELS[view.award]}
        </h2>
        <Timer />
      </header>

      <HostLine />

      {/* Always mounted so the live region is announced when its text appears. */}
      <p role="status" style={{ margin: '8px 0 0', fontWeight: 600, minHeight: '1.2em' }}>
        {unsentAward === view.award ? 'Vote not sent \u2014 reconnecting. Tap again once you are back.' : ''}
      </p>

      <div style={{
        display: 'grid', gap: 12, marginTop: 16,
        gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
      }}>
        {view.gallery.map(entry => {
          const isMine = entry.slot === view.mySlot
          return (
            <PumpkinThumb
              key={entry.slot}
              entry={entry}
              caption={isMine ? 'Yours' : undefined}
              selected={view.myVote === entry.slot}
              disabled={isMine}
              onClick={() => setUnsentAward(
                dispatch({ type: 'VOTE', award: view.award, slot: entry.slot }) ? null : view.award)}
            />
          )
        })}
      </div>
    </main>
  )
}
