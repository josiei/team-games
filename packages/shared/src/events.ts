import type { PlayerId } from './ids.js'
import type { Player } from './game.js'

export type ServerMessage =
  | {
      type: 'snapshot'
      phase: string
      view: unknown
      players: Player[]
      labels: Record<string, string>
      hostId: PlayerId | null
    }
  | { type: 'timer'; endsAt: number; serverNow: number }
  | { type: 'host'; line: string }
  | { type: 'error'; code: string; message: string }

export type ClientMessage =
  | { type: 'action'; payload: unknown }
  | { type: 'ping' }
