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
  private timer: ReturnType<typeof setTimeout> | null = null
  private started = false

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
    this.started = true

    // Participants, never room.players: spectators who joined after the game
    // started must not receive a pumpkin or a gallery slot.
    const participants = this.store.participants(this.room)
    this.room.state = this.module.createState(participants, this.room.seed)
    this.repo.setRoomStatus(this.room.workspaceId, this.room.id, 'playing')
    this.enterPhase(this.module.phases[1]!)      // phases[0] is 'lobby'
  }

  dispatch(by: PlayerId, action: unknown): void {
    if (!this.started || action === null || typeof action !== 'object') return
    if (!('type' in action) || typeof action.type !== 'string') return
    if (!this.room.players.has(by)) return

    // `by` comes from the authenticated socket. Any `by` in the payload is ignored.
    // A module's reducer may not recognise the action (or choke on its shape);
    // either way the state must survive untouched.
    let next: unknown
    try {
      next = this.module.reduce(this.room.state, action, by)
    } catch {
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
      // Branded PlayerId keys are not assignable to string keys; cast here only.
      labels: labelPlayers(players) as Record<string, string>,
      hostId: this.room.hostId,
    }
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private enterPhase(phase: string): void {
    this.clearTimer()

    this.room.phase = phase
    this.room.state = this.module.setPhase(this.room.state, phase)

    // Snapshot first, then timer: the client clears its stored deadline
    // whenever a snapshot arrives, so the other order would wipe it.
    this.broadcastSnapshot()

    const ms = this.room.config.phaseMs[phase]
    if (ms !== undefined) {
      const now = Date.now()
      this.broadcast({ type: 'timer', endsAt: now + ms, serverNow: now })
      this.timer = setTimeout(() => this.advancePhase(), ms)
    }

    // Side effects live only in onPhaseEnter.
    this.module.onPhaseEnter(this.room.state, phase, this.context())
    // (saveSnapshot will be called here once persistence lands.)
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private context(): RoomContext {
    return {
      broadcast: message => this.broadcast(message),
      setTimer: (ms, fn) => { this.clearTimer(); this.timer = setTimeout(fn, ms) },
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
    if (waiting.length === 0) return true
    const state = this.room.state as { pumpkins: Record<string, { submitted: boolean }> }
    return waiting.every(p => state.pumpkins[p.id]?.submitted === true)
  }

  private broadcast(message: ServerMessage): void {
    for (const id of this.room.players.keys()) this.send(id, message)
  }

  private broadcastSnapshot(): void {
    for (const id of this.room.players.keys()) this.send(id, this.snapshotFor(id))
  }
}
