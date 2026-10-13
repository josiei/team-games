import { useEffect, useRef, useState } from 'react'
import {
  CANVAS_H, CANVAS_W, COLLAPSE_BASE, carvedRatio, integrityState,
  type PumpkinView, type StampShape,
} from '@tg/shared'
import { useConnection } from '../../store/connection.js'
import { Timer } from '../../ui/Timer.js'
import { HostLine } from '../../ui/HostLine.js'
import { IntegrityMeter } from './IntegrityMeter.js'
import { renderPumpkin } from './canvas.js'
import {
  allStrokes, beginStroke, clearDraft, emptyDraft, endStroke,
  extendStroke, loadDraft, saveDraft, undo, type DraftState,
} from './strokes.js'

const DRAFT_AUTOSAVE_MS = 10_000
const STAMPS: StampShape[] = ['triangle', 'circle', 'crescent', 'zigzag', 'snaggletooth']
const THEME = { accent: '#FF7518', glow: '#FFC24D', bg: '#0E0D14' }

type Setter = (ratio: number) => void

/**
 * The only piece of chrome that changes while dragging. It owns its own state
 * and registers its setter with the parent, so CarveScreen itself never
 * re-renders on pointermove.
 */
function LiveMeter({ register }: { register: { current: Setter | null } }) {
  const [ratio, setRatio] = useState(0)
  useEffect(() => {
    register.current = setRatio
    return () => { register.current = null }
  }, [register])
  // The client cannot know this player's jittered threshold (the server never
  // sends it, or the unlabeled meter stops being a gamble), so it approximates
  // with the shared base value.
  return <IntegrityMeter ratio={ratio} integrity={integrityState(ratio, COLLAPSE_BASE)} />
}

export function CarveScreen({ roomId }: { roomId: string }) {
  const view = useConnection(s => s.view) as PumpkinView | null
  const dispatch = useConnection(s => s.dispatch)
  const carving = view?.kind === 'carving' ? view : null
  const submitted = carving?.submitted ?? false

  const canvasRef = useRef<HTMLCanvasElement>(null)
  // The draft lives in a ref, not React state: pointermove must never re-render.
  const draftRef = useRef<DraftState>(emptyDraft())
  const meterRef = useRef<Setter | null>(null)
  const frameRef = useRef(0)
  const serverStrokes = carving?.myStrokes
  const [strokeCount, setStrokeCount] = useState(0)
  const [tool, setTool] = useState<'cut' | 'uncut' | 'stamp'>('cut')
  const [shape, setShape] = useState<StampShape>('triangle')
  const [size, setSize] = useState(0.08)

  /** Paint now: canvas pixels plus the meter. Never touches CarveScreen state. */
  const paint = () => {
    frameRef.current = 0
    const strokes = allStrokes(draftRef.current)
    const ctx = canvasRef.current?.getContext('2d')
    if (ctx) renderPumpkin(ctx, strokes, THEME)
    meterRef.current?.(carvedRatio(strokes))
  }
  /** At most one paint per animation frame, however many events arrive. */
  const redraw = () => {
    if (frameRef.current) return
    frameRef.current = requestAnimationFrame(paint)
  }

  const commit = () => {
    draftRef.current = endStroke(draftRef.current)
    saveDraft(roomId, draftRef.current.strokes)
    setStrokeCount(draftRef.current.strokes.length)
    redraw()
  }

  // Restore after a crash or refresh: the local draft is freshest, the
  // server's last unicast save is the fallback (new device, cleared storage).
  useEffect(() => {
    const saved = loadDraft(roomId)
    const strokes = saved ?? serverStrokes ?? []
    draftRef.current = { strokes, active: null }
    setStrokeCount(strokes.length)
    paint()
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); frameRef.current = 0 }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId])

  // Unicast autosave. A save, not a broadcast: nothing fans out mid-carve.
  useEffect(() => {
    if (submitted) return
    const id = setInterval(() => {
      const strokes = draftRef.current.strokes
      saveDraft(roomId, strokes)
      dispatch({ type: 'DRAFT', strokes })
    }, DRAFT_AUTOSAVE_MS)
    return () => clearInterval(id)
  }, [roomId, dispatch, submitted])

  if (!carving) return null

  if (submitted) {
    return (
      <main style={{ textAlign: 'center', padding: 24 }}>
        <h2>Carved.</h2>
        <p>{carving.submittedCount} of {carving.totalPlayers} done.</p>
        <HostLine />
      </main>
    )
  }

  const toPoint = (clientX: number, clientY: number, rect: DOMRect): [number, number] =>
    [(clientX - rect.left) / rect.width, (clientY - rect.top) / rect.height]

  return (
    <main style={{ maxWidth: 560, margin: '0 auto', padding: 16 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <h2 style={{ fontFamily: 'var(--font-game)', margin: 0 }}>Carve</h2>
        <Timer />
      </header>

      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        aria-label="Pumpkin carving canvas"
        style={{ width: '100%', touchAction: 'none', cursor: 'crosshair' }}
        onPointerDown={e => {
          e.currentTarget.setPointerCapture?.(e.pointerId)
          const rect = e.currentTarget.getBoundingClientRect()
          draftRef.current = beginStroke(
            draftRef.current, tool, size,
            tool === 'stamp' ? shape : undefined, toPoint(e.clientX, e.clientY, rect))
          redraw()
        }}
        onPointerMove={e => {
          // A stamp is placed once per press; dragging would smear a trail of them.
          if (!draftRef.current.active || tool === 'stamp') return
          // Coalesced events keep fast drags smooth without extra renders.
          const events = e.nativeEvent.getCoalescedEvents?.() ?? []
          const samples = events.length > 0 ? events : [e.nativeEvent]
          const rect = e.currentTarget.getBoundingClientRect()
          for (const raw of samples) {
            draftRef.current = extendStroke(
              draftRef.current, toPoint(raw.clientX, raw.clientY, rect))
          }
          redraw()
        }}
        onPointerUp={commit}
        onPointerCancel={commit}
      />

      <LiveMeter register={meterRef} />

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        <button aria-pressed={tool === 'cut'} onClick={() => setTool('cut')}>Cut</button>
        <button aria-pressed={tool === 'uncut'} onClick={() => setTool('uncut')}>Uncarve</button>
        <button aria-pressed={tool === 'stamp'} onClick={() => setTool('stamp')}>Stamp</button>
        {tool === 'stamp' && STAMPS.map(s => (
          <button key={s} aria-pressed={shape === s} onClick={() => setShape(s)}>{s}</button>
        ))}
        <label>Size
          <input type="range" min={0.03} max={0.25} step={0.01} value={size}
            onChange={e => setSize(Number(e.target.value))} />
        </label>
        <button onClick={() => {
          draftRef.current = undo(draftRef.current)
          saveDraft(roomId, draftRef.current.strokes)
          setStrokeCount(draftRef.current.strokes.length)
          redraw()
        }}>
          Undo
        </button>
      </div>

      <button
        style={{ marginTop: 16, width: '100%' }}
        onClick={() => {
          const committed = endStroke(draftRef.current).strokes
          dispatch({ type: 'SUBMIT', strokes: committed })
          clearDraft(roomId)
        }}
      >
        Submit pumpkin ({strokeCount} strokes)
      </button>

      <HostLine />
    </main>
  )
}
