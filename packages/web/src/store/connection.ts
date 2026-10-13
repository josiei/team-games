import { create } from 'zustand'
import type { ClientMessage, Player, PlayerId, ServerMessage } from '@tg/shared'

export type Status = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed'

type State = {
  status: Status
  phase: string
  view: unknown
  players: Player[]
  labels: Record<string, string>
  hostId: PlayerId | null
  hostLine: string | null
  endsAt: number | null
  clockOffset: number
  me: PlayerId | null
}

type Actions = {
  connect(roomId: string, playerId: PlayerId, token: string): void
  disconnect(): void
  dispatch(action: unknown): void
  applyMessage(message: ServerMessage): void
}

/** Absolute deadlines plus a measured offset. No tick stream to miss. */
export function remainingMs(
  endsAt: number | null,
  clockOffset: number,
  now: number = Date.now(),
): number {
  if (endsAt === null) return 0
  return Math.max(0, endsAt - (now - clockOffset))
}

export function backoffMs(attempt: number): number {
  return Math.min(10_000, 300 * 2 ** attempt)
}

let socket: WebSocket | null = null
let attempt = 0
let retry: ReturnType<typeof setTimeout> | null = null
let lastArgs: { roomId: string; playerId: PlayerId; token: string } | null = null

export const useConnection = create<State & Actions>((set, get) => ({
  status: 'idle',
  phase: 'lobby',
  view: null,
  players: [],
  labels: {},
  hostId: null,
  hostLine: null,
  endsAt: null,
  clockOffset: 0,
  me: null,

  connect(roomId, playerId, token) {
    lastArgs = { roomId, playerId, token }
    if (retry) { clearTimeout(retry); retry = null }
    set({ status: attempt === 0 ? 'connecting' : 'reconnecting', me: playerId })

    const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
    socket = new WebSocket(
      `${protocol}://${location.host}/ws?room=${roomId}&token=${token}`)

    socket.onopen = () => { attempt = 0; set({ status: 'open' }) }

    socket.onmessage = event => {
      try { get().applyMessage(JSON.parse(String(event.data)) as ServerMessage) }
      catch { /* a malformed frame must not break the game */ }
    }

    socket.onclose = event => {
      socket = null
      if (event.code === 4001) return set({ status: 'closed' })   // replaced by another tab
      if (!lastArgs) return set({ status: 'closed' })
      set({ status: 'reconnecting' })
      const delay = backoffMs(attempt++)
      retry = setTimeout(() => {
        const args = lastArgs!
        get().connect(args.roomId, args.playerId, args.token)
      }, delay)
    }
  },

  disconnect() {
    lastArgs = null
    if (retry) { clearTimeout(retry); retry = null }
    socket?.close()
    socket = null
    set({ status: 'closed' })
  },

  dispatch(action) {
    if (socket?.readyState !== WebSocket.OPEN) return
    const message: ClientMessage = { type: 'action', payload: action }
    socket.send(JSON.stringify(message))
  },

  applyMessage(message) {
    switch (message.type) {
      case 'snapshot':
        // The deadline is part of the authoritative snapshot: it is replaced
        // wholesale each time, so a mid-phase snapshot can never blank it.
        return set({
          phase: message.phase,
          view: message.view,
          players: message.players,
          labels: message.labels,
          hostId: message.hostId,
          endsAt: message.endsAt,
          clockOffset: Date.now() - message.serverNow,
        })
      case 'host':
        return set({ hostLine: message.line })
      default:
        return
    }
  },
}))
