/**
 * The clue pack: a whole board, described as data.
 *
 * Two kinds of clue share one shape, because they share one answer mechanism.
 * Every clue is answered by picking one of `choices` — there is no free text
 * anywhere in this game, so there is no answer matcher to get wrong. What the
 * matcher used to risk, the pack's distractors now carry: a wrong-but-arguable
 * option is the only way a clue can still cheat a team.
 *
 * `choices[0]` is the correct answer AS WRITTEN IN THE FILE. A room shuffles
 * each clue from its own seed, so the pack never dictates a screen position
 * and two rooms on the same pack do not share an answer layout.
 */

type BaseClue = {
  /** Which board row, and what the tile is worth. */
  value: number
  prompt: string
  /** choices[0] is correct in the file; the room shuffles. */
  choices: string[]
  /** Where the fact or the photograph came from. Never optional (spec 7.4). */
  source: string
  /** ISO date the clue was checked. */
  verifiedAt: string
}

export type ImageClue = BaseClue & {
  kind: 'image'
  /** File name within the pack's directory. Content-hashed: never the answer. */
  file: string
  /** Mosaic blocks across. Fixed per clue, set when the image was verified. */
  mosaic: number
}

export type TextClue = BaseClue & { kind: 'text' }

export type Clue = ImageClue | TextClue

export type Category = { id: string; name: string; clues: Clue[] }

export type Pack = {
  id: string
  name: string
  /** The board's rows, cheapest first. Defines both tile values and height. */
  values: number[]
  categories: Category[]
}

/** Mosaic sizes we consider sane; outside this a clue is a typo, not a choice. */
export const MIN_MOSAIC = 4
export const MAX_MOSAIC = 48

/**
 * How many options a row offers: six on the top two rows, four below.
 *
 * Difficulty rises with the number of options as well as the obscurity of the
 * fact, and a blind guess is never worthless — one in six on a 1000 keeps
 * buzzing a live decision rather than a solved one.
 */
export function choiceCountFor(value: number, values: readonly number[]): 4 | 6 {
  const ordered = [...values].sort((a, b) => a - b)
  const index = ordered.indexOf(value)
  if (index < 0) return 4
  return index >= ordered.length - 2 ? 6 : 4
}

/** Case- and space-insensitive, so "Dracula" and "dracula" are one option. */
function normalizeChoice(choice: string): string {
  return choice.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Deterministic 32-bit hash of a string, mixed with a numeric seed. Not a
 * security primitive — it only has to spread clue keys apart.
 */
function hash(seed: number, key: string): number {
  let h = (seed ^ 0x9e3779b9) >>> 0
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 0x01000193) >>> 0
  }
  return h >>> 0
}

/** mulberry32: tiny, seeded, and good enough to shuffle four things. */
function prng(state: number): () => number {
  let a = state >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Shuffle a clue's options and report where the correct one landed.
 *
 * Pure and seeded, so the same room always sees the same board and a server
 * restart restores it exactly. The correct index is stored in game state and
 * redacted from every pre-reveal view.
 */
export function shuffleChoices(
  choices: readonly string[], seed: number, clueKey: string,
): { order: string[]; correct: number } {
  const order = [...choices]
  const rand = prng(hash(seed, clueKey))
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[order[i], order[j]] = [order[j]!, order[i]!]
  }
  return { order, correct: order.indexOf(choices[0]!) }
}

/**
 * The Flashlight lifeline: which option indexes to strike out.
 *
 * Removes half the wrong answers and never the right one. Keyed by team as
 * well as by clue, so when both teams spend one on the same clue they cut
 * different options — a lifeline is private to the team that paid for it.
 */
export function fiftyFifty(
  order: readonly string[], correct: number, seed: number, clueKey: string, team: string,
): number[] {
  const wrong = order.map((_, i) => i).filter(i => i !== correct)
  const rand = prng(hash(seed, `${clueKey}|${team}|5050`))
  for (let i = wrong.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[wrong[i], wrong[j]] = [wrong[j]!, wrong[i]!]
  }
  // 4 options -> keep 2 -> cut 2. 6 -> keep 3 -> cut 3.
  const keep = Math.ceil(order.length / 2) - 1
  return wrong.slice(0, wrong.length - keep).sort((a, b) => a - b)
}

/**
 * Structural problems with a pack, as human-readable lines. Empty means valid.
 *
 * **Messages name a clue by category id and value, never by its text.** The
 * person who owns this repo is going to play the game, and a failing CI run
 * they can read without learning an answer is the whole point.
 *
 * `fileExists` is injected so this stays pure and runs in the browser bundle;
 * the server passes a real filesystem check.
 */
export function validatePack(
  pack: Pack, fileExists: (file: string) => boolean = () => true,
): string[] {
  const problems: string[] = []
  const at = (categoryId: string, value: number) => `${categoryId}:${value}`

  if (!Array.isArray(pack.values) || pack.values.length === 0) {
    return ['pack declares no values']
  }
  if (pack.categories.length === 0) problems.push('pack declares no categories')

  for (const category of pack.categories) {
    const seen = new Map<number, number>()
    for (const clue of category.clues) {
      seen.set(clue.value, (seen.get(clue.value) ?? 0) + 1)
    }
    for (const value of pack.values) {
      const count = seen.get(value) ?? 0
      if (count === 0) problems.push(`${at(category.id, value)}: missing`)
      if (count > 1) problems.push(`${at(category.id, value)}: ${count} clues, expected 1`)
    }
    for (const value of seen.keys()) {
      if (!pack.values.includes(value)) {
        problems.push(`${at(category.id, value)}: not a row on this board`)
      }
    }

    for (const clue of category.clues) {
      const where = at(category.id, clue.value)
      const want = choiceCountFor(clue.value, pack.values)
      if (clue.choices.length !== want) {
        problems.push(`${where}: ${clue.choices.length} choices, expected ${want}`)
      }
      if (clue.choices.some(c => c.trim() === '')) {
        problems.push(`${where}: has an empty choice`)
      }
      const distinct = new Set(clue.choices.map(normalizeChoice))
      if (distinct.size !== clue.choices.length) {
        problems.push(`${where}: choices are not distinct`)
      }
      if (!clue.prompt || clue.prompt.trim() === '') problems.push(`${where}: no prompt`)
      if (!clue.source || clue.source.trim() === '') problems.push(`${where}: no source`)
      if (!clue.verifiedAt || clue.verifiedAt.trim() === '') {
        problems.push(`${where}: no verifiedAt`)
      }
      if (clue.kind === 'image') {
        if (!clue.file || !fileExists(clue.file)) problems.push(`${where}: image file missing`)
        if (!Number.isInteger(clue.mosaic)
          || clue.mosaic < MIN_MOSAIC || clue.mosaic > MAX_MOSAIC) {
          problems.push(
            `${where}: mosaic out of range (${MIN_MOSAIC}-${MAX_MOSAIC})`)
        }
      }
    }
  }
  return problems
}
