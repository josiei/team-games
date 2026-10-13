import { CANVAS_H, CANVAS_W, type Stroke, type StampShape } from '@tg/shared'

/**
 * `active.points` is MUTATED in place while a stroke is being drawn: the draft
 * lives in a ref and React never reads it mid-drag, so copying the array per
 * sample would be quadratic churn on the hottest path. Committed `strokes`
 * stay immutable.
 */
export type DraftState = { strokes: Stroke[]; active: Stroke | null }

export const emptyDraft = (): DraftState => ({ strokes: [], active: null })

/**
 * Point budget. A SUBMIT or DRAFT frame over 1 MiB closes the websocket and
 * loses the pumpkin, and DRAFT resends the whole list. At ~16 bytes per point
 * and ~60 per stroke object these ceilings keep a full pumpkin near 300 KB.
 * Once either is hit the draft stops accepting input (see `isFull`).
 */
export const MAX_POINTS = 15_000
export const MAX_STROKES = 800

const STAMP_SHAPES: readonly StampShape[] = ['triangle', 'circle', 'crescent', 'zigzag', 'snaggletooth']

/**
 * Clamp into the canvas, then round to 4 decimal places (0.05px on a 512px
 * canvas). Raw pointer floats cost ~35-40 bytes per point; quantized ones cost
 * ~14. Non-finite input (a zero-size canvas rect) collapses to 0.
 */
const quantize1 = (n: number): number =>
  Number.isFinite(n) ? Math.round(Math.min(1, Math.max(0, n)) * 1e4) / 1e4 : 0
const quantize = ([x, y]: [number, number]): [number, number] => [quantize1(x), quantize1(y)]

const radiusPx = (size: number) => (size * CANVAS_W) / 2

/**
 * Minimum gap between kept points, in canvas pixels: a quarter of the brush
 * radius (never below 1px), growing as the pumpkin fills. It only ever affects
 * FUTURE samples; points already drawn are never resampled.
 */
function minStepPx(size: number, total: number): number {
  return Math.max(1, radiusPx(size) / 4) * (1 + (2 * total) / MAX_POINTS)
}

const committedCache = new WeakMap<Stroke[], number>()
function committedPoints(strokes: Stroke[]): number {
  let n = committedCache.get(strokes)
  if (n === undefined) {
    n = strokes.reduce((sum, s) => sum + s.points.length, 0)
    committedCache.set(strokes, n)
  }
  return n
}

const totalPoints = (d: DraftState) =>
  committedPoints(d.strokes) + (d.active ? d.active.points.length : 0)
const totalStrokes = (d: DraftState) => d.strokes.length + (d.active ? 1 : 0)

/** True once the point or stroke ceiling is reached; the UI shows a cue. */
export const isFull = (d: DraftState): boolean =>
  totalPoints(d) >= MAX_POINTS || totalStrokes(d) >= MAX_STROKES

export function beginStroke(
  draft: DraftState,
  tool: Stroke['tool'],
  size: number,
  shape: StampShape | undefined,
  point: [number, number],
): DraftState {
  if (isFull(draft)) return { strokes: draft.strokes, active: null }
  const p = quantize(point)
  const active: Stroke = shape
    ? { tool, shape, size, points: [p] }
    : { tool, size, points: [p] }
  return { strokes: draft.strokes, active }
}

export function extendStroke(draft: DraftState, point: [number, number]): DraftState {
  const active = draft.active
  if (!active || active.tool === 'stamp') return draft
  const next = quantize(point)
  const last = active.points[active.points.length - 1]
  if (!last) { active.points.push(next); return draft }

  const total = totalPoints(draft)
  const dx = (next[0] - last[0]) * CANVAS_W
  const dy = (next[1] - last[1]) * CANVAS_H
  const gap = Math.hypot(dx, dy)
  // Thin as we capture: a still finger must not accumulate identical points.
  const minStep = minStepPx(active.size, total)
  if (gap < minStep) return draft

  // Interpolate in the DATA, not the renderer, so the picture, the meter and
  // the server all see the same continuous line. A flick faster than one brush
  // radius per sample would otherwise leave a dotted trail.
  const spacing = Math.max(radiusPx(active.size), minStep) // sub-pixel brushes need no sub-pixel fill
  const segments = gap <= spacing * 1.5 ? 1 : Math.ceil(gap / spacing)
  const room = MAX_POINTS - total
  for (let i = 1; i <= segments && i <= room; i++) {
    const t = i / segments
    active.points.push(quantize([last[0] + (next[0] - last[0]) * t, last[1] + (next[1] - last[1]) * t]))
  }
  return draft
}

export function endStroke(draft: DraftState): DraftState {
  if (!draft.active || draft.active.points.length === 0) {
    return { strokes: draft.strokes, active: null }
  }
  return { strokes: [...draft.strokes, draft.active], active: null }
}

export function undo(draft: DraftState): DraftState {
  if (draft.active) return { strokes: draft.strokes, active: null }
  return { strokes: draft.strokes.slice(0, -1), active: null }
}

/** Includes the in-progress stroke, so the live integrity meter is accurate. */
export function allStrokes(draft: DraftState): Stroke[] {
  return draft.active ? [...draft.strokes, draft.active] : draft.strokes
}

const key = (roomId: string) => `tg:draft:${roomId}`

export function saveDraft(roomId: string, strokes: Stroke[]): void {
  try { localStorage.setItem(key(roomId), JSON.stringify(strokes)) } catch { /* private mode */ }
}

const isUnit = (n: unknown): n is number => typeof n === 'number' && n >= 0 && n <= 1

function isStroke(s: unknown): s is Stroke {
  if (!s || typeof s !== 'object') return false
  const o = s as Record<string, unknown>
  if (o.tool !== 'cut' && o.tool !== 'uncut' && o.tool !== 'stamp') return false
  if (typeof o.size !== 'number' || !Number.isFinite(o.size) || o.size <= 0) return false
  if (o.shape !== undefined && !STAMP_SHAPES.includes(o.shape as StampShape)) return false
  return Array.isArray(o.points) && o.points.every(
    p => Array.isArray(p) && p.length === 2 && isUnit(p[0]) && isUnit(p[1]))
}

/** Returns null (discarding the draft) for anything malformed or over budget. */
export function loadDraft(roomId: string): Stroke[] | null {
  try {
    const raw = localStorage.getItem(key(roomId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed) || parsed.length > MAX_STROKES) return null
    if (!parsed.every(isStroke)) return null
    const points = (parsed as Stroke[]).reduce((n, s) => n + s.points.length, 0)
    return points > MAX_POINTS ? null : (parsed as Stroke[])
  } catch { return null }
}

export function clearDraft(roomId: string): void {
  try { localStorage.removeItem(key(roomId)) } catch { /* ignore */ }
}
