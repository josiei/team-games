import { useState, type CSSProperties } from 'react'
import {
  AVATARS, avatarById,
  type Player, type PlayerId, type RoomCode, type Team,
} from '@tg/shared'
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

  const myself = me === null ? undefined : ordered.find(p => p.id === me)
  const myAvatar = myself?.avatar ?? ''
  const myName = myself ? labels[myself.id] ?? myself.displayName : 'you'

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
      <div className={`lobby-content${hasTeams ? ' has-teams' : ''}`}>
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
                  hostId={hostId}
                  me={me}
                  mine={me !== null && ordered.find(p => p.id === me)?.team === team.id}
                  onJoin={() => void choose({ team: team.id })}
                  onLeave={() => void choose({ team: null })}
                />
              ))}
            </div>

            <div className="you-preview">
              <span className="portrait-face" aria-hidden="true">
                {avatarById(myAvatar)?.emoji ?? '?'}
              </span>
              <span className="you-preview-text">
                {myAvatar
                  ? <>You are <strong>{myName}</strong></>
                  : <>Pick one below, <strong>{myName}</strong></>}
              </span>
            </div>
            <p className="avatar-strip-label">Your avatar</p>
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

        {!hasTeams && <ul className="roster">
          {ordered.map((player, index) => (
            <li key={player.id} className="roster-row" style={{ '--i': index } as CSSProperties}>
              {avatarById(player.avatar)
                ? (
                  <span
                    className="roster-avatar"
                    aria-hidden="true"
                    style={{ opacity: player.connected ? 1 : 0.5 }}
                  >
                    {avatarById(player.avatar)!.emoji}
                  </span>
                )
                : <PlayerPip id={player.id} connected={player.connected} />}
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
        </ul>}

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

/**
 * One team, as a row of portraits.
 *
 * A name per line grew the card by one row per player and pushed the start
 * button off the screen at a real team size; portraits wrap four to a row, so
 * fifteen people cost four rows rather than fifteen. Seeing a face land in a
 * box is also the thing that makes joining a team feel like joining a team.
 */
function TeamColumn({ team, members, labels, hostId, me, mine, onJoin, onLeave }: {
  team: Team
  members: Player[]
  labels: Record<string, string>
  hostId: PlayerId | null
  me: PlayerId | null
  mine: boolean
  onJoin(): void
  onLeave(): void
}) {
  return (
    <section
      className={`team-column${mine ? ' is-mine' : ''}`}
      style={{ '--team': team.color } as CSSProperties}
      aria-label={`${team.name} team`}
    >
      <h2 className="team-name">
        {team.name}
        {mine && <span className="team-yours">Your team</span>}
      </h2>

      <div className="team-portraits">
        {members.map(p => {
          const label = labels[p.id] ?? p.displayName
          return (
            <div
              key={p.id}
              className={[
                'portrait',
                p.id === hostId ? 'is-host' : '',
                p.id === me ? 'is-me' : '',
                p.connected ? '' : 'is-away',
              ].filter(Boolean).join(' ')}
              title={p.id === hostId ? `${label} (host)` : label}
            >
              <span className="portrait-face" aria-hidden="true">
                {avatarById(p.avatar)?.emoji ?? '\u2022'}
              </span>
              {p.id === hostId && (
                <span className="portrait-crown" aria-hidden="true">{'\u{1F451}'}</span>
              )}
              <span className="portrait-name">{label}</span>
            </div>
          )
        })}
        {members.length === 0 && <p className="team-empty">Nobody yet</p>}
      </div>

      {mine
        ? (
          <button className="btn-quiet team-join" onClick={onLeave}>
            Leave {team.name}
          </button>
        )
        : (
          <button className="btn-neon team-join" onClick={onJoin}>
            Join {team.name}
          </button>
        )}
    </section>
  )
}
