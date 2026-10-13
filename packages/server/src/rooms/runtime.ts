import {
  labelPlayers,
  type GameModule, type PlayerId, type RoomContext, type ServerMessage,
} from '@tg/shared'
import type { Repo } from '../db/repo.js'
import type { LiveRoom, RoomStore } from './store.js'

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

  start(): void {
    if (this.started) throw new Error('Room already started')

    // Participants, never room.players: spectators who joined after the game
    // started must not receive a pumpkin or a gallery slot.
    const participants = this.store.participants(this.room)
    // Build state before flipping `started`, so a throw here leaves the
    // runtime retryable instead of wedged on "already started".
    const state = this.module.createState(participants, this.room.seed)
    if (state === undefined || state === null) throw new Error('createState returned no state')
    this.room.state = state
    this.started = true
    this.repo.setRoomStatus(this.room.workspaceId, this.room.id, 'playing')
    this.enterPhase(this.module.phases[1]!)      // phases[0] is 'lobby'
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
        `[room ${this.room.id}] reduce threw for player ${by}, action ${action.type}:`, error)
      return
    }
    if (next === undefined || next === null) return
    this.room.state = next

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
    if (this.disposed || !this.started) return
    const index = this.module.phases.indexOf(this.room.phase)
    const next = this.module.phases[index + 1]
    if (!next) return
    this.enterPhase(next)
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
      view: this.room.state === null
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

  private enterPhase(phase: string): void {
    // Validate before committing anything, so a bad setPhase cannot leave the
    // room half-transitioned with state that viewFor would choke on.
    let nextState: unknown
    try {
      nextState = this.module.setPhase(this.room.state, phase)
    } catch (error) {
      console.error(`[room ${this.room.id}] setPhase threw entering ${phase}:`, error)
      return
    }
    if (nextState === undefined || nextState === null) {
      console.error(`[room ${this.room.id}] setPhase returned no state entering ${phase}`)
      return
    }

    this.clearPhaseTimer()
    this.clearModuleTimers()

    this.room.phase = phase
    this.room.state = nextState

    // The deadline is part of authoritative state and rides in every snapshot,
    // so no later snapshot can wipe it.
    const ms = this.room.config.phaseMs[phase]
    if (ms !== undefined) {
      this.phaseEndsAt = Date.now() + ms
      this.phaseTimer = setTimeout(() => {
        this.phaseTimer = null
        this.guarded(`advancing past ${phase}`, () => this.advancePhase())
      }, ms)
    } else {
      this.phaseEndsAt = null
    }

    this.broadcastSnapshot()

    // Side effects live only in onPhaseEnter.
    this.guarded(`onPhaseEnter(${phase})`,
      () => this.module.onPhaseEnter(this.room.state, phase, this.context()))
    // (saveSnapshot will be called here once persistence lands.)
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
