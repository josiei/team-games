import { describe, expect, it } from 'vitest'
import { createState, reduce, setPhase, seededShuffle, slotOf } from '../pumpkin.js'
import { asPlayerId } from '../ids.js'
import type { Stroke } from '../carve.js'
import { collapseThresholdFor } from '../carve.js'

const player = (id: string, joinedAt: number) =>
  ({ id: asPlayerId(id), displayName: id, connected: true, joinedAt, avatar: '', team: null })

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

describe('determinism golden vectors', () => {
  // Pinned values. Changing mulberry32's constants or the Fisher-Yates loop
  // changes these and fails here. A restart replaying the stored seed must
  // reproduce exactly these orders.
  it('seededShuffle matches the pinned permutation', () => {
    expect(seededShuffle([1, 2, 3, 4, 5, 6, 7, 8], 2026)).toEqual([7, 2, 5, 1, 6, 8, 3, 4])
    expect(seededShuffle(['a', 'b', 'c', 'd', 'e'], 42)).toEqual(['a', 'e', 'c', 'b', 'd'])
  })

  it('createState slot order matches the pinned gallery order', () => {
    const ps = ['p1', 'p2', 'p3', 'p4', 'p5'].map((id, i) =>
      ({ id: asPlayerId(id), displayName: id, connected: true, joinedAt: i , avatar: '', team: null}))
    expect(createState(ps, 1234).slots).toEqual(['p5', 'p2', 'p4', 'p3', 'p1'])
    expect(createState(ps, 1235).slots).toEqual(['p2', 'p4', 'p1', 'p5', 'p3'])
  })
})

describe('createState tie-break', () => {
  // 'B' (0x42) sorts before 'a' (0x61) in UTF-16 code-unit order, but
  // localeCompare puts 'a' first. Do not simplify these to 'a' and 'b':
  // the test only discriminates when the ids differ in case in this way.
  it('breaks joinedAt ties by code-unit order, not locale collation', () => {
    const tied = [player('a', 1), player('B', 1)]
    const s = createState(tied, 42)
    expect(s.pumpkins[asPlayerId('B')]!.collapseAt).toBe(collapseThresholdFor(42, 0))
    expect(s.pumpkins[asPlayerId('a')]!.collapseAt).toBe(collapseThresholdFor(42, 1))
    expect(s.slots).toEqual(seededShuffle([asPlayerId('B'), asPlayerId('a')], 42))
  })
})

describe('reduce DRAFT outside carving', () => {
  it('ignores drafts outside the carving phase', () => {
    const voting = setPhase(createState(three, 42), 'vote-scariest')
    const s = reduce(voting, { type: 'DRAFT', strokes }, asPlayerId('a'))
    expect(s.pumpkins[asPlayerId('a')]!.strokes).toEqual([])
    expect(s).toEqual(voting)
  })
})

describe('reduce unknown action', () => {
  it('returns the state unchanged for an unrecognised action type', () => {
    const s = base()
    const out = reduce(s, { type: 'NONSENSE' } as never, asPlayerId('a'))
    expect(out).toEqual(s)
  })
})
