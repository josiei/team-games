import { beforeEach, describe, expect, it } from 'vitest'
import { asPlayerId, type Player } from '../index.js'
import {
  FRIGHT_PHASES, makeCreateState, reduce, setPhase, viewFor, type FrightState,
} from '../fright.js'
import type { Pack } from '../fright-pack.js'

const VALUES = [100, 200]

const PACK: Pack = {
  id: 'test', name: 'Test', values: VALUES,
  categories: [
    {
      id: 'cat-a', name: 'Cat A',
      clues: VALUES.map(value => ({
        value, kind: 'image' as const, file: `a${value}.png`, mosaic: 12,
        prompt: `a${value}`, choices: [`right-a${value}`, 'w1', 'w2', 'w3'],
        source: 's', verifiedAt: '2026-10-25',
      })),
    },
    {
      id: 'cat-b', name: 'Cat B',
      clues: VALUES.map(value => ({
        value, kind: 'text' as const, prompt: `b${value}`,
        choices: [`right-b${value}`, 'w1', 'w2', 'w3'],
        source: 's', verifiedAt: '2026-10-25',
      })),
    },
  ],
}

const BLUE = asPlayerId('blue1')
const BLUE_2 = asPlayerId('blue2')
const RED = asPlayerId('red1')
const WATCHER = asPlayerId('watcher')

const player = (id: ReturnType<typeof asPlayerId>, team: string | null, n: number): Player =>
  ({ id, displayName: String(id), connected: true, joinedAt: n, avatar: '', team })

const PLAYERS = [
  player(BLUE, 'blue', 1), player(BLUE_2, 'blue', 2),
  player(RED, 'red', 3), player(WATCHER, null, 4),
]
const EVERYONE = PLAYERS.map(p => p.id)
const create = makeCreateState(PACK, ['blue', 'red'])

let base: FrightState
beforeEach(() => { base = setPhase({ ...create(PLAYERS, 3), control: 'blue' }, 'board') })

const active = (s: FrightState) => s.clues[s.active!]!
const wrongIndex = (s: FrightState) =>
  active(s).order.findIndex((_, i) => i !== active(s).correct)

function armed(from = base): FrightState {
  let s = reduce(from, { type: 'PICK', categoryId: 'cat-a', value: 100 }, BLUE)
  s = setPhase(s, 'reading')
  return setPhase(s, 'clue')
}

describe('redaction', () => {
  /** Every phase a real game passes through, with a clue in flight. */
  function statesByPhase(): FrightState[] {
    const picked = reduce(base, { type: 'PICK', categoryId: 'cat-a', value: 100 }, BLUE)
    const reading = setPhase(picked, 'reading')
    const clue = setPhase(reading, 'clue')
    const buzzed = reduce(clue, { type: 'BUZZ' }, BLUE)
    const answering = setPhase(buzzed, 'answer')
    const lifelined = reduce(answering, { type: 'LIFELINE' }, BLUE)
    const wrong = reduce(lifelined, { type: 'CHOOSE', index: wrongIndex(lifelined) }, BLUE)
    const steal = setPhase(wrong, 'steal')
    return [base, picked, reading, clue, buzzed, answering, lifelined, wrong, steal]
  }

  // The single most important test in this suite.
  it('no pre-reveal view for any phase and any viewer carries the correct index', () => {
    for (const state of statesByPhase()) {
      for (const viewer of EVERYONE) {
        const view = viewFor(state, viewer, PLAYERS)
        const json = JSON.stringify(view)
        expect(json).not.toContain('"correct"')
        // The answer's own text must not leak either: it is one of `order`,
        // so check the server never labels which one.
        expect(view).not.toHaveProperty('correct')
      }
    }
  })

  it('every phase name the game declares produces a view without the answer', () => {
    for (const phase of FRIGHT_PHASES) {
      if (phase === 'reveal' || phase === 'results') continue
      const state = setPhase(armed(), phase)
      for (const viewer of EVERYONE) {
        expect(JSON.stringify(viewFor(state, viewer, PLAYERS))).not.toContain('"correct"')
      }
    }
  })

  // Spending a lifeline must not hand the steal a narrowed field.
  it('a viewer receives their own team eliminations and never the other team\'s', () => {
    let s = setPhase(reduce(armed(), { type: 'BUZZ' }, BLUE), 'answer')
    s = reduce(s, { type: 'LIFELINE' }, BLUE)
    const cut = active(s).eliminated.blue!
    expect(cut.length).toBe(2)

    const blueView = viewFor(s, BLUE, PLAYERS) as { myEliminated?: number[] }
    expect(blueView.myEliminated).toEqual(cut)

    for (const viewer of [RED, WATCHER]) {
      const view = viewFor(s, viewer, PLAYERS)
      expect((view as { myEliminated?: number[] }).myEliminated).toEqual([])
      // Structural: the indexes must not appear under any key at all.
      const json = JSON.stringify(view)
      expect(json).not.toContain('"eliminated"')
    }
  })

  it('a teammate of the buzzing player does see their own team eliminations', () => {
    let s = setPhase(reduce(armed(), { type: 'BUZZ' }, BLUE), 'answer')
    s = reduce(s, { type: 'LIFELINE' }, BLUE)
    const view = viewFor(s, BLUE_2, PLAYERS) as { myEliminated?: number[] }
    expect(view.myEliminated).toEqual(active(s).eliminated.blue)
  })

  it('both teams lifeline counts are public', () => {
    const s = setPhase(reduce(armed(), { type: 'BUZZ' }, BLUE), 'answer')
    const view = viewFor(s, RED, PLAYERS) as { lifelines?: Record<string, number> }
    expect(view.lifelines).toEqual({ blue: 2, red: 2 })
  })
})

