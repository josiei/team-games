import { useEffect, useRef, type CSSProperties } from 'react'
import { CANVAS_H, CANVAS_W, type GalleryEntry } from '@tg/shared'
import { renderPumpkin } from './canvas.js'
import { varietyFor } from './varieties.js'

const THEME = { accent: '#FF7518', glow: '#FFC24D', bg: '#0E0D14' }

const INTEGRITY_TEXT = {
  solid: '', sagging: 'Sagging', collapsed: 'Collapsed',
} as const

/**
 * Interactive when `onClick` is given (a toggle button); otherwise a static,
 * non-focusable image. `dimmed` defaults to `disabled`, so a display-only
 * thumb is never dimmed unless asked.
 */
export function PumpkinThumb({
  entry, code, caption, selected, disabled, dimmed, onClick,
}: {
  entry: GalleryEntry
  /** The room code: which pumpkin this slot was given is derived from it. */
  code: string
  caption?: string | undefined
  selected?: boolean
  disabled?: boolean
  dimmed?: boolean
  onClick?(): void
}) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return                   // jsdom has no 2D context; e2e covers rendering
    renderPumpkin(ctx, entry.strokes, THEME, varietyFor(code, entry.slot))
    // Keyed on stable values, not `entry.strokes`: every snapshot is a fresh
    // JSON.parse, so the array identity changes though a submitted pumpkin's
    // strokes cannot. Re-rasterizing all thumbs on every vote is wasted work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, entry.slot, entry.strokes.length, entry.integrity])

  const state = INTEGRITY_TEXT[entry.integrity]
  // The accessible name carries the caption and the state, so assistive tech
  // hears what sighted users read ("Yours", "Collapsed").
  const name = [`Pumpkin ${entry.slot + 1}`, caption, state].filter(Boolean).join(', ')
  const interactive = onClick !== undefined
  const faded = dimmed ?? disabled ?? false

  const style: CSSProperties = {
    padding: 8,
    cursor: interactive && !disabled ? 'pointer' : 'default',
    opacity: faded ? 0.55 : 1,
    // Selection uses border + ring, never `outline`, so the browser's
    // keyboard focus ring stays visible and distinct.
    border: selected ? '3px solid var(--accent)' : '3px solid transparent',
    boxShadow: selected ? '0 0 0 2px var(--glow)' : 'none',
    // A collapsed pumpkin slumps, so it reads as failed before the
    // caption is read. Shape, not colour, carries the meaning.
    transform: entry.integrity === 'collapsed'
      ? 'rotate(-6deg) scaleY(0.86)'
      : entry.integrity === 'sagging' ? 'scaleY(0.96)' : 'none',
    transition: 'transform 200ms ease-out',
  }

  const body = (
    <>
      <canvas ref={ref} className="thumb-canvas" width={CANVAS_W} height={CANVAS_H} aria-hidden="true" />
      <span style={{ display: 'block', fontSize: 13, color: 'var(--shell-muted)' }}>
        {selected ? '\u2713 ' : ''}{caption}
        {caption && state ? ' \u00b7 ' : ''}{state}
      </span>
    </>
  )

  if (!interactive) {
    return (
      <div role="img" aria-label={name} className="surface"
        data-integrity={entry.integrity} style={style}>
        {body}
      </div>
    )
  }
  return (
    <button
      aria-label={name}
      aria-pressed={selected ?? false}
      disabled={disabled ?? false}
      onClick={onClick}
      className="surface"
      data-integrity={entry.integrity}
      style={style}
    >
      {body}
    </button>
  )
}
