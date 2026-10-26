/**
 * Fright Night: a two-team Halloween quiz board.
 *
 * Everything here is pure. The runtime owns the clock and the sockets; this
 * file owns the rules, which is what makes the whole game testable in
 * milliseconds with no server and no browser.
 *
 * Two things are worth knowing before reading on:
 *
 * 1. **The team roster is frozen at createState.** `reduce` is handed only the
 *    actor's id and never a Player, so it has no way to ask what team someone
 *    is on. createState is the one hook that sees the player list, so it
 *    copies the roster into state and every team rule reads it from there.
 *
 * 2. **`correct` must never reach a pre-reveal view.** It lives on the clue in
 *    state; `viewFor` builds each view field by field rather than spreading,
 *    because spreading is how it would escape.
 */
import { fiftyFifty, shuffleChoices, type Pack } from './fright-pack.js'
import type { Player } from './game.js'
import type { PlayerId } from './ids.js'

export const FRIGHT_PHASES = [
  'lobby', 'board', 'reading', 'clue', 'steal', 'answer', 'reveal', 'results',
] as const

export type FrightPhase = (typeof FRIGHT_PHASES)[number]

/** Two lifelines each, spent one per clue, only after that team has buzzed. */
export const LIFELINES_PER_TEAM = 2

export type Tile = { categoryId: string; value: number; spent: boolean }

export type ActiveClue = {
  categoryId: string
  value: number
  kind: 'image' | 'text'
  prompt: string
  file?: string
  mosaic?: number
  /** Shuffled for this room. The pack's own order never reaches a client. */
  order: string[]
  /** Index into `order`. REDACTED from every view before `reveal`. */
  correct: number
  buzzedBy: PlayerId | null
  buzzedTeam: string | null
  /** Teams that have used their one shot at this clue. */
  spentTeams: string[]
  /** Wrong picks, public: earned by being wrong, not purchased. */
  wrongIndexes: number[]
  /**
   * Per TEAM, never merged. A viewer only ever receives their own team's
   * entry: a lifeline is private to the team that paid for it, or spending
   * one would hand the steal a narrowed field.
   */
  eliminated: Record<string, number[]>
  /** The team that answered correctly, or null. Drives control (see setPhase). */
  wonBy: string | null
}

export type FrightState = {
  phase: string
  seed: number
  /** Frozen at createState; see the note at the top of this file. */
  teams: Record<PlayerId, string>
  teamIds: string[]
  scores: Record<string, number>
  lifelines: Record<string, number>
  control: string
  tiles: Tile[]
  /** Every clue on the board, keyed `${categoryId}:${value}`. */
  clues: Record<string, ActiveClue>
  active: string | null
  buzzCount: Record<PlayerId, number>
  correctCount: Record<PlayerId, number>
}

export const clueKey = (categoryId: string, value: number) => `${categoryId}:${value}`

/**
 * `createState` needs the pack, but `GameModule.createState` is fixed at
 * (players, seed) — so the pack is bound here, once, by the module factory.
 */
export function makeCreateState(pack: Pack, teamIds: readonly string[]) {
  return function createState(players: Player[], seed: number): FrightState {
    const teams: Record<PlayerId, string> = {}
    for (const player of players) {
      if (player.team !== null && teamIds.includes(player.team)) teams[player.id] = player.team
    }

    const tiles: Tile[] = []
    const clues: Record<string, ActiveClue> = {}
    for (const category of pack.categories) {
      for (const clue of category.clues) {
        const key = clueKey(category.id, clue.value)
        tiles.push({ categoryId: category.id, value: clue.value, spent: false })
        const { order, correct } = shuffleChoices(clue.choices, seed, key)
        clues[key] = {
          categoryId: category.id,
          value: clue.value,
          kind: clue.kind,
          prompt: clue.prompt,
          ...(clue.kind === 'image' ? { file: clue.file, mosaic: clue.mosaic } : {}),
          order,
          correct,
          buzzedBy: null,
          buzzedTeam: null,
          spentTeams: [],
          wrongIndexes: [],
          eliminated: {},
          wonBy: null,
        }
      }
    }

    const ids = [...teamIds]
    return {
      phase: 'lobby',
      seed,
      teams,
      teamIds: ids,
      scores: Object.fromEntries(ids.map(id => [id, 0])),
      lifelines: Object.fromEntries(ids.map(id => [id, LIFELINES_PER_TEAM])),
      // Deterministic from the seed, so a restart restores the same game.
      control: ids[seed % ids.length]!,
      tiles,
      clues,
      active: null,
      buzzCount: {},
      correctCount: {},
    }
  }
}

