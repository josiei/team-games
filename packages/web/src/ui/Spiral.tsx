import { useMemo } from 'react'

/**
 * The slowly turning spiral behind the lobby, in the manner of a Jackbox title
 * screen. Decorative only: `aria-hidden` keeps it out of the accessibility tree
 * entirely, and the rotation stops under `prefers-reduced-motion` (see neon.css).
 *
 * Drawn as one stroked Archimedean spiral (r = GROWTH x theta) rather than as an
 * image, so it stays sharp at any size and recolors from the theme tokens.
 */

/**
 * The viewBox is 0..SIZE on both axes with the spiral drawn around its middle,
 * rather than centred on a negative origin. Browsers disagree about whether
 * `transform-origin` under `transform-box: view-box` counts from the viewBox's
 * min corner or from user-space (0,0); with a non-negative viewBox the two
 * readings coincide, so the spin stays centred either way.
 */
const SIZE = 200
const CENTRE = SIZE / 2
/** The spiral must reach a corner of the square: half-diagonal is CENTRE * sqrt(2). */
const REACH = CENTRE * Math.SQRT2

/** Stroke width and growth are paired: a turn gap of ~2x the stroke reads as a band. */
const STROKE = 7
const GROWTH = (2 * STROKE) / (2 * Math.PI)

/** Small enough that the curve has no visible facets at full-screen scale. */
const STEP = 0.12

function spiralPath(): string {
  const maxTheta = REACH / GROWTH
  const points: string[] = []
  for (let theta = 0; theta <= maxTheta; theta += STEP) {
    const r = GROWTH * theta
    points.push(
      `${(CENTRE + r * Math.cos(theta)).toFixed(2)},${(CENTRE + r * Math.sin(theta)).toFixed(2)}`)
  }
  return `M ${points.join(' L ')}`
}

export function Spiral() {
  const d = useMemo(spiralPath, [])
  return (
    <svg
      className="spiral"
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      preserveAspectRatio="xMidYMid slice"
    >
      <g className="spiral-turn">
        <path d={d} fill="none" stroke="var(--spiral-ink)" strokeWidth={STROKE} strokeLinecap="round" />
      </g>
    </svg>
  )
}
