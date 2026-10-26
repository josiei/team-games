import { beforeEach, describe, expect, it } from 'vitest'
import { asPlayerId, type Player } from '../index.js'
import {
  makeCreateState, nextPhase, phaseComplete, reduce, setPhase, tally,
  type FrightState,
} from '../fright.js'
import type { Pack } from '../fright-pack.js'

const VALUES = [100, 200]

const PACK: Pack = {
  id: 'test', name: 'Test', values: VALUES,
  categories: ['cat-a', 'cat-b'].map(id => ({
    id, name: id,
    clues: VALUES.map(value => ({
      value, kind: 'text' as const, prompt: `${id}${value}`,
      choices: [`right-${id}${value}`, 'w1', 'w2', 'w3'],
      source: 's', verifiedAt: '2026-10-25',
    })),
  })),
}

const BLUE = asPlayerId('blue1')
const RED = asPlayerId('red1')
const player = (id: ReturnType<typeof asPlayerId>, team: string | null, n: number): Player =>
  ({ id, displayName: String(id), connected: true, joinedAt: n, avatar: '', team })
const PLAYERS = [player(BLUE, 'blue', 1), player(RED, 'red', 2)]
const create = makeCreateState(PACK, ['blue', 'red'])

let state: FrightState
beforeEach(() => {
  state = setPhase({ ...create(PLAYERS, 1), control: 'blue' }, 'board')
})

const active = (s: FrightState) => s.clues[s.active!]!
const wrongIndex = (s: FrightState) =>
  active(s).order.findIndex((_, i) => i !== active(s).correct)

/** board -> picked -> reading -> clue (armed). */
function armed(): FrightState {
  let s = reduce(state, { type: 'PICK', categoryId: 'cat-a', value: 100 }, BLUE)
  s = setPhase(s, 'reading')
  return setPhase(s, 'clue')
}

describe('nextPhase', () => {
  it('lobby goes to board', () => {
    expect(nextPhase(state, 'lobby')).toBe('board')
  })

  it('board goes to reading', () => {
    expect(nextPhase(state, 'board')).toBe('reading')
  })

  it('reading always goes to clue', () => {
    expect(nextPhase(armed(), 'reading')).toBe('clue')
  })

  it('clue with a buzz goes to answer', () => {
    const s = reduce(armed(), { type: 'BUZZ' }, BLUE)
    expect(nextPhase(s, 'clue')).toBe('answer')
  })

  it('clue with no buzz goes to reveal', () => {
    expect(nextPhase(armed(), 'clue')).toBe('reveal')
  })

  it('steal with a buzz goes to answer', () => {
    let s = setPhase(reduce(armed(), { type: 'BUZZ' }, BLUE), 'answer')
    s = reduce(s, { type: 'CHOOSE', index: wrongIndex(s) }, BLUE)
    s = setPhase(s, 'steal')
    s = reduce(s, { type: 'BUZZ' }, RED)
    expect(nextPhase(s, 'steal')).toBe('answer')
  })

  it('steal with no buzz goes to reveal', () => {
    let s = setPhase(reduce(armed(), { type: 'BUZZ' }, BLUE), 'answer')
    s = reduce(s, { type: 'CHOOSE', index: wrongIndex(s) }, BLUE)
    s = setPhase(s, 'steal')
    expect(nextPhase(s, 'steal')).toBe('reveal')
  })

  it('answer goes to reveal when the choice was correct', () => {
    let s = setPhase(reduce(armed(), { type: 'BUZZ' }, BLUE), 'answer')
    s = reduce(s, { type: 'CHOOSE', index: active(s).correct }, BLUE)
    expect(nextPhase(s, 'answer')).toBe('reveal')
  })

  it('answer goes to steal when wrong and the other team still has a shot', () => {
    let s = setPhase(reduce(armed(), { type: 'BUZZ' }, BLUE), 'answer')
    s = reduce(s, { type: 'CHOOSE', index: wrongIndex(s) }, BLUE)
    expect(nextPhase(s, 'answer')).toBe('steal')
  })

  it('answer goes to reveal when wrong and both teams have spent their shots', () => {
    let s = setPhase(reduce(armed(), { type: 'BUZZ' }, BLUE), 'answer')
    s = reduce(s, { type: 'CHOOSE', index: wrongIndex(s) }, BLUE)
    s = setPhase(s, 'steal')
    s = setPhase(reduce(s, { type: 'BUZZ' }, RED), 'answer')
    s = reduce(s, { type: 'CHOOSE', index: wrongIndex(s) }, RED)
    expect(nextPhase(s, 'answer')).toBe('reveal')
  })

  it('answer with the clock run out and nothing chosen goes to steal', () => {
    // The phase clock expired: nobody chose, and that spends the shot.
    const s = setPhase(reduce(armed(), { type: 'BUZZ' }, BLUE), 'answer')
    expect(nextPhase(s, 'answer')).toBe('steal')
  })

  it('reveal goes to board while tiles remain', () => {
    const s = { ...armed(), phase: 'reveal' }
    expect(nextPhase(s, 'reveal')).toBe('board')
  })

  it('reveal goes to results when every tile is spent', () => {
    const s = { ...armed(), phase: 'reveal', tiles: state.tiles.map(t => ({ ...t, spent: true })) }
    expect(nextPhase(s, 'reveal')).toBe('results')
  })

  it('results is terminal', () => {
    expect(nextPhase({ ...state, phase: 'results' }, 'results')).toBeNull()
  })

  it('board with every tile spent goes to results rather than an empty clue', () => {
    const s = { ...state, tiles: state.tiles.map(t => ({ ...t, spent: true })) }
    expect(nextPhase(s, 'board')).toBe('results')
  })
})

