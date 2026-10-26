import { normalizeCode, type PlayerId } from '@tg/shared'

export const MIN_PLAYERS = 2

export type JoinResult = { roomId: string; playerId: PlayerId; playerToken: string }

/** Thrown message when the request never reached the server. */
export const NETWORK_ERROR = 'NETWORK'

async function post<T>(url: string, body: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error(NETWORK_ERROR)
  }
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { code?: string }
    throw new Error(detail.code ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export type GameTheme = { accent: string; accent2: string; glow: string; danger: string }
export type Team = { id: string; name: string; color: string }

export type GameCard = {
  id: string
  name: string
  description: string
  minPlayers: number
  maxPlayers: number
  estimatedMinutes: number
  theme: GameTheme
  thumbnail: string
  teams?: Team[]
}

async function get<T>(url: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(url)
  } catch {
    throw new Error(NETWORK_ERROR)
  }
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { code?: string }
    throw new Error(detail.code ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

/** Every game the picker may offer. Hidden modules are filtered server-side. */
export const listGames = () => get<GameCard[]>('/api/games')

/** Lobby profile. An omitted field is left alone; `team: null` clears it. */
export const setProfile = (
  code: string, playerToken: string, patch: { avatar?: string; team?: string | null },
) =>
  post<{ ok: true }>(`/api/rooms/${normalizeCode(code)}/me`, { playerToken, ...patch })

export const createRoom = (gameId: string) =>
  post<{ code: string; roomId: string }>('/api/rooms', { gameId })

/** Pass an existing `playerToken` to get the SAME player back (idempotent re-join). */
export const joinRoom = (code: string, displayName: string, playerToken?: string) =>
  post<JoinResult>(`/api/rooms/${normalizeCode(code)}/join`, {
    displayName,
    ...(playerToken ? { playerToken } : {}),
  })

export const startGame = (code: string, playerToken: string) =>
  post<{ ok: true }>(`/api/rooms/${normalizeCode(code)}/start`, { playerToken })

export const errorCode = (e: unknown) => (e instanceof Error ? e.message : 'UNKNOWN')

export function humanize(code: string): string {
  switch (code) {
    case 'ROOM_NOT_FOUND': return "No room with that code. Check it against the host's screen."
    case 'ROOM_FULL': return 'That room is full.'
    case 'NAME_REQUIRED': return 'Pick a name first.'
    case 'NAME_TOO_LONG': return 'That name is too long.'
    case 'UNKNOWN_GAME': return 'That game is not available.'
    case 'NOT_HOST': return 'Only the host can start the game.'
    case 'NOT_ENOUGH_PLAYERS': return `Need at least ${MIN_PLAYERS} players to start.`
    case 'ALREADY_STARTED': return 'The game has already started.'
    case 'NOT_A_PLAYER': return "You are not in this room any more. Rejoin with the code."
    case 'BAD_AVATAR': return 'Pick an avatar from the list.'
    case 'BAD_TEAM': return 'That team is not part of this game.'
    case NETWORK_ERROR: return "Can't reach the server. Check your connection and try again."
    default: return 'Something went wrong. Try again.'
  }
}
