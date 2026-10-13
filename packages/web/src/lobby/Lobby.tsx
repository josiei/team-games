import { useState } from 'react'
import type { RoomCode } from '@tg/shared'
import { useConnection } from '../store/connection.js'
import { HostLine } from '../ui/HostLine.js'
import { MIN_PLAYERS, errorCode, humanize, startGame } from './api.js'

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

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}>
      <header>
        <p style={{ color: 'var(--shell-muted)', margin: 0 }}>Room code</p>
        <p className="room-code" style={{ margin: 0 }}>{code}</p>
      </header>

      {status === 'reconnecting' && (
        <p role="status" style={{ color: 'var(--glow)' }}>Reconnecting…</p>
      )}

      <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 8 }}>
        {ordered.map(player => (
          <li key={player.id} className="surface" style={{ padding: 12 }}>
            <strong style={{ opacity: player.connected ? 1 : 0.5 }}>
              {labels[player.id] ?? player.displayName}
            </strong>
            {player.id === hostId && <span> · host</span>}
            {!player.connected && <span> · offline</span>}
          </li>
        ))}
      </ul>

      <HostLine />

      {isHost ? (
        <>
          <button
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
            <p style={{ color: 'var(--shell-muted)' }}>Need at least {MIN_PLAYERS} players.</p>
          )}
        </>
      ) : (
        <p>Waiting for the host to start…</p>
      )}

      {error && <p role="alert">{humanize(error)}</p>}

      {onLeave && <button onClick={onLeave}>Leave room</button>}
    </main>
  )
}