describe('the clue view', () => {
  it('canChoose is true only for the buzzing player', () => {
    const s = setPhase(reduce(armed(), { type: 'BUZZ' }, BLUE), 'answer')
    expect((viewFor(s, BLUE, PLAYERS) as { canChoose: boolean }).canChoose).toBe(true)
    for (const other of [BLUE_2, RED, WATCHER]) {
      expect((viewFor(s, other, PLAYERS) as { canChoose: boolean }).canChoose).toBe(false)
    }
  })

  it('canBuzz is false during reading and true during clue for an eligible team', () => {
    const picked = reduce(base, { type: 'PICK', categoryId: 'cat-a', value: 100 }, BLUE)
    const reading = setPhase(picked, 'reading')
    expect((viewFor(reading, BLUE, PLAYERS) as { canBuzz: boolean }).canBuzz).toBe(false)
    expect((viewFor(reading, BLUE, PLAYERS) as { armed: boolean }).armed).toBe(false)

    const clue = setPhase(reading, 'clue')
    expect((viewFor(clue, BLUE, PLAYERS) as { canBuzz: boolean }).canBuzz).toBe(true)
    expect((viewFor(clue, BLUE, PLAYERS) as { armed: boolean }).armed).toBe(true)
  })

  it('canBuzz is false for a team that has spent its shot during steal', () => {
    let s = setPhase(reduce(armed(), { type: 'BUZZ' }, BLUE), 'answer')
    s = reduce(s, { type: 'CHOOSE', index: wrongIndex(s) }, BLUE)
    s = setPhase(s, 'steal')
    expect((viewFor(s, BLUE, PLAYERS) as { canBuzz: boolean }).canBuzz).toBe(false)
    expect((viewFor(s, RED, PLAYERS) as { canBuzz: boolean }).canBuzz).toBe(true)
  })

  it('a spectator can neither buzz nor choose nor spend a lifeline', () => {
    const s = setPhase(reduce(armed(), { type: 'BUZZ' }, BLUE), 'answer')
    const view = viewFor(s, WATCHER, PLAYERS) as
      { canBuzz: boolean; canChoose: boolean; canLifeline: boolean }
    expect(view.canBuzz).toBe(false)
    expect(view.canChoose).toBe(false)
    expect(view.canLifeline).toBe(false)
  })

  it('canLifeline is true only for the buzzing player, with one left and none spent', () => {
    const s = setPhase(reduce(armed(), { type: 'BUZZ' }, BLUE), 'answer')
    expect((viewFor(s, BLUE, PLAYERS) as { canLifeline: boolean }).canLifeline).toBe(true)
    const spent = reduce(s, { type: 'LIFELINE' }, BLUE)
    expect((viewFor(spent, BLUE, PLAYERS) as { canLifeline: boolean }).canLifeline).toBe(false)
    const none = { ...s, lifelines: { blue: 0, red: 2 } }
    expect((viewFor(none, BLUE, PLAYERS) as { canLifeline: boolean }).canLifeline).toBe(false)
  })

  it('names who is answering, for everyone', () => {
    const s = setPhase(reduce(armed(), { type: 'BUZZ' }, BLUE), 'answer')
    for (const viewer of EVERYONE) {
      const view = viewFor(s, viewer, PLAYERS) as
        { answeringId: string | null; answeringTeam: string | null }
      expect(view.answeringId).toBe(BLUE)
      expect(view.answeringTeam).toBe('blue')
    }
  })

  it('carries the choices, the prompt and the image fields', () => {
    const s = armed()
    const view = viewFor(s, RED, PLAYERS) as
      { order: string[]; prompt: string; file?: string; mosaic?: number; value: number }
    expect(view.order).toHaveLength(4)
    expect(view.prompt).toBe('a100')
    expect(view.file).toBe('a100.png')
    expect(view.mosaic).toBe(12)
    expect(view.value).toBe(100)
  })

  it('shows a wrong pick to everyone, because it was earned not purchased', () => {
    let s = setPhase(reduce(armed(), { type: 'BUZZ' }, BLUE), 'answer')
    const wrong = wrongIndex(s)
    s = reduce(s, { type: 'CHOOSE', index: wrong }, BLUE)
    s = setPhase(s, 'steal')
    for (const viewer of EVERYONE) {
      expect((viewFor(s, viewer, PLAYERS) as { wrongIndexes: number[] }).wrongIndexes)
        .toContain(wrong)
    }
  })
})

