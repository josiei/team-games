/**
 * The persisted player session. One localStorage key holds everything needed
 * to re-join the same player (same token) after a refresh. Every access is
 * guarded: storage throws in some private-browsing modes, and a storage
 * failure must degrade to the ordinary join form, never break the app.
 */
export const SESSION_KEY = 'tg.session'

export type StoredSession = {
  code: string
  roomId: string
  playerId: string
  playerToken: string
  displayName: string
}

export function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Partial<StoredSession> | null
    if (
      s && typeof s.code === 'string' && typeof s.roomId === 'string' &&
      typeof s.playerId === 'string' && typeof s.playerToken === 'string' &&
      typeof s.displayName === 'string'
    ) return s as StoredSession
    return null
  } catch { return null }
}

export function saveSession(session: StoredSession): void {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)) } catch { /* degrade */ }
}

export function clearSession(): void {
  try { localStorage.removeItem(SESSION_KEY) } catch { /* degrade */ }
}