describe('phaseComplete', () => {
  const connected = PLAYERS

  it('is true in board once a tile is picked', () => {
    expect(phaseComplete(state, 'board', connected)).toBe(false)
    const s = reduce(state, { type: 'PICK', categoryId: 'cat-a', value: 100 }, BLUE)
    expect(phaseComplete(s, 'board', connected)).toBe(true)
  })

  it('is true in clue once a buzz lands', () => {
    const s = armed()
    expect(phaseComplete(s, 'clue', connected)).toBe(false)
    expect(phaseComplete(reduce(s, { type: 'BUZZ' }, BLUE), 'clue', connected)).toBe(true)
  })

  it('is true in steal once a buzz lands', () => {
    let s = setPhase(reduce(armed(), { type: 'BUZZ' }, BLUE), 'answer')
    s = reduce(s, { type: 'CHOOSE', index: wrongIndex(s) }, BLUE)
    s = setPhase(s, 'steal')
    expect(phaseComplete(s, 'steal', connected)).toBe(false)
    expect(phaseComplete(reduce(s, { type: 'BUZZ' }, RED), 'steal', connected)).toBe(true)
  })

  it('is true in answer once a choice lands', () => {
    const s = setPhase(reduce(armed(), { type: 'BUZZ' }, BLUE), 'answer')
    expect(phaseComplete(s, 'answer', connected)).toBe(false)
    const chosen = reduce(s, { type: 'CHOOSE', index: active(s).correct }, BLUE)
    expect(phaseComplete(chosen, 'answer', connected)).toBe(true)
  })

  it('is false in reading, which always runs its full clock', () => {
    const s = setPhase(reduce(state, { type: 'PICK', categoryId: 'cat-a', value: 100 }, BLUE),
      'reading')
    expect(phaseComplete(s, 'reading', connected)).toBe(false)
  })

  // A disconnect mid-answer must not hold the room open.
  it('is true in answer when the buzzing player has gone', () => {
    const s = setPhase(reduce(armed(), { type: 'BUZZ' }, BLUE), 'answer')
    expect(phaseComplete(s, 'answer', [player(RED, 'red', 2)])).toBe(true)
  })
})

describe('tally', () => {
  it('names the leading team', () => {
    const s = { ...state, scores: { blue: 500, red: 300 } }
    expect(tally(s)).toEqual({ scores: { blue: 500, red: 300 }, winner: 'blue' })
  })

  it('reports a tie as a tie, with no winner', () => {
    const s = { ...state, scores: { blue: 400, red: 400 } }
    expect(tally(s).winner).toBeNull()
  })

  it('reports nil-nil as a tie', () => {
    expect(tally(state).winner).toBeNull()
  })
})

describe('a shot that is never taken is still spent', () => {
  /** Buzz, enter `answer`, and say nothing: the phase clock runs out. */
  function timedOut(): FrightState {
    return setPhase(reduce(armed(), { type: 'BUZZ' }, BLUE), 'answer')
  }

  it('the buzzing team cannot buzz again in the steal they caused', () => {
    const stolen = setPhase(timedOut(), 'steal')
    expect(active(stolen).spentTeams).toContain('blue')
    expect(reduce(stolen, { type: 'BUZZ' }, BLUE).clues[stolen.active!]!.buzzedBy)
      .toBeNull()
  })

  it('the other team can still buzz in that steal', () => {
    const stolen = setPhase(timedOut(), 'steal')
    expect(reduce(stolen, { type: 'BUZZ' }, RED).clues[stolen.active!]!.buzzedBy)
      .toBe(RED)
  })

  // Without this the clue loops answer -> steal -> answer forever on one
  // player who buzzed and then walked away from their laptop.
  it('both teams timing out reaches the reveal rather than looping', () => {
    let s = timedOut()
    expect(nextPhase(s, 'answer')).toBe('steal')
    s = setPhase(s, 'steal')
    s = setPhase(reduce(s, { type: 'BUZZ' }, RED), 'answer')
    expect(nextPhase(s, 'answer')).toBe('reveal')
  })

  it('a timeout by the second team does not open a third shot', () => {
    let s = timedOut()
    s = setPhase(s, 'steal')
    s = setPhase(reduce(s, { type: 'BUZZ' }, RED), 'answer')
    s = setPhase(s, 'reveal')
    expect(active(s).spentTeams.sort()).toEqual(['blue', 'red'])
  })

  it('a disconnect mid-answer forfeits that team shot too', () => {
    // phaseComplete ends the phase early when the answerer has gone; the
    // forfeit has to follow, or the room re-arms the absent team.
    const s = timedOut()
    expect(phaseComplete(s, 'answer', [player(RED, 'red', 2)])).toBe(true)
    expect(active(setPhase(s, 'steal')).spentTeams).toContain('blue')
  })
})

describe('the board ends promptly when there is nothing left', () => {
  it('phaseComplete is true in board once every tile is spent', () => {
    const s = { ...state, tiles: state.tiles.map(t => ({ ...t, spent: true })) }
    // The host pressed End: the room must not sit out the rest of BOARD_MS.
    expect(phaseComplete(s, 'board', PLAYERS)).toBe(true)
  })
})
