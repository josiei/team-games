import { CANVAS_H, CANVAS_W, type Stroke } from '@tg/shared'
import { VARIETIES, bodyFor, lobesFor, type Body, type Variety } from './varieties.js'

export const DEFAULT_VARIETY: Variety = VARIETIES[0]!

/**
 * One silhouette per variety, built once. Strokes are clipped to it, so this
 * is also what stops you carving the background.
 */
const silhouettes = new Map<string, Path2D>()
export function pumpkinPath(variety: Variety = DEFAULT_VARIETY): Path2D {
  const hit = silhouettes.get(variety.name)
  if (hit) return hit
  const body = bodyFor(variety)
  const path = new Path2D()
  for (const lobe of lobesFor(variety)) {
    const x = body.cx + lobe.dx * body.rx
    const rx = lobe.rx * body.rx
    // Without this each ellipse() joins the previous subpath with a straight
    // line from its end point. Filling hides them; stroking does not.
    path.moveTo(x + rx, body.cy)
    path.ellipse(x, body.cy, rx, lobe.ry * body.ry, 0, 0, Math.PI * 2)
  }
  silhouettes.set(variety.name, path)
  return path
}

/** Where an unreadable colour lands: visibly wrong, rather than not rendering. */
export const FALLBACK_SKIN = '#8A8A8A'

/**
 * Mixes a hex colour toward white (amount > 0) or black (amount < 0), so the
 * shading follows whatever accent a game hands us instead of hard-coding
 * orange. Anything it cannot parse becomes grey: the result goes straight into
 * `addColorStop`, which THROWS on a colour it cannot read — from the carve
 * screen's animation frame that means a blank canvas every frame, where the
 * old flat fill merely ignored the value. A grey pumpkin is debuggable; a
 * blank one is not.
 */
export function shade(hex: string, amount: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return FALLBACK_SKIN
  const n = parseInt(match[1]!, 16)
  const towards = amount >= 0 ? 255 : 0
  const t = Math.min(1, Math.abs(amount))
  const mix = (channel: number) => Math.round(channel + (towards - channel) * t)
  const r = mix((n >> 16) & 0xff), g = mix((n >> 8) & 0xff), b = mix(n & 0xff)
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
}

/** Where the seams fall: between each pair of neighbouring lobes. */
export function seamsFor(variety: Variety): number[] {
  const lobes = lobesFor(variety)
  const seams: number[] = []
  for (let i = 0; i < lobes.length - 1; i++) {
    seams.push((lobes[i]!.dx + lobes[i + 1]!.dx) / 2)
  }
  return seams
}

/** The curved seam at `offset`, bulging with the body it sits on. */
function seamPath(offset: number, body: Body): Path2D {
  const path = new Path2D()
  const x = body.cx + offset * body.rx
  // How far down the body this seam reaches: the further out, the shorter.
  const span = body.ry * Math.sqrt(Math.max(0, 1 - offset * offset * 0.9))
  const bulge = offset * body.rx * 0.28
  path.moveTo(x, body.cy - span)
  path.quadraticCurveTo(x + bulge, body.cy, x, body.cy + span)
  return path
}

/** How far each stem reaches above the body. Pinned by a test against the canvas. */
export const STEM_RISE = [50, 34, 58] as const

/** The stem's apex for a variety, clamped so a taller body cannot crop it. */
export function stemTop(variety: Variety, body: Body): number {
  const topY = body.cy - body.ry
  return topY - Math.min(STEM_RISE[variety.stem], Math.max(0, topY - 6))
}

