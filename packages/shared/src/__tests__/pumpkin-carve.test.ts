import { describe, expect, it } from 'vitest'
import { createState, reduce, setPhase, seededShuffle, slotOf } from '../pumpkin.js'
import { asPlayerId } from '../ids.js'
import type { Stroke } from '../carve.js'

const player = (id: string, joinedAt: number) =>
  ({ id: asPlayerId(id), displayName: id, connected: true, joinedAt })

const three = [player('a', 1), player('b', 2), player('c', 3)]
const base = () => setPhase(createState(three, 42), 'carving')
const strokes: Stroke[] = [{ tool: 'cut', size: 0.1, points: [[0.5, 0.5]] }]

describe('createState', () => {
  it('gives every player an empty unsubmitted pumpkin', () => {
    const s = createState(three, 42)
    for (const p of three) {
      expect(s.pumpkins[p.id]).toEqual(
        expect.objectContaining({ strokes: [], submitted: false }))
    }
  })

  it('assigns each player a distinct jittered collapse threshold', () => {
    const s = createState(three, 42)
    const thresholds = three.map(p => s.pumpkins[p.id]!.collapseAt)
    expect(new Set(thresholds).size).toBe(3)
  })

  it('shuffles gallery slots deterministically from the seed', () => {
    expect(createState(three, 42).slots).toEqual(createState(three, 42).slots)
    expect(createState(three, 42).slots).not.toEqual(createState(three, 7).slots)
  })

  it('includes every player exactly once in the slot order', () => {
    const s = createState(three, 42)
    expect([...s.slots].sort()).toEqual(three.map(p => p.id).sort())
  })
})

describe('reduce SUBMIT', () => {
  it('stores the submitting players strokes and marks them submitted', () => {
    const s = reduce(base(), { type: 'SUBMIT', strokes }, asPlayerId('a'))
    expect(s.pumpkins[asPlayerId('a')]!.submitted).toBe(true)
    expect(s.pumpkins[asPlayerId('a')]!.strokes).toEqual(strokes)
  })

  it('does not touch another players pumpkin', () => {
    const s = reduce(base(), { type: 'SUBMIT', strokes }, asPlayerId('a'))
    expect(s.pumpkins[asPlayerId('b')]!.submitted).toBe(false)
  })

  it('ignores a second submission so a player cannot revise after the fact', () => {
    const once = reduce(base(), { type: 'SUBMIT', strokes }, asPlayerId('a'))
    const twice = reduce(once, { type: 'SUBMIT', strokes: [] }, asPlayerId('a'))
    expect(twice.pumpkins[asPlayerId('a')]!.strokes).toEqual(strokes)
  })

  it('ignores submissions outside the carving phase', () => {
    const voting = setPhase(createState(three, 42), 'vote-scariest')
    const s = reduce(voting, { type: 'SUBMIT', strokes }, asPlayerId('a'))
    expect(s.pumpkins[asPlayerId('a')]!.submitted).toBe(false)
  })

  it('ignores an unknown player id', () => {
    const s = reduce(base(), { type: 'SUBMIT', strokes }, asPlayerId('nobody'))
    expect(s).toEqual(base())
  })

  it('does not mutate the input state', () => {
    const before = base()
    reduce(before, { type: 'SUBMIT', strokes }, asPlayerId('a'))
    expect(before.pumpkins[asPlayerId('a')]!.submitted).toBe(false)
  })
})

describe('reduce DRAFT', () => {
  it('stores strokes without marking the pumpkin submitted', () => {
    const s = reduce(base(), { type: 'DRAFT', strokes }, asPlayerId('a'))
    expect(s.pumpkins[asPlayerId('a')]!.strokes).toEqual(strokes)
    expect(s.pumpkins[asPlayerId('a')]!.submitted).toBe(false)
  })

  it('is ignored once the player has submitted', () => {
    const submitted = reduce(base(), { type: 'SUBMIT', strokes }, asPlayerId('a'))
    const s = reduce(submitted, { type: 'DRAFT', strokes: [] }, asPlayerId('a'))
    expect(s.pumpkins[asPlayerId('a')]!.strokes).toEqual(strokes)
  })
})

describe('seededShuffle', () => {
  it('is a permutation', () => {
    const out = seededShuffle([1, 2, 3, 4, 5], 99)
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5])
  })
  it('is deterministic', () => {
    expect(seededShuffle([1, 2, 3, 4, 5], 99)).toEqual(seededShuffle([1, 2, 3, 4, 5], 99))
  })
})

describe('slotOf', () => {
  it('returns the players index in the shuffled order', () => {
    const s = createState(three, 42)
    expect(s.slots[slotOf(s, asPlayerId('a'))]).toBe(asPlayerId('a'))
  })
  it('returns -1 for a player who is not in the game', () => {
    expect(slotOf(createState(three, 42), asPlayerId('nobody'))).toBe(-1)
  })
})
