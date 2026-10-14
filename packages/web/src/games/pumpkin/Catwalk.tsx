import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  AWARD_LABELS, CANVAS_H, CANVAS_W,
  type AwardKey, type GalleryEntry,
} from '@tg/shared'
import { renderPumpkin } from './canvas.js'
import { varietyFor } from './varieties.js'

const THEME = { accent: '#FF7518', glow: '#FFC24D', bg: '#0E0D14' }

/**
 * Award order for the show, which is not the order the grid uses. Most Cursed
 * opens because a disaster is a good warm-up, and Funniest closes because the
 * biggest laugh is the one to end on.
 */
export const RUNNING_ORDER: readonly AwardKey[] = ['cursed', 'scariest', 'craft', 'funniest']

/**
 * One strut: enter, turn, pose under the light, exit. Published to CSS as
 * `--act-ms` on the stage, so the stylesheet cannot drift out of step with it —
 * the keyframe percentages are duration-relative and follow automatically.
 */
export const ACT_MS = 3200

/**
 * Whether this browsing session has already sat through the show. Without it,
 * anything that remounts the results screen — a refresh, taking the session
 * back from another tab — replays all thirteen seconds before the grid is
 * reachable again, and there is no skip control. A throw (private mode, blocked
 * storage) reads as "seen": repeating the show is the worse failure.
 */
const SEEN_KEY = 'tg.catwalk.seen'

/**
 * Remembered per room, not per tab. A refresh of the same results screen must
 * not replay thirteen unskippable seconds — but the next game is a different
 * show, and a tab-wide flag silently retired the reveal for every game after
 * the first in the same tab. Storing the room id makes a new room replay it.
 */
export function showSeen(roomId: string): boolean {
  if (!roomId) return false
  try { return sessionStorage.getItem(SEEN_KEY) === roomId } catch { return true }
}

export function markShowSeen(roomId: string): void {
  if (!roomId) return
  try { sessionStorage.setItem(SEEN_KEY, roomId) } catch { /* degrade */ }
}

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

function Walker({ act, code }: { act: Act; code: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return                  // jsdom has no 2D context
    renderPumpkin(ctx, act.entry.strokes, THEME, varietyFor(code, act.entry.slot))
    // Keyed on stable values, not the entry object: every snapshot is a fresh
    // JSON.parse, so a host line or a player dropping mid-act would otherwise
    // re-rasterize the walker underneath a running 3D composite.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [act.entry.slot, act.entry.strokes.length, act.entry.integrity])

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
export function Catwalk({ acts, code, onDone }: { acts: Act[]; code: string; onDone(): void }) {
  const [index, setIndex] = useState(0)
  const doneRef = useRef(onDone)
  doneRef.current = onDone

  useEffect(() => {
    const startedAt = Date.now()
    // Ending on the timer rather than on a null render keeps the blank frame
    // between the last walker and the grid off the screen, and the cleanup
    // guarantees onDone fires once even if the effect is double-invoked.
    const advance = () => {
      if (index + 1 >= acts.length) doneRef.current()
      else setIndex(i => i + 1)
    }
    const id = setTimeout(advance, ACT_MS)
    // A hidden tab has its timers throttled to once a minute after a few
    // minutes, while the CSS animations keep running on wall clock and settle
    // on their end frame. Without this, coming back lands on an empty runway.
    const onVisible = () => {
      if (!document.hidden && Date.now() - startedAt >= ACT_MS) {
        clearTimeout(id)
        advance()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [index, acts.length])

  const act = acts[index]
  if (!act) return null

  return (
    <section
      className="catwalk"
      aria-label="Awards reveal"
      style={{ '--act-ms': `${ACT_MS}ms` } as CSSProperties}
    >
      <div className="catwalk-floor" aria-hidden="true" />
      <div className="catwalk-beam" key={`beam-${index}`} aria-hidden="true" />

      {/* Keyed on the act so every animation restarts for each walker. */}
      <Walker key={index} act={act} code={code} />

      {/* Announced as each winner lands, so the show is not thirteen silent
          seconds for anyone listening rather than watching. */}
      <div className="catwalk-plate" key={`plate-${index}`} aria-live="polite">
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
