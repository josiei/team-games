import { useEffect, useRef, useState } from 'react'
import {
  AWARD_LABELS, CANVAS_H, CANVAS_W,
  type AwardKey, type GalleryEntry,
} from '@tg/shared'
import { renderPumpkin } from './canvas.js'

const THEME = { accent: '#FF7518', glow: '#FFC24D', bg: '#0E0D14' }

/**
 * Award order for the show, which is not the order the grid uses. Most Cursed
 * opens because a disaster is a good warm-up, and Funniest closes because the
 * biggest laugh is the one to end on.
 */
const RUNNING_ORDER: readonly AwardKey[] = ['cursed', 'scariest', 'craft', 'funniest']

/** One strut: enter, turn, pose under the light, exit. Mirrored in neon.css. */
export const ACT_MS = 3200

export type Act = {
  award: AwardKey
  entry: GalleryEntry
  carver: string
  votes: number
}

/**
 * Builds the running order from whatever the results hold. An award with no
 * votes, or a winner whose pumpkin is missing from the gallery, simply does not
 * walk — the show is a flourish and must never be the thing that breaks results.
 */
export function actsFrom(
  winners: Partial<Record<AwardKey, { slot: number; votes: number } | null | undefined>>,
  gallery: GalleryEntry[],
  nameFor: (slot: number) => string,
): Act[] {
  const acts: Act[] = []
  for (const award of RUNNING_ORDER) {
    const winner = winners[award]
    if (!winner) continue
    const entry = gallery.find(g => g.slot === winner.slot)
    if (!entry) continue
    acts.push({ award, entry, carver: nameFor(winner.slot), votes: winner.votes })
  }
  return acts
}

/**
 * True when the viewer has asked their system to keep motion down — and also
 * when the environment has no `matchMedia` at all. Skipping is the safe default:
 * somewhere that cannot answer the question should not be shown a 13-second
 * animation it may not be able to render.
 */
export function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true
}

function Walker({ act }: { act: Act }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return                  // jsdom has no 2D context
    renderPumpkin(ctx, act.entry.strokes, THEME)
  }, [act.entry])

  return (
    <div className="walker">
      <div className="walker-turn">
        <div className={`walker-body is-${act.entry.integrity}`}>
          <canvas ref={ref} width={CANVAS_W} height={CANVAS_H} aria-hidden="true" />
        </div>
      </div>
      <div className="walker-shadow" aria-hidden="true" />
    </div>
  )
}

/**
 * The results reveal: each award's winner walks a lit runway, one at a time,
 * before the full grid appears. Everyone's client receives the results snapshot
 * in the same instant, so playing this locally keeps the room near enough in
 * step without a phase of its own in the protocol.
 */
export function Catwalk({ acts, onDone }: { acts: Act[]; onDone(): void }) {
  const [index, setIndex] = useState(0)
  const doneRef = useRef(onDone)
  doneRef.current = onDone

  useEffect(() => {
    if (index >= acts.length) { doneRef.current(); return }
    const id = setTimeout(() => setIndex(i => i + 1), ACT_MS)
    return () => clearTimeout(id)
  }, [index, acts.length])

  const act = acts[index]
  if (!act) return null

  return (
    <section className="catwalk" aria-label="Awards reveal">
      <div className="catwalk-floor" aria-hidden="true" />
      <div className="catwalk-beam" key={`beam-${index}`} aria-hidden="true" />

      {/* Keyed on the act so every animation restarts for each walker. */}
      <Walker key={index} act={act} />

      <div className="catwalk-plate" key={`plate-${index}`}>
        <p className="catwalk-award">{AWARD_LABELS[act.award]}</p>
        <p className="catwalk-carver">{act.carver}</p>
        <p className="catwalk-votes">
          {act.votes} {act.votes === 1 ? 'vote' : 'votes'}
        </p>
      </div>

      <ol className="catwalk-dots" aria-hidden="true">
        {acts.map((a, i) => (
          <li key={a.award} className={i === index ? 'is-now' : i < index ? 'is-done' : ''} />
        ))}
      </ol>
    </section>
  )
}