/** The other team, for a two-team board. */
export function otherTeam(state: FrightState, team: string): string {
  return state.teamIds.find(id => id !== team) ?? team
}

/**
 * The cheapest unspent tile, scanning categories left to right.
 *
 * Used when the board clock runs out: a team that goes quiet must not stall
 * the room. Scans across columns rather than indexing one, because the
 * leftmost column may be entirely spent.
 */
export function cheapestRemaining(state: FrightState): Tile | null {
  const live = state.tiles.filter(t => !t.spent)
  if (live.length === 0) return null
  const lowest = Math.min(...live.map(t => t.value))
  return live.find(t => t.value === lowest) ?? null
}

export function setPhase(state: FrightState, phase: string): FrightState {
  // Leaving a reveal is where a clue is put away and the board changes hands.
  if (phase === 'board' && state.phase === 'reveal') {
    const won = state.active ? state.clues[state.active]?.wonBy ?? null : null
    return {
      ...state,
      phase,
      active: null,
      // Control to whoever got it; if nobody did it alternates, so one team
      // cannot sit on the board by refusing to answer.
      control: won ?? otherTeam(state, state.control),
    }
  }

  // A steal re-arms the buzzer for whoever has a shot left. Without clearing
  // the previous buzz the clue stays owned by the team that just missed, and
  // nobody can ring in at all.
  if (phase === 'steal' && state.active !== null) {
    const clue = state.clues[state.active]
    if (clue) {
      return {
        ...state,
        phase,
        clues: {
          ...state.clues,
          [state.active]: { ...clue, buzzedBy: null, buzzedTeam: null },
        },
      }
    }
  }

  // Entering a clue with nothing chosen means the board clock expired.
  if (phase === 'reading' && state.active === null) {
    const tile = cheapestRemaining(state)
    if (!tile) return { ...state, phase }
    const key = clueKey(tile.categoryId, tile.value)
    return {
      ...state,
      phase,
      active: key,
      tiles: state.tiles.map(t =>
        t.categoryId === tile.categoryId && t.value === tile.value ? { ...t, spent: true } : t),
    }
  }

  return { ...state, phase }
}

export type FrightAction =
  | { type: 'PICK'; categoryId: string; value: number }
  | { type: 'BUZZ' }
  | { type: 'CHOOSE'; index: number }
  | { type: 'LIFELINE' }
  | { type: 'SKIP' }
  | { type: 'END' }

/** Replace the active clue, keeping the rest of the board untouched. */
function withActive(
  state: FrightState, change: (clue: ActiveClue) => ActiveClue,
): FrightState {
  if (!state.active) return state
  const clue = state.clues[state.active]
  if (!clue) return state
  return { ...state, clues: { ...state.clues, [state.active]: change(clue) } }
}

const bump = (counts: Record<PlayerId, number>, id: PlayerId) =>
  ({ ...counts, [id]: (counts[id] ?? 0) + 1 })

/**
 * The rules. Pure: every guard that fails returns the state untouched rather
 * than throwing, because the runtime treats a throw as a bug worth logging
 * and a malformed payload is not one.
 *
 * `by` is supplied by the runtime from the authenticated socket, so "who is
 * this" is always trustworthy here. What team they are on comes from the
 * frozen roster, not from anything the client sent.
 */
