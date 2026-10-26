import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InMemoryRoomStore } from '../rooms/store.js'
import { EARLY_ADVANCE_MS, MAX_PHASE_HOPS, RoomRuntime } from '../rooms/runtime.js'
import { pumpkinModule } from '../games/pumpkin/index.js'
import { createDb } from '../db/client.js'
import { Repo } from '../db/repo.js'
import { asRoomCode, newId, type GameModule, type ServerMessage, type PlayerId } from '@tg/shared'

let store: InMemoryRoomStore
let repo: Repo
let sent: { to: PlayerId; message: ServerMessage }[]
let runtime: RoomRuntime
let ids: PlayerId[]

beforeEach(() => {
  vi.useFakeTimers()
  store = new InMemoryRoomStore()
  repo = new Repo(createDb(':memory:'))
  sent = []

  const ws = repo.ensureDefaultWorkspace()
  const room = store.create({
    workspaceId: ws, code: asRoomCode('AB2CD3'), gameId: 'pumpkin-carve',
  })
  // saveResult requires the room to exist in the DB under its workspace, so
  // adopt the persisted row's id (the store and repo each mint their own).
  room.id = repo.createRoom({ workspaceId: ws, code: room.code, gameId: room.gameId }).id
  ids = ['A', 'B', 'C'].map(n =>
    store.addPlayer(room, { displayName: n, token: newId() }).id)

  runtime = new RoomRuntime({
    room, store, repo, module: pumpkinModule,
    send: (to, message) => sent.push({ to, message }),
  })
})

afterEach(() => { runtime.dispose(); vi.useRealTimers() })

type Snap = Extract<ServerMessage, { type: 'snapshot' }>

const strokes = [{ tool: 'cut' as const, size: 0.1, points: [[0.5, 0.5]] as [number, number][] }]

describe('start', () => {
  it('enters the carving phase', () => {
    runtime.start()
    expect(runtime.phase).toBe('carving')
  })

  it('sends every player a snapshot', () => {
    runtime.start()
    const recipients = new Set(
      sent.filter(s => s.message.type === 'snapshot').map(s => s.to))
    for (const id of ids) expect(recipients).toContain(id)
  })

  it('carries the deadline in every snapshot of a timed phase', () => {
    runtime.start()
    const snaps = sent.filter(s => s.message.type === 'snapshot')
      .map(s => s.message as Snap)
    expect(snaps.length).toBe(ids.length)
    for (const snap of snaps) {
      expect(snap.endsAt).not.toBeNull()
      expect(snap.endsAt! - snap.serverNow).toBe(180_000)
    }
  })

  it('sends no separate timer message', () => {
    runtime.start()
    expect(sent.some(s => (s.message as { type: string }).type === 'timer')).toBe(false)
  })

  it('carries endsAt: null in a phase with no configured duration', () => {
    const room = store.all()[0]!
    room.config = { phaseMs: {} }
    runtime.start()
    const snap = runtime.snapshotFor(ids[0]!) as Snap
    expect(snap.endsAt).toBeNull()
  })

  it('keeps the ORIGINAL deadline in snapshots sent after a mid-phase action', () => {
    runtime.start()
    const original = (runtime.snapshotFor(ids[0]!) as Snap).endsAt!
    vi.advanceTimersByTime(10_000)
    sent.length = 0
    runtime.dispatch(ids[0]!, { type: 'SUBMIT', strokes })
    const snaps = sent.filter(s => s.message.type === 'snapshot').map(s => s.message as Snap)
    expect(snaps.length).toBe(ids.length)
    for (const snap of snaps) {
      expect(snap.endsAt).toBe(original)
      expect(snap.endsAt! - snap.serverNow).toBe(170_000)
    }
  })

  it('keeps the original deadline across connect and disconnect snapshots', () => {
    runtime.start()
    const original = (runtime.snapshotFor(ids[0]!) as Snap).endsAt!
    vi.advanceTimersByTime(5_000)
    runtime.onDisconnect(ids[2]!)
    runtime.onConnect(ids[2]!)
    expect((runtime.snapshotFor(ids[1]!) as Snap).endsAt).toBe(original)
  })

  it('sends a host line', () => {
    runtime.start()
    expect(sent.some(s => s.message.type === 'host')).toBe(true)
  })

  it('refuses to start twice', () => {
    runtime.start()
    expect(() => runtime.start()).toThrow(/already started/i)
  })
})

