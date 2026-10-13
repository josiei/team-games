import {
  labelPlayers,
  type GameModule, type PlayerId, type RoomContext, type ServerMessage,
} from '@tg/shared'
import type { Repo } from '../db/repo.js'
import type { LiveRoom, RoomStore } from './store.js'

/** Client-controlled text must not forge log lines or flood the log. */
function logSafe(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').slice(0, 32)
}

type Send = (to: PlayerId, message: ServerMessage) => void

export class RoomRuntime {
  private readonly room: LiveRoom
  private readonly store: RoomStore
  private readonly repo: Repo
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly module: GameModule<any, any, any>
  private readonly send: Send
  // The phase timer and module timers live apart: a module calling setTimer
  // must never cancel the clock that advances its own phase.
  private phaseTimer: ReturnType<typeof setTimeout> | null = null
  private readonly moduleTimers = new Set<ReturnType<typeof setTimeout>>()
  private phaseEndsAt: number | null = null
  private started = false
  private disposed = false
  private failed = false

  constructor(deps: {
    room: LiveRoom
    store: RoomStore
    repo: Repo
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    module: GameModule<any, any, any>
    send: Send
  }) {
    this.room = deps.room
    this.store = deps.store
    this.repo = deps.repo
    this.module = deps.module
    this.send = deps.send
  }

  get phase(): string { return this.room.phase }
  get hasStarted(): boolean { return this.started }

  start(): void {
    if (this.disposed) throw new Error('Room disposed')
    if (this.started) throw new Error('Room already started')

    // Any failure inside start() rolls the runtime back to its pre-start
    // condition and rethrows, so the caller can report it and the host can
    // press start again.
    try {
      // Participants, never room.players: spectators who joined after the game
      // started must not receive a pumpkin or a gallery slot.
      const participants = this.store.participants(this.room)
      const state = this.module.createState(participants, this.room.seed)
      if (state === undefined || state === null) throw new Error('createState returned no state')
      this.room.state = state
      this.started = true
      this.repo.setRoomStatus(this.room.workspaceId, this.room.id, 'playing')
      if (!this.enterPhase(this.module.phases[1]!)) {     // phases[0] is 'lobby'
        throw new Error('could not enter the first phase')
      }
    } catch (error) {
      this.started = false
      this.clearPhaseTimer()
      this.clearModuleTimers()
      this.phaseEndsAt = null
      this.room.state = null
      this.room.phase = this.module.phases[0]!
      try {
        this.repo.setRoomStatus(this.room.workspaceId, this.room.id, 'open')
      } catch { /* best effort */ }
      throw error
    }
  }

  dispatch(by: PlayerId, action: unknown): void {
    if (this.disposed || !this.started || action === null || typeof action !== 'object') return
    if (!('type' in action) || typeof action.type !== 'string') return
    if (!this.room.players.has(by)) return

    // `by` comes from the authenticated socket. Any `by` in the payload is ignored.
    // A module's reducer may not recognise the action (or choke on its shape);
    // either way the state must survive untouched.
    let next: unknown
    try {
      next = this.module.reduce(this.room.state, action, by)
    } catch (error) {
      // An unknown action type is ignored quietly; a throw is a bug or a
      // malformed payload and must be visible.
      console.error(
        `[room ${this.room.id}] reduce threw for player ${by}, action ${logSafe(action.type)}:`, error)
      return
    }
    if (next === undefined || next === null) return
    this.room.state = next

    // Persist before the early returns below, so DRAFT saves too and an
    // in-progress carving survives a crash. Reached only once the reducer has
    // produced a new state; every bail-out above returns first.
    this.persist()

    // DRAFT is a private save: nothing fans out, or every player's in-progress
    // strokes would be shipped to everyone.
    if (action.type === 'DRAFT') return

    if (this.room.phase === 'carving' && this.allConnectedSubmitted()) {
      this.advancePhase()   // enterPhase broadcasts the new snapshot
      return
    }
    this.broadcastSnapshot()
  }

  advancePhase(): void {
    this.tryAdvance()
  }

