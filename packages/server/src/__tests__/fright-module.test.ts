import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { InMemoryRoomStore } from '../rooms/store.js'
import { RoomRuntime } from '../rooms/runtime.js'
import { frightNightDev } from '../games/fright/index.js'
import { GAMES, getGame } from '../games/registry.js'
import { createDb } from '../db/client.js'
import { Repo } from '../db/repo.js'
import { asRoomCode, newId, type PlayerId, type ServerMessage } from '@tg/shared'
import type { FrightState } from '@tg/shared'

let store: InMemoryRoomStore
let repo: Repo
let runtime: RoomRuntime
let sent: { to: PlayerId; message: ServerMessage }[]
let blue: PlayerId[]
let red: PlayerId[]

beforeEach(() => {
  vi.useFakeTimers()
  store = new InMemoryRoomStore()
  repo = new Repo(createDb(':memory:'))
  sent = []

  const ws = repo.ensureDefaultWorkspace()
  const room = store.create({
    workspaceId: ws, code: asRoomCode('AB2CD3'), gameId: 'fright-night-dev',
  })
  room.id = repo.createRoom({ workspaceId: ws, code: room.code, gameId: room.gameId }).id

  blue = []
  red = []
  for (const [name, team] of [['A', 'blue'], ['B', 'blue'], ['C', 'red']] as const) {
    const p = store.addPlayer(room, { displayName: name, token: newId() })
    store.setProfile(room, p.id, { team })
    ;(team === 'blue' ? blue : red).push(p.id)
  }

  runtime = new RoomRuntime({
    room, store, repo, module: frightNightDev,
    send: (to, message) => sent.push({ to, message }),
  })
})

afterEach(() => { runtime.dispose(); vi.useRealTimers() })

const state = () => store.all()[0]!.state as FrightState
const activeClue = () => state().clues[state().active!]!

