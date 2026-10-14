import { CANVAS_H, CANVAS_W } from '@tg/shared'

/**
 * Pumpkins differ from player to player, so a gallery of eight is not eight of
 * the same gourd.
 *
 * The assignment is derived from the ROOM CODE and the slot, never from the
 * room seed. Both are already known to every client, so no field has to travel
 * and every screen draws the same pumpkin for the same person. The seed is
 * deliberately left out of it: `collapseThresholdFor` derives the unlabeled
 * collapse point from that seed, and a visible, per-slot function of it would
 * be enough to brute-force the seed back out and read everyone's threshold.
 */
export type Variety = {
  readonly name: string
  /** How many lobes the silhouette is built from; the seams follow. */
  readonly lobes: number
  /** Aspect. `rx` scales by it and `ry` by its inverse, so area does not move. */
  readonly m: number
  /** How much shorter the outermost lobes are: low is scalloped, high is round. */
  readonly scallop: number
  readonly stem: 0 | 1 | 2
  /** Mixed into the game's accent, so no two neighbours are quite the same orange. */
  readonly tint: number
}

/**
 * Areas are held within a few percent of each other on purpose. `carvedRatio`
 * measures cut area against the whole canvas rather than against the pumpkin,
 * so a genuinely smaller body would mean more of its owner's carving landed
 * outside it — invisible, but still counting toward collapse. Equal areas keep
 * the gamble the same for everyone. `pumpkin-art.test.ts` holds the line.
 */
export const VARIETIES: readonly Variety[] = [
  { name: 'classic', lobes: 5, m: 1, scallop: 0.88, stem: 0, tint: 0 },
  { name: 'squat', lobes: 6, m: 1.05, scallop: 0.88, stem: 1, tint: 0.05 },
  { name: 'tall', lobes: 5, m: 0.92, scallop: 0.88, stem: 2, tint: -0.05 },
  { name: 'ribbed', lobes: 7, m: 1, scallop: 0.86, stem: 0, tint: 0.08 },
  { name: 'round', lobes: 6, m: 0.97, scallop: 0.885, stem: 1, tint: -0.02 },
  { name: 'gourd', lobes: 6, m: 0.94, scallop: 0.86, stem: 2, tint: 0.03 },
]

/** The box every variety is drawn in, before its own aspect is applied. */
const BASE = {
  cx: CANVAS_W / 2,
  cy: CANVAS_H / 2 + 16,
  rx: CANVAS_W * 0.47,
  ry: CANVAS_H * 0.385,
} as const

export type Body = { cx: number; cy: number; rx: number; ry: number }

export function bodyFor(variety: Variety): Body {
  return {
    cx: BASE.cx,
    cy: BASE.cy,
    rx: BASE.rx * variety.m,
    ry: BASE.ry / variety.m,
  }
}

export type Lobe = { dx: number; rx: number; ry: number }

/** Each lobe's rx, as a fraction of the body's: more lobes, narrower each. */
function lobeWidth(lobes: number): number {
  return lobes <= 5 ? 0.44 : lobes === 6 ? 0.42 : 0.4
}

/**
 * Lobes spread evenly across the body, the outermost ending exactly on its
 * edge, each one shorter the further out it sits. Returned rather than stored,
 * so a variety is a handful of numbers rather than a table of coordinates.
 */
export function lobesFor(variety: Variety): Lobe[] {
  const rx = lobeWidth(variety.lobes)
  const reach = 1 - rx
  const out: Lobe[] = []
  for (let i = 0; i < variety.lobes; i++) {
    // -1..1 across the row; a single lobe would sit in the middle.
    const t = variety.lobes === 1 ? 0 : (i / (variety.lobes - 1)) * 2 - 1
    out.push({
      dx: t * reach,
      rx,
      ry: 1 - (1 - variety.scallop) * Math.pow(Math.abs(t), 1.5),
    })
  }
  return out
}

/**
 * Which pumpkin a slot gets. Stable for a room, different in the next one, and
 * the same for every client because the room code is.
 */
export function varietyFor(roomCode: string, slot: number): Variety {
  let h = 2166136261 >>> 0
  for (let i = 0; i < roomCode.length; i++) {
    h = Math.imul(h ^ roomCode.charCodeAt(i), 16777619) >>> 0
  }
  h = Math.imul(h ^ (slot + 1), 2654435761) >>> 0
  h ^= h >>> 15
  h = Math.imul(h, 2246822507) >>> 0
  h ^= h >>> 13
  // The index is always in range; the `??` is what `noUncheckedIndexedAccess`
  // requires to turn `Variety | undefined` into `Variety`.
  return VARIETIES[(h >>> 0) % VARIETIES.length] ?? VARIETIES[0]!
}
