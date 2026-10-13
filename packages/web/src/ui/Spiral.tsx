/**
 * The slowly turning spiral behind the lobby, in the manner of a Jackbox title
 * screen. Decorative only: `aria-hidden` keeps it out of the accessibility tree
 * entirely, and the rotation stops under `prefers-reduced-motion` (see neon.css).
 *
 * Drawn as one stroked Archimedean spiral (r = GROWTH x theta) rather than as an
 * image, so it stays sharp at any size and recolors from the theme tokens.
 *
 * The element is laid out as a square larger than the viewport's diagonal, which
 * lets neon.css spin the <svg> box itself. Spinning an inner <g> instead costs a
 * full-viewport repaint every frame, because SVG children are not promoted to
 * their own compositor layer.
 */

/** The spiral is centred in a square viewBox with a non-negative origin. */
const SIZE = 200
const CENTRE = SIZE / 2
/** It must reach a corner of that square: the half-diagonal is CENTRE * sqrt(2). */
const REACH = CENTRE * Math.SQRT2

/** Stroke width and growth are paired: a turn gap of ~2x the stroke reads as a band. */
const STROKE = 5
const GROWTH = (2 * STROKE) / (2 * Math.PI)

/**
 * Steps of a fixed angle leave the outer turns visibly polygonal, because chord
 * length grows with radius. Stepping by a fixed arc instead keeps every segment
 * the same length; MAX_STEP caps it near the centre, where the arc for one chord
 * would otherwise be most of a turn.
 */
const CHORD = 6
const MAX_STEP = 0.3

function spiralPath(): string {
  const maxTheta = REACH / GROWTH
  const points: string[] = []
  const at = (theta: number) => {
    const r = GROWTH * theta
    points.push(
      `${(CENTRE + r * Math.cos(theta)).toFixed(2)},${(CENTRE + r * Math.sin(theta)).toFixed(2)}`)
  }
  let theta = 0
  while (theta < maxTheta) {
    at(theta)
    theta += Math.min(MAX_STEP, CHORD / Math.max(GROWTH * theta, 1))
  }
  at(maxTheta)
  return `M ${points.join(' L ')}`
}

/** Computed once for the life of the module: the geometry never varies. */
const PATH = spiralPath()

export function Spiral() {
  return (
    <svg
      className="spiral"
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${SIZE} ${SIZE}`}
    >
      <path d={PATH} fill="none" strokeWidth={STROKE} strokeLinecap="round" />
    </svg>
  )
}
