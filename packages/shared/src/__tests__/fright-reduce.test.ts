import { beforeEach, describe, expect, it } from 'vitest'
import { asPlayerId, type Player } from '../index.js'
import { clueKey, makeCreateState, reduce, setPhase, type FrightState } from '../fright.js'
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

const BLUE_1 = asPlayerId('blue1')
const BLUE_2 = asPlayerId('blue2')
const RED_1 = asPlayerId('red1')
const WATCHER = asPlayerId('watcher')

const player = (id: ReturnType<typeof asPlayerId>, team: string | null, n: number): Player =>
  ({ id, displayName: String(id), connected: true, joinedAt: n, avatar: '', team })

const PLAYERS = [
  player(BLUE_1, 'blue', 1), player(BLUE_2, 'blue', 2),
  player(RED_1, 'red', 3), player(WATCHER, null, 4),
]

const create = makeCreateState(PACK, ['blue', 'red'])

let state: FrightState
beforeEach(() => {
  state = create(PLAYERS, 1)
  state = { ...state, control: 'blue' }
  state = setPhase(state, 'board')
})

/** Walk to an armed clue with a tile already picked. */
function armed(from: FrightState = state): FrightState {
  let s = reduce(from, { type: 'PICK', categoryId: 'cat-a', value: 100 }, BLUE_1)
  s = setPhase(s, 'reading')
  return setPhase(s, 'clue')
}

const active = (s: FrightState) => s.clues[s.active!]!

describe('PICK', () => {
  it('a player on the controlling team opens a tile', () => {
    const next = reduce(state, { type: 'PICK', categoryId: 'cat-a', value: 100 }, BLUE_1)
    expect(next.active).toBe(clueKey('cat-a', 100))
    expect(next.tiles.find(t => t.categoryId === 'cat-a' && t.value === 100)!.spent).toBe(true)
  })

  it('a player on the other team cannot open a tile', () => {
    const next = reduce(state, { type: 'PICK', categoryId: 'cat-a', value: 100 }, RED_1)
    expect(next.active).toBeNull()
  })

  it('a spectator cannot open a tile', () => {
    const next = reduce(state, { type: 'PICK', categoryId: 'cat-a', value: 100 }, WATCHER)
    expect(next.active).toBeNull()
  })

  // A stale client re-sending a click after the board moved on.
  it('PICK on a spent tile changes nothing', () => {
    const once = reduce(state, { type: 'PICK', categoryId: 'cat-a', value: 100 }, BLUE_1)
    const back = setPhase({ ...once, phase: 'reveal' }, 'board')
    const again = reduce(back, { type: 'PICK', categoryId: 'cat-a', value: 100 }, BLUE_1)
    expect(again.active).toBeNull()
  })

  it('PICK naming a category that is not on the board changes nothing', () => {
    const next = reduce(state, { type: 'PICK', categoryId: 'nope', value: 100 }, BLUE_1)
    expect(next.active).toBeNull()
  })

  it('PICK naming a value that is not a row changes nothing', () => {
    const next = reduce(state, { type: 'PICK', categoryId: 'cat-a', value: 999 }, BLUE_1)
    expect(next.active).toBeNull()
  })

  it('PICK outside the board phase changes nothing', () => {
    const next = reduce(setPhase(state, 'clue'),
      { type: 'PICK', categoryId: 'cat-a', value: 100 }, BLUE_1)
    expect(next.active).toBeNull()
  })

  it('a second PICK while one is open changes nothing', () => {
    const once = reduce(state, { type: 'PICK', categoryId: 'cat-a', value: 100 }, BLUE_1)
    const twice = reduce(once, { type: 'PICK', categoryId: 'cat-b', value: 200 }, BLUE_1)
    expect(twice.active).toBe(clueKey('cat-a', 100))
  })
})