  /** True when the room advanced or is already terminal; false if entering the next phase failed. */
  private tryAdvance(): boolean {
    if (this.disposed || !this.started) return true
    const index = this.module.phases.indexOf(this.room.phase)
    const next = this.module.phases[index + 1]
    if (!next) return true
    return this.enterPhase(next)
  }

  /**
   * The phase clock fired and the next phase could not be entered. Nobody can
   * retry on a player's behalf, so end the game visibly instead of leaving a
   * dead countdown.
   */
  private failRoom(reason: string): void {
    if (this.disposed) return
    console.error(`[room ${this.room.id}] ${reason}; ending the game`)
    this.clearPhaseTimer()
    this.clearModuleTimers()
    this.phaseEndsAt = null
    const terminal = this.module.phases[this.module.phases.length - 1]!
    this.room.phase = terminal
    try {
      const next = this.module.setPhase(this.room.state, terminal)
      if (next === undefined || next === null) throw new Error('no state')
      this.room.state = next
    } catch {
      this.failed = true      // state still says the old phase; do not render it
    }
    this.broadcast({
      type: 'error', code: 'PHASE_FAILED',
      message: 'The game hit a problem and had to end.',
    })
    if (!this.failed) this.persist()   // a terminal room restores as terminal
    this.broadcastSnapshot()
  }

  onConnect(playerId: PlayerId): void {
    this.store.setConnected(this.room, playerId, true)
    this.repo.setConnected(this.room.workspaceId, playerId, true)
    this.broadcastSnapshot()
  }

  onDisconnect(playerId: PlayerId): void {
    this.store.setConnected(this.room, playerId, false)
    this.repo.setConnected(this.room.workspaceId, playerId, false)
    this.store.reassignHostIfNeeded(this.room)
    this.repo.setHost(this.room.workspaceId, this.room.id, this.room.hostId)

    if (this.started && this.room.phase === 'carving' && this.allConnectedSubmitted()) {
      this.advancePhase()   // enterPhase broadcasts the new snapshot
      return
    }
    this.broadcastSnapshot()
  }

  snapshotFor(playerId: PlayerId): ServerMessage {
    const players = [...this.room.players.values()].map(p =>
      ({ id: p.id, displayName: p.displayName, connected: p.connected, joinedAt: p.joinedAt }))
    return {
      type: 'snapshot',
      phase: this.room.phase,
      // Always through viewFor for the current phase, never raw state: the
      // results view carries carver ids that earlier views must not.
      view: this.room.state === null || this.failed
        ? { kind: 'lobby', playerCount: players.length }
        : this.module.viewFor(this.room.state, playerId),
      players,
      endsAt: this.phaseEndsAt,
      serverNow: Date.now(),
      // Branded PlayerId keys are not assignable to string keys; cast here only.
      labels: labelPlayers(players) as Record<string, string>,
      hostId: this.room.hostId,
    }
  }

  dispose(): void {
    this.disposed = true
    this.clearPhaseTimer()
    this.clearModuleTimers()
  }

  /** Sets the deadline and the one clock that ends this phase. */
  private armPhaseTimer(phase: string, ms: number): void {
    this.phaseEndsAt = Date.now() + ms
    this.phaseTimer = setTimeout(() => {
      this.phaseTimer = null
      let ok = false
      try { ok = this.tryAdvance() } catch (error) {
        console.error(`[room ${this.room.id}] error advancing past ${phase}:`, error)
      }
      if (!ok) this.failRoom(`could not advance past ${phase}`)
    }, ms)
  }

  /**
   * Take over a room restored from a snapshot (it already has phase and
   * state). Re-arms the phase clock for the time that was left, so the phase
   * ends when it originally would have; a deadline that passed during the
   * outage advances at once. Idempotent.
   */
  resume(): void {
    if (this.disposed || this.started || this.room.state === null) return
    this.started = true
    const endsAt = this.room.restoredEndsAt ?? null
    delete this.room.restoredEndsAt
    if (endsAt === null) { this.phaseEndsAt = null; return }
    const phase = this.room.phase
    // Clamp to the configured phase length (and Node's timer ceiling): a clock
    // that moved backwards must not turn into a huge or instantly-firing timeout.
    const cap = Math.min(this.room.config.phaseMs[phase] ?? 2 ** 31 - 1, 2 ** 31 - 1)
    const remaining = Math.min(endsAt - Date.now(), cap)
    if (remaining > 0) {
      this.armPhaseTimer(phase, remaining)
      return
    }
    this.phaseEndsAt = null
    let ok = false
    try { ok = this.tryAdvance() } catch (error) {
      console.error(`[room ${this.room.id}] error advancing past ${phase} on resume:`, error)
    }
    if (!ok) this.failRoom(`could not advance past ${phase}`)
  }