describe('phase advance', () => {
  it('moves to the first vote phase when the carve timer fires', () => {
    runtime.start()
    vi.advanceTimersByTime(180_000)
    expect(runtime.phase).toBe('vote-scariest')
  })

  it('walks all four award phases then lands on results', () => {
    runtime.start()
    vi.advanceTimersByTime(180_000)
    for (let i = 0; i < 4; i++) vi.advanceTimersByTime(15_000)
    expect(runtime.phase).toBe('results')
  })

  it('sets no timer on the terminal phase', () => {
    runtime.start()
    vi.advanceTimersByTime(180_000 + 4 * 15_000)
    expect(runtime.phase).toBe('results')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('persists a result when it reaches results', () => {
    const ws = repo.ensureDefaultWorkspace()
    runtime.start()
    vi.advanceTimersByTime(180_000 + 4 * 15_000)
    expect(repo.listResults(ws)).toHaveLength(1)
  })
})

describe('early exit', () => {
  it('ends carving as soon as every connected player has submitted', () => {
    runtime.start()
    for (const id of ids) runtime.dispatch(id, { type: 'SUBMIT', strokes })
    vi.advanceTimersByTime(EARLY_ADVANCE_MS)
    expect(runtime.phase).toBe('vote-scariest')
  })

  it('holds the screen for a beat, so the final count can land', () => {
    runtime.start()
    for (const id of ids) runtime.dispatch(id, { type: 'SUBMIT', strokes })
    vi.advanceTimersByTime(EARLY_ADVANCE_MS - 1)
    expect(runtime.phase).toBe('carving')
    // And the snapshot sent in that window says everyone is in.
    const snap = runtime.snapshotFor(ids[0]!) as Snap
    expect((snap.view as { submittedCount: number }).submittedCount).toBe(3)
    vi.advanceTimersByTime(1)
    expect(runtime.phase).toBe('vote-scariest')
  })

  it('does not wait on a disconnected player', () => {
    runtime.start()
    runtime.onDisconnect(ids[2]!)
    runtime.dispatch(ids[0]!, { type: 'SUBMIT', strokes })
    runtime.dispatch(ids[1]!, { type: 'SUBMIT', strokes })
    vi.advanceTimersByTime(EARLY_ADVANCE_MS)
    expect(runtime.phase).toBe('vote-scariest')
  })

  it('re-checks on disconnect when the last holdout leaves', () => {
    runtime.start()
    runtime.dispatch(ids[0]!, { type: 'SUBMIT', strokes })
    runtime.dispatch(ids[1]!, { type: 'SUBMIT', strokes })
    expect(runtime.phase).toBe('carving')
    runtime.onDisconnect(ids[2]!)
    vi.advanceTimersByTime(EARLY_ADVANCE_MS)
    expect(runtime.phase).toBe('vote-scariest')
  })

  it('keeps waiting while someone connected has not submitted', () => {
    runtime.start()
    runtime.dispatch(ids[0]!, { type: 'SUBMIT', strokes })
    vi.advanceTimersByTime(EARLY_ADVANCE_MS)
    expect(runtime.phase).toBe('carving')
  })

  // The point of the whole change: a vote between three people takes as long
  // as those three take, not the full fifteen seconds every single time.
  const voteSlot = (voter: PlayerId): number => {
    const snap = runtime.snapshotFor(voter) as Snap
    const view = snap.view as { gallery: { slot: number }[]; mySlot: number }
    return view.gallery.find(g => g.slot !== view.mySlot)!.slot
  }

  const reachVoting = () => {
    runtime.start()
    for (const id of ids) runtime.dispatch(id, { type: 'SUBMIT', strokes })
    vi.advanceTimersByTime(EARLY_ADVANCE_MS)
  }

  it('ends a vote as soon as everyone has voted', () => {
    reachVoting()
    expect(runtime.phase).toBe('vote-scariest')
    for (const id of ids) {
      runtime.dispatch(id, { type: 'VOTE', award: 'scariest', slot: voteSlot(id) })
    }
    vi.advanceTimersByTime(EARLY_ADVANCE_MS)
    expect(runtime.phase).toBe('vote-funniest')
  })

  it('keeps the vote open while anyone has not voted', () => {
    reachVoting()
    runtime.dispatch(ids[0]!, { type: 'VOTE', award: 'scariest', slot: voteSlot(ids[0]!) })
    runtime.dispatch(ids[1]!, { type: 'VOTE', award: 'scariest', slot: voteSlot(ids[1]!) })
    vi.advanceTimersByTime(EARLY_ADVANCE_MS)
    expect(runtime.phase).toBe('vote-scariest')
  })

  it('lets a voter change their mind without ending the phase twice', () => {
    reachVoting()
    for (const id of ids) {
      runtime.dispatch(id, { type: 'VOTE', award: 'scariest', slot: voteSlot(id) })
    }
    // A change of mind inside the beat must not queue a second advance, or the
    // room would skip the award after this one.
    runtime.dispatch(ids[0]!, { type: 'VOTE', award: 'scariest', slot: voteSlot(ids[0]!) })
    vi.advanceTimersByTime(EARLY_ADVANCE_MS)
    expect(runtime.phase).toBe('vote-funniest')
    vi.advanceTimersByTime(EARLY_ADVANCE_MS)
    expect(runtime.phase).toBe('vote-funniest')
  })

  it('runs the whole game on votes alone, never touching a phase clock', () => {
    reachVoting()
    for (const award of ['scariest', 'funniest', 'craft', 'cursed'] as const) {
      for (const id of ids) runtime.dispatch(id, { type: 'VOTE', award, slot: voteSlot(id) })
      vi.advanceTimersByTime(EARLY_ADVANCE_MS)
    }
    expect(runtime.phase).toBe('results')
  })

  // A refresh is a disconnect followed by a connect. If the beat fires blind,
  // the phase ends while the returning player is still mid-reload, and their
  // carving or their vote is simply dropped.
  it('calls off the beat when the last holdout comes back inside it', () => {
    runtime.start()
    runtime.dispatch(ids[0]!, { type: 'SUBMIT', strokes })
    runtime.dispatch(ids[1]!, { type: 'SUBMIT', strokes })
    runtime.onDisconnect(ids[2]!)
    vi.advanceTimersByTime(EARLY_ADVANCE_MS - 100)
    runtime.onConnect(ids[2]!)
    vi.advanceTimersByTime(400)
    expect(runtime.phase).toBe('carving')
    // and they can still finish the pumpkin they came back for
    runtime.dispatch(ids[2]!, { type: 'SUBMIT', strokes })
    vi.advanceTimersByTime(EARLY_ADVANCE_MS)
    expect(runtime.phase).toBe('vote-scariest')
  })

  it('does not decide an award while the missing voter is reconnecting', () => {
    reachVoting()
    runtime.dispatch(ids[0]!, { type: 'VOTE', award: 'scariest', slot: voteSlot(ids[0]!) })
    runtime.dispatch(ids[1]!, { type: 'VOTE', award: 'scariest', slot: voteSlot(ids[1]!) })
    runtime.onDisconnect(ids[2]!)
    vi.advanceTimersByTime(EARLY_ADVANCE_MS - 100)
    runtime.onConnect(ids[2]!)
    vi.advanceTimersByTime(400)
    expect(runtime.phase).toBe('vote-scariest')
  })

  it('moves on when someone returns to a phase that is already finished', () => {
    reachVoting()
    for (const id of ids) {
      runtime.dispatch(id, { type: 'VOTE', award: 'scariest', slot: voteSlot(id) })
    }
    runtime.onDisconnect(ids[2]!)      // cancels nothing: everyone has voted
    vi.advanceTimersByTime(EARLY_ADVANCE_MS)
    expect(runtime.phase).toBe('vote-funniest')
  })

  // The bar on screen says "n of m votes in". If m counted players the phase
  // will never wait for, it could never reach m — and the client would go on
  // offering "changed your mind?" as the phase cut underneath it.
  it('counts the vote against who is still here', () => {
    reachVoting()
    runtime.onDisconnect(ids[2]!)
    const progress = (of: PlayerId) => {
      const view = (runtime.snapshotFor(of) as Snap).view as
        { votedCount: number; totalVoters: number }
      return [view.votedCount, view.totalVoters]
    }
    expect(progress(ids[0]!)).toEqual([0, 2])
    runtime.dispatch(ids[0]!, { type: 'VOTE', award: 'scariest', slot: voteSlot(ids[0]!) })
    expect(progress(ids[0]!)).toEqual([1, 2])
    runtime.dispatch(ids[1]!, { type: 'VOTE', award: 'scariest', slot: voteSlot(ids[1]!) })
    expect(progress(ids[0]!)).toEqual([2, 2])    // reachable, and the phase now ends
    vi.advanceTimersByTime(EARLY_ADVANCE_MS)
    expect(runtime.phase).toBe('vote-funniest')
  })

  it('leaves the early clock behind when the phase ends on its own first', () => {
    reachVoting()
    runtime.dispatch(ids[0]!, { type: 'VOTE', award: 'scariest', slot: voteSlot(ids[0]!) })
    vi.advanceTimersByTime(15_000)            // the vote clock runs out
    expect(runtime.phase).toBe('vote-funniest')
    const before = runtime.phase
    vi.advanceTimersByTime(EARLY_ADVANCE_MS)  // no stale beat from the last phase
    expect(runtime.phase).toBe(before)
  })
})

describe('dispatch', () => {
  it('ignores a malformed action without throwing', () => {
    runtime.start()
    expect(() => runtime.dispatch(ids[0]!, { type: 'NONSENSE' })).not.toThrow()
    expect(() => runtime.dispatch(ids[0]!, null)).not.toThrow()
    expect(runtime.phase).toBe('carving')
  })

  it('attributes the action to the authenticated player, not the payload', () => {
    runtime.start()
    runtime.dispatch(ids[0]!, { type: 'SUBMIT', strokes, by: ids[1]! })
    const snap = runtime.snapshotFor(ids[1]!) as Extract<ServerMessage, { type: 'snapshot' }>
    expect((snap.view as { submitted: boolean }).submitted).toBe(false)
    const actor = runtime.snapshotFor(ids[0]!) as Snap
    expect((actor.view as { submitted: boolean }).submitted).toBe(true)
  })

  it('saves a DRAFT without broadcasting anything', () => {
    runtime.start()
    sent.length = 0
    runtime.dispatch(ids[0]!, { type: 'DRAFT', strokes })
    expect(sent).toHaveLength(0)
    const snap = runtime.snapshotFor(ids[0]!) as Extract<ServerMessage, { type: 'snapshot' }>
    expect((snap.view as { myStrokes: unknown[] }).myStrokes).toHaveLength(1)
  })
})

describe('snapshotFor', () => {
  it('includes disambiguated player labels', () => {
    const room = store.all()[0]!
    runtime.start()
    const dup = store.addPlayer(room, { displayName: 'A', token: newId() })
    const snap = runtime.snapshotFor(ids[0]!) as Extract<ServerMessage, { type: 'snapshot' }>
    expect(Object.values(snap.labels)).toContain('A (2)')
    expect(dup.spectator).toBe(true)
  })

  it('names the current host', () => {
    runtime.start()
    const snap = runtime.snapshotFor(ids[0]!) as Extract<ServerMessage, { type: 'snapshot' }>
    expect(snap.hostId).toBe(ids[0]!)
  })

  it('does not leak carver identities before results', () => {
    runtime.start()
    vi.advanceTimersByTime(180_000)
    const snap = runtime.snapshotFor(ids[0]!) as Extract<ServerMessage, { type: 'snapshot' }>
    expect(snap.view).not.toHaveProperty('carvers')
    expect(JSON.stringify(snap.view)).not.toContain(ids[1]!)
  })

  it('gives a late joiner no slot', () => {
    const room = store.all()[0]!
    runtime.start()
    const late = store.addPlayer(room, { displayName: 'Late', token: newId() })
    const snap = runtime.snapshotFor(late.id) as Extract<ServerMessage, { type: 'snapshot' }>
    expect((snap.view as { kind: string }).kind).toBe('spectator')
  })
})

describe('failure handling', () => {
  it('logs a reducer that throws, with room, player and action type', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const bad: GameModule<any, any, any> = { // eslint-disable-line @typescript-eslint/no-explicit-any
      ...pumpkinModule,
      reduce: () => { throw new Error('boom') },
    }
    const room = store.all()[0]!
    const r = new RoomRuntime({ room, store, repo, module: bad, send: () => {} })
    r.start()
    expect(() => r.dispatch(ids[0]!, { type: 'SUBMIT', strokes })).not.toThrow()
    const logged = err.mock.calls.flat().map(String).join(' ')
    expect(logged).toContain(room.id)
    expect(logged).toContain(ids[0]!)
    expect(logged).toContain('SUBMIT')
    r.dispose()
    err.mockRestore()
  })

  it('does not advance when setPhase returns nothing', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    runtime.start()
    const room = store.all()[0]!
    const bad: GameModule<any, any, any> = { // eslint-disable-line @typescript-eslint/no-explicit-any
      ...pumpkinModule,
      setPhase: () => undefined as never,
    }
    const r = new RoomRuntime({ room, store, repo, module: bad, send: () => {} })
    ;(r as unknown as { started: boolean }).started = true
    expect(() => r.advancePhase()).not.toThrow()
    expect(room.phase).toBe('carving')
    expect(room.state).not.toBeUndefined()
    r.dispose()
    err.mockRestore()
  })

  it('does not let a throwing timer callback escape', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    runtime.start()
    store.all()[0]!.id = newId() as never       // saveResult will throw
    expect(() => vi.advanceTimersByTime(180_000 + 4 * 15_000)).not.toThrow()
    expect(runtime.phase).toBe('results')
    err.mockRestore()
  })

  it('one failing recipient does not starve the rest of the room', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const got: PlayerId[] = []
    const room = store.all()[0]!
    const r = new RoomRuntime({
      room, store, repo, module: pumpkinModule,
      send: (to, m) => {
        if (to === ids[0]) throw new Error('socket closed')
        if (m.type === 'snapshot') got.push(to)
      },
    })
    r.start()
    expect(got).toContain(ids[1]!)
    expect(got).toContain(ids[2]!)
    r.dispose()
    err.mockRestore()
  })
})

