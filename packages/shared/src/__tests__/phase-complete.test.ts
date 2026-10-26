import { describe, expect, it } from 'vitest'
import { createState, phaseComplete, reduce, setPhase, slotOf } from '../pumpkin.js'
import { asPlayerId } from '../ids.js'
import type { Player } from '../game.js'
import type { Stroke } from '../carve.js'

const [A, B, C] = ['pa', 'pb', 'pc'].map(asPlayerId) as [
  ReturnType<typeof asPlayerId>, ReturnType<typeof asPlayerId>, ReturnType<typeof asPlayerId>,
]
const player = (id: ReturnType<typeof asPlayerId>, i: number): Player =>
  ({ id, displayName: `p${i}`, connected: true, joinedAt: i + 1 , avatar: '', team: null})
const players = [player(A, 0), player(B, 1), player(C, 2)]
const strokes: Stroke[] = [{ tool: 'cut', size: 0.1, points: [[0.5, 0.5]] }]

const carving = () => setPhase(createState(players, 7), 'carving')

describe('phaseComplete during carving', () => {
  it('is false until every player taking part has submitted', () => {
    let s = carving()
    expect(phaseComplete(s, 'carving', players)).toBe(false)
    s = reduce(s, { type: 'SUBMIT', strokes }, A)
    s = reduce(s, { type: 'SUBMIT', strokes }, B)
    expect(phaseComplete(s, 'carving', players)).toBe(false)
    s = reduce(s, { type: 'SUBMIT', strokes }, C)
    expect(phaseComplete(s, 'carving', players)).toBe(true)
  })

  it('does not wait on someone who has gone', () => {
    let s = carving()
    s = reduce(s, { type: 'SUBMIT', strokes }, A)
    s = reduce(s, { type: 'SUBMIT', strokes }, B)
    expect(phaseComplete(s, 'carving', [players[0]!, players[1]!])).toBe(true)
  })

  it('is false for an empty room, so one blip cannot discard every carving', () => {
    expect(phaseComplete(carving(), 'carving', [])).toBe(false)
  })

  it('ignores a spectator who has no pumpkin of their own', () => {
    let s = carving()
    for (const p of players) s = reduce(s, { type: 'SUBMIT', strokes }, p.id)
    const latecomer = player(asPlayerId('pz'), 9)
    expect(phaseComplete(s, 'carving', [...players, latecomer])).toBe(true)
  })
})

describe('phaseComplete during voting', () => {
  const voting = () => {
    let s = carving()
    for (const p of players) s = reduce(s, { type: 'SUBMIT', strokes }, p.id)
    return setPhase(s, 'vote-scariest')
  }

  it('is false until everyone has voted on the award in play', () => {
    let s = voting()
    expect(phaseComplete(s, 'vote-scariest', players)).toBe(false)
    s = reduce(s, { type: 'VOTE', award: 'scariest', slot: slotOf(s, B) }, A)
    s = reduce(s, { type: 'VOTE', award: 'scariest', slot: slotOf(s, C) }, B)
    expect(phaseComplete(s, 'vote-scariest', players)).toBe(false)
    s = reduce(s, { type: 'VOTE', award: 'scariest', slot: slotOf(s, A) }, C)
    expect(phaseComplete(s, 'vote-scariest', players)).toBe(true)
  })

  it('counts only the award in play, not the ones already decided', () => {
    let s = voting()
    for (const [voter, target] of [[A, B], [B, C], [C, A]] as const) {
      s = reduce(s, { type: 'VOTE', award: 'scariest', slot: slotOf(s, target) }, voter)
    }
    expect(phaseComplete(s, 'vote-scariest', players)).toBe(true)
    // The next award starts over at nobody.
    s = setPhase(s, 'vote-funniest')
    expect(phaseComplete(s, 'vote-funniest', players)).toBe(false)
  })

  it('never ends the lobby or the results screen early', () => {
    const s = voting()
    expect(phaseComplete(setPhase(s, 'lobby'), 'lobby', players)).toBe(false)
    expect(phaseComplete(setPhase(s, 'results'), 'results', players)).toBe(false)
    expect(phaseComplete(s, 'vote-nonsense', players)).toBe(false)
  })
})