/** Sits above the body and outside the carve clip, so it cannot be cut away. */
function drawStem(ctx: CanvasRenderingContext2D, variety: Variety, body: Body): void {
  const topY = body.cy - body.ry
  const apex = stemTop(variety, body)
  const cx = body.cx
  const stem = new Path2D()
  const ridge = new Path2D()
  if (variety.stem === 1) {
    // Stubby and upright.
    stem.moveTo(cx - 26, topY + 12)
    stem.quadraticCurveTo(cx - 24, apex + 8, cx - 2, apex + 2)
    stem.quadraticCurveTo(cx + 18, apex, cx + 22, apex + 14)
    stem.quadraticCurveTo(cx + 6, apex + 18, cx + 26, topY + 12)
    ridge.moveTo(cx - 10, topY + 6)
    ridge.quadraticCurveTo(cx - 10, apex + 16, cx + 4, apex + 6)
  } else if (variety.stem === 2) {
    // Long and curling back over itself.
    stem.moveTo(cx - 24, topY + 12)
    stem.quadraticCurveTo(cx - 40, apex + 34, cx - 2, apex + 8)
    stem.quadraticCurveTo(cx + 26, apex, cx + 22, apex + 26)
    stem.quadraticCurveTo(cx + 4, apex + 34, cx + 22, topY + 10)
    ridge.moveTo(cx - 10, topY + 6)
    ridge.quadraticCurveTo(cx - 20, apex + 38, cx + 2, apex + 20)
  } else {
    // The one everybody draws: thick, leaning slightly.
    stem.moveTo(cx - 30, topY + 14)
    stem.quadraticCurveTo(cx - 34, apex + 16, cx + 2, apex + 4)
    stem.quadraticCurveTo(cx + 20, apex, cx + 26, apex + 14)
    stem.quadraticCurveTo(cx + 6, apex + 24, cx + 28, topY + 12)
    ridge.moveTo(cx - 14, topY + 8)
    ridge.quadraticCurveTo(cx - 16, apex + 22, cx + 6, apex + 8)
  }
  stem.closePath()
  ctx.fillStyle = '#6B8A3C'
  ctx.fill(stem)
  ctx.strokeStyle = '#415724'
  ctx.lineWidth = 4
  ctx.lineJoin = 'round'
  ctx.stroke(stem)
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
 * The paint a CUT uses. `destination-out` removes only as much as the source's
 * own alpha, so it must be fully opaque, and it must never inherit whatever
 * was left on the context. (It did: the body's shading leaked into the cuts
 * and carving stopped taking the flesh away.)
 *
 * A restore does not use a paint at all — it blits the untouched body back, so
 * the seams and the rim come with it. Filling it with the flesh gradient put a
 * flat bright patch over the outer two thirds of the pumpkin, where the shaded
 * edge belongs.
 */
export const CUT_PAINT = '#000'

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
  /** The body before any carving: what an uncarve puts back. */
  private pristine: HTMLCanvasElement | null = null
  private accent = ''
  private variety = ''
  private painted = new WeakMap<Stroke, number>()

  /** Forget everything; the next `sync` replays all strokes in array order. */
  reset(): void {
    this.painted = new WeakMap()
    this.bctx = null
  }

  /** Only for tests: the untouched body an uncarve blits from. */
  get pristineBody(): HTMLCanvasElement | null { return this.pristine }

  private ensure(theme: Theme, variety: Variety): CanvasRenderingContext2D | null {
    if (this.bctx && this.accent === theme.accent && this.variety === variety.name) return this.bctx
    if (!this.canvas) {
      this.canvas = document.createElement('canvas')
      this.canvas.width = CANVAS_W
      this.canvas.height = CANVAS_H
    }
    this.canvas.width = CANVAS_W // resizing resets all context state, incl. the clip stack
    const bctx = this.canvas.getContext('2d')
    if (!bctx) return null
    // A different body is a different canvas: every stroke has to go on again.
    if (this.accent !== theme.accent || this.variety !== variety.name) this.painted = new WeakMap()
    bctx.setTransform(1, 0, 0, 1, 0, 0)
    bctx.globalCompositeOperation = 'source-over'
    bctx.clearRect(0, 0, CANVAS_W, CANVAS_H)

    const geo = bodyFor(variety)
    const path = pumpkinPath(variety)
    // Each variety sits a little off the game's accent, so two pumpkins side by
    // side are not quite the same orange.
    const skin = shade(theme.accent, variety.tint)

    // Lit from up and to the left. A flat fill is most of why this read as a
    // ball rather than a gourd.
    const body = bctx.createRadialGradient(
      geo.cx - geo.rx * 0.35, geo.cy - geo.ry * 0.45, geo.rx * 0.1,
      geo.cx, geo.cy, geo.rx * 1.15)
    body.addColorStop(0, shade(skin, 0.28))
    body.addColorStop(0.55, skin)
    body.addColorStop(1, shade(skin, -0.35))
    bctx.fillStyle = body
    bctx.fill(path)

    // Clip once, for good: every later op is confined to the silhouette, so
    // the background cannot be carved.
    bctx.save()
    bctx.clip(path)

    // Seams, inside the clip and painted before any stroke: carving punches
    // through them exactly as it punches through the flesh around them.
    bctx.strokeStyle = shade(skin, -0.3)
    bctx.lineCap = 'round'
    for (const offset of seamsFor(variety)) {
      bctx.lineWidth = Math.abs(offset) > 0.3 ? 6 : 8
      bctx.stroke(seamPath(offset, geo))
    }

    // A darker edge, so the body turns away rather than stopping flat. Painted
    // as a vignette rather than stroked: the path is several lobes, and
    // stroking it would trace every one of them across the face.
    const rim = bctx.createRadialGradient(
      geo.cx, geo.cy, geo.rx * 0.62, geo.cx, geo.cy, geo.rx)
    rim.addColorStop(0, 'rgba(0,0,0,0)')
    rim.addColorStop(1, 'rgba(0,0,0,0.38)')
    bctx.fillStyle = rim
    bctx.fill(path)

    // Keep a copy of the finished body. An uncarve blits from this, so it puts
    // the seams and the shaded edge back rather than a flat patch of flesh.
    this.pristine ??= document.createElement('canvas')
    this.pristine.width = CANVAS_W
    this.pristine.height = CANVAS_H
    const pctx = this.pristine.getContext('2d')
    if (pctx) {
      pctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
      pctx.drawImage(this.canvas, 0, 0)
    }

    this.accent = theme.accent
    this.variety = variety.name
    this.bctx = bctx
    return bctx
  }

  /** Apply any points not yet painted. Safe to call every frame. */
  sync(strokes: Stroke[], theme: Theme, variety: Variety = DEFAULT_VARIETY): void {
    const bctx = this.ensure(theme, variety)
    if (!bctx) return
    for (const stroke of strokes) {
      const from = this.painted.get(stroke) ?? 0
      if (from >= stroke.points.length) continue
      for (const op of strokeOps(stroke, from)) {
        if (op.kind === 'restore' && this.pristine) {
          // Put the original body back through the brush, shading and all.
          bctx.save()
          bctx.globalCompositeOperation = 'source-over'
          if (op.shape) {
            bctx.clip(stampPath(op.shape, op.x, op.y, op.r))
          } else {
            bctx.beginPath()
            bctx.arc(op.x, op.y, op.r, 0, Math.PI * 2)
            bctx.clip()
          }
          bctx.drawImage(this.pristine, 0, 0)
          bctx.restore()
          continue
        }
        bctx.globalCompositeOperation = 'destination-out'
        bctx.fillStyle = CUT_PAINT
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
  present(ctx: CanvasRenderingContext2D, theme: Theme, variety: Variety = DEFAULT_VARIETY): void {
    const geo = bodyFor(variety)
    // The context belongs to the caller: leave its paint, line settings and
    // composite mode exactly as they were found.
    ctx.save()
    ctx.globalCompositeOperation = 'source-over'
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
    const glow = ctx.createRadialGradient(
      geo.cx, geo.cy, 10, geo.cx, geo.cy, geo.rx * 1.05)
    glow.addColorStop(0, '#FFFFFF')
    glow.addColorStop(0.35, theme.glow)
    glow.addColorStop(1, theme.bg)
    ctx.fillStyle = glow
    ctx.fill(pumpkinPath(variety))
    // Under the body, so the body's top edge overlaps its base and it reads as
    // planted in the pumpkin rather than balanced on it.
    drawStem(ctx, variety, geo)
    if (this.canvas && this.bctx) ctx.drawImage(this.canvas, 0, 0)
    ctx.restore()
  }
}

let scratch: PumpkinPainter | null = null

/** Full render of a finished stroke list (galleries, thumbnails). Array order. */
export function renderPumpkin(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  theme: Theme,
  variety: Variety = DEFAULT_VARIETY,
): void {
  scratch ??= new PumpkinPainter()
  scratch.reset()
  scratch.sync(strokes, theme, variety)
  scratch.present(ctx, theme, variety)
}