export function reduce(
  state: FrightState, action: FrightAction, by: PlayerId,
): FrightState {
  const team = state.teams[by] ?? null
  const clue = state.active ? state.clues[state.active] ?? null : null

  switch (action.type) {
    case 'PICK': {
      // Only the controlling team, only from the board, only once.
      if (state.phase !== 'board' || state.active !== null) return state
      if (team === null || team !== state.control) return state
      const tile = state.tiles.find(t =>
        t.categoryId === action.categoryId && t.value === action.value)
      if (!tile || tile.spent) return state
      const key = clueKey(tile.categoryId, tile.value)
      if (!state.clues[key]) return state
      return {
        ...state,
        active: key,
        tiles: state.tiles.map(t => (t === tile ? { ...t, spent: true } : t)),
      }
    }

    case 'BUZZ': {
      // Dead during `reading` on purpose: without that window the race goes
      // to the fastest trigger finger rather than the fastest reader.
      if (state.phase !== 'clue' && state.phase !== 'steal') return state
      if (!clue || team === null) return state
      // First press after arming wins, and only that one. A later press is
      // ignored silently — including one that lands inside the 700ms beat
      // between phaseComplete going true and the phase actually changing.
      if (clue.buzzedBy !== null) return state
      if (clue.spentTeams.includes(team)) return state
      return withActive(
        { ...state, buzzCount: bump(state.buzzCount, by) },
        c => ({ ...c, buzzedBy: by, buzzedTeam: team }),
      )
    }

    case 'CHOOSE': {
      if (state.phase !== 'answer' || !clue) return state
      // Only the player who buzzed, whatever a client sends.
      if (clue.buzzedBy !== by || clue.buzzedTeam === null) return state
      if (clue.spentTeams.includes(clue.buzzedTeam)) return state
      // A malformed index is a client bug; spending a team's shot on it would
      // be unfair in a way a wrong click is not.
      if (!Number.isInteger(action.index)
        || action.index < 0 || action.index >= clue.order.length) return state

      const answeringTeam = clue.buzzedTeam
      const right = action.index === clue.correct
      const next = withActive(state, c => ({
        ...c,
        spentTeams: [...c.spentTeams, answeringTeam],
        wrongIndexes: right ? c.wrongIndexes : [...c.wrongIndexes, action.index],
        wonBy: right ? answeringTeam : c.wonBy,
      }))
      if (!right) return next
      return {
        ...next,
        scores: { ...next.scores, [answeringTeam]: (next.scores[answeringTeam] ?? 0) + clue.value },
        correctCount: bump(next.correctCount, by),
      }
    }

    case 'LIFELINE': {
      // Only after buzzing: the choices are on screen for everyone from
      // `reading`, so a lifeline spendable earlier would help the opponent
      // as much as the team that paid for it.
      if (state.phase !== 'answer' || !clue) return state
      if (clue.buzzedBy !== by || clue.buzzedTeam === null) return state
      const spender = clue.buzzedTeam
      if ((state.lifelines[spender] ?? 0) <= 0) return state
      if (clue.eliminated[spender]) return state
      const cut = fiftyFifty(clue.order, clue.correct, state.seed, state.active!, spender)
      return withActive(
        { ...state, lifelines: { ...state.lifelines, [spender]: state.lifelines[spender]! - 1 } },
        c => ({ ...c, eliminated: { ...c.eliminated, [spender]: cut } }),
      )
    }

    // SKIP and END are host-only. The runtime enforces that from hostActions,
    // because `reduce` is pure and cannot know who the host is.
    case 'SKIP': {
      if (!clue) return state
      // Spending both teams' shots is what sends nextPhase to the reveal.
      return withActive(state, c => ({ ...c, spentTeams: [...state.teamIds] }))
    }

    case 'END':
      return { ...state, tiles: state.tiles.map(t => ({ ...t, spent: true })) }

    default:
      return state
  }
}
