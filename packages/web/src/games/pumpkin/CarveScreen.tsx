import { useEffect, useRef, useState } from 'react'
import {
  CANVAS_H, CANVAS_W, COLLAPSE_BASE, carvedRatio, integrityState,
  type PumpkinView, type StampShape,
} from '@tg/shared'
import { remainingMs, useConnection } from '../../store/connection.js'
import { Timer } from '../../ui/Timer.js'
import { HostLine } from '../../ui/HostLine.js'
import { IntegrityMeter } from './IntegrityMeter.js'
import { PumpkinPainter } from './canvas.js'
import {
  allStrokes, beginStroke, clearDraft, emptyDraft, endStroke,
  extendStroke, isFull, loadDraft, saveDraft, undo, type DraftState,
} from './strokes.js'

const DRAFT_AUTOSAVE_MS = 10_000
/** Local persistence is debounced so a big list is not stringified on every pointerup. */
const LOCAL_SAVE_DEBOUNCE_MS = 400
/** Submit this long before the deadline so the pumpkin lands before the server advances. */
export const AUTO_SUBMIT_MARGIN_MS = 750
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
  const endsAt = useConnection(s => s.endsAt)
  const clockOffset = useConnection(s => s.clockOffset)
  const carving = view?.kind === 'carving' ? view : null
  const inCarving = carving !== null
  const submitted = carving?.submitted ?? false

  const canvasRef = useRef<HTMLCanvasElement>(null)
  // The draft lives in a ref, not React state: pointermove must never re-render.
  const draftRef = useRef<DraftState>(emptyDraft())
  const painterRef = useRef<PumpkinPainter | null>(null)
  const meterRef = useRef<Setter | null>(null)
  const frameRef = useRef(0)
  const rebuildRef = useRef(true)          // next paint replays everything (undo, restore)
  const pointerRef = useRef<number | null>(null) // the one pointer that owns the active stroke
  const dirtyRef = useRef(false)           // committed strokes changed since the last DRAFT
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sentRef = useRef(false)
  const fullRef = useRef(false)
  const serverStrokes = carving?.myStrokes
  const [strokeCount, setStrokeCount] = useState(0)
  const [full, setFull] = useState(false)
  const [tool, setTool] = useState<'cut' | 'uncut' | 'stamp'>('cut')
  const [shape, setShape] = useState<StampShape>('triangle')
  const [size, setSize] = useState(0.08)

  /** Paint now: new points onto the canvas plus the meter. Never sets CarveScreen state per move. */
  const paint = () => {
    frameRef.current = 0
    const draft = draftRef.current
    const strokes = allStrokes(draft)
    const ctx = canvasRef.current?.getContext('2d')
    if (ctx) {
      painterRef.current ??= new PumpkinPainter()
      if (rebuildRef.current) { painterRef.current.reset(); rebuildRef.current = false }
      painterRef.current.sync(strokes, THEME)
      painterRef.current.present(ctx, THEME)
    }
    meterRef.current?.(carvedRatio(strokes))
    if (!fullRef.current && isFull(draft)) { fullRef.current = true; setFull(true) } // once, not per move
  }
  /** At most one paint per animation frame, however many events arrive. */
  const redraw = () => {
    if (frameRef.current) return
    frameRef.current = requestAnimationFrame(paint)
  }

  const cancelSave = () => {
    if (saveTimerRef.current !== null) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
  }
  const persistNow = () => { cancelSave(); saveDraft(roomId, draftRef.current.strokes) }
  const scheduleSave = () => {
    cancelSave()
    saveTimerRef.current = setTimeout(persistNow, LOCAL_SAVE_DEBOUNCE_MS)
  }

  const afterChange = () => {
    dirtyRef.current = true
    scheduleSave()
    setStrokeCount(draftRef.current.strokes.length)
    redraw()
  }

  const commit = () => {
    if (!draftRef.current.active) return
    draftRef.current = endStroke(draftRef.current)
    afterChange()
  }

  /** Final send. Includes an in-progress stroke, so nothing drawn is lost. */
  const submit = () => {
    if (sentRef.current) return
    sentRef.current = true
    cancelSave()
    pointerRef.current = null
    const committed = endStroke(draftRef.current).strokes
    dispatch({ type: 'SUBMIT', strokes: committed })
    clearDraft(roomId)
  }
  const submitRef = useRef(submit)
  submitRef.current = submit

  // Restore after a crash or refresh: the local draft is freshest, the
  // server's last unicast save is the fallback (new device, cleared storage).
  useEffect(() => {
    const saved = loadDraft(roomId)
    const strokes = saved ?? serverStrokes ?? []
    draftRef.current = { strokes, active: null }
    dirtyRef.current = saved !== null // the server may hold an older draft
    rebuildRef.current = true
    setStrokeCount(strokes.length)
    paint()
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); frameRef.current = 0 }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId])

  // Unicast autosave. A save, not a broadcast: nothing fans out mid-carve, and
  // nothing is sent at all when nothing changed since the last one.
  useEffect(() => {
    if (submitted) return
    const id = setInterval(() => {
      if (!dirtyRef.current) return
      dirtyRef.current = false
      persistNow()
      dispatch({ type: 'DRAFT', strokes: draftRef.current.strokes })
    }, DRAFT_AUTOSAVE_MS)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, dispatch, submitted])

  // Flush at the deadline: most players carve until the timer runs out.
  useEffect(() => {
    if (!inCarving || submitted || endsAt === null) return
    const ms = Math.max(0, remainingMs(endsAt, clockOffset) - AUTO_SUBMIT_MARGIN_MS)
    const id = setTimeout(() => submitRef.current(), ms)
    return () => clearTimeout(id)
  }, [inCarving, submitted, endsAt, clockOffset])

  // A room can host another round: never let this pumpkin's draft outlive the
  // carving view, however it ended (manual submit, timer, or phase change).
  useEffect(() => {
    if (!inCarving || submitted) { cancelSave(); clearDraft(roomId) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inCarving, submitted, roomId])
  useEffect(() => () => {
    if ((useConnection.getState().view as PumpkinView | null)?.kind !== 'carving') { cancelSave(); clearDraft(roomId) }
    else if (saveTimerRef.current !== null) persistNow() // unmounted for another reason: keep the draft
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId])

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
          // Primary button only, and only one pointer at a time: a palm or a
          // second finger must not replace the stroke in progress.
          if (e.button !== 0 || pointerRef.current !== null) return
          const rect = e.currentTarget.getBoundingClientRect()
          draftRef.current = beginStroke(
            draftRef.current, tool, size,
            tool === 'stamp' ? shape : undefined, toPoint(e.clientX, e.clientY, rect))
          if (!draftRef.current.active) { // pumpkin is full
            if (!fullRef.current) { fullRef.current = true; setFull(true) }
            return
          }
          pointerRef.current = e.pointerId
          e.currentTarget.setPointerCapture?.(e.pointerId)
          redraw()
        }}
        onPointerMove={e => {
          if (e.pointerId !== pointerRef.current) return
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
        onPointerUp={e => {
          if (e.pointerId !== pointerRef.current) return
          pointerRef.current = null
          commit()
        }}
        onPointerCancel={e => {
          if (e.pointerId !== pointerRef.current) return
          pointerRef.current = null
          commit()
        }}
      />

      <LiveMeter register={meterRef} />

      {full && (
        <p role="status" style={{ margin: '8px 0 0', fontWeight: 600 }}>
          This pumpkin is full. Undo a stroke to keep carving, or submit it.
        </p>
      )}

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
          pointerRef.current = null
          rebuildRef.current = true
          fullRef.current = false
          setFull(false)
          afterChange()
        }}>
          Undo
        </button>
      </div>

      <button style={{ marginTop: 16, width: '100%' }} onClick={submit}>
        Submit pumpkin ({strokeCount} strokes)
      </button>

      <HostLine />
    </main>
  )
}
