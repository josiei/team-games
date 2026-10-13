import { useCallback, useEffect, useRef, useState } from 'react'
import { asRoomCode, type PumpkinView, type RoomCode } from '@tg/shared'
import { useConnection } from './store/connection.js'
import { JoinScreen } from './lobby/JoinScreen.js'
import { Lobby } from './lobby/Lobby.js'
import { CarveScreen } from './games/pumpkin/CarveScreen.js'
import { VoteScreen } from './games/pumpkin/VoteScreen.js'
import { ResultsScreen } from './games/pumpkin/ResultsScreen.js'
import { errorCode, humanize, joinRoom } from './lobby/api.js'
import { clearSession, loadSession, saveSession, type StoredSession } from './lobby/session.js'

type Phase = 'form' | 'restoring' | 'retry' | 'active'

/** How long the socket may take to deliver a first view before we offer an exit. */
const STUCK_MS = 4000

/**
 * Router, extended by Tasks 16-18.
 *
 * ROUTE ON `view.kind`, NEVER ON `phase`. When a phase transition fails the
 * server moves the room to its terminal phase but may still send a
 * LOBBY-shaped view with `phase: 'results'`. `phase` therefore cannot be
 * trusted to say which screen the payload fits; the view's own discriminant
 * always can.
 *
 * On mount a stored session is re-joined WITH its player token (the server's
 * join is idempotent), so a refresh never adds a duplicate player. Only a
 * definitive ROOM_NOT_FOUND discards the session; any other failure keeps it
 * and offers a retry, so we never fall back to a token-less manual join.
 */
export function App() {
  return (
    <>
      <ErrorBanner />
      <Router />
    </>
  )
}

/** Server error frames (e.g. PHASE_FAILED) shown above whichever screen is up. */
export function ErrorBanner() {
  const error = useConnection(s => s.error)
  if (!error) return null
  return (
    <div role="alert" className="error-banner" style={{
      position: 'sticky', top: 0, zIndex: 10, padding: '12px 16px', textAlign: 'center',
      fontWeight: 700, background: '#B3261E', color: '#fff',
    }}>
      {error.message || `Something went wrong (${error.code}).`}
    </div>
  )
}

function Router() {
  const status = useConnection(s => s.status)
  const view = useConnection(s => s.view) as PumpkinView | null
  const connect = useConnection(s => s.connect)
  const disconnect = useConnection(s => s.disconnect)

  const [identity, setIdentity] = useState<StoredSession | null>(() => loadSession())
  const [phase, setPhase] = useState<Phase>(() => (identity ? 'restoring' : 'form'))
  const [failure, setFailure] = useState<string | null>(null)
  const alive = useRef(true)

  const rejoin = useCallback(async (stored: StoredSession) => {
    setPhase('restoring'); setFailure(null)
    try {
      const join = await joinRoom(stored.code, stored.displayName, stored.playerToken)
      if (!alive.current) return
      const next = { ...stored, roomId: join.roomId, playerId: join.playerId, playerToken: join.playerToken }
      saveSession(next)
      setIdentity(next)
      connect(join.roomId, join.playerId, join.playerToken)
      setPhase('active')
    } catch (e) {
      if (!alive.current) return
      if (errorCode(e) === 'ROOM_NOT_FOUND') {
        clearSession(); setIdentity(null); setPhase('form')
      } else {
        // Transient (network, 5xx, bad body): keep the token and let the user retry.
        setFailure(errorCode(e)); setPhase('retry')
      }
    }
  }, [connect])

  useEffect(() => {
    alive.current = true
    const stored = loadSession()
    if (stored) void rejoin(stored)
    return () => { alive.current = false }
  }, [rejoin])

  function leave() {
    disconnect()
    clearSession()
    useConnection.setState({
      status: 'idle', phase: 'lobby', view: null, players: [], labels: {},
      hostId: null, hostLine: null, endsAt: null, me: null, error: null,
    })
    setIdentity(null); setFailure(null); setPhase('form')
  }

  if (phase === 'restoring') return <p role="status">Rejoining your game...</p>

  if (phase === 'retry' && identity) {
    return (
      <main style={{ maxWidth: 420, margin: '12vh auto', padding: 16 }}>
        <p role="alert">
          Couldn't rejoin room {identity.code}. {humanize(failure ?? 'UNKNOWN')}
        </p>
        <button onClick={() => void rejoin(identity)}>Try again</button>
        <button onClick={leave}>Leave room</button>
      </main>
    )
  }

  if (phase === 'form' || !identity) {
    return (
      <JoinScreen
        onJoined={(code, join, displayName) => {
          const next = {
            code: asRoomCode(code) as string, roomId: join.roomId, playerId: join.playerId,
            playerToken: join.playerToken, displayName,
          }
          saveSession(next)
          setIdentity(next)
          setPhase('active')
          connect(join.roomId, join.playerId, join.playerToken)
        }}
      />
    )
  }

  if (status === 'taken-over') {
    // The session is deliberately KEPT: localStorage is shared with the tab that
    // took over, and re-joining with the token reclaims the player (the new
    // socket closes the other tab's with 4001).
    return (
      <main style={{ maxWidth: 420, margin: '12vh auto', padding: 16 }}>
        <p role="alert">This session was opened in another tab.</p>
        <button onClick={() => void rejoin(identity)}>Take it back here</button>
      </main>
    )
  }

  if (!view) return <Connecting status={status} onRetry={() => void rejoin(identity)} onLeave={leave} />
  if (view.kind === 'lobby') {
    return <Lobby code={asRoomCode(identity.code) as RoomCode} playerToken={identity.playerToken} onLeave={leave} />
  }
  if (view.kind === 'carving') return <CarveScreen roomId={identity.roomId} />
  if (view.kind === 'voting' || view.kind === 'spectator') return <VoteScreen />
  if (view.kind === 'results') return <ResultsScreen onLeave={leave} />
  return <p>View: {(view as { kind: string }).kind}</p>
}

/** Waiting for the first snapshot, with an exit if it never comes. */
function Connecting({ status, onRetry, onLeave }: {
  status: string; onRetry(): void; onLeave(): void
}) {
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setStuck(true), STUCK_MS)
    return () => clearTimeout(t)
  }, [])
  const failed = status === 'closed' || status === 'idle'
  return (
    <main style={{ maxWidth: 420, margin: '12vh auto', padding: 16 }}>
      <p role="status">
        {status === 'reconnecting' ? 'Reconnecting...' : failed ? 'Connection lost.' : 'Connecting...'}
      </p>
      {(stuck || failed) && (
        <>
          <button onClick={onRetry}>Try again</button>
          <button onClick={onLeave}>Leave room</button>
        </>
      )}
    </main>
  )
}
