import { describe, expect, it } from 'vitest'
import { asPlayerId, type Player } from '../index.js'
import { makeCreateState, setPhase, type FrightState } from '../fright.js'
import type { Pack } from '../fright-pack.js'

const VALUES = [100, 200]

const PACK: Pack = {
  id: 'test', name: 'Test', values: VALUES,
  categories: [
    {
      id: 'cat-a', name: 'Cat A',
      clues: VALUES.map(value => ({
        value, kind: 'text' as const, prompt: `a${value}`,
        choices: [`right-a${value}`, 'w1', 'w2', 'w3'],
        source: 's', verifiedAt: '2026-10-25',
      })),
    },
    {
      id: 'cat-b', name: 'Cat B',
      clues: VALUES.map(value => ({
        value, kind: 'image' as const, file: `b${value}.png`, mosaic: 10,
        prompt: `b${value}`, choices: [`right-b${value}`, 'w1', 'w2', 'w3'],
        source: 's', verifiedAt: '2026-10-25',
      })),
    },
  ],
}

const player = (id: string, team: string | null, joinedAt: number): Player => ({
  id: asPlayerId(id), displayName: id, connected: true, joinedAt, avatar: '', team,
})

const PLAYERS = [
  player('a', 'blue', 1),
  player('b', 'red', 2),
  player('c', 'blue', 3),
  player('d', null, 4),        // a spectator: in the room, on no team
]

const create = makeCreateState(PACK, ['blue', 'red'])

describe('createState', () => {
  it('freezes each player team from the player list', () => {
    const state = create(PLAYERS, 1)
    expect(state.teams[asPlayerId('a')]).toBe('blue')
    expect(state.teams[asPlayerId('b')]).toBe('red')
    expect(state.teams[asPlayerId('c')]).toBe('blue')
  })

  it('leaves a player with no team out of the roster entirely', () => {
    const state = create(PLAYERS, 1)
    expect(state.teams[asPlayerId('d')]).toBeUndefined()
  })

  it('builds one tile per category per declared value, none spent', () => {
    const state = create(PLAYERS, 1)
    expect(state.tiles).toHaveLength(4)
    expect(state.tiles.every(t => !t.spent)).toBe(true)
    expect(state.tiles.map(t => `${t.categoryId}:${t.value}`).sort())
      .toEqual(['cat-a:100', 'cat-a:200', 'cat-b:100', 'cat-b:200'])
  })

  it('materialises every clue with a shuffled order and its correct index', () => {
    const state = create(PLAYERS, 1)
    for (const [key, clue] of Object.entries(state.clues)) {
      expect(clue.order).toHaveLength(4)
      expect(clue.order[clue.correct]).toContain('right-')
      expect(key).toMatch(/^cat-[ab]:\d+$/)
    }
  })

  it('carries the image fields onto an image clue and not onto a text one', () => {
    const state = create(PLAYERS, 1)
    expect(state.clues['cat-b:100']).toMatchObject({ kind: 'image', file: 'b100.png', mosaic: 10 })
    expect(state.clues['cat-a:100']!.kind).toBe('text')
    expect(state.clues['cat-a:100']!.file).toBeUndefined()
  })

  it('starts both scores at zero', () => {
    const state = create(PLAYERS, 1)
    expect(state.scores).toEqual({ blue: 0, red: 0 })
  })

  it('gives each team two lifelines', () => {
    const state = create(PLAYERS, 1)
    expect(state.lifelines).toEqual({ blue: 2, red: 2 })
  })

  it('picks starting control from the seed, deterministically', () => {
    expect(create(PLAYERS, 7).control).toBe(create(PLAYERS, 7).control)
    const seen = new Set(
      Array.from({ length: 40 }, (_, seed) => create(PLAYERS, seed).control))
    expect(seen).toEqual(new Set(['blue', 'red']))
  })

  it('shuffles differently for different seeds', () => {
    const orders = new Set([1, 2, 3, 4, 5, 6].map(seed =>
      create(PLAYERS, seed).clues['cat-a:100']!.order.join('|')))
    expect(orders.size).toBeGreaterThan(1)
  })

  it('starts with no active clue and an empty board phase', () => {
    const state = create(PLAYERS, 1)
    expect(state.active).toBeNull()
    expect(state.phase).toBe('lobby')
  })
})

describe('setPhase', () => {
  const base = () => create(PLAYERS, 1)

  it('records the phase it entered', () => {
    expect(setPhase(base(), 'board').phase).toBe('board')
  })

  it('arriving at board from reveal clears the active clue', () => {
    let state: FrightState = { ...base(), phase: 'reveal', active: 'cat-a:100' }
    state = setPhase(state, 'board')
    expect(state.active).toBeNull()
  })

  it('arriving at board from reveal gives control to whoever answered right', () => {
    const start = base()
    const state = setPhase({
      ...start, phase: 'reveal', control: 'blue', active: 'cat-a:100',
      clues: { ...start.clues, 'cat-a:100': { ...start.clues['cat-a:100']!, wonBy: 'red' } },
    }, 'board')
    expect(state.control).toBe('red')
  })

  it('arriving at board from reveal with nobody right alternates control', () => {
    const start = base()
    const state = setPhase({ ...start, phase: 'reveal', control: 'blue', active: 'cat-a:100' }, 'board')
    expect(state.control).toBe('red')
  })

  it('arriving at board from lobby leaves control alone', () => {
    const start = { ...base(), control: 'red' }
    expect(setPhase(start, 'board').control).toBe('red')
  })

  it('entering reading with no active clue auto-picks the cheapest remaining tile', () => {
    const state = setPhase({ ...base(), phase: 'board' }, 'reading')
    expect(state.active).toBe('cat-a:100')
    expect(state.tiles.find(t => t.categoryId === 'cat-a' && t.value === 100)!.spent).toBe(true)
  })

  // The obvious implementation indexes a column that may be empty.
  it('auto-pick skips a column whose tiles are all spent', () => {
    const start = base()
    const state = setPhase({
      ...start,
      phase: 'board',
      tiles: start.tiles.map(t => t.categoryId === 'cat-a' ? { ...t, spent: true } : t),
    }, 'reading')
    expect(state.active).toBe('cat-b:100')
  })

  it('auto-pick with every tile spent leaves no active clue', () => {
    const start = base()
    const state = setPhase({
      ...start, phase: 'board', tiles: start.tiles.map(t => ({ ...t, spent: true })),
    }, 'reading')
    expect(state.active).toBeNull()
  })

  it('entering reading leaves an already-picked clue alone', () => {
    const start = base()
    const state = setPhase({ ...start, phase: 'board', active: 'cat-b:200' }, 'reading')
    expect(state.active).toBe('cat-b:200')
  })
})
