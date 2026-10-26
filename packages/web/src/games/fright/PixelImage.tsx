import { useEffect, useRef, useState } from 'react'

type Load = 'loading' | 'ready' | 'failed'

/**
 * A photograph hidden behind a mosaic.
 *
 * Drawn by downscaling to `mosaic` blocks across and scaling back up with
 * smoothing off, which is what gives hard-edged blocks rather than a blur —
 * a blur hides a subject by making it soft, a mosaic hides it by making it
 * ambiguous, and ambiguity is the game.
 *
 * The canvas can only paint once the image has arrived, and a clue lasts
 * well under a minute. Until then — and for good if the fetch fails — a
 * placeholder stands in, so a slow connection shows "the picture is coming"
 * rather than an empty frame. The prompt renders either way, so the clue is
 * still playable on its text.
 */
export function PixelImage({ src, mosaic, revealed, alt }: {
  src: string
  mosaic: number
  revealed: boolean
  alt: string
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const [load, setLoad] = useState<Load>('loading')

  useEffect(() => {
    setLoad('loading')
    const el = canvas.current
    // On the reveal the full photograph covers the canvas, so there is
    // nothing to mosaic — drawing it would also be drawing it at the wrong
    // block count, since the reveal view carries no mosaic of its own.
    if (!el || revealed) return

    const context = el.getContext('2d')
    // jsdom has no 2D context; the component must still mount for tests.
    if (!context) return

    let cancelled = false
    const image = new Image()
    image.crossOrigin = 'anonymous'

    image.onload = () => {
      if (cancelled) return
      const ratio = image.height / image.width || 1
      const across = Math.max(2, Math.floor(mosaic))
      const down = Math.max(2, Math.round(across * ratio))
      el.width = across
      el.height = down
      context.imageSmoothingEnabled = false
      context.drawImage(image, 0, 0, across, down)
      setLoad('ready')
    }
    image.onerror = () => { if (!cancelled) setLoad('failed') }

    image.src = src
    return () => { cancelled = true }
  }, [src, mosaic, revealed])

  return (
    <div className="pixel-image">
      {!revealed && (
        <canvas
          ref={canvas}
          className="pixel-canvas"
          role="img"
          aria-label="A pixelated photograph"
        />
      )}
      {!revealed && load !== 'ready' && (
        <div className="pixel-placeholder" role="status">
          {load === 'failed' ? "This picture didn't load" : 'Developing…'}
        </div>
      )}
      {revealed && <img className="pixel-reveal" src={src} alt={alt} />}
    </div>
  )
}
