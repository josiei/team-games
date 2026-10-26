/**
 * The host's two controls.
 *
 * Deliberately only these: anything that adjudicates an answer would mean the
 * host sees answers early, and the host is playing. Skip is for a clue that
 * is broken, not for one they do not like — which is why it spends the tile
 * rather than putting it back.
 */
export function HostBar({ canSkip, onSkip, onEnd }: {
  canSkip: boolean
  onSkip(): void
  onEnd(): void
}) {
  return (
    <div className="host-bar">
      <span className="host-tag">Host</span>
      <button className="btn-quiet" disabled={!canSkip} onClick={onSkip}>Skip this clue</button>
      <button className="btn-quiet" onClick={onEnd}>End game</button>
    </div>
  )
}
