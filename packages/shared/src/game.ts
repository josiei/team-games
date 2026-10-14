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
  /**
   * `waiting` is everyone still connected who is taking part — the same set
   * `phaseComplete` is asked about. A view that shows progress ("3 of 4 in")
   * must count that set, or it reports a total the phase will never reach.
   */
  viewFor(state: State, viewer: PlayerId, waiting?: Player[]): View

  /**
   * True when this phase has nothing left to wait for, so the room can move on
   * without burning the rest of the clock. `players` is everyone still
   * connected who is taking part; a game that cannot end a phase early simply
   * leaves this out and every phase runs its full duration.
   */
  phaseComplete?(state: State, phase: string, players: Player[]): boolean
}

/**
 * Display names are player-chosen and a work team will contain two
 * Jocelyns. Labels disambiguate by join order so the gallery and results
 * attribute pumpkins unambiguously.
 *
 * Every issued label is unique: a raw name that happens to equal an
 * already-suffixed form (e.g. a player literally named "Sam (2)") is
 * pushed past the taken suffixes rather than colliding with them.
 */
export function labelPlayers(players: Player[]): Record<PlayerId, string> {
  const ordered = [...players].sort((a, b) =>
    a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const seen = new Map<string, number>()
  const issued = new Set<string>()
  const labels: Record<PlayerId, string> = {}

  for (const player of ordered) {
    const key = player.displayName.trim().toLowerCase()
    let n = (seen.get(key) ?? 0) + 1
    seen.set(key, n)
    let candidate = n === 1 ? player.displayName : `${player.displayName} (${n})`
    while (issued.has(candidate)) {
      n += 1
      candidate = `${player.displayName} (${n})`
    }
    issued.add(candidate)
    labels[player.id] = candidate
  }
  return labels
}
