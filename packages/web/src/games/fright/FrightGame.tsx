import { useMemo } from 'react'
import { useConnection, remainingMs } from '../../store/connection.js'
import { Set as GameSet } from './Set.js'
import { Board, type BoardView } from './Board.js'
import { Stage, type ClueView } from './Stage.js'
import { Reveal, type RevealView } from './Reveal.js'
import { Results, type ResultsView } from './Results.js'

type AnyFrightView = BoardView | ClueView | RevealView | ResultsView

/**
 * One screen for the whole game.
 *
 * The set is mounted once and only its panel swaps, which is what makes the
 * game read as a continuous room. Routing is on `view.kind`, never on the
 * phase — see the note in App.tsx for why the phase cannot be trusted to say
 * which payload arrived.
 */
export function FrightGame({ onLeave }: { onLeave(): void }) {
  const view = useConnection(s => s.view) as AnyFrightView
  const teams = useConnection(s => s.teams) ?? []
  const players = useConnection(s => s.players)
  const labels = useConnection(s => s.labels)
  const endsAt = useConnection(s => s.endsAt)
  const clockOffset = useConnection(s => s.clockOffset)
  const dispatch = useConnection(s => s.dispatch)

  const secondsLeft = Math.ceil(remainingMs(endsAt, clockOffset) / 1000)

  const controlName = useMemo(() => {
    if (view.kind !== 'fright-board') return ''
    return teams.find(t => t.id === view.control)?.name ?? view.control
  }, [view, teams])

  const answeringName = view.kind === 'fright-clue' && view.answeringId
    ? labels[view.answeringId] ?? null
    : null

  const panel = (() => {
    switch (view.kind) {
      case 'fright-board':
        return (
          <Board
            view={view}
            controlName={controlName}
            onPick={(categoryId, value) => dispatch({ type: 'PICK', categoryId, value })}
          />
        )
      case 'fright-clue':
        return (
          <Stage
            view={view}
            secondsLeft={secondsLeft}
            answeringName={answeringName}
            onBuzz={() => dispatch({ type: 'BUZZ' })}
            onChoose={index => dispatch({ type: 'CHOOSE', index })}
            onLifeline={() => dispatch({ type: 'LIFELINE' })}
          />
        )
      case 'fright-reveal':
        return <Reveal view={view} teams={teams} />
      case 'fright-results':
        return <Results view={view} teams={teams} labels={labels} onLeave={onLeave} />
      default:
        return null
    }
  })()

  return (
    <GameSet
      teams={teams}
      scores={view.scores ?? {}}
      lifelines={'lifelines' in view ? view.lifelines : {}}
      players={players}
    >
      {panel}
    </GameSet>
  )
}
