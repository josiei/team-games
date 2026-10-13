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
import '../../theme/neon.css'

/** The carve meter is a slowly moving bar: recompute carvedRatio at ~10Hz, paint at full rate. */
const METER_INTERVAL_MS = 100
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
  const status = useConnection(s => s.status)
  const carving = view?.kind === 'carving' ? view : null
  const inCarving = carving !== null
  // Only an ACTUAL non-carving view counts as leaving. A null view (initial
  // mount, reconnect before the first snapshot) says nothing.
  const leftCarving = view != null && view.kind !== 'carving'
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
  const retryRef = useRef(false)          // a submit attempt failed; retry once the socket reopens
  const meterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const meterAtRef = useRef(0)
  const serverStrokes = carving?.myStrokes
  const [strokeCount, setStrokeCount] = useState(0)
  const [full, setFull] = useState(false)
  const [unsent, setUnsent] = useState(false)
  const [tool, setTool] = useState<'cut' | 'uncut' | 'stamp'>('cut')
  const [shape, setShape] = useState<StampShape>('triangle')
  const [size, setSize] = useState(0.08)

  /** carvedRatio is O(points x brush area); throttled, with a trailing call so the bar always settles. */
  const updateMeter = () => {
    if (meterTimerRef.current !== null) return
    const wait = Math.max(0, METER_INTERVAL_MS - (performance.now() - meterAtRef.current))
    const run = () => {
      meterTimerRef.current = null
      meterAtRef.current = performance.now()
      meterRef.current?.(carvedRatio(allStrokes(draftRef.current)))
    }
    if (wait === 0) run()
    else meterTimerRef.current = setTimeout(run, wait)
  }

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
    updateMeter()
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

  /**
   * Final send. Includes an in-progress stroke, so nothing drawn is lost.
   * Nothing is latched or cleared until `dispatch` reports the message really
   * went out: a closed socket silently drops it, and deleting the draft then
   * would lose the pumpkin. On failure we stay usable and retry on reconnect.
   */
  const submit = () => {
    if (sentRef.current) return
    const committed = endStroke(draftRef.current).strokes
    if (!dispatch({ type: 'SUBMIT', strokes: committed })) {
      retryRef.current = true
      setUnsent(true)
      return
    }
    sentRef.current = true
    retryRef.current = false
    setUnsent(false)
    cancelSave()
    pointerRef.current = null
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
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
      frameRef.current = 0
      if (meterTimerRef.current !== null) clearTimeout(meterTimerRef.current)
      meterTimerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId])

  // Unicast autosave. A save, not a broadcast: nothing fans out mid-carve, and
  // nothing is sent at all when nothing changed since the last one.
  useEffect(() => {
    if (submitted) return
    const id = setInterval(() => {
      if (!dirtyRef.current) return
      persistNow()
      // Stay dirty if the socket dropped the frame: that draft is what enters
      // the gallery for someone who disconnects mid-carve, so retry next tick.
      if (dispatch({ type: 'DRAFT', strokes: draftRef.current.strokes })) dirtyRef.current = false
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

  // `dispatch` returning true only means the frame reached an open socket, not
  // the server. If a snapshot still shows this player as NOT submitted after we
  // latched, the SUBMIT was lost: un-latch and resend. SUBMIT is idempotent
  // server-side, so a duplicate (e.g. a snapshot already in flight) is harmless.
  useEffect(() => {
    if (sentRef.current && inCarving && !submitted) {
      sentRef.current = false
      submitRef.current()
    }
  }, [view, inCarving, submitted])

  // Reconnect: if a submit failed, or the deadline has already passed without
  // one landing, send it now that the socket is open again.
  useEffect(() => {
    if (status !== 'open' || !inCarving || submitted || sentRef.current) return
    const due = endsAt !== null && remainingMs(endsAt, clockOffset) <= AUTO_SUBMIT_MARGIN_MS
    if (retryRef.current || due) submitRef.current()
  }, [status, inCarving, submitted, endsAt, clockOffset])

  // A room can host another round: never let this pumpkin's draft outlive the
  // carving view, however it ended (manual submit, timer, or phase change).
  useEffect(() => {
    if (leftCarving || submitted) { cancelSave(); clearDraft(roomId) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftCarving, submitted, roomId])
  useEffect(() => () => {
    const v = useConnection.getState().view as PumpkinView | null
    if (v != null && v.kind !== 'carving') { cancelSave(); clearDraft(roomId) }
    else if (saveTimerRef.current !== null) persistNow() // unmounted for another reason: keep the draft
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId])

  if (!carving) return null

  if (submitted) {
    return (
      <main className="game-stage">
        <div className="game-inner is-narrow panel panel-centred">
          <h2 className="game-title">Carved.</h2>
          <p>{carving.submittedCount} of {carving.totalPlayers} done.</p>
          <HostLine />
        </div>
      </main>
    )
  }

  const toPoint = (clientX: number, clientY: number, rect: DOMRect): [number, number] =>
    [(clientX - rect.left) / rect.width, (clientY - rect.top) / rect.height]

  return (
    <main className="game-stage">
      <div className="game-inner is-narrow">
      <header className="game-head">
        <h2 className="game-title">Carve</h2>
        <Timer />
      </header>

      <div className="carve-frame">
      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        aria-label="Pumpkin carving canvas"
        style={{ touchAction: 'none', cursor: 'crosshair' }}
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
      </div>

      <LiveMeter register={meterRef} />

      {/* Always mounted: a live region inserted together with its text is often not announced. */}
      <p role="status" className="game-status">
        {full
          ? 'This pumpkin is full. Undo a stroke to keep carving, or submit it.'
          : unsent
            ? 'Connection lost. Your pumpkin is saved here and will send when you reconnect.'
            : ''}
      </p>

      <div className="toolbar">
        <button className="tool-btn" aria-pressed={tool === 'cut'} onClick={() => setTool('cut')}>Cut</button>
        <button className="tool-btn" aria-pressed={tool === 'uncut'} onClick={() => setTool('uncut')}>Uncarve</button>
        <button className="tool-btn" aria-pressed={tool === 'stamp'} onClick={() => setTool('stamp')}>Stamp</button>
        {tool === 'stamp' && STAMPS.map(s => (
          <button className="tool-btn" key={s} aria-pressed={shape === s} onClick={() => setShape(s)}>{s}</button>
        ))}
        <label className="size-field">Size
          <input type="range" min={0.03} max={0.25} step={0.01} value={size}
            onChange={e => setSize(Number(e.target.value))} />
        </label>
        <button className="tool-btn" onClick={() => {
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

      <button className="btn-neon" style={{ marginTop: 16, width: '100%' }} onClick={submit}>
        Submit pumpkin ({strokeCount} strokes)
      </button>

      <HostLine />
      </div>
    </main>
  )
}