describe('BUZZ', () => {
  it('a buzz during reading is ignored, because the buzzer is not armed yet', () => {
    let s = reduce(state, { type: 'PICK', categoryId: 'cat-a', value: 100 }, BLUE_1)
    s = setPhase(s, 'reading')
    const next = reduce(s, { type: 'BUZZ' }, BLUE_1)
    expect(active(next).buzzedBy).toBeNull()
  })

  it('the first buzz in clue wins and records the player and their team', () => {
    const next = reduce(armed(), { type: 'BUZZ' }, RED_1)
    expect(active(next).buzzedBy).toBe(RED_1)
    expect(active(next).buzzedTeam).toBe('red')
  })

  // phaseComplete goes true on the first buzz but the phase does not change
  // for EARLY_ADVANCE_MS, so a second press lands on a still-live clue phase.
  it('a second buzz arriving before the phase changes does not displace the first', () => {
    const first = reduce(armed(), { type: 'BUZZ' }, BLUE_1)
    const second = reduce(first, { type: 'BUZZ' }, RED_1)
    expect(active(second).buzzedBy).toBe(BLUE_1)
    expect(active(second).buzzedTeam).toBe('blue')
  })

  it('a spectator cannot buzz', () => {
    const next = reduce(armed(), { type: 'BUZZ' }, WATCHER)
    expect(active(next).buzzedBy).toBeNull()
  })

  it('a team that has spent its shot cannot buzz in steal', () => {
    let s = armed()
    s = setPhase(reduce(s, { type: 'BUZZ' }, BLUE_1), 'answer')
    s = reduce(s, { type: 'CHOOSE', index: wrongIndex(s) }, BLUE_1)
    s = setPhase(s, 'steal')
    const next = reduce(s, { type: 'BUZZ' }, BLUE_2)   // same team, already spent
    expect(active(next).buzzedBy).toBeNull()
  })

  it('the other team can buzz in steal', () => {
    let s = armed()
    s = setPhase(reduce(s, { type: 'BUZZ' }, BLUE_1), 'answer')
    s = reduce(s, { type: 'CHOOSE', index: wrongIndex(s) }, BLUE_1)
    s = setPhase(s, 'steal')
    const next = reduce(s, { type: 'BUZZ' }, RED_1)
    expect(active(next).buzzedBy).toBe(RED_1)
  })

  it('counts a buzz against the player who made it', () => {
    const next = reduce(armed(), { type: 'BUZZ' }, BLUE_1)
    expect(next.buzzCount[BLUE_1]).toBe(1)
  })
})

function wrongIndex(s: FrightState): number {
  const clue = s.clues[s.active!]!
  return clue.order.findIndex((_, i) => i !== clue.correct)
}

describe('CHOOSE', () => {
  /** Buzz, then enter `answer` as the runtime does once phaseComplete fires. */
  function buzzed() {
    return setPhase(reduce(armed(), { type: 'BUZZ' }, BLUE_1), 'answer')
  }

  it('the buzzing player choosing the correct index scores the tile value', () => {
    const s = buzzed()
    const next = reduce(s, { type: 'CHOOSE', index: active(s).correct }, BLUE_1)
    expect(next.scores.blue).toBe(100)
    expect(active(next).wonBy).toBe('blue')
    expect(next.correctCount[BLUE_1]).toBe(1)
  })

  it('choosing wrong records the index and spends that team shot', () => {
    const s = buzzed()
    const next = reduce(s, { type: 'CHOOSE', index: wrongIndex(s) }, BLUE_1)
    expect(next.scores.blue).toBe(0)
    expect(active(next).wrongIndexes).toContain(wrongIndex(s))
    expect(active(next).spentTeams).toContain('blue')
    expect(active(next).wonBy).toBeNull()
  })

  it('a correct answer also spends the shot, so the clue is finished', () => {
    const s = buzzed()
    const next = reduce(s, { type: 'CHOOSE', index: active(s).correct }, BLUE_1)
    expect(active(next).spentTeams).toContain('blue')
  })

  // The UI only offers buttons to one person; the socket does not enforce it.
  it('a CHOOSE from a teammate of the buzzing player is ignored', () => {
    const s = buzzed()
    const next = reduce(s, { type: 'CHOOSE', index: active(s).correct }, BLUE_2)
    expect(next.scores.blue).toBe(0)
    expect(active(next).spentTeams).toEqual([])
  })

  it('a CHOOSE from the other team is ignored', () => {
    const s = buzzed()
    const next = reduce(s, { type: 'CHOOSE', index: active(s).correct }, RED_1)
    expect(next.scores.red).toBe(0)
  })

  it('a CHOOSE with nobody buzzed is ignored', () => {
    const s = armed()
    const next = reduce(s, { type: 'CHOOSE', index: 0 }, BLUE_1)
    expect(active(next).spentTeams).toEqual([])
  })

  it('an out-of-range index is ignored and does NOT spend the shot', () => {
    const s = buzzed()
    for (const index of [-1, 4, 99, 1.5, Number.NaN]) {
      const next = reduce(s, { type: 'CHOOSE', index }, BLUE_1)
      expect(active(next).spentTeams).toEqual([])
      expect(active(next).wrongIndexes).toEqual([])
    }
  })

  it('a second CHOOSE after the first is ignored', () => {
    const s = buzzed()
    const once = reduce(s, { type: 'CHOOSE', index: wrongIndex(s) }, BLUE_1)
    const twice = reduce(once, { type: 'CHOOSE', index: active(once).correct }, BLUE_1)
    expect(twice.scores.blue).toBe(0)
  })
})

