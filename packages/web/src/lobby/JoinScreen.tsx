import { useState } from 'react'
import { CODE_LENGTH } from '@tg/shared'
import { createRoom, errorCode, humanize, joinRoom, type JoinResult } from './api.js'

export const MAX_DISPLAY_NAME = 24

export function JoinScreen({
  onJoined,
}: { onJoined(code: string, result: JoinResult, displayName: string): void }) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const ready = code.trim().length > 0 && name.trim().length > 0 && !busy

  async function submit(target: string) {
    setBusy(true); setError(null)
    try { onJoined(target, await joinRoom(target, name.trim()), name.trim()) }
    catch (e) { setError(errorCode(e)) }
    finally { setBusy(false) }
  }

  async function host() {
    setBusy(true); setError(null)
    try {
      const room = await createRoom('pumpkin-carve')
      setCode(room.code)
      onJoined(room.code, await joinRoom(room.code, name.trim()), name.trim())
    } catch (e) { setError(errorCode(e)) } finally { setBusy(false) }
  }

  return (
    <main style={{ maxWidth: 420, margin: '12vh auto', padding: 16 }}>
      <h1 style={{ fontFamily: 'var(--font-game)', color: 'var(--accent)' }}>Team Games</h1>

      <label htmlFor="name">Your name</label>
      <input id="name" value={name} maxLength={MAX_DISPLAY_NAME}
        onChange={e => setName(e.target.value)} />

      <label htmlFor="code">Room code</label>
      <input id="code" value={code} maxLength={CODE_LENGTH + 1}
        onChange={e => setCode(e.target.value.toUpperCase())}
        style={{ fontFamily: 'var(--font-display)', letterSpacing: '0.2em' }} />

      <button disabled={!ready} onClick={() => submit(code)}>Join game</button>
      <button disabled={name.trim().length === 0 || busy} onClick={host}>
        Start a new room
      </button>

      {error && <p role="alert" style={{ color: 'var(--accent)' }}>{humanize(error)}</p>}
    </main>
  )
}
