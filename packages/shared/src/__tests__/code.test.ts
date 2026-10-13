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

describe('generateCode distribution', () => {
  it('draws every alphabet character with equal probability (no modulo bias)', () => {
    // 20,000 codes = 120,000 characters over 30 symbols: expected 4,000 each.
    // Chi-square with 29 df; 58.3 is the 99.9th percentile. A modulo-biased
    // draw (indices 0-15 at 9/256 vs 8/256) scores ~400 here and fails.
    const counts = new Map<string, number>()
    for (let i = 0; i < 20_000; i++) {
      for (const c of generateCode(() => false)) {
        counts.set(c, (counts.get(c) ?? 0) + 1)
      }
    }
    const total = 20_000 * 6
    const expected = total / CODE_ALPHABET.length
    let chi2 = 0
    for (const c of CODE_ALPHABET) {
      const observed = counts.get(c) ?? 0
      chi2 += (observed - expected) ** 2 / expected
    }
    expect(counts.size).toBe(CODE_ALPHABET.length)
    expect(chi2).toBeLessThan(58.3)
  })
})