describe('registration', () => {
  it('declares both teams, host actions and a thumbnail', () => {
    expect(frightNightDev.teams?.map(t => t.id)).toEqual(['blue', 'red'])
    expect(frightNightDev.hostActions).toEqual(['SKIP', 'END'])
    expect(frightNightDev.thumbnail).toMatch(/^\/games\//)
  })

  it('the dev module is hidden and says so in its name', () => {
    expect(frightNightDev.hidden).toBe(true)
    expect(frightNightDev.name).toMatch(/dev/i)
  })

  it('is reachable by id even though it is hidden', () => {
    expect(getGame('fright-night-dev')).toBe(frightNightDev)
  })

  it('at least one registered game is hidden, so the picker filter is exercised', () => {
    expect(GAMES.some(g => g.hidden)).toBe(true)
  })
})

describe('a game over the dev pack', () => {
  it('starts on the board with control on one of the two teams', () => {
    runtime.start()
    expect(runtime.phase).toBe('board')
    expect(['blue', 'red']).toContain(state().control)
  })

  it('freezes the roster, so spectators are not on a team', () => {
    runtime.start()
    expect(Object.keys(state().teams)).toHaveLength(3)
  })

  /** Drive one clue end to end and return who scored. */
  function playOneClue(correctly: boolean) {
    runtime.start()
    const control = state().control
    const picker = (control === 'blue' ? blue : red)[0]!
    const tile = state().tiles.find(t => !t.spent)!
    runtime.dispatch(picker, { type: 'PICK', categoryId: tile.categoryId, value: tile.value })
    vi.advanceTimersByTime(800)                 // the early-advance beat
    expect(runtime.phase).toBe('reading')

    vi.advanceTimersByTime(6_000)
    expect(runtime.phase).toBe('clue')

    runtime.dispatch(picker, { type: 'BUZZ' })
    vi.advanceTimersByTime(800)
    expect(runtime.phase).toBe('answer')

    const clue = activeClue()
    const index = correctly
      ? clue.correct
      : clue.order.findIndex((_, i) => i !== clue.correct)
    runtime.dispatch(picker, { type: 'CHOOSE', index })
    vi.advanceTimersByTime(800)
    return { control, tileValue: tile.value }
  }

  it('a correct answer scores the tile value and reveals', () => {
    const { control, tileValue } = playOneClue(true)
    expect(runtime.phase).toBe('reveal')
    expect(state().scores[control]).toBe(tileValue)
  })

  it('a wrong answer opens the steal for the other team', () => {
    playOneClue(false)
    expect(runtime.phase).toBe('steal')
    expect(state().scores).toEqual({ blue: 0, red: 0 })
  })

  it('a buzz during reading is ignored by the real runtime too', () => {
    runtime.start()
    const picker = (state().control === 'blue' ? blue : red)[0]!
    const tile = state().tiles.find(t => !t.spent)!
    runtime.dispatch(picker, { type: 'PICK', categoryId: tile.categoryId, value: tile.value })
    vi.advanceTimersByTime(800)
    expect(runtime.phase).toBe('reading')
    runtime.dispatch(picker, { type: 'BUZZ' })
    expect(activeClue().buzzedBy).toBeNull()
  })

  it('the board clock running out auto-picks rather than stalling', () => {
    runtime.start()
    vi.advanceTimersByTime(30_000 + 100)
    expect(runtime.phase).toBe('reading')
    expect(state().active).not.toBeNull()
  })

  it('reaches results once every tile is spent', () => {
    runtime.start()
    const host = store.all()[0]!.hostId!
    runtime.dispatch(host, { type: 'END' })
    // END spends every tile; the board then has nothing to open.
    vi.advanceTimersByTime(30_000 + 100)
    expect(runtime.phase).toBe('results')
  })

  it('saves a result payload with the scores when it reaches results', () => {
    runtime.start()
    const host = store.all()[0]!.hostId!
    runtime.dispatch(host, { type: 'END' })
    vi.advanceTimersByTime(30_000 + 100)
    const saved = repo.listResults(store.all()[0]!.workspaceId)
    expect(saved).toHaveLength(1)
    expect(saved[0]!.payload).toMatchObject({ scores: { blue: 0, red: 0 } })
  })
})

describe('host-only actions through the runtime', () => {
  it('a non-host cannot SKIP', () => {
    runtime.start()
    const room = store.all()[0]!
    const notHost = [...blue, ...red].find(id => id !== room.hostId)!
    const picker = (state().control === 'blue' ? blue : red)[0]!
    const tile = state().tiles.find(t => !t.spent)!
    runtime.dispatch(picker, { type: 'PICK', categoryId: tile.categoryId, value: tile.value })
    vi.advanceTimersByTime(800)
    runtime.dispatch(notHost, { type: 'SKIP' })
    expect(activeClue().spentTeams).toEqual([])
  })

  it('the host can SKIP', () => {
    runtime.start()
    const room = store.all()[0]!
    const picker = (state().control === 'blue' ? blue : red)[0]!
    const tile = state().tiles.find(t => !t.spent)!
    runtime.dispatch(picker, { type: 'PICK', categoryId: tile.categoryId, value: tile.value })
    vi.advanceTimersByTime(800)
    runtime.dispatch(room.hostId!, { type: 'SKIP' })
    expect(activeClue().spentTeams.sort()).toEqual(['blue', 'red'])
  })
})

describe('what reaches a client', () => {
  it('no snapshot before the reveal carries the correct index', () => {
    runtime.start()
    const picker = (state().control === 'blue' ? blue : red)[0]!
    const tile = state().tiles.find(t => !t.spent)!
    runtime.dispatch(picker, { type: 'PICK', categoryId: tile.categoryId, value: tile.value })
    vi.advanceTimersByTime(800)
    vi.advanceTimersByTime(6_000)
    runtime.dispatch(picker, { type: 'BUZZ' })
    vi.advanceTimersByTime(800)

    const views = sent
      .filter(s => s.message.type === 'snapshot')
      .map(s => s.message as Extract<ServerMessage, { type: 'snapshot' }>)
      .filter(m => m.phase !== 'reveal' && m.phase !== 'results')
    expect(views.length).toBeGreaterThan(0)
    for (const snapshot of views) {
      expect(JSON.stringify(snapshot.view)).not.toContain('"correct"')
    }
  })

  it('every snapshot carries the declared teams, so the lobby can render them', () => {
    runtime.start()
    const snapshot = sent
      .map(s => s.message)
      .find(m => m.type === 'snapshot') as Extract<ServerMessage, { type: 'snapshot' }>
    expect(snapshot.teams?.map(t => t.id)).toEqual(['blue', 'red'])
  })
})