  /** Returns false (having changed nothing) if the phase could not be entered. */
  private enterPhase(phase: string): boolean {
    // Validate before committing anything, so a bad setPhase cannot leave the
    // room half-transitioned with state that viewFor would choke on.
    let nextState: unknown
    try {
      nextState = this.module.setPhase(this.room.state, phase)
    } catch (error) {
      console.error(`[room ${this.room.id}] setPhase threw entering ${phase}:`, error)
      return false
    }
    if (nextState === undefined || nextState === null) {
      console.error(`[room ${this.room.id}] setPhase returned no state entering ${phase}`)
      return false
    }

    this.clearPhaseTimer()
    this.clearModuleTimers()

    this.room.phase = phase
    this.room.state = nextState

    // The deadline is part of authoritative state and rides in every snapshot,
    // so no later snapshot can wipe it.
    const ms = this.room.config.phaseMs[phase]
    if (ms !== undefined) this.armPhaseTimer(phase, ms)
    else this.phaseEndsAt = null

    this.broadcastSnapshot()

    // Side effects live only in onPhaseEnter.
    this.guarded(`onPhaseEnter(${phase})`,
      () => this.module.onPhaseEnter(this.room.state, phase, this.context()))
    this.persist()
    return true
  }

  /**
   * Best-effort durability: a failed write must never break a live game, so
   * it is logged and swallowed. Called only after state is committed.
   */
  private persist(): void {
    this.guarded('saving snapshot', () => this.repo.saveSnapshot({
      workspaceId: this.room.workspaceId,
      roomId: this.room.id,
      phase: this.room.phase,
      state: this.room.state,
      participants: this.store.participants(this.room).map(p => p.id),
      endsAt: this.phaseEndsAt,
    }))
  }

  private guarded(what: string, fn: () => void): void {
    try {
      fn()
    } catch (error) {
      console.error(`[room ${this.room.id}] error ${what}:`, error)
    }
  }

  private clearPhaseTimer(): void {
    if (this.phaseTimer) clearTimeout(this.phaseTimer)
    this.phaseTimer = null
  }

  private clearModuleTimers(): void {
    for (const t of this.moduleTimers) clearTimeout(t)
    this.moduleTimers.clear()
  }

  private context(): RoomContext {
    return {
      broadcast: message => this.broadcast(message),
      setTimer: (ms, fn) => {
        if (this.disposed) return
        const handle = setTimeout(() => {
          this.moduleTimers.delete(handle)
          this.guarded('module timer', fn)
        }, ms)
        this.moduleTimers.add(handle)
      },
      advancePhase: () => this.advancePhase(),
      hostLine: line => this.broadcast({ type: 'host', line }),
      saveResult: payload => this.repo.saveResult({
        workspaceId: this.room.workspaceId,
        roomId: this.room.id,
        gameId: this.room.gameId,
        payload,
      }),
    }
  }

  private allConnectedSubmitted(): boolean {
    const waiting = this.store.participants(this.room).filter(p => p.connected)
    // Nobody connected: stall and let the phase clock decide, so a blip for
    // everyone does not discard every unsubmitted carving.
    if (waiting.length === 0) return false
    const state = this.room.state as { pumpkins: Record<string, { submitted: boolean }> }
    return waiting.every(p => state.pumpkins[p.id]?.submitted === true)
  }

  private broadcast(message: ServerMessage): void {
    for (const id of this.room.players.keys()) {
      this.guarded(`sending to ${id}`, () => this.send(id, message))
    }
  }

  private broadcastSnapshot(): void {
    // Per recipient: one bad send or view must not starve the rest of the room.
    for (const id of this.room.players.keys()) {
      this.guarded(`sending snapshot to ${id}`, () => this.send(id, this.snapshotFor(id)))
    }
  }
}
