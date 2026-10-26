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
  /** Category id -> display name, so a view never has to carry the pack. */
  categoryNames: Record<string, string>
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
    const categoryNames: Record<string, string> = {}
    for (const category of pack.categories) {
      categoryNames[category.id] = category.name
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
      categoryNames,
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

/**
 * Where the room goes when `current` ends.
 *
 * This is the method the board needed and a linear phase list could not
 * express: `board` is revisited once per tile, in whatever order the players
 * pick, and `steal` loops back into `answer`.
 */
export function nextPhase(state: FrightState, current: string): string | null {
  const clue = state.active ? state.clues[state.active] ?? null : null
  const tilesLeft = state.tiles.some(t => !t.spent)

  switch (current) {
    case 'lobby':
      return 'board'

    case 'board':
      // Nothing left to pick: the host ended the game, or the last reveal
      // spent the final tile while this phase was still on screen.
      return tilesLeft || state.active !== null ? 'reading' : 'results'

    case 'reading':
      return 'clue'

    case 'clue':
    case 'steal':
      // A buzz landed, so somebody owes an answer; otherwise show the answer.
      return clue?.buzzedBy ? 'answer' : 'reveal'

    case 'answer': {
      if (!clue) return 'reveal'
      // Right, or both teams out of shots: the clue is finished either way.
      if (clue.wonBy !== null) return 'reveal'
      const everyoneTried = state.teamIds.every(id => clue.spentTeams.includes(id))
      return everyoneTried ? 'reveal' : 'steal'
    }

    case 'reveal':
      return tilesLeft ? 'board' : 'results'

    default:
      return null
  }
}

/**
 * Whether this phase has nothing left to wait for.
 *
 * The runtime adds its own 700ms beat before acting on this, which is wanted
 * here: the room sees "Blue buzzed!" before the buttons come alive.
 */
export function phaseComplete(
  state: FrightState, phase: string, players: Player[],
): boolean {
  const clue = state.active ? state.clues[state.active] ?? null : null

  switch (phase) {
    case 'board':
      return state.active !== null
    case 'clue':
    case 'steal':
      return clue?.buzzedBy != null
    case 'answer': {
      if (!clue || clue.buzzedTeam === null) return true
      // The shot is spent the moment an answer lands.
      if (clue.spentTeams.includes(clue.buzzedTeam)) return true
      // Nobody can answer for them, so waiting out the clock is dead air.
      return !players.some(p => p.id === clue.buzzedBy)
    }
    default:
      // `reading` runs its full clock on purpose: it is the window that makes
      // the buzzer race about reading speed rather than reflexes.
      return false
  }
}

/** Final scores, and the winner — or null, because a tie is shown as a tie. */
export function tally(state: FrightState): {
  scores: Record<string, number>
  winner: string | null
} {
  const best = Math.max(...state.teamIds.map(id => state.scores[id] ?? 0))
  const leaders = state.teamIds.filter(id => (state.scores[id] ?? 0) === best)
  return { scores: state.scores, winner: leaders.length === 1 ? leaders[0]! : null }
}

export type BoardTileView = { categoryId: string; value: number; spent: boolean }

/**
 * View kinds are prefixed because the client routes on this discriminant
 * alone, and every game would otherwise want to call its last screen
 * 'results'. The prefix is what keeps two games' screens apart.
 */
export type FrightView =
  | { kind: 'lobby'; playerCount: number }
  | {
      kind: 'fright-board'
      categories: { id: string; name: string }[]
      tiles: BoardTileView[]
      scores: Record<string, number>
      lifelines: Record<string, number>
      control: string
      canPick: boolean
    }
  | {
      kind: 'fright-clue'
      categoryId: string
      categoryName: string
      value: number
      clueKind: 'image' | 'text'
      prompt: string
      file?: string
      mosaic?: number
      order: string[]
      armed: boolean
      canBuzz: boolean
      canChoose: boolean
      canLifeline: boolean
      answeringId: PlayerId | null
      answeringTeam: string | null
      wrongIndexes: number[]
      /** This viewer's OWN team's eliminations. Never anyone else's. */
      myEliminated: number[]
      scores: Record<string, number>
      lifelines: Record<string, number>
    }
  | {
      kind: 'fright-reveal'
      categoryName: string
      value: number
      clueKind: 'image' | 'text'
      prompt: string
      file?: string
      order: string[]
      correct: number
      wonBy: string | null
      outcome: 'won' | 'missed' | 'no-buzz'
      scores: Record<string, number>
      lifelines: Record<string, number>
    }
  | {
      kind: 'fright-results'
      scores: Record<string, number>
      winner: string | null
      gallery: { file: string; answer: string; categoryName: string; value: number }[]
      buzzCount: Record<string, number>
      correctCount: Record<string, number>
    }

/**
 * One view per viewer, built field by field.
 *
 * **Never spread an ActiveClue into a view.** Spreading is how `correct` and
 * the other team's `eliminated` would escape, and both of those are the whole
 * reason this function exists rather than shipping raw state.
 */
export function viewFor(
  state: FrightState, viewer: PlayerId, _players?: Player[],
): FrightView {
  const myTeam = state.teams[viewer] ?? null
  const clue = state.active ? state.clues[state.active] ?? null : null
  const money = { scores: state.scores, lifelines: state.lifelines }

  if (state.phase === 'lobby') {
    return { kind: 'lobby', playerCount: Object.keys(state.teams).length }
  }

  if (state.phase === 'results') {
    const { scores, winner } = tally(state)
    return {
      kind: 'fright-results',
      scores,
      winner,
      gallery: Object.values(state.clues)
        .filter(c => c.kind === 'image' && c.file)
        .map(c => ({
          file: c.file!,
          answer: c.order[c.correct]!,
          categoryName: state.categoryNames[c.categoryId] ?? c.categoryId,
          value: c.value,
        })),
      buzzCount: { ...state.buzzCount },
      correctCount: { ...state.correctCount },
    }
  }

  if (state.phase === 'reveal' && clue) {
    const outcome: 'won' | 'missed' | 'no-buzz' =
      clue.wonBy !== null ? 'won' : clue.wrongIndexes.length > 0 ? 'missed' : 'no-buzz'
    return {
      kind: 'fright-reveal',
      categoryName: state.categoryNames[clue.categoryId] ?? clue.categoryId,
      value: clue.value,
      clueKind: clue.kind,
      prompt: clue.prompt,
      ...(clue.file ? { file: clue.file } : {}),
      order: clue.order,
      correct: clue.correct,          // the one place this is allowed out
      wonBy: clue.wonBy,
      outcome,
      ...money,
    }
  }

  const onClue = clue
    && (state.phase === 'reading' || state.phase === 'clue'
      || state.phase === 'steal' || state.phase === 'answer')

  if (onClue) {
    const armed = state.phase === 'clue' || state.phase === 'steal'
    const isAnswerer = clue.buzzedBy === viewer
    return {
      kind: 'fright-clue',
      categoryId: clue.categoryId,
      categoryName: state.categoryNames[clue.categoryId] ?? clue.categoryId,
      value: clue.value,
      clueKind: clue.kind,
      prompt: clue.prompt,
      ...(clue.file ? { file: clue.file } : {}),
      ...(clue.mosaic !== undefined ? { mosaic: clue.mosaic } : {}),
      order: clue.order,
      armed,
      canBuzz: armed && myTeam !== null
        && clue.buzzedBy === null && !clue.spentTeams.includes(myTeam),
      canChoose: state.phase === 'answer' && isAnswerer
        && clue.buzzedTeam !== null && !clue.spentTeams.includes(clue.buzzedTeam),
      canLifeline: state.phase === 'answer' && isAnswerer
        && clue.buzzedTeam !== null
        && (state.lifelines[clue.buzzedTeam] ?? 0) > 0
        && clue.eliminated[clue.buzzedTeam] === undefined,
      answeringId: clue.buzzedBy,
      answeringTeam: clue.buzzedTeam,
      wrongIndexes: clue.wrongIndexes,
      // Own team only. Giving the other team these would hand the steal a
      // narrowed field and undo the point of a private lifeline.
      myEliminated: myTeam !== null ? clue.eliminated[myTeam] ?? [] : [],
      ...money,
    }
  }

  return {
    kind: 'fright-board',
    categories: dedupeCategories(state),
    tiles: state.tiles.map(t => ({ ...t })),
    control: state.control,
    canPick: myTeam !== null && myTeam === state.control,
    ...money,
  }
}

/** Category order, taken from the tiles so the board renders left to right. */
function dedupeCategories(state: FrightState): { id: string; name: string }[] {
  const seen: { id: string; name: string }[] = []
  for (const tile of state.tiles) {
    if (!seen.some(c => c.id === tile.categoryId)) {
      seen.push({ id: tile.categoryId, name: state.categoryNames[tile.categoryId] ?? tile.categoryId })
    }
  }
  return seen
}
