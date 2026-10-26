import type { CSSProperties } from 'react'
import type { Team } from '@tg/shared'

export type ResultsView = {
  kind: 'fright-results'
  scores: Record<string, number>
  winner: string | null
  gallery: { file: string; answer: string; categoryName: string; value: number }[]
  buzzCount: Record<string, number>
  correctCount: Record<string, number>
}

/** The player with the most of something, or null when nobody has any. */
function leader(counts: Record<string, number>): { id: string; n: number } | null {
  const entries = Object.entries(counts).filter(([, n]) => n > 0)
  if (entries.length === 0) return null
  const [id, n] = entries.reduce((best, row) => (row[1] > best[1] ? row : best))
  return { id, n }
}

/**
 * The final board, and the bit people scroll back through while arguing.
 *
 * A tie is shown as a tie. Inventing a winner from a tiebreak nobody agreed
 * to beforehand is how a friendly game ends badly.
 */
export function Results({ view, teams, labels, onLeave }: {
  view: ResultsView
  teams: readonly Team[]
  labels: Record<string, string>
  onLeave(): void
}) {
  const buzzer = leader(view.buzzCount)
  const scorer = leader(view.correctCount)
  const name = (id: string) => labels[id] ?? id
  const winnerName = teams.find(t => t.id === view.winner)?.name ?? view.winner

  return (
    <div className="results">
      <h1 className="results-title">
        {view.winner ? `${winnerName} wins` : "It's a tie"}
      </h1>

      <div className="results-scores">
        {teams.map(team => (
          <div
            key={team.id}
            className={`results-score${team.id === view.winner ? ' is-winner' : ''}`}
            style={{ '--team': team.color } as CSSProperties}
          >
            <span className="results-team">{team.name}</span>
            <span className="results-number">{view.scores[team.id] ?? 0}</span>
          </div>
        ))}
      </div>

      <div className="results-callouts">
        {buzzer && (
          <p><strong>{name(buzzer.id)}</strong> had the most buzzes ({buzzer.n})</p>
        )}
        {scorer && (
          <p><strong>{name(scorer.id)}</strong> was most correct ({scorer.n})</p>
        )}
      </div>

      {view.gallery.length > 0 && (
        <>
          <h2 className="results-subtitle">Every picture, un-pixelated</h2>
          <ul className="gallery">
            {view.gallery.map(item => (
              <li key={item.file} className="gallery-card">
                <img src={item.file} alt={item.answer} loading="lazy" />
                <span className="gallery-answer">{item.answer}</span>
                <span className="gallery-meta">{item.categoryName} &middot; {item.value}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <button className="btn-quiet" onClick={onLeave}>Leave room</button>
    </div>
  )
}
