import type { PumpkinView } from '@tg/shared'
import { useConnection } from './store/connection.js'

/**
 * Placeholder router, extended by Tasks 15-18.
 *
 * ROUTE ON `view.kind`, NEVER ON `phase`. When a phase transition fails the
 * server moves the room to its terminal phase but may still send a
 * LOBBY-shaped view with `phase: 'results'`. `phase` therefore cannot be
 * trusted to say which screen the payload fits; the view's own discriminant
 * always can.
 */
export function App() {
  const status = useConnection(s => s.status)
  const view = useConnection(s => s.view) as PumpkinView | null
  if (status === 'taken-over') {
    return <p>This session was opened in another tab. Close this one or reload to take it back.</p>
  }
  if (status === 'idle') return <p>Join screen arrives in Task 15.</p>
  if (!view) return <p>Connecting...</p>
  return <p>View: {view.kind}</p>
}
