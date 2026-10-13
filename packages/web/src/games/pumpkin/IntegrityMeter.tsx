type Integrity = 'solid' | 'sagging' | 'collapsed'

const LABEL: Record<Integrity, string> = {
  solid: 'Solid',
  sagging: 'Sagging',
  collapsed: 'Collapsed',
}

const COLOR: Record<Integrity, string> = {
  solid: 'var(--danger)',
  sagging: 'var(--glow)',
  collapsed: 'var(--accent)',
}

const CRACKS: Record<Integrity, number> = { solid: 0, sagging: 2, collapsed: 5 }

/**
 * Deliberately unlabeled numerically: the bar shows how far you have gone,
 * never how far you may go, so over-carving stays a gamble. aria-valuenow is
 * omitted for the same reason; aria-valuetext carries the qualitative state.
 */
export function IntegrityMeter({
  ratio, integrity,
}: { ratio: number; integrity: Integrity }) {
  return (
    <div>
      <div
        role="meter"
        aria-label="Structural integrity"
        aria-valuetext={LABEL[integrity]}
        style={{
          height: 10, borderRadius: 999, overflow: 'hidden',
          background: 'var(--shell-surface)', border: '1px solid var(--shell-border)',
          position: 'relative',
        }}
      >
        <div style={{
          width: `${Math.min(100, ratio * 100 / 0.6)}%`,
          height: '100%', background: COLOR[integrity],
          transition: 'width 80ms linear',
        }} />
        {Array.from({ length: CRACKS[integrity] }, (_, i) => (
          <span key={i} data-crack style={{
            position: 'absolute', top: 0, bottom: 0,
            left: `${12 + i * 16}%`, width: 2,
            background: 'var(--shell-bg)', transform: 'rotate(12deg)',
          }} />
        ))}
      </div>
      <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--shell-muted)' }}>
        {LABEL[integrity]}
      </p>
    </div>
  )
}
