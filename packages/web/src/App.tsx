import { useEffect, useState } from 'react'
import { asRoomCode, type PumpkinView, type RoomCode } from '@tg/shared'
import { useConnection } from './store/connection.js'
import { JoinScreen } from './lobby/JoinScreen.js'
import { Lobby } from './lobby/Lobby.js'
import { NETWORK_ERROR, errorCode, joinRoom } from './lobby/api.js'
import { clearSession, loadSession, saveSession } from './lobby/session.js'

type Session = { code: RoomCode; playerToken: string }

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
 * join is idempotent), so a refresh never adds a duplicate player.
 */
export function App() {
  const status = useConnection(s => s.status)
  const view = useConnection(s => s.view) as PumpkinView | null
  const connect = useConnection(s => s.connect)
  const disconnect = useConnection(s => s.disconnect)

  const [session, setSession] = useState<Session | null>(null)
  // 'restoring' while a stored session is being re-joined; avoids flashing the form.
  const [restoring, setRestoring] = useState(() => loadSession() !== null)

  useEffect(() => {
    const stored = loadSession()
    if (!stored) { setRestoring(false); return }
    let cancelled = false
    joinRoom(stored.code, stored.displayName, stored.playerToken)
      .then(join => {
        if (cancelled) return
        setSession({ code: asRoomCode(stored.code), playerToken: join.playerToken })
        saveSession({ ...stored, roomId: join.roomId, playerId: join.playerId, playerToken: join.playerToken })
        connect(join.roomId, join.playerId, join.playerToken)
        setRestoring(false)
      })
      .catch(e => {
        if (cancelled) return
        // An unreachable server says nothing about the room; keep the session.
        if (errorCode(e) !== NETWORK_ERROR) clearSession()
        setRestoring(false)
      })
    return () => { cancelled = true }
  }, [connect])

  // Another tab owns this player now; the session is not ours to keep.
  useEffect(() => {
    if (status === 'taken-over') clearSession()
  }, [status])

  function leave() {
    disconnect()
    clearSession()
    useConnection.setState({
      status: 'idle', phase: 'lobby', view: null, players: [], labels: {},
      hostId: null, hostLine: null, endsAt: null, me: null,
    })
    setSession(null)
  }

  if (status === 'taken-over') {
    return <p role="alert">This session was opened in another tab. Close this one, or reload to join again.</p>
  }
  if (restoring) return <p role="status">Rejoining your game...</p>

  if (!session) {
    return (
      <JoinScreen
        onJoined={(code, join, displayName) => {
          saveSession({
            code: asRoomCode(code), roomId: join.roomId, playerId: join.playerId,
            playerToken: join.playerToken, displayName,
          })
          setSession({ code: asRoomCode(code), playerToken: join.playerToken })
          connect(join.roomId, join.playerId, join.playerToken)
        }}
      />
    )
  }

  if (!view) return <p role="status">Connecting...</p>
  if (view.kind === 'lobby') {
    return <Lobby code={session.code} playerToken={session.playerToken} onLeave={leave} />
  }
  // Carve, vote, and results screens are wired in Tasks 16-18.
  return <p>View: {view.kind}</p>
}
