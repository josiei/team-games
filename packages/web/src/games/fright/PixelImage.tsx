import { useEffect, useRef } from 'react'

/**
 * A photograph hidden behind a mosaic.
 *
 * Drawn by downscaling to `mosaic` blocks across and scaling back up with
 * smoothing off, which is what gives hard-edged blocks rather than a blur —
 * a blur hides a subject by making it soft, a mosaic hides it by making it
 * ambiguous, and ambiguity is the game.
 *
 * On reveal the original is cross-faded over the top rather than redrawn, so
 * the answer appears as a resolve rather than a cut.
 */
export function PixelImage({ src, mosaic, revealed, alt }: {
  src: string
  mosaic: number
  revealed: boolean
  alt: string
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const context = el.getContext('2d')
    // jsdom has no 2D context; the component must still mount for tests.
    if (!context) return

    let cancelled = false
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      if (cancelled) return
      const ratio = image.height / image.width || 1
      const blocksAcross = Math.max(2, Math.floor(mosaic))
      const blocksDown = Math.max(2, Math.round(blocksAcross * ratio))

      el.width = blocksAcross
      el.height = blocksDown
      context.imageSmoothingEnabled = false
      context.drawImage(image, 0, 0, blocksAcross, blocksDown)
    }
    image.src = src
    return () => { cancelled = true }
  }, [src, mosaic])

  return (
    <div className="pixel-image">
      <canvas
        ref={canvas}
        className="pixel-canvas"
        role="img"
        aria-label={revealed ? alt : 'A pixelated photograph'}
      />
      {revealed && <img className="pixel-reveal" src={src} alt={alt} />}
    </div>
  )
}
