import { describe, expect, it } from 'vitest'
import { CODE_ALPHABET, generateCode, normalizeCode } from '../code.js'
import { asRoomCode } from '../ids.js'

describe('CODE_ALPHABET', () => {
  it('excludes characters that are misread off a shared screen', () => {
    for (const c of ['O', '0', 'I', '1', 'S', '5']) {
      expect(CODE_ALPHABET).not.toContain(c)
    }
  })
})

describe('generateCode', () => {
  it('produces a 6-character code from the alphabet', () => {
    const code = generateCode(() => false)
    expect(code).toHaveLength(6)
    for (const c of code) expect(CODE_ALPHABET).toContain(c)
  })

  it('retries until it finds a code that is not taken', () => {
    let calls = 0
    const code = generateCode(() => { calls += 1; return calls < 3 })
    expect(calls).toBe(3)
    expect(code).toHaveLength(6)
  })

  it('throws rather than looping forever when the space is exhausted', () => {
    expect(() => generateCode(() => true)).toThrow(/exhausted/i)
  })
})

describe('normalizeCode', () => {
  it('uppercases and strips separators so typed input matches', () => {
    expect(normalizeCode(' ab2-cd3 ')).toBe(asRoomCode('AB2CD3'))
  })
})
