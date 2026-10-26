import type { PlayerId } from './ids.js'
import type { Player, Team } from './game.js'

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
      /**
       * Teams this room's game declares, absent for a game played by
       * individuals. The lobby is shared across games and has no other way
       * to know, so it rides along rather than costing a second request.
       */
      teams?: readonly Team[]
    }
  | { type: 'host'; line: string }
  | { type: 'error'; code: string; message: string }

export type ClientMessage =
  | { type: 'action'; payload: unknown }
  | { type: 'ping' }