describe('LIFELINE', () => {
  /** Buzz, then enter `answer` as the runtime does once phaseComplete fires. */
  function buzzed() {
    return setPhase(reduce(armed(), { type: 'BUZZ' }, BLUE_1), 'answer')
  }

  it('the buzzing player spends one and their team eliminations are recorded', () => {
    const next = reduce(buzzed(), { type: 'LIFELINE' }, BLUE_1)
    expect(next.lifelines.blue).toBe(1)
    expect(active(next).eliminated.blue).toHaveLength(2)
  })

  it('never eliminates the correct index', () => {
    const next = reduce(buzzed(), { type: 'LIFELINE' }, BLUE_1)
    expect(active(next).eliminated.blue).not.toContain(active(next).correct)
  })

  it('a lifeline before any buzz is ignored', () => {
    const next = reduce(armed(), { type: 'LIFELINE' }, BLUE_1)
    expect(next.lifelines.blue).toBe(2)
  })

  it('a lifeline from the team that did not buzz is ignored', () => {
    const next = reduce(buzzed(), { type: 'LIFELINE' }, RED_1)
    expect(next.lifelines.red).toBe(2)
    expect(active(next).eliminated.red).toBeUndefined()
  })

  it('a second lifeline on the same clue by the same team is ignored', () => {
    const once = reduce(buzzed(), { type: 'LIFELINE' }, BLUE_1)
    const twice = reduce(once, { type: 'LIFELINE' }, BLUE_1)
    expect(twice.lifelines.blue).toBe(1)
  })

  it('a team with none left cannot spend one', () => {
    const s = { ...buzzed(), lifelines: { blue: 0, red: 2 } }
    const next = reduce(s, { type: 'LIFELINE' }, BLUE_1)
    expect(next.lifelines.blue).toBe(0)
    expect(active(next).eliminated.blue).toBeUndefined()
  })

  it('both teams may each spend one on the same clue, with their own eliminations', () => {
    let s = reduce(buzzed(), { type: 'LIFELINE' }, BLUE_1)
    s = reduce(s, { type: 'CHOOSE', index: wrongIndex(s) }, BLUE_1)
    s = setPhase(s, 'steal')
    s = setPhase(reduce(s, { type: 'BUZZ' }, RED_1), 'answer')
    s = reduce(s, { type: 'LIFELINE' }, RED_1)
    expect(active(s).eliminated.blue).toHaveLength(2)
    expect(active(s).eliminated.red).toHaveLength(2)
    expect(s.lifelines).toEqual({ blue: 1, red: 1 })
  })
})

describe('SKIP and END', () => {
  // Authorisation is the runtime's job (hostActions), not the reducer's.
  it('SKIP spends the active tile and clears the buzz', () => {
    const next = reduce(armed(), { type: 'SKIP' }, BLUE_1)
    expect(active(next).spentTeams.sort()).toEqual(['blue', 'red'])
  })

  it('END marks every tile spent so the board is finished', () => {
    const next = reduce(armed(), { type: 'END' }, BLUE_1)
    expect(next.tiles.every(t => t.spent)).toBe(true)
  })
})

describe('unknown actions', () => {
  it('an unrecognised action returns the state unchanged', () => {
    const next = reduce(state, { type: 'NONSENSE' } as never, BLUE_1)
    expect(next).toBe(state)
  })
})
