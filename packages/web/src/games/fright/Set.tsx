import type { CSSProperties, ReactNode } from 'react'
import { avatarById, type Player, type Team } from '@tg/shared'
import '../../theme/fright.css'

/**
 * The game-show set: one frame, drawn once, with a slot for the panel.
 *
 * Every in-game screen is the same room — only what sits inside the
 * proscenium changes. The pillars, lighting and score rails never re-mount,
 * so the game reads as one continuous room rather than a sequence of pages,
 * and the scores are in the same place on every screen including the board.
 *
 * Entirely CSS. The art pass replaces the backdrop behind these exact
 * proportions, so the layout cannot shift when it lands.
 */
export function Set({ teams, scores, lifelines, players, banner, children }: {
  teams: readonly Team[]
  scores: Record<string, number>
  lifelines: Record<string, number>
  players: Player[]
  banner?: ReactNode
  children: ReactNode
}) {
  return (
    <main className="fright-set">
      <div className="set-sky" aria-hidden="true">
        {STARS.map((star, i) => <span key={i} className="set-star" style={star} />)}
      </div>
      <div className="set-pillar is-left" aria-hidden="true" />
      <div className="set-pillar is-right" aria-hidden="true" />

      <div className="set-proscenium">
        <div className="set-panel">{children}</div>
      </div>

      {banner && <p className="set-banner">{banner}</p>}

      <div className="set-rails">
        {teams.map(team => (
          <ScoreRail
            key={team.id}
            team={team}
            score={scores[team.id] ?? 0}
            lifelines={lifelines[team.id] ?? 0}
            members={players.filter(p => p.team === team.id)}
          />
        ))}
      </div>
    </main>
  )
}

function ScoreRail({ team, score, lifelines, members }: {
  team: Team
  score: number
  lifelines: number
  members: Player[]
}) {
  return (
    <section
      className="score-rail"
      style={{ '--team': team.color } as CSSProperties}
      aria-label={`${team.name} team`}
    >
      <span className="rail-avatars" aria-hidden="true">
        {members.map(p => (
          <span key={p.id} className="rail-avatar" style={{ opacity: p.connected ? 1 : 0.45 }}>
            {avatarById(p.avatar)?.emoji ?? '•'}
          </span>
        ))}
      </span>
      <span className="rail-name">{team.name}</span>
      <span className="rail-score">{score}</span>
      <span className="rail-lifelines" aria-label={`${lifelines} flashlights left`}>
        {[0, 1].map(i => (
          <span key={i} className={`rail-pip${i < lifelines ? ' is-lit' : ''}`} aria-hidden="true" />
        ))}
      </span>
      <span className="rail-underline" aria-hidden="true" />
    </section>
  )
}

/** Fixed, not random: a starfield that twitches on every render is noise. */
const STARS: CSSProperties[] = [
  { left: '4%', top: '12%' }, { left: '11%', top: '34%' }, { left: '19%', top: '8%' },
  { left: '26%', top: '22%' }, { left: '33%', top: '5%' }, { left: '41%', top: '17%' },
  { left: '48%', top: '9%' }, { left: '56%', top: '27%' }, { left: '63%', top: '6%' },
  { left: '71%', top: '19%' }, { left: '78%', top: '31%' }, { left: '85%', top: '11%' },
  { left: '92%', top: '24%' }, { left: '97%', top: '7%' },
]
