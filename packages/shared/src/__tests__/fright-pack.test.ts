import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  choiceCountFor, fiftyFifty, shuffleChoices, validatePack, type Pack,
} from '../fright-pack.js'

const VALUES = [200, 400, 600, 800, 1000]

const four = (lead: string) => [lead, 'w1', 'w2', 'w3']
const six = (lead: string) => [lead, 'w1', 'w2', 'w3', 'w4', 'w5']

function clue(value: number, extra: Record<string, unknown> = {}) {
  return {
    value,
    kind: 'text' as const,
    prompt: `prompt ${value}`,
    choices: choiceCountFor(value, VALUES) === 6 ? six(`right${value}`) : four(`right${value}`),
    source: 'https://example.test/source',
    verifiedAt: '2026-10-25',
    ...extra,
  }
}

function pack(overrides: Partial<Pack> = {}): Pack {
  return {
    id: 'test-pack',
    name: 'Test Pack',
    values: VALUES,
    categories: [
      { id: 'cat-a', name: 'Cat A', clues: VALUES.map(v => clue(v)) },
      { id: 'cat-b', name: 'Cat B', clues: VALUES.map(v => clue(v)) },
    ],
    ...overrides,
  } as Pack
}

/** The pack's own files are never read by the validator in these tests. */
const alwaysPresent = () => true

describe('validatePack', () => {
  it('a well-formed pack validates clean', () => {
    expect(validatePack(pack(), alwaysPresent)).toEqual([])
  })

  it('a category missing a value is reported by category id and value', () => {
    const p = pack()
    p.categories[0]!.clues = p.categories[0]!.clues.filter(c => c.value !== 600)
    const problems = validatePack(p, alwaysPresent)
    expect(problems.some(m => m.includes('cat-a') && m.includes('600'))).toBe(true)
  })

  it('a duplicated value in one category is reported', () => {
    const p = pack()
    p.categories[0]!.clues = [...p.categories[0]!.clues, clue(200)]
    expect(validatePack(p, alwaysPresent).some(m => m.includes('200'))).toBe(true)
  })

  // The author must be able to read a failing run without learning the answers.
  it('a validator message never contains a prompt or a choice', () => {
    const p = pack()
    p.categories[0]!.clues[0]!.choices = ['SECRETANSWER', 'SECRETANSWER', 'w2', 'w3']
    p.categories[1]!.clues = []
    const joined = validatePack(p, () => false).join(' | ')
    expect(joined).not.toContain('SECRETANSWER')
    expect(joined).not.toContain('prompt 200')
    expect(joined.length).toBeGreaterThan(0)
  })

  it('choices of the wrong length for the row are rejected', () => {
    const p = pack()
    p.categories[0]!.clues[0]!.choices = ['a', 'b', 'c']          // 200 needs 4
    expect(validatePack(p, alwaysPresent).some(m => m.includes('cat-a'))).toBe(true)
  })

  it('a bottom row with six choices is rejected', () => {
    const p = pack()
    p.categories[0]!.clues[0]!.choices = six('right200')          // 200 needs 4
    expect(validatePack(p, alwaysPresent).length).toBeGreaterThan(0)
  })

  it('duplicate choices within a clue are rejected', () => {
    const p = pack()
    p.categories[0]!.clues[0]!.choices = ['Dracula', 'dracula', 'w2', 'w3']
    expect(validatePack(p, alwaysPresent).some(m => m.includes('cat-a'))).toBe(true)
  })

  it('a clue with no source or no verifiedAt is rejected', () => {
    const p = pack()
    p.categories[0]!.clues[0]!.source = ''
    expect(validatePack(p, alwaysPresent).length).toBeGreaterThan(0)
  })

  it('an image clue with a missing file is rejected', () => {
    const p = pack()
    p.categories[0]!.clues[0] = clue(200, {
      kind: 'image', file: 'nope.jpg', mosaic: 10,
    }) as (typeof p.categories)[0]['clues'][0]
    expect(validatePack(p, () => false).some(m => m.includes('cat-a'))).toBe(true)
  })

  it('an image clue with a mosaic out of range is rejected', () => {
    const p = pack()
    p.categories[0]!.clues[0] = clue(200, {
      kind: 'image', file: 'a.jpg', mosaic: 2,
    }) as (typeof p.categories)[0]['clues'][0]
    expect(validatePack(p, alwaysPresent).length).toBeGreaterThan(0)
  })
})

describe('choiceCountFor', () => {
  it('gives 4 on the bottom three rows and 6 on the top two', () => {
    expect(VALUES.map(v => choiceCountFor(v, VALUES))).toEqual([4, 4, 4, 6, 6])
  })

  it('works for a shorter board, still six on the top two rows', () => {
    const short = [100, 200, 300, 400]
    expect(short.map(v => choiceCountFor(v, short))).toEqual([4, 4, 6, 6])
  })
})

