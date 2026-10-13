import { CANVAS_H, CANVAS_W, type Stroke } from '@tg/shared'

/** The pumpkin outline. Strokes are clipped to it so you cannot carve the background. */
let silhouette: Path2D | null = null
export function pumpkinPath(): Path2D {
  if (!silhouette) {
    silhouette = new Path2D()
    silhouette.ellipse(CANVAS_W / 2, CANVAS_H / 2 + 20, CANVAS_W * 0.44, CANVAS_H * 0.40, 0, 0, Math.PI * 2)
  }
  return silhouette
}

function stampPath(shape: Stroke['shape'], x: number, y: number, r: number): Path2D {
  const path = new Path2D()
  switch (shape) {
    case 'triangle':
      path.moveTo(x, y - r); path.lineTo(x + r, y + r); path.lineTo(x - r, y + r); path.closePath()
      break
    case 'crescent':
      path.arc(x, y, r, 0, Math.PI); path.closePath()
      break
    case 'zigzag':
      path.moveTo(x - r, y)
      for (let i = 0; i < 4; i++) {
        path.lineTo(x - r + (r / 2) * (i * 2 + 1), y + (i % 2 ? r : -r) * 0.6)
      }
      path.lineTo(x + r, y); path.lineTo(x + r, y + r); path.lineTo(x - r, y + r); path.closePath()
      break
    case 'snaggletooth':
      path.rect(x - r, y - r * 0.4, r * 2, r * 0.8)
      path.rect(x - r * 0.2, y - r * 0.4, r * 0.4, r)
      break
    default:
      path.arc(x, y, r, 0, Math.PI * 2)
  }
  return path
}

export type Theme = { accent: string; glow: string; bg: string }

/** One pixel-level operation. `cut` punches flesh out; `restore` paints it back. */
export type Op = {
  kind: 'cut' | 'restore'
  shape: Stroke['shape']
  x: number
  y: number
  r: number
}

/**
 * The operations a stroke's points `from..end` produce, in point order. This
 * is the single definition of what drawing means, shared by the painter and
 * the ordering test, and it mirrors `carvedRatio` (cut writes 1, uncut writes
 * 0, stamps are cuts; later writes win) so picture and meter cannot disagree.
 */
export function strokeOps(stroke: Stroke, from = 0): Op[] {
  const r = (stroke.size * CANVAS_W) / 2
  const kind = stroke.tool === 'uncut' ? 'restore' : 'cut'
  const shape = stroke.tool === 'stamp' ? stroke.shape : undefined
  const ops: Op[] = []
  for (let i = from; i < stroke.points.length; i++) {
    const [nx, ny] = stroke.points[i]!
    ops.push({ kind, shape, x: nx * CANVAS_W, y: ny * CANVAS_H, r })
  }
  return ops
}

/**
 * Keeps the pumpkin body on a persistent offscreen canvas and applies each
 * point once, as it arrives, in chronological order. Only `reset()` (undo,
 * draft restore) causes a full replay, and that replay is also in array order.
 * Per-frame cost is proportional to the NEW points, not the whole carve.
 */
export class PumpkinPainter {
  private canvas: HTMLCanvasElement | null = null
  private bctx: CanvasRenderingContext2D | null = null
  private accent = ''
  private painted = new WeakMap<Stroke, number>()

  /** Forget everything; the next `sync` replays all strokes in array order. */
  reset(): void {
    this.painted = new WeakMap()
    this.bctx = null
  }

  private ensure(theme: Theme): CanvasRenderingContext2D | null {
    if (this.bctx && this.accent === theme.accent) return this.bctx
    if (!this.canvas) {
      this.canvas = document.createElement('canvas')
      this.canvas.width = CANVAS_W
      this.canvas.height = CANVAS_H
    }
    this.canvas.width = CANVAS_W // resizing resets all context state, incl. the clip stack
    const bctx = this.canvas.getContext('2d')
    if (!bctx) return null
    if (this.accent !== theme.accent) this.painted = new WeakMap()
    bctx.setTransform(1, 0, 0, 1, 0, 0)
    bctx.globalCompositeOperation = 'source-over'
    bctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
    bctx.fillStyle = theme.accent
    bctx.fill(pumpkinPath())
    // Clip once, for good: every later op is confined to the silhouette, so
    // the background cannot be carved.
    bctx.save()
    bctx.clip(pumpkinPath())
    this.accent = theme.accent
    this.bctx = bctx
    return bctx
  }

  /** Apply any points not yet painted. Safe to call every frame. */
  sync(strokes: Stroke[], theme: Theme): void {
    const bctx = this.ensure(theme)
    if (!bctx) return
    for (const stroke of strokes) {
      const from = this.painted.get(stroke) ?? 0
      if (from >= stroke.points.length) continue
      for (const op of strokeOps(stroke, from)) {
        bctx.globalCompositeOperation = op.kind === 'cut' ? 'destination-out' : 'source-over'
        if (op.shape) {
          bctx.fill(stampPath(op.shape, op.x, op.y, op.r))
        } else {
          bctx.beginPath()
          bctx.arc(op.x, op.y, op.r, 0, Math.PI * 2)
          bctx.fill()
        }
      }
      this.painted.set(stroke, stroke.points.length)
    }
  }

  /** Candle glow beneath, pumpkin body above, onto the visible canvas. */
  present(ctx: CanvasRenderingContext2D, theme: Theme): void {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
    const glow = ctx.createRadialGradient(
      CANVAS_W / 2, CANVAS_H / 2, 10, CANVAS_W / 2, CANVAS_H / 2, CANVAS_W * 0.5)
    glow.addColorStop(0, '#FFFFFF')
    glow.addColorStop(0.35, theme.glow)
    glow.addColorStop(1, theme.bg)
    ctx.fillStyle = glow
    ctx.fill(pumpkinPath())
    if (this.canvas && this.bctx) ctx.drawImage(this.canvas, 0, 0)
  }
}

let scratch: PumpkinPainter | null = null

/** Full render of a finished stroke list (galleries, thumbnails). Array order. */
export function renderPumpkin(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  theme: Theme,
): void {
  scratch ??= new PumpkinPainter()
  scratch.reset()
  scratch.sync(strokes, theme)
  scratch.present(ctx, theme)
}
