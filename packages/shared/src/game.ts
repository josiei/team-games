import type { PlayerId } from './ids.js'
import type { ServerMessage } from './events.js'

export type Player = {
  id: PlayerId
  displayName: string
  connected: boolean
  joinedAt: number
  /** An id from AVATARS, or '' before the player has chosen one. */
  avatar: string
  /**
   * The lobby group this player joined, or null for no team and for games
   * that declare none. Generic on purpose: the team is picked in the lobby,
   * before game state exists, so it cannot live in a game's own state.
   */
  team: string | null
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

  /**
   * The phase to enter when `current` ends, or null to stop there. Omit it and
   * the runtime walks `phases` in order, which is what every linear game wants.
   *
   * Implement it when the order is decided at runtime rather than written down:
   * a board game returns to its board as many times as there are tiles, in
   * whatever order the players pick, and an index walk cannot express that.
   *
   * The returned name MUST be one of `phases`; anything else is treated as a
   * module bug and ends the room visibly rather than stalling it. Because this
   * can return to a phase already visited, the runtime caps how many
   * transitions one room may make — see MAX_PHASE_HOPS.
   */
  nextPhase?(state: State, current: string): string | null

  /**
   * Action types only the room's current host may dispatch. Everything else is
   * open to any player in the room, as before.
   *
   * The check lives in the runtime rather than in `reduce` because `reduce` is
   * pure and is handed only `by` — it has no way to know who the host is, and
   * `hostId` moves when a host disconnects, so a copy taken at createState
   * would be wrong by the time it mattered.
   */
  readonly hostActions?: readonly string[]

  /**
   * Lobby teams this game splits players into, or absent for a game played by
   * individuals. The lobby renders team columns only when a game declares
   * them, so adding this changes nothing for pumpkin-carve.
   *
   * A game that declares none rejects every team id, rather than silently
   * accepting one it will never use.
   */
  readonly teams?: readonly { id: string; name: string; color: string }[]

  /**
   * Path to the card art the game picker shows, under the web client's static
   * assets. Required: a picker with a blank card reads as broken, so a game
   * without art ships a placeholder rather than nothing.
   */
  readonly thumbnail: string

  /**
   * Keep this game out of the picker. Used for a module that exists only for
   * tests — a dev-content twin of a real game — which must be reachable by id
   * but must never be offered to players.
   */
  readonly hidden?: boolean
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
