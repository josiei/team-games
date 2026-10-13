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
      /** Absolute deadline of the current phase, or null if it has none. */
      endsAt: number | null
      /** Server clock at send time, so clients can correct for skew. */
      serverNow: number
    }
  | { type: 'host'; line: string }
  | { type: 'error'; code: string; message: string }

export type ClientMessage =
  | { type: 'action'; payload: unknown }
  | { type: 'ping' }
