import { beforeEach, describe, expect, it } from 'vitest'
import { InMemoryRoomStore } from '../rooms/store.js'
import { asRoomCode, asWorkspaceId, newId } from '@tg/shared'

const WS_A = asWorkspaceId('ws-a')
const WS_B = asWorkspaceId('ws-b')
let store: InMemoryRoomStore

beforeEach(() => { store = new InMemoryRoomStore() })

const make = (ws = WS_A, code = 'AB2CD3') =>
  store.create({ workspaceId: ws, code: asRoomCode(code), gameId: 'pumpkin-carve' })

describe('create and get', () => {
  it('starts a room in the lobby phase with no players', () => {
    const room = make()
    expect(room.phase).toBe('lobby')
    expect(room.players.size).toBe(0)
    expect(room.hostId).toBeNull()
  })

  it('finds a room by code', () => {
    const room = make()
    expect(store.byCode(asRoomCode('AB2CD3'))?.id).toBe(room.id)
  })

  it('does not return a room to the wrong workspace', () => {
    const room = make(WS_A)
    expect(store.get(WS_A, room.id)).not.toBeNull()
    expect(store.get(WS_B, room.id)).toBeNull()
  })
})

describe('players', () => {
  it('makes the first joiner the host', () => {
    const room = make()
    const first = store.addPlayer(room, { displayName: 'Jocelyn', token: newId() })
    store.addPlayer(room, { displayName: 'Sam', token: newId() })
    expect(room.hostId).toBe(first.id)
  })

  it('marks a player joining after carving starts as a spectator', () => {
    const room = make()
    store.addPlayer(room, { displayName: 'Early', token: newId() })
    room.phase = 'carving'
    const late = store.addPlayer(room, { displayName: 'Late', token: newId() })
    expect(late.spectator).toBe(true)
  })

  it('does not mark a lobby joiner as a spectator', () => {
    const room = make()
    const early = store.addPlayer(room, { displayName: 'Early', token: newId() })
    expect(early.spectator).toBe(false)
  })

  it('transfers the host to the longest-connected player when the host drops', () => {
    const room = make()
    const first = store.addPlayer(room, { displayName: 'A', token: newId() })
    const second = store.addPlayer(room, { displayName: 'B', token: newId() })
    store.addPlayer(room, { displayName: 'C', token: newId() })
    store.setConnected(room, first.id, false)
    store.reassignHostIfNeeded(room)
    expect(room.hostId).toBe(second.id)
  })

  it('leaves the host alone while they are still connected', () => {
    const room = make()
    const first = store.addPlayer(room, { displayName: 'A', token: newId() })
    store.addPlayer(room, { displayName: 'B', token: newId() })
    store.reassignHostIfNeeded(room)
    expect(room.hostId).toBe(first.id)
  })

  it('clears the host when everyone is disconnected', () => {
    const room = make()
    const only = store.addPlayer(room, { displayName: 'A', token: newId() })
    store.setConnected(room, only.id, false)
    store.reassignHostIfNeeded(room)
    expect(room.hostId).toBeNull()
  })

  it('lists participants in join order, excluding spectators', () => {
    const room = make()
    store.addPlayer(room, { displayName: 'A', token: newId() })
    store.addPlayer(room, { displayName: 'B', token: newId() })
    room.phase = 'carving'
    store.addPlayer(room, { displayName: 'Late', token: newId() })
    expect(store.participants(room).map(p => p.displayName)).toEqual(['A', 'B'])
  })
})
