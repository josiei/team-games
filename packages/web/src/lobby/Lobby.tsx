import { useState, type CSSProperties } from 'react'
import { AVATARS, avatarById, type Player, type RoomCode, type Team } from '@tg/shared'
import { useConnection } from '../store/connection.js'
import { HostLine } from '../ui/HostLine.js'
import { PlayerPip } from '../ui/PlayerPip.js'
import { Spiral } from '../ui/Spiral.js'
import { MIN_PLAYERS, errorCode, humanize, setProfile, startGame } from './api.js'
import '../theme/neon.css'

export function Lobby({ code, playerToken, onLeave }: {
  code: RoomCode
  playerToken: string
  onLeave?: () => void
}) {
  const players = useConnection(s => s.players)
  const labels = useConnection(s => s.labels)
  const hostId = useConnection(s => s.hostId)
  const me = useConnection(s => s.me)
  const status = useConnection(s => s.status)
  const teams = useConnection(s => s.teams)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  const isHost = me !== null && me === hostId
  const ordered = [...players].sort((a, b) => a.joinedAt - b.joinedAt)

  // A game that declares no teams keeps the lobby it already had.
  const hasTeams = teams !== undefined && teams.length > 0
  const counts = new Map((teams ?? []).map(t =>
    [t.id, ordered.filter(p => p.team === t.id).length]))
  const everyTeamHasSomeone = hasTeams && [...counts.values()].every(n => n > 0)
  const sizes = [...counts.values()]
  // Two apart is a nudge, not a rule: a work team splits itself and the host
  // can start regardless.
  const lopsided = hasTeams && sizes.length > 0
    && Math.max(...sizes) - Math.min(...sizes) >= 2

  async function choose(patch: { avatar?: string; team?: string | null }) {
    setError(null)
    try { await setProfile(code, playerToken, patch) }
    catch (e) { setError(errorCode(e)) }
  }
  // Below the minimum, show the seats still to fill: an empty row reads as
  // "someone is missing", where a short list just looks finished.
  const openSeats = Math.max(0, MIN_PLAYERS - ordered.length)

  return (
    <main className="lobby-stage">
      <Spiral />
      <div className="lobby-content">
        <div className="code-sign">
          <p className="code-sign-label">Room code</p>
          <p className="room-code">{code}</p>
          <p className="code-sign-hint">Teammates join with this on the home screen</p>
        </div>

        {status === 'reconnecting' && (
          <p role="status" className="reconnecting">Reconnecting<span className="dots" aria-hidden="true" /></p>
        )}

        {hasTeams && (
          <>
            <div className="team-columns">
              {teams!.map(team => (
                <TeamColumn
                  key={team.id}
                  team={team}
                  members={ordered.filter(p => p.team === team.id)}
                  labels={labels}
                  mine={me !== null && ordered.find(p => p.id === me)?.team === team.id}
                  onJoin={() => void choose({ team: team.id })}
                />
              ))}
            </div>

            <div className="avatar-strip" role="group" aria-label="Choose your avatar">
              {AVATARS.map(a => {
                const mine = me !== null && ordered.find(p => p.id === me)?.avatar === a.id
                return (
                  <button
                    key={a.id}
                    className={`avatar-chip${mine ? ' is-mine' : ''}`}
                    aria-pressed={mine}
                    aria-label={`Choose the ${a.label} avatar`}
                    onClick={() => void choose({ avatar: a.id })}
                  >
                    <span aria-hidden="true">{a.emoji}</span>
                  </button>
                )
              })}
            </div>
          </>
        )}

        <ul className="roster">
          {ordered.map((player, index) => (
            <li key={player.id} className="roster-row" style={{ '--i': index } as CSSProperties}>
              <PlayerPip id={player.id} connected={player.connected} />
              <strong className="roster-name" style={{ opacity: player.connected ? 1 : 0.5 }}>
                {labels[player.id] ?? player.displayName}
              </strong>
              {player.id === hostId && <span className="roster-tag">host</span>}
              {!player.connected && <span className="roster-tag is-quiet">offline</span>}
            </li>
          ))}
          {Array.from({ length: openSeats }, (_, n) => (
            <li key={`seat-${n}`} className="roster-row is-empty"
              style={{ '--i': ordered.length + n } as CSSProperties}>
              <span className="pip-empty" aria-hidden="true" />
              <span className="roster-name is-quiet">Open seat</span>
            </li>
          ))}
        </ul>

        <HostLine />

        <div className="lobby-actions">
          {isHost ? (
            <>
              <button
                className="btn-neon"
                disabled={
                  players.length < MIN_PLAYERS || starting
                  || (hasTeams && !everyTeamHasSomeone)
                }
                onClick={async () => {
                  if (starting) return
                  setStarting(true); setError(null)
                  try { await startGame(code, playerToken) }
                  catch (e) { setError(errorCode(e)) }
                  finally { setStarting(false) }
                }}
              >
                Start game
              </button>
              {players.length < MIN_PLAYERS && (
                <p className="lobby-note">Need at least {MIN_PLAYERS} players.</p>
              )}
              {hasTeams && !everyTeamHasSomeone && (
                <p className="lobby-note">Both teams need at least one player.</p>
              )}
              {hasTeams && everyTeamHasSomeone && lopsided && (
                <p className="lobby-note">The teams look lopsided, but you can start anyway.</p>
              )}
            </>
          ) : (
            <p className="lobby-note">
              Waiting for the host to start<span className="dots" aria-hidden="true" />
            </p>
          )}

          {error && <p className="join-error" role="alert">{humanize(error)}</p>}

          {onLeave && <button className="btn-quiet" onClick={onLeave}>Leave room</button>}
        </div>
      </div>
    </main>
  )
}

/** One team's roster, with a join button for anyone not already on it. */
function TeamColumn({ team, members, labels, mine, onJoin }: {
  team: Team
  members: Player[]
  labels: Record<string, string>
  mine: boolean
  onJoin(): void
}) {
  return (
    <section
      className={`team-column${mine ? ' is-mine' : ''}`}
      style={{ '--team': team.color } as CSSProperties}
      aria-label={`${team.name} team`}
    >
      <h2 className="team-name">{team.name}</h2>
      <ul className="team-roster">
        {members.map(p => (
          <li key={p.id} className="team-member">
            <span aria-hidden="true">{avatarById(p.avatar)?.emoji ?? '\u2022'}</span>
            <span style={{ opacity: p.connected ? 1 : 0.5 }}>
              {labels[p.id] ?? p.displayName}
            </span>
          </li>
        ))}
        {members.length === 0 && <li className="team-member is-quiet">Nobody yet</li>}
      </ul>
      <button className="btn-neon team-join" onClick={onJoin}>Join {team.name}</button>
    </section>
  )
}
