import type { Team } from '@tg/shared'
import { PixelImage } from './PixelImage.js'

export type RevealView = {
  kind: 'fright-reveal'
  categoryName: string
  value: number
  clueKind: 'image' | 'text'
  prompt: string
  file?: string
  order: string[]
  correct: number
  wonBy: string | null
  outcome: 'won' | 'missed' | 'no-buzz'
  scores: Record<string, number>
  lifelines: Record<string, number>
}

/**
 * The answer, and what it cost.
 *
 * Three outcomes, each said in words rather than implied by a colour: a team
 * scored, both teams missed, or nobody rang in. "Nobody buzzed" and "both got
 * it wrong" feel completely different in the room and the screen should not
 * flatten them into the same shrug.
 */
export function Reveal({ view, teams }: { view: RevealView; teams: readonly Team[] }) {
  const teamName = (id: string | null) =>
    teams.find(t => t.id === id)?.name ?? id ?? 'Nobody'

  const outcome =
    view.outcome === 'won'
      ? `${teamName(view.wonBy)} takes it — +${view.value}`
      : view.outcome === 'missed'
        ? 'Both teams missed it. No points.'
        : 'Nobody buzzed. No points.'

  return (
    <div className="stage">
      <p className="stage-head">
        <span className="stage-category">{view.categoryName}</span>
        <span className="stage-value">{view.value}</span>
      </p>

      <div className="stage-clue">
        {view.clueKind === 'image' && view.file
          ? <PixelImage src={view.file} mosaic={12} revealed alt={view.order[view.correct]!} />
          : null}
        <p className="stage-prompt">{view.prompt}</p>
      </div>

      <div className="choice-grid" data-cols={view.order.length > 4 ? '3' : '2'}
        style={{ '--cols': view.order.length > 4 ? 3 : 2 } as React.CSSProperties}>
        {view.order.map((choice, index) => (
          <div
            key={`${choice}-${index}`}
            className={`choice${index === view.correct ? ' is-correct' : ''}`}
          >
            <span className="choice-number" aria-hidden="true">{index + 1}</span>
            <span className="choice-text">{choice}</span>
          </div>
        ))}
      </div>

      <p className="reveal-outcome" role="status">{outcome}</p>
    </div>
  )
}
