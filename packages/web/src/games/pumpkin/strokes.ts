import { CANVAS_H, CANVAS_W, type Stroke, type StampShape } from '@tg/shared'

export type DraftState = { strokes: Stroke[]; active: Stroke | null }

export const emptyDraft = (): DraftState => ({ strokes: [], active: null })

/**
 * Clamp into the canvas, then round to 4 decimal places (0.05px on a 512px
 * canvas). Raw pointer floats cost ~35-40 bytes per point; quantized ones cost
 * ~14. A SUBMIT or DRAFT frame over 1 MiB closes the websocket and loses the
 * pumpkin, so every stored point goes through here.
 */
const q = (n: number): number => Math.round(Math.min(1, Math.max(0, n)) * 1e4) / 1e4
const clamp = ([x, y]: [number, number]): [number, number] => [q(x), q(y)]

/** Points closer than this many canvas pixels to the last kept point are dropped. */
const MIN_STEP_PX = 1

export function beginStroke(
  draft: DraftState,
  tool: Stroke['tool'],
  size: number,
  shape: StampShape | undefined,
  point: [number, number],
): DraftState {
  const active: Stroke = shape
    ? { tool, shape, size, points: [clamp(point)] }
    : { tool, size, points: [clamp(point)] }
  return { strokes: draft.strokes, active }
}

export function extendStroke(draft: DraftState, point: [number, number]): DraftState {
  if (!draft.active) return draft
  const next = clamp(point)
  const last = draft.active.points[draft.active.points.length - 1]
  if (last) {
    // Thin as we capture: a still finger must not accumulate identical points.
    const dx = (next[0] - last[0]) * CANVAS_W
    const dy = (next[1] - last[1]) * CANVAS_H
    if (dx * dx + dy * dy < MIN_STEP_PX * MIN_STEP_PX) return draft
  }
  return {
    strokes: draft.strokes,
    active: { ...draft.active, points: [...draft.active.points, next] },
  }
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

export function loadDraft(roomId: string): Stroke[] | null {
  try {
    const raw = localStorage.getItem(key(roomId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as Stroke[]) : null
  } catch { return null }
}

export function clearDraft(roomId: string): void {
  try { localStorage.removeItem(key(roomId)) } catch { /* ignore */ }
}
