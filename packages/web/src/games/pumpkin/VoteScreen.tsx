import { useState } from 'react'
import { AWARD_LABELS, type PumpkinView } from '@tg/shared'
import { useConnection } from '../../store/connection.js'
import { Timer } from '../../ui/Timer.js'
import { HostLine } from '../../ui/HostLine.js'
import { PumpkinThumb } from './PumpkinThumb.js'
import '../../theme/neon.css'

export function VoteScreen() {
  const view = useConnection(s => s.view) as PumpkinView | null
  const dispatch = useConnection(s => s.dispatch)
  const [unsentAward, setUnsentAward] = useState<string | null>(null)

  if (view?.kind === 'spectator') {
    return (
      <main className="game-stage">
        <div className="game-inner is-narrow panel panel-centred">
          <h2 className="game-title">Watching this one</h2>
          <p>You joined mid-game — you&apos;re in the next round.</p>
          <HostLine />
        </div>
      </main>
    )
  }

  // Anything but a voting view (including null) has nothing to vote on.
  // Narrowing on `kind` also means `mySlot: -1` can never reach the grid.
  if (view?.kind !== 'voting') return null

  return (
    <main className="game-stage">
      <div className="game-inner">
      <header className="game-head">
        <h2 className="game-title">
          {AWARD_LABELS[view.award]}
        </h2>
        <Timer />
      </header>

      <HostLine />

      {/* Always mounted so the live region is announced when its text appears. */}
      <p role="status" className="game-status">
        {unsentAward === view.award ? 'Vote not sent \u2014 reconnecting. Tap again once you are back.' : ''}
      </p>

      <div className="gallery-grid">
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
      </div>
    </main>
  )
}
