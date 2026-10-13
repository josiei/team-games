import type { PlayerId } from './ids.js'
import type { ServerMessage } from './events.js'

export type Player = {
  id: PlayerId
  displayName: string
  connected: boolean
  joinedAt: number
}

export type GameTheme = {
  accent: string
  accent2: string
  glow: string
  danger: string
}

export interface RoomContext {
  broadcast(message: ServerMessage): void
  setTimer(ms: number, fn: () => void): void
  advancePhase(): void
  hostLine(line: string): void
  saveResult(payload: unknown): void
}

export interface GameModule<State, Action, View> {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly minPlayers: number
  readonly maxPlayers: number
  readonly estimatedMinutes: number
  readonly phases: readonly string[]
  readonly theme: GameTheme
  readonly hostLines: Record<string, string[]>

  createState(players: Player[], seed: number): State
  setPhase(state: State, phase: string): State
  reduce(state: State, action: Action, by: PlayerId): State
  onPhaseEnter(state: State, phase: string, ctx: RoomContext): void
  viewFor(state: State, viewer: PlayerId): View
}

/**
 * Display names are player-chosen and a work team will contain two
 * Jocelyns. Labels disambiguate by join order so the gallery and results
 * attribute pumpkins unambiguously.
 */
export function labelPlayers(players: Player[]): Record<PlayerId, string> {
  const ordered = [...players].sort((a, b) =>
    a.joinedAt - b.joinedAt || a.id.localeCompare(b.id))
  const seen = new Map<string, number>()
  const labels: Record<PlayerId, string> = {}

  for (const player of ordered) {
    const key = player.displayName.trim().toLowerCase()
    const n = (seen.get(key) ?? 0) + 1
    seen.set(key, n)
    labels[player.id] = n === 1 ? player.displayName : `${player.displayName} (${n})`
  }
  return labels
}
