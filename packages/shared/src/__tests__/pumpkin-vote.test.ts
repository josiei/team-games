import { describe, expect, it } from 'vitest'
import { createState, reduce, setPhase, slotOf, tally } from '../pumpkin.js'
import { asPlayerId } from '../ids.js'

const player = (id: string, joinedAt: number) =>
  ({ id: asPlayerId(id), displayName: id, connected: true, joinedAt })

const A = asPlayerId('a'), B = asPlayerId('b'), C = asPlayerId('c')
const three = [player('a', 1), player('b', 2), player('c', 3)]
const voting = () => setPhase(createState(three, 42), 'vote-scariest')

describe('reduce VOTE', () => {
  it('records a vote for another players slot', () => {
    const s0 = voting()
    const target = slotOf(s0, B)
    const s = reduce(s0, { type: 'VOTE', award: 'scariest', slot: target }, A)
    expect(s.votes.scariest[A]).toBe(target)
  })

  it('rejects a vote for the voters own slot', () => {
    const s0 = voting()
    const s = reduce(s0, { type: 'VOTE', award: 'scariest', slot: slotOf(s0, A) }, A)
    expect(s.votes.scariest[A]).toBeUndefined()
  })

  it('lets a voter change their mind within the phase', () => {
    const s0 = voting()
    const s1 = reduce(s0, { type: 'VOTE', award: 'scariest', slot: slotOf(s0, B) }, A)
    const s2 = reduce(s1, { type: 'VOTE', award: 'scariest', slot: slotOf(s0, C) }, A)
    expect(s2.votes.scariest[A]).toBe(slotOf(s0, C))
    expect(Object.keys(s2.votes.scariest)).toHaveLength(1)
  })

  it('rejects a vote for an award whose phase is not current', () => {
    const s0 = voting()
    const s = reduce(s0, { type: 'VOTE', award: 'funniest', slot: slotOf(s0, B) }, A)
    expect(s.votes.funniest[A]).toBeUndefined()
  })

  it('rejects an out-of-range slot', () => {
    const s0 = voting()
    for (const slot of [-1, 3, 99]) {
      expect(reduce(s0, { type: 'VOTE', award: 'scariest', slot }, A).votes.scariest[A])
        .toBeUndefined()
    }
  })

  it('rejects a vote during the carving phase', () => {
    const s0 = setPhase(createState(three, 42), 'carving')
    const s = reduce(s0, { type: 'VOTE', award: 'scariest', slot: slotOf(s0, B) }, A)
    expect(s.votes.scariest[A]).toBeUndefined()
  })
})

describe('tally', () => {
  it('returns null for an award with no votes at all', () => {
    expect(tally(voting()).scariest).toBeNull()
  })

  it('returns null for every award when nobody voted', () => {
    const results = tally(voting())
    expect(Object.values(results).every(r => r === null)).toBe(true)
  })

  it('crowns the slot with the most votes', () => {
    const s0 = voting()
    const target = slotOf(s0, C)
    let s = reduce(s0, { type: 'VOTE', award: 'scariest', slot: target }, A)
    s = reduce(s, { type: 'VOTE', award: 'scariest', slot: target }, B)
    expect(tally(s).scariest).toEqual({ slot: target, votes: 2 })
  })

  it('breaks ties by lower slot index, deterministically', () => {
    const s0 = voting()
    let s = reduce(s0, { type: 'VOTE', award: 'scariest', slot: slotOf(s0, B) }, A)
    s = reduce(s, { type: 'VOTE', award: 'scariest', slot: slotOf(s0, A) }, B)
    const expected = Math.min(slotOf(s0, A), slotOf(s0, B))
    expect(tally(s).scariest).toEqual({ slot: expected, votes: 1 })
  })

  it('handles a single-player room where every vote would be a self-vote', () => {
    const solo = setPhase(createState([player('a', 1)], 42), 'vote-scariest')
    const s = reduce(solo, { type: 'VOTE', award: 'scariest', slot: 0 }, A)
    expect(s.votes.scariest[A]).toBeUndefined()
    expect(tally(s).scariest).toBeNull()
  })

  it('tallies each award independently', () => {
    const s0 = voting()
    let s = reduce(s0, { type: 'VOTE', award: 'scariest', slot: slotOf(s0, B) }, A)
    s = reduce(setPhase(s, 'vote-cursed'),
      { type: 'VOTE', award: 'cursed', slot: slotOf(s0, C) }, A)
    const results = tally(s)
    expect(results.scariest).toEqual({ slot: slotOf(s0, B), votes: 1 })
    expect(results.cursed).toEqual({ slot: slotOf(s0, C), votes: 1 })
    expect(results.funniest).toBeNull()
  })
})