describe('timer lifecycle', () => {
  it('a module setTimer in onPhaseEnter does not cancel the phase timer', () => {
    const fired = vi.fn()
    const mod: GameModule<any, any, any> = { // eslint-disable-line @typescript-eslint/no-explicit-any
      ...pumpkinModule,
      onPhaseEnter(state, phase, ctx) {
        if (phase === 'carving') ctx.setTimer(1_000, fired)
      },
    }
    const room = store.all()[0]!
    const r = new RoomRuntime({ room, store, repo, module: mod, send: () => {} })
    r.start()
    vi.advanceTimersByTime(1_000)
    expect(fired).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(179_000)
    expect(r.phase).toBe('vote-scariest')
    r.dispose()
  })

  it('dispose clears the phase timer and any module timers', () => {
    const mod: GameModule<any, any, any> = { // eslint-disable-line @typescript-eslint/no-explicit-any
      ...pumpkinModule,
      onPhaseEnter(state, phase, ctx) { ctx.setTimer(1_000, () => {}) },
    }
    const room = store.all()[0]!
    const r = new RoomRuntime({ room, store, repo, module: mod, send: () => {} })
    r.start()
    r.dispose()
    runtime.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('dispatch and advancePhase are no-ops after dispose', () => {
    runtime.start()
    runtime.dispose()
    runtime.dispatch(ids[0]!, { type: 'SUBMIT', strokes })
    runtime.advancePhase()
    expect(runtime.phase).toBe('carving')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('advancePhase before start does nothing', () => {
    runtime.advancePhase()
    expect(runtime.phase).toBe('lobby')
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('everyone disconnected', () => {
  it('stalls rather than racing through the phases', () => {
    runtime.start()
    for (const id of ids) runtime.onDisconnect(id)
    expect(runtime.phase).toBe('carving')
    expect(repo.listResults(repo.ensureDefaultWorkspace())).toHaveLength(0)
  })

  it('lets the phase clock decide once nobody is connected', () => {
    runtime.start()
    for (const id of ids) runtime.onDisconnect(id)
    vi.advanceTimersByTime(180_000)
    expect(runtime.phase).toBe('vote-scariest')
  })
})

describe('start failure', () => {
  it('can be retried after createState throws', () => {
    let calls = 0
    const mod: GameModule<any, any, any> = { // eslint-disable-line @typescript-eslint/no-explicit-any
      ...pumpkinModule,
      createState: (p, seed) => {
        if (calls++ === 0) throw new Error('boom')
        return pumpkinModule.createState(p, seed)
      },
    }
    const room = store.all()[0]!
    const r = new RoomRuntime({ room, store, repo, module: mod, send: () => {} })
    expect(() => r.start()).toThrow(/boom/)
    expect(() => r.start()).not.toThrow()
    expect(r.phase).toBe('carving')
    r.dispose()
  })
})

describe('phase failure', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const failingOn = (bad: (phase: string) => boolean): GameModule<any, any, any> => ({
    ...pumpkinModule,
    setPhase: (state, phase) => {
      if (bad(phase)) throw new Error('boom')
      return pumpkinModule.setPhase(state, phase)
    },
  })

  it('start() throws when the first phase fails, and can be retried', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    let fail = true
    const room = store.all()[0]!
    const r = new RoomRuntime({
      room, store, repo, send: () => {},
      module: failingOn(() => { const f = fail; fail = false; return f }),
    })
    expect(() => r.start()).toThrow()
    expect(room.phase).toBe('lobby')
    expect(vi.getTimerCount()).toBe(0)
    expect(() => r.start()).not.toThrow()
    expect(r.phase).toBe('carving')
    r.dispose()
    err.mockRestore()
  })

  it('start() rolls back when setRoomStatus throws', () => {
    const room = store.all()[0]!
    const spy = vi.spyOn(repo, 'setRoomStatus').mockImplementationOnce(() => { throw new Error('db') })
    const r = new RoomRuntime({ room, store, repo, module: pumpkinModule, send: () => {} })
    expect(() => r.start()).toThrow(/db/)
    expect(() => r.start()).not.toThrow()
    r.dispose()
    spy.mockRestore()
  })

  it('ends the room visibly when a timer-fired advance cannot enter the next phase', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const room = store.all()[0]!
    const r = new RoomRuntime({
      room, store, repo, module: failingOn(p => p === 'vote-scariest'),
      send: (to, message) => sent.push({ to, message }),
    })
    r.start()
    sent.length = 0
    vi.advanceTimersByTime(180_000)
    const errors = sent.filter(s => s.message.type === 'error')
    expect(errors).toHaveLength(ids.length)
    expect((errors[0]!.message as { code: string }).code).toBe('PHASE_FAILED')
    expect(r.phase).toBe('results')
    expect(vi.getTimerCount()).toBe(0)
    r.dispose()
    err.mockRestore()
  })

  it('keeps the pending timer when an early advance fails', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const room = store.all()[0]!
    const r = new RoomRuntime({
      room, store, repo, module: failingOn(p => p === 'vote-scariest'), send: () => {},
    })
    r.start()
    for (const id of ids) r.dispatch(id, { type: 'SUBMIT', strokes })
    vi.advanceTimersByTime(EARLY_ADVANCE_MS)
    expect(r.phase).toBe('carving')
    expect(vi.getTimerCount()).toBe(1)
    r.dispose()
    err.mockRestore()
  })
})

describe('disposed and logging hygiene', () => {
  it('start() after dispose throws', () => {
    runtime.dispose()
    expect(() => runtime.start()).toThrow(/disposed/i)
  })

  it('a module cannot arm a timer after dispose', () => {
    let ctx: Parameters<GameModule<unknown, unknown, unknown>['onPhaseEnter']>[2] | null = null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: GameModule<any, any, any> = {
      ...pumpkinModule,
      onPhaseEnter(state, phase, c) { ctx = c },
    }
    const room = store.all()[0]!
    const r = new RoomRuntime({ room, store, repo, module: mod, send: () => {} })
    r.start()
    r.dispose()
    ctx!.setTimer(1_000, () => {})
    expect(vi.getTimerCount()).toBe(0)
  })

  it('truncates and de-newlines a client-controlled action type in logs', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bad: GameModule<any, any, any> = { ...pumpkinModule, reduce: () => { throw new Error('x') } }
    const room = store.all()[0]!
    const r = new RoomRuntime({ room, store, repo, module: bad, send: () => {} })
    r.start()
    r.dispatch(ids[0]!, { type: 'A\nFAKE LOG LINE ' + 'y'.repeat(500) })
    const line = String(err.mock.calls[0]![0])
    expect(line).not.toContain('\n')
    expect(line).not.toContain('y'.repeat(20))
    r.dispose()
    err.mockRestore()
  })
})

describe('nextPhase', () => {
  type StubState = { phase: string }

  /**
   * A module with its own tiny phase list. `phaseMs` has no entry for these
   * names, so no phase clock arms and every transition here is driven by an
   * explicit advancePhase() — which is what makes the hop-budget test fast.
   */
  function stub(overrides: Partial<GameModule<StubState, unknown, unknown>> = {}) {
    return {
      ...pumpkinModule,
      phases: ['lobby', 'a', 'b', 'c'],
      createState: () => ({ phase: 'lobby' }),
      setPhase: (state: StubState, phase: string) => ({ ...state, phase }),
      viewFor: (state: StubState) => ({ kind: 'stub', phase: state.phase }),
      onPhaseEnter: () => {},
      ...overrides,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as unknown as GameModule<any, any, any>
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function runWith(module: GameModule<any, any, any>) {
    const room = store.all()[0]!
    const r = new RoomRuntime({
      room, store, repo, module,
      send: (to, message) => sent.push({ to, message }),
    })
    return r
  }

  it('a module without nextPhase advances by index', () => {
    const r = runWith(stub())
    r.start()
    expect(r.phase).toBe('a')
    r.advancePhase()
    expect(r.phase).toBe('b')
    r.dispose()
  })

  it('nextPhase can return an earlier phase, so a loop is possible', () => {
    const r = runWith(stub({
      nextPhase: (_state, current) => (current === 'b' ? 'a' : 'b'),
    }))
    r.start()
    expect(r.phase).toBe('a')
    r.advancePhase()
    expect(r.phase).toBe('b')
    r.advancePhase()
    expect(r.phase).toBe('a')      // an index walk could never get back here
    r.dispose()
  })

  it('nextPhase returning null leaves the room in its current phase', () => {
    const r = runWith(stub({ nextPhase: () => null }))
    r.start()
    expect(r.phase).toBe('a')
    r.advancePhase()
    expect(r.phase).toBe('a')
    r.dispose()
  })

  it('nextPhase returning an unknown phase fails the room with PHASE_FAILED', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = runWith(stub({ nextPhase: () => 'not-a-phase' }))
    r.start()
    sent.length = 0
    r.advancePhase()
    const codes = sent
      .filter(s => s.message.type === 'error')
      .map(s => (s.message as { code: string }).code)
    expect(codes).toContain('PHASE_FAILED')
    expect(r.phase).toBe('c')      // the terminal phase, not the bad name
    r.dispose()
    err.mockRestore()
  })

  it('a nextPhase that returns its own phase stops at MAX_PHASE_HOPS and fails the room', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = runWith(stub({ nextPhase: (_state, current) => current }))
    r.start()
    for (let i = 0; i < MAX_PHASE_HOPS + 5; i++) r.advancePhase()
    const codes = sent
      .filter(s => s.message.type === 'error')
      .map(s => (s.message as { code: string }).code)
    expect(codes).toContain('PHASE_FAILED')
    expect(r.phase).toBe('c')
    r.dispose()
    err.mockRestore()
  })
})

describe('hostActions', () => {
  /** Records every (by, action.type) pair the reducer actually sees. */
  function spying(hostActions?: readonly string[]) {
    const seen: { by: PlayerId; type: string }[] = []
    const module = {
      ...pumpkinModule,
      ...(hostActions ? { hostActions } : {}),
      reduce: (state: unknown, action: { type: string }, by: PlayerId) => {
        seen.push({ by, type: action.type })
        return state
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as unknown as GameModule<any, any, any>
    return { seen, module }
  }

  it('an action in hostActions from a non-host never reaches reduce', () => {
    const { seen, module } = spying(['SKIP'])
    const room = store.all()[0]!
    const r = new RoomRuntime({ room, store, repo, module, send: () => {} })
    r.start()
    const notHost = ids.find(id => id !== room.hostId)!
    r.dispatch(notHost, { type: 'SKIP' })
    expect(seen).toEqual([])
    r.dispose()
  })

  it('an action in hostActions from the host reaches reduce', () => {
    const { seen, module } = spying(['SKIP'])
    const room = store.all()[0]!
    const r = new RoomRuntime({ room, store, repo, module, send: () => {} })
    r.start()
    r.dispatch(room.hostId!, { type: 'SKIP' })
    expect(seen.map(s => s.type)).toEqual(['SKIP'])
    r.dispose()
  })

  it('an action not in hostActions is ungated', () => {
    const { seen, module } = spying(['SKIP'])
    const room = store.all()[0]!
    const r = new RoomRuntime({ room, store, repo, module, send: () => {} })
    r.start()
    const notHost = ids.find(id => id !== room.hostId)!
    r.dispatch(notHost, { type: 'BUZZ' })
    expect(seen.map(s => s.type)).toEqual(['BUZZ'])
    r.dispose()
  })

  it('after host reassignment the new host can dispatch a host action', () => {
    const { seen, module } = spying(['SKIP'])
    const room = store.all()[0]!
    const r = new RoomRuntime({ room, store, repo, module, send: () => {} })
    r.start()
    const firstHost = room.hostId!
    r.onDisconnect(firstHost)                 // host moves to the next connected player
    const newHost = room.hostId!
    expect(newHost).not.toBe(firstHost)
    r.dispatch(newHost, { type: 'SKIP' })
    expect(seen.map(s => s.type)).toEqual(['SKIP'])
    r.dispose()
  })

  it('the former host loses the privilege when the host moves', () => {
    const { seen, module } = spying(['SKIP'])
    const room = store.all()[0]!
    const r = new RoomRuntime({ room, store, repo, module, send: () => {} })
    r.start()
    const firstHost = room.hostId!
    r.onDisconnect(firstHost)
    r.onConnect(firstHost)                    // back, but no longer host
    expect(room.hostId).not.toBe(firstHost)
    r.dispatch(firstHost, { type: 'SKIP' })
    expect(seen).toEqual([])
    r.dispose()
  })

  it('a module with no hostActions gates nothing', () => {
    const { seen, module } = spying()
    const room = store.all()[0]!
    const r = new RoomRuntime({ room, store, repo, module, send: () => {} })
    r.start()
    const notHost = ids.find(id => id !== room.hostId)!
    r.dispatch(notHost, { type: 'SKIP' })
    expect(seen.map(s => s.type)).toEqual(['SKIP'])
    r.dispose()
  })
})
