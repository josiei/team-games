import { CANVAS_H, CANVAS_W, type Stroke } from '@tg/shared'

/**
 * The body's bounding box. Kept at roughly the area of the plain ellipse this
 * replaced: `carvedRatio` measures cut area against the whole canvas rather
 * than against the pumpkin, so shrinking the body would quietly make the
 * integrity meter harsher for the same amount of visible carving.
 */
export const BODY = {
  cx: CANVAS_W / 2,
  cy: CANVAS_H / 2 + 16,
  rx: CANVAS_W * 0.47,
  ry: CANVAS_H * 0.385,
} as const

/**
 * Five overlapping lobes, filled as one path. Nonzero winding unions them, so
 * the result is a single scalloped outline rather than five ellipses — which
 * is the difference between a pumpkin and an orange. The outermost pair ends
 * exactly on `rx` (0.56 + 0.44), so the body still fills its box.
 */
export const LOBES: readonly { dx: number; rx: number; ry: number }[] = [
  { dx: 0, rx: 0.46, ry: 1 },
  { dx: 0.3, rx: 0.44, ry: 0.97 },
  { dx: -0.3, rx: 0.44, ry: 0.97 },
  { dx: 0.56, rx: 0.44, ry: 0.88 },
  { dx: -0.56, rx: 0.44, ry: 0.88 },
]

/** The seams between the lobes, as a fraction of `rx`. Mirrored, so four in all. */
const RIBS = [0.17, 0.44] as const

/** The pumpkin outline. Strokes are clipped to it so you cannot carve the background. */
let silhouette: Path2D | null = null
export function pumpkinPath(): Path2D {
  if (!silhouette) {
    silhouette = new Path2D()
    for (const lobe of LOBES) {
      const x = BODY.cx + lobe.dx * BODY.rx
      const rx = lobe.rx * BODY.rx
      // Without this each ellipse() joins the previous subpath with a straight
      // line from its end point. Filling hides them; stroking does not.
      silhouette.moveTo(x + rx, BODY.cy)
      silhouette.ellipse(x, BODY.cy, rx, lobe.ry * BODY.ry, 0, 0, Math.PI * 2)
    }
  }
  return silhouette
}

/**
 * Mixes a hex colour toward white (amount > 0) or black (amount < 0), so the
 * shading follows whatever accent a game hands us instead of hard-coding
 * orange. Anything it cannot parse comes back untouched — a flat body is a
 * worse pumpkin, never a broken one.
 */
export function shade(hex: string, amount: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return hex
  const n = parseInt(match[1]!, 16)
  const towards = amount >= 0 ? 255 : 0
  const t = Math.min(1, Math.abs(amount))
  const mix = (channel: number) => Math.round(channel + (towards - channel) * t)
  const r = mix((n >> 16) & 0xff), g = mix((n >> 8) & 0xff), b = mix(n & 0xff)
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
}

/** The curved seam between two lobes, bulging with the body it sits on. */
function ribPath(offset: number): Path2D {
  const path = new Path2D()
  const x = BODY.cx + offset * BODY.rx
  // How far down the body this seam reaches: the further out, the shorter.
  const span = BODY.ry * Math.sqrt(Math.max(0, 1 - offset * offset * 0.9))
  const bulge = offset * BODY.rx * 0.28
  path.moveTo(x, BODY.cy - span)
  path.quadraticCurveTo(x + bulge, BODY.cy, x, BODY.cy + span)
  return path
}

/** Sits above the body and outside the carve clip, so it cannot be cut away. */
function drawStem(ctx: CanvasRenderingContext2D): void {
  const topY = BODY.cy - BODY.ry
  // Short and thick, leaning slightly: a long thin one reads as a leaf.
  const stem = new Path2D()
  stem.moveTo(BODY.cx - 30, topY + 14)
  stem.quadraticCurveTo(BODY.cx - 34, topY - 34, BODY.cx + 2, topY - 50)
  stem.quadraticCurveTo(BODY.cx + 20, topY - 54, BODY.cx + 26, topY - 40)
  stem.quadraticCurveTo(BODY.cx + 6, topY - 30, BODY.cx + 28, topY + 12)
  stem.closePath()
  ctx.fillStyle = '#6B8A3C'
  ctx.fill(stem)
  ctx.strokeStyle = '#415724'
  ctx.lineWidth = 4
  ctx.lineJoin = 'round'
  ctx.stroke(stem)
  // One ridge, so it is not a flat green blob.
  const ridge = new Path2D()
  ridge.moveTo(BODY.cx - 14, topY + 8)
  ridge.quadraticCurveTo(BODY.cx - 16, topY - 28, BODY.cx + 6, topY - 42)
  ctx.strokeStyle = '#415724'
  ctx.lineWidth = 3
  ctx.stroke(ridge)
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

/**
 * The paint an op uses. A cut works by `destination-out`, which removes only
 * as much as the source's own alpha — so it must be fully opaque, and it must
 * never inherit whatever was left on the context. (It did: the body's shading
 * leaked into the cuts and carving stopped taking the flesh away.) `restore`
 * paints the flesh back, shading and all, so an uncarve blends in rather than
 * leaving a flat patch.
 */
export function fillFor(kind: Op['kind'], flesh: string | CanvasGradient): string | CanvasGradient {
  return kind === 'cut' ? '#000' : flesh
}

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
  private flesh: string | CanvasGradient = ''
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

    // Lit from up and to the left. A flat fill is most of why this read as a
    // ball rather than a gourd.
    const body = bctx.createRadialGradient(
      BODY.cx - BODY.rx * 0.35, BODY.cy - BODY.ry * 0.45, BODY.rx * 0.1,
      BODY.cx, BODY.cy, BODY.rx * 1.15)
    body.addColorStop(0, shade(theme.accent, 0.28))
    body.addColorStop(0.55, theme.accent)
    body.addColorStop(1, shade(theme.accent, -0.35))
    bctx.fillStyle = body
    this.flesh = body
    bctx.fill(pumpkinPath())

    // Clip once, for good: every later op is confined to the silhouette, so
    // the background cannot be carved.
    bctx.save()
    bctx.clip(pumpkinPath())

    // Seams, inside the clip and painted before any stroke: carving punches
    // through them exactly as it punches through the flesh around them.
    bctx.strokeStyle = shade(theme.accent, -0.3)
    bctx.lineCap = 'round'
    for (const offset of RIBS) {
      for (const side of [1, -1]) {
        bctx.lineWidth = Math.abs(side * offset) > 0.3 ? 6 : 8
        bctx.stroke(ribPath(side * offset))
      }
    }

    // A darker edge, so the body turns away rather than stopping flat. Painted
    // as a vignette rather than stroked: the path is five lobes, and stroking
    // it would trace every one of them across the face.
    const rim = bctx.createRadialGradient(
      BODY.cx, BODY.cy, BODY.rx * 0.62, BODY.cx, BODY.cy, BODY.rx)
    rim.addColorStop(0, 'rgba(0,0,0,0)')
    rim.addColorStop(1, 'rgba(0,0,0,0.38)')
    bctx.fillStyle = rim
    bctx.fill(pumpkinPath())
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
        bctx.fillStyle = fillFor(op.kind, this.flesh)
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
    // Under the body, so the body's top edge overlaps its base and it reads as
    // planted in the pumpkin rather than balanced on it.
    drawStem(ctx)
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