describe('the board view', () => {
  it('marks spent tiles and names the controlling team', () => {
    const s = reduce(base, { type: 'PICK', categoryId: 'cat-a', value: 100 }, BLUE)
    const back = setPhase({ ...s, phase: 'reveal' }, 'board')
    const view = viewFor(back, RED, PLAYERS) as {
      kind: string
      tiles: { categoryId: string; value: number; spent: boolean }[]
      control: string
      categories: { id: string; name: string }[]
    }
    expect(view.kind).toBe('board')
    expect(view.tiles.find(t => t.categoryId === 'cat-a' && t.value === 100)!.spent).toBe(true)
    expect(view.control).toBe('red')
    expect(view.categories.map(c => c.id)).toEqual(['cat-a', 'cat-b'])
  })

  it('tells the viewer whether it is their team turn to pick', () => {
    expect((viewFor(base, BLUE, PLAYERS) as { canPick: boolean }).canPick).toBe(true)
    expect((viewFor(base, RED, PLAYERS) as { canPick: boolean }).canPick).toBe(false)
    expect((viewFor(base, WATCHER, PLAYERS) as { canPick: boolean }).canPick).toBe(false)
  })

  it('the board view carries no clue content at all', () => {
    const json = JSON.stringify(viewFor(base, BLUE, PLAYERS))
    expect(json).not.toContain('right-')
    expect(json).not.toContain('a100')
  })
})

describe('reveal and results', () => {
  it('the reveal view carries the correct index and the image file', () => {
    let s = setPhase(reduce(armed(), { type: 'BUZZ' }, BLUE), 'answer')
    s = reduce(s, { type: 'CHOOSE', index: active(s).correct }, BLUE)
    s = setPhase(s, 'reveal')
    const view = viewFor(s, RED, PLAYERS) as
      { kind: string; correct: number; file?: string; wonBy: string | null }
    expect(view.kind).toBe('reveal')
    expect(view.correct).toBe(active(s).correct)
    expect(view.file).toBe('a100.png')
    expect(view.wonBy).toBe('blue')
  })

  it('the reveal distinguishes nobody buzzing from both teams missing', () => {
    const noBuzz = setPhase(armed(), 'reveal')
    expect((viewFor(noBuzz, BLUE, PLAYERS) as { outcome: string }).outcome).toBe('no-buzz')

    let missed = setPhase(reduce(armed(), { type: 'BUZZ' }, BLUE), 'answer')
    missed = reduce(missed, { type: 'CHOOSE', index: wrongIndex(missed) }, BLUE)
    missed = setPhase(missed, 'steal')
    missed = setPhase(reduce(missed, { type: 'BUZZ' }, RED), 'answer')
    missed = reduce(missed, { type: 'CHOOSE', index: wrongIndex(missed) }, RED)
    missed = setPhase(missed, 'reveal')
    expect((viewFor(missed, BLUE, PLAYERS) as { outcome: string }).outcome).toBe('missed')
  })

  it('the results view carries scores, a winner and every image clue', () => {
    const s = setPhase({ ...base, scores: { blue: 300, red: 100 } }, 'results')
    const view = viewFor(s, BLUE, PLAYERS) as {
      kind: string
      scores: Record<string, number>
      winner: string | null
      gallery: { file: string; answer: string }[]
    }
    expect(view.kind).toBe('results')
    expect(view.winner).toBe('blue')
    expect(view.scores).toEqual({ blue: 300, red: 100 })
    expect(view.gallery.map(g => g.file).sort()).toEqual(['a100.png', 'a200.png'])
    expect(view.gallery.every(g => g.answer.startsWith('right-'))).toBe(true)
  })

  it('the lobby view is what a viewer gets before the game starts', () => {
    const view = viewFor({ ...base, phase: 'lobby' }, BLUE, PLAYERS) as { kind: string }
    expect(view.kind).toBe('lobby')
  })
})
