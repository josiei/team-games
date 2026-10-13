import { useEffect, useRef } from 'react'
import { CANVAS_H, CANVAS_W, type GalleryEntry } from '@tg/shared'
import { renderPumpkin } from './canvas.js'

const THEME = { accent: '#FF7518', glow: '#FFC24D', bg: '#0E0D14' }

const INTEGRITY_TEXT = {
  solid: '', sagging: 'Sagging', collapsed: 'Collapsed',
} as const

export function PumpkinThumb({
  entry, caption, selected, disabled, onClick,
}: {
  entry: GalleryEntry
  caption?: string | undefined
  selected?: boolean
  disabled?: boolean
  onClick?(): void
}) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return                   // jsdom has no 2D context; e2e covers rendering
    renderPumpkin(ctx, entry.strokes, THEME)
  }, [entry.strokes])

  return (
    <button
      aria-label={`Pumpkin ${entry.slot + 1}`}
      aria-pressed={selected ?? false}
      disabled={disabled ?? false}
      onClick={onClick}
      className="surface"
      data-integrity={entry.integrity}
      style={{
        padding: 8, cursor: disabled ? 'default' : 'pointer',
        outline: selected ? '3px solid var(--accent)' : 'none',
        opacity: disabled ? 0.55 : 1,
        // A collapsed pumpkin slumps, so it reads as failed before the
        // caption is read. Shape, not colour, carries the meaning.
        transform: entry.integrity === 'collapsed'
          ? 'rotate(-6deg) scaleY(0.86)'
          : entry.integrity === 'sagging' ? 'scaleY(0.96)' : 'none',
        transition: 'transform 200ms ease-out',
      }}
    >
      <canvas ref={ref} width={CANVAS_W} height={CANVAS_H} style={{ width: '100%' }} />
      <span style={{ display: 'block', fontSize: 13, color: 'var(--shell-muted)' }}>
        {caption ?? INTEGRITY_TEXT[entry.integrity]}
      </span>
    </button>
  )
}
