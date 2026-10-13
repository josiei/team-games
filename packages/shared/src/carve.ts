export type StampShape = 'triangle' | 'circle' | 'crescent' | 'zigzag' | 'snaggletooth'

export type Stroke = {
  tool: 'cut' | 'uncut' | 'stamp'
  shape?: StampShape
  size: number                    // normalized brush diameter, 0..1
  points: [number, number][]      // normalized 0..1
}

export const CANVAS_W = 512
export const CANVAS_H = 640

export const SAG_THRESHOLD = 0.40
export const COLLAPSE_BASE = 0.55
export const COLLAPSE_JITTER = 0.04

/** Grid resolution for area estimation. 64x80 keeps the aspect ratio and costs ~5k cells. */
const GX = 64
const GY = 80

/**
 * Fraction of the pumpkin face that has been cut away.
 * Occupancy grid, so overlapping strokes cannot double-count.
 */
export function carvedRatio(strokes: Stroke[]): number {
  if (strokes.length === 0) return 0
  const hit = ratioCache.get(strokes)
  if (hit !== undefined) return hit
  const ratio = computeCarvedRatio(strokes)
  ratioCache.set(strokes, ratio)
  return ratio
}

/**
 * Submitted stroke arrays are never mutated, so array identity is a sound
 * cache key. Every vote re-derives the whole gallery for every player; without
 * this that is O(players^2) rasterizations per vote.
 */
const ratioCache = new WeakMap<Stroke[], number>()

function computeCarvedRatio(strokes: Stroke[]): number {
  const grid = new Uint8Array(GX * GY)

  for (const stroke of strokes) {
    const value = stroke.tool === 'uncut' ? 0 : 1
    const radius = Math.max(stroke.size, 1 / GX) / 2
    for (const [px, py] of stroke.points) {
      const minX = Math.max(0, Math.floor((px - radius) * GX))
      const maxX = Math.min(GX - 1, Math.ceil((px + radius) * GX))
      const minY = Math.max(0, Math.floor((py - radius) * GY))
      const maxY = Math.min(GY - 1, Math.ceil((py + radius) * GY))
      for (let gy = minY; gy <= maxY; gy++) {
        for (let gx = minX; gx <= maxX; gx++) {
          const dx = (gx + 0.5) / GX - px
          const dy = (gy + 0.5) / GY - py
          if (dx * dx + dy * dy <= radius * radius) grid[gy * GX + gx] = value
        }
      }
    }
  }

  let cut = 0
  for (let i = 0; i < grid.length; i++) if (grid[i] === 1) cut += 1
  return cut / grid.length
}

export function integrityState(
  ratio: number,
  collapseAt: number,
): 'solid' | 'sagging' | 'collapsed' {
  if (ratio >= collapseAt) return 'collapsed'
  if (ratio >= SAG_THRESHOLD) return 'sagging'
  return 'solid'
}

/**
 * Per-pumpkin collapse threshold, jittered so the unlabeled meter is a
 * genuine gamble rather than a number to read. Deterministic from the
 * room seed, which is why reduce can stay pure.
 */
export function collapseThresholdFor(seed: number, index: number): number {
  let h = (seed ^ (index * 0x9e3779b9)) >>> 0
  h ^= h << 13; h >>>= 0
  h ^= h >>> 17
  h ^= h << 5;  h >>>= 0
  const unit = h / 0xffffffff              // 0..1
  return COLLAPSE_BASE + (unit * 2 - 1) * COLLAPSE_JITTER
}
