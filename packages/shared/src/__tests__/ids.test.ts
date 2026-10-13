import { describe, expect, it } from 'vitest'
import { newId, asPlayerId, asRoomId } from '../ids.js'

describe('newId', () => {
  it('returns a 21-character url-safe id', () => {
    const id = newId()
    expect(id).toHaveLength(21)
    expect(id).toMatch(/^[A-Za-z0-9_-]{21}$/)
  })

  it('does not collide across 10k draws', () => {
    const seen = new Set(Array.from({ length: 10_000 }, () => newId()))
    expect(seen.size).toBe(10_000)
  })
})

describe('branded ids', () => {
  it('round-trips the underlying string', () => {
    expect(asPlayerId('abc')).toBe('abc')
    expect(asRoomId('xyz')).toBe('xyz')
  })
})
