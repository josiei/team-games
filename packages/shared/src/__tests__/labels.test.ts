import { describe, expect, it } from 'vitest'
import { labelPlayers } from '../game.js'
import { asPlayerId } from '../ids.js'

const p = (id: string, displayName: string, joinedAt: number) =>
  ({ id: asPlayerId(id), displayName, connected: true, joinedAt, avatar: '', team: null })

describe('labelPlayers', () => {
  it('leaves unique names alone', () => {
    const labels = labelPlayers([p('a', 'Jocelyn', 1), p('b', 'Sam', 2)])
    expect(labels[asPlayerId('a')]).toBe('Jocelyn')
    expect(labels[asPlayerId('b')]).toBe('Sam')
  })

  it('disambiguates duplicates by join order', () => {
    const labels = labelPlayers([p('a', 'Jocelyn', 1), p('b', 'Jocelyn', 2)])
    expect(labels[asPlayerId('a')]).toBe('Jocelyn')
    expect(labels[asPlayerId('b')]).toBe('Jocelyn (2)')
  })

  it('is case- and whitespace-insensitive when detecting duplicates', () => {
    const labels = labelPlayers([p('a', 'Jocelyn', 1), p('b', '  jocelyn ', 2)])
    expect(labels[asPlayerId('b')]).toBe('  jocelyn  (2)')
  })

  it('numbers a third duplicate correctly', () => {
    const labels = labelPlayers([
      p('a', 'Sam', 1), p('b', 'Sam', 2), p('c', 'Sam', 3),
    ])
    expect(Object.values(labels)).toEqual(['Sam', 'Sam (2)', 'Sam (3)'])
  })

  it('is stable regardless of input array order', () => {
    const a = labelPlayers([p('a', 'Sam', 1), p('b', 'Sam', 2)])
    const b = labelPlayers([p('b', 'Sam', 2), p('a', 'Sam', 1)])
    expect(a).toEqual(b)
  })

  it('never issues colliding labels when a raw name equals a suffixed form', () => {
    const players = [p('a', 'Sam', 1), p('b', 'Sam', 2), p('c', 'Sam (2)', 3)]
    const labels = labelPlayers(players)
    expect(labels[asPlayerId('a')]).toBe('Sam')
    expect(labels[asPlayerId('b')]).toBe('Sam (2)')
    expect(labels[asPlayerId('c')]).toBe('Sam (2) (2)')
    expect(new Set(Object.values(labels)).size).toBe(3)
  })

  it('breaks identical joinedAt ties deterministically by id', () => {
    const forward = labelPlayers([p('a', 'Sam', 1), p('b', 'Sam', 1)])
    const reversed = labelPlayers([p('b', 'Sam', 1), p('a', 'Sam', 1)])
    expect(forward[asPlayerId('a')]).toBe('Sam')
    expect(forward[asPlayerId('b')]).toBe('Sam (2)')
    expect(reversed).toEqual(forward)
  })

  it('returns an empty record for no players', () => {
    expect(labelPlayers([])).toEqual({})
  })

  it('returns the unsuffixed name for a single player', () => {
    expect(labelPlayers([p('a', 'Sam', 1)])).toEqual({ [asPlayerId('a')]: 'Sam' })
  })
})
