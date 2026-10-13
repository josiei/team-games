import { CANVAS_H, CANVAS_W, type Stroke } from '@tg/shared'

/** The pumpkin outline. Strokes are clipped to it so you cannot carve the background. */
export function pumpkinPath(): Path2D {
  const path = new Path2D()
  path.ellipse(CANVAS_W / 2, CANVAS_H / 2 + 20, CANVAS_W * 0.44, CANVAS_H * 0.40, 0, 0, Math.PI * 2)
  return path
}

function stampPath(stroke: Stroke, x: number, y: number, r: number): Path2D {
  const path = new Path2D()
  switch (stroke.shape) {
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

/**
 * Two layers: a candle glow beneath, the pumpkin body above. Carving punches
 * holes in the body with destination-out, so the light shows through.
 */
export function renderPumpkin(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  theme: { accent: string; glow: string; bg: string },
): void {
  const silhouette = pumpkinPath()

  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)

  // candle
  const glow = ctx.createRadialGradient(
    CANVAS_W / 2, CANVAS_H / 2, 10, CANVAS_W / 2, CANVAS_H / 2, CANVAS_W * 0.5)
  glow.addColorStop(0, '#FFFFFF')
  glow.addColorStop(0.35, theme.glow)
  glow.addColorStop(1, theme.bg)
  ctx.fillStyle = glow
  ctx.fill(silhouette)

  // body, with the carve mask punched out. The offscreen canvas is reused
  // across frames: allocating one per redraw would churn memory mid-drag.
  const bctx = bodyContext()
  if (!bctx) return
  bctx.globalCompositeOperation = 'source-over'
  bctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
  bctx.fillStyle = theme.accent
  bctx.fill(silhouette)

  // Every stroke is clipped to the silhouette so the background cannot be carved.
  bctx.save()
  bctx.clip(silhouette)
  bctx.globalCompositeOperation = 'destination-out'
  for (const stroke of strokes) {
    if (stroke.tool === 'uncut') continue
    const radius = (stroke.size * CANVAS_W) / 2
    for (const [nx, ny] of stroke.points) {
      const x = nx * CANVAS_W, y = ny * CANVAS_H
      bctx.fill(stroke.tool === 'stamp' ? stampPath(stroke, x, y, radius) : circle(x, y, radius))
    }
  }

  // uncut restores flesh
  bctx.globalCompositeOperation = 'source-over'
  bctx.fillStyle = theme.accent
  for (const stroke of strokes) {
    if (stroke.tool !== 'uncut') continue
    const radius = (stroke.size * CANVAS_W) / 2
    for (const [nx, ny] of stroke.points) {
      bctx.fill(circle(nx * CANVAS_W, ny * CANVAS_H, radius))
    }
  }
  bctx.restore()

  ctx.drawImage(bctx.canvas, 0, 0)
}

let bodyCanvas: HTMLCanvasElement | null = null
function bodyContext(): CanvasRenderingContext2D | null {
  if (!bodyCanvas) {
    bodyCanvas = document.createElement('canvas')
    bodyCanvas.width = CANVAS_W
    bodyCanvas.height = CANVAS_H
  }
  return bodyCanvas.getContext('2d')
}

function circle(x: number, y: number, r: number): Path2D {
  const path = new Path2D()
  path.arc(x, y, r, 0, Math.PI * 2)
  return path
}
