import { useState } from 'react'
import { CODE_LENGTH } from '@tg/shared'
import { createRoom, errorCode, humanize, joinRoom, type JoinResult } from './api.js'
import { GamePicker } from './GamePicker.js'
import { pickTagline } from './taglines.js'
import { NeonSign } from '../ui/NeonSign.js'
import { Spiral } from '../ui/Spiral.js'
import '../theme/neon.css'

export const MAX_DISPLAY_NAME = 24

export function JoinScreen({
  onJoined,
}: { onJoined(code: string, result: JoinResult, displayName: string): void }) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  // Chosen once per mount: the line must not change under the reader mid-visit.
  const [tagline] = useState(pickTagline)

  const ready = code.trim().length > 0 && name.trim().length > 0 && !busy

  async function submit(target: string) {
    setBusy(true); setError(null)
    try { onJoined(target, await joinRoom(target, name.trim()), name.trim()) }
    catch (e) { setError(errorCode(e)) }
    finally { setBusy(false) }
  }

  async function host(gameId: string) {
    setPicking(false)
    setBusy(true); setError(null)
    try {
      const room = await createRoom(gameId)
      setCode(room.code)
      onJoined(room.code, await joinRoom(room.code, name.trim()), name.trim())
    } catch (e) { setError(errorCode(e)) } finally { setBusy(false) }
  }

  // Choosing the game comes before the room exists, so the picker replaces this
  // screen rather than sitting inside it.
  if (picking) {
    return <GamePicker onPick={gameId => void host(gameId)} onCancel={() => setPicking(false)} />
  }

  return (
    <main className="lobby-stage">
      <Spiral />
      <div className="lobby-content">
        <NeonSign tagline={tagline} />

        <div className="join-card">
          <label htmlFor="name">Your name</label>
          <input id="name" value={name} maxLength={MAX_DISPLAY_NAME}
            autoComplete="nickname" placeholder="e.g. Sam"
            onChange={e => setName(e.target.value)} />

          <label htmlFor="code">Room code</label>
          <input id="code" className="code-field" value={code} maxLength={CODE_LENGTH + 1}
            autoComplete="off" autoCapitalize="characters" spellCheck={false}
            onChange={e => setCode(e.target.value.toUpperCase())} />

          <div className="join-actions">
            <button className="btn-neon" disabled={!ready} onClick={() => submit(code)}>
              Join game
            </button>
            <button className="btn-ghost" disabled={name.trim().length === 0 || busy}
              onClick={() => setPicking(true)}>
              Start a new room
            </button>
          </div>

          {error && <p className="join-error" role="alert">{humanize(error)}</p>}
        </div>
      </div>
    </main>
  )
}
