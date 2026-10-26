import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { errorCode, humanize, listGames, type GameCard } from './api.js'
import '../theme/neon.css'

type Load =
  | { state: 'loading' }
  | { state: 'ready'; games: GameCard[] }
  | { state: 'failed'; code: string }

/**
 * Choosing what to play, before a room exists.
 *
 * The games come from the server rather than a client-side list, so adding a
 * module is still one registry entry — the promise the portal spec makes.
 * A failed fetch offers a retry: an empty grid is indistinguishable from
 * "there are no games", and one of those is a bug the player can work around.
 */
export function GamePicker({ onPick, onCancel }: {
  onPick(gameId: string): void
  onCancel(): void
}) {
  const [load, setLoad] = useState<Load>({ state: 'loading' })

  const fetchGames = useCallback(async () => {
    setLoad({ state: 'loading' })
    try {
      setLoad({ state: 'ready', games: await listGames() })
    } catch (e) {
      setLoad({ state: 'failed', code: errorCode(e) })
    }
  }, [])

  useEffect(() => { void fetchGames() }, [fetchGames])

  return (
    <main className="lobby-stage">
      <div className="lobby-content is-wide">
        <h1 className="picker-title">Pick a game</h1>

        {load.state === 'loading' && <p role="status">Loading games&hellip;</p>}

        {load.state === 'failed' && (
          <div className="picker-failed">
            <p role="alert">{humanize(load.code)}</p>
            <button className="btn-neon" onClick={() => void fetchGames()}>Try again</button>
          </div>
        )}

        {load.state === 'ready' && load.games.length === 0 && (
          <p role="status">No games are available right now.</p>
        )}

        {load.state === 'ready' && load.games.length > 0 && (
          <ul className="picker-grid">
            {load.games.map((game, index) => (
              <li key={game.id} style={{ '--i': index } as CSSProperties}>
                <button
                  className="picker-card"
                  style={{ '--accent': game.theme.accent, '--glow': game.theme.glow } as CSSProperties}
                  onClick={() => onPick(game.id)}
                >
                  <img className="picker-thumb" src={game.thumbnail} alt="" />
                  <span className="picker-name">{game.name}</span>
                  <span className="picker-desc">{game.description}</span>
                  <span className="picker-meta">
                    {game.minPlayers}&ndash;{game.maxPlayers} players
                    {' · '}~{game.estimatedMinutes} min
                    {game.teams ? ` · ${game.teams.length} teams` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <button className="btn-quiet" onClick={onCancel}>Back</button>
      </div>
    </main>
  )
}