describe('shuffleChoices', () => {
  const choices = ['right', 'a', 'b', 'c']

  it('is stable for the same seed and clue key', () => {
    const a = shuffleChoices(choices, 1234, 'cat-a:200')
    const b = shuffleChoices(choices, 1234, 'cat-a:200')
    expect(a).toEqual(b)
  })

  it('differs between two seeds', () => {
    const orders = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map(seed =>
        shuffleChoices(choices, seed, 'cat-a:200').order.join('|')))
    expect(orders.size).toBeGreaterThan(1)
  })

  it('differs between two clues under the same seed', () => {
    const orders = new Set(
      ['cat-a:200', 'cat-a:400', 'cat-b:200', 'cat-b:400', 'cat-b:600'].map(key =>
        shuffleChoices(choices, 99, key).order.join('|')))
    expect(orders.size).toBeGreaterThan(1)
  })

  it('always reports the index that holds choices[0]', () => {
    for (let seed = 0; seed < 200; seed++) {
      const { order, correct } = shuffleChoices(choices, seed, 'k')
      expect(order[correct]).toBe('right')
    }
  })

  it('keeps every choice exactly once', () => {
    const { order } = shuffleChoices(choices, 7, 'k')
    expect([...order].sort()).toEqual([...choices].sort())
  })

  it('does not always put the answer in the same slot', () => {
    const slots = new Set(
      Array.from({ length: 60 }, (_, s) => shuffleChoices(choices, s, 'k').correct))
    expect(slots.size).toBeGreaterThan(1)
  })
})

describe('fiftyFifty', () => {
  it('removes 2 of 4 and never the correct index', () => {
    for (let seed = 0; seed < 100; seed++) {
      const { order, correct } = shuffleChoices(['right', 'a', 'b', 'c'], seed, 'k')
      const cut = fiftyFifty(order, correct, seed, 'k', 'blue')
      expect(cut).toHaveLength(2)
      expect(cut).not.toContain(correct)
      expect(new Set(cut).size).toBe(2)
    }
  })

  it('removes 3 of 6 and never the correct index', () => {
    const six = ['right', 'a', 'b', 'c', 'd', 'e']
    for (let seed = 0; seed < 100; seed++) {
      const { order, correct } = shuffleChoices(six, seed, 'k')
      const cut = fiftyFifty(order, correct, seed, 'k', 'red')
      expect(cut).toHaveLength(3)
      expect(cut).not.toContain(correct)
    }
  })

  it('is stable for the same team', () => {
    const { order, correct } = shuffleChoices(['right', 'a', 'b', 'c'], 5, 'k')
    expect(fiftyFifty(order, correct, 5, 'k', 'blue'))
      .toEqual(fiftyFifty(order, correct, 5, 'k', 'blue'))
  })

  it('differs between the two teams, so a spent lifeline is not shared', () => {
    const six = ['right', 'a', 'b', 'c', 'd', 'e']
    const differing = Array.from({ length: 40 }, (_, seed) => {
      const { order, correct } = shuffleChoices(six, seed, 'k')
      const blue = fiftyFifty(order, correct, seed, 'k', 'blue').join('|')
      const red = fiftyFifty(order, correct, seed, 'k', 'red').join('|')
      return blue !== red
    })
    expect(differing.some(Boolean)).toBe(true)
  })
})

/**
 * A clue's `file` is the URL the browser requests, so "exists" means "is in
 * the web client's static assets". Checking the pack directory would pass
 * while every image 404s in the game.
 */
const PUBLIC = join(process.cwd(), 'packages', 'web', 'public')
const servedImageExists = (file: string) =>
  file.startsWith('/') && existsSync(join(PUBLIC, file.slice(1)))

describe('the dev pack on disk', () => {
  // Every test, e2e run and load test plays this pack, so a broken one is a
  // broken suite rather than a broken game night.
  const dir = join(process.cwd(), 'content', 'packs', 'dev')
  const onDisk = JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8')) as Pack

  it('validates against the images the client will actually fetch', () => {
    expect(validatePack(onDisk, servedImageExists)).toEqual([])
  })

  it('has one image category and one text category', () => {
    const kinds = onDisk.categories.map(c => new Set(c.clues.map(k => k.kind)))
    expect(kinds.some(k => k.has('image'))).toBe(true)
    expect(kinds.some(k => k.has('text'))).toBe(true)
  })

  it('exercises both choice counts, so the grid layouts are covered', () => {
    const counts = new Set(onDisk.categories.flatMap(c => c.clues.map(k => k.choices.length)))
    expect(counts).toEqual(new Set([4, 6]))
  })
})

describe('the Halloween pack on disk', () => {
  // Structure only. No assertion here prints a prompt or a choice: the person
  // who owns this repo is going to play this board.
  const file = join(process.cwd(), 'content', 'packs', 'halloween', 'pack.json')
  const onDisk = JSON.parse(readFileSync(file, 'utf8')) as Pack

  it('validates against the images the client will actually fetch', () => {
    expect(validatePack(onDisk, servedImageExists)).toEqual([])
  })

  it('is a full six-by-five board', () => {
    expect(onDisk.values).toEqual([200, 400, 600, 800, 1000])
    expect(onDisk.categories).toHaveLength(6)
    for (const category of onDisk.categories) {
      expect(category.clues).toHaveLength(5)
    }
  })

  it('has two image categories and four of trivia', () => {
    const kinds = onDisk.categories.map(c => c.clues[0]!.kind)
    expect(kinds.filter(k => k === 'image')).toHaveLength(2)
    expect(kinds.filter(k => k === 'text')).toHaveLength(4)
  })

  it('records a source and a verification date on every single clue', () => {
    for (const category of onDisk.categories) {
      for (const clue of category.clues) {
        expect(clue.source, `${category.id}:${clue.value}`).toMatch(/^https?:\/\//)
        expect(clue.verifiedAt, `${category.id}:${clue.value}`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      }
    }
  })

  it('never names an answer in an image filename', () => {
    for (const category of onDisk.categories) {
      for (const clue of category.clues) {
        if (clue.kind !== 'image') continue
        // Content-hashed: sixteen hex characters and an extension, nothing else.
        expect(clue.file, `${category.id}:${clue.value}`)
          .toMatch(/\/[0-9a-f]{16}\.(jpg|jpeg|png)$/)
      }
    }
  })
})
