import { useState, type CSSProperties } from 'react'
import type { RoomCode } from '@tg/shared'
import { useConnection } from '../store/connection.js'
import { HostLine } from '../ui/HostLine.js'
import { PlayerPip } from '../ui/PlayerPip.js'
import { Spiral } from '../ui/Spiral.js'
import { MIN_PLAYERS, errorCode, humanize, startGame } from './api.js'
import '../theme/neon.css'

export function Lobby({ code, playerToken, onLeave }: {
  code: RoomCode
  playerToken: string
  onLeave?: () => void
}) {
  const players = useConnection(s => s.players)
  const labels = useConnection(s => s.labels)
  const hostId = useConnection(s => s.hostId)
  const me = useConnection(s => s.me)
  const status = useConnection(s => s.status)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  const isHost = me !== null && me === hostId
  const ordered = [...players].sort((a, b) => a.joinedAt - b.joinedAt)
  // Below the minimum, show the seats still to fill: an empty row reads as
  // "someone is missing", where a short list just looks finished.
  const openSeats = Math.max(0, MIN_PLAYERS - ordered.length)

  return (
    <main className="lobby-stage">
      <Spiral />
      <div className="lobby-content">
        <div className="code-sign">
          <p className="code-sign-label">Room code</p>
          <p className="room-code">{code}</p>
          <p className="code-sign-hint">Teammates join with this on the home screen</p>
        </div>

        {status === 'reconnecting' && (
          <p role="status" className="reconnecting">Reconnecting<span className="dots" aria-hidden="true" /></p>
        )}

        <ul className="roster">
          {ordered.map((player, index) => (
            <li key={player.id} className="roster-row" style={{ '--i': index } as CSSProperties}>
              <PlayerPip id={player.id} connected={player.connected} />
              <strong className="roster-name" style={{ opacity: player.connected ? 1 : 0.5 }}>
                {labels[player.id] ?? player.displayName}
              </strong>
              {player.id === hostId && <span className="roster-tag">host</span>}
              {!player.connected && <span className="roster-tag is-quiet">offline</span>}
            </li>
          ))}
          {Array.from({ length: openSeats }, (_, n) => (
            <li key={`seat-${n}`} className="roster-row is-empty"
              style={{ '--i': ordered.length + n } as CSSProperties}>
              <span className="pip-empty" aria-hidden="true" />
              <span className="roster-name is-quiet">Open seat</span>
            </li>
          ))}
        </ul>

        <HostLine />

        <div className="lobby-actions">
          {isHost ? (
            <>
              <button
                className="btn-neon"
                disabled={players.length < MIN_PLAYERS || starting}
                onClick={async () => {
                  if (starting) return
                  setStarting(true); setError(null)
                  try { await startGame(code, playerToken) }
                  catch (e) { setError(errorCode(e)) }
                  finally { setStarting(false) }
                }}
              >
                Start carving
              </button>
              {players.length < MIN_PLAYERS && (
                <p className="lobby-note">Need at least {MIN_PLAYERS} players.</p>
              )}
            </>
          ) : (
            <p className="lobby-note">
              Waiting for the host to start<span className="dots" aria-hidden="true" />
            </p>
          )}

          {error && <p className="join-error" role="alert">{humanize(error)}</p>}

          {onLeave && <button className="btn-quiet" onClick={onLeave}>Leave room</button>}
        </div>
      </div>
    </main>
  )
}
