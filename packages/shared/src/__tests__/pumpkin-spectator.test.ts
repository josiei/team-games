import { describe, expect, it } from 'vitest'
import { createState, setPhase, viewFor } from '../pumpkin.js'
import { asPlayerId } from '../ids.js'

const players = [
  { id: asPlayerId('a'), displayName: 'A', connected: true, joinedAt: 1 , avatar: '', team: null},
  { id: asPlayerId('b'), displayName: 'B', connected: true, joinedAt: 2 , avatar: '', team: null},
]
const LATE = asPlayerId('late')

describe('viewFor a player who is not in the game', () => {
  it('returns a spectator view during carving', () => {
    const s = setPhase(createState(players, 42), 'carving')
    expect(viewFor(s, LATE)).toEqual({ kind: 'spectator', phase: 'carving' })
  })

  it('returns a spectator view during voting, so they cannot vote', () => {
    const s = setPhase(createState(players, 42), 'vote-scariest')
    expect(viewFor(s, LATE)).toEqual({ kind: 'spectator', phase: 'vote-scariest' })
  })

  it('still shows them the results, since nothing is secret then', () => {
    const s = setPhase(createState(players, 42), 'results')
    expect(viewFor(s, LATE).kind).toBe('results')
  })

  it('still shows them the lobby', () => {
    expect(viewFor(createState(players, 42), LATE).kind).toBe('lobby')
  })
})
