import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { asPlayerId, type Player, type Team } from '@tg/shared'
import { Board, type BoardView } from '../games/fright/Board.js'
import { Set as GameSet } from '../games/fright/Set.js'

const TEAMS: Team[] = [
  { id: 'blue', name: 'Blue', color: '#3B82F6' },
  { id: 'red', name: 'Red', color: '#EF4444' },
]

const CATEGORIES = [
  { id: 'killers', name: "Who's That Killer?" },
  { id: 'treats', name: 'Blurry Treats' },
]

const view = (over: Partial<BoardView> = {}): BoardView => ({
  kind: 'fright-board',
  categories: CATEGORIES,
  tiles: CATEGORIES.flatMap(c =>
    [100, 200].map(value => ({ categoryId: c.id, value, spent: false }))),
  scores: { blue: 300, red: 100 },
  lifelines: { blue: 2, red: 1 },
  control: 'blue',
  canPick: true,
  ...over,
})

const player = (id: string, team: string, avatar = 'vampire'): Player => ({
  id: asPlayerId(id), displayName: id, connected: true, joinedAt: 1, avatar, team,
})

describe('Board', () => {
  it('renders a column per category and a tile per value', () => {
    render(<Board view={view()} controlName="Blue" onPick={() => {}} />)
    expect(screen.getByText("Who's That Killer?")).toBeTruthy()
    expect(screen.getByText('Blurry Treats')).toBeTruthy()
    expect(screen.getAllByRole('gridcell')).toHaveLength(4)
  })

  it('clicking a live tile reports its category and value', () => {
    const onPick = vi.fn()
    render(<Board view={view()} controlName="Blue" onPick={onPick} />)
    fireEvent.click(screen.getByRole('gridcell', { name: /Blurry Treats for 200/ }))
    expect(onPick).toHaveBeenCalledWith('treats', 200)
  })

  it('a spent tile renders blank and is not clickable', () => {
    const v = view()
    v.tiles[0]!.spent = true
    const onPick = vi.fn()
    const { container } = render(<Board view={v} controlName="Blue" onPick={onPick} />)
    const spent = container.querySelector('.board-tile.is-spent')!
    expect(spent.textContent).toBe('')
    fireEvent.click(spent)
    expect(onPick).not.toHaveBeenCalled()
  })

  it('tiles are disabled for a player who is not on the controlling team', () => {
    render(<Board view={view({ canPick: false })} controlName="Blue" onPick={() => {}} />)
    const tiles = screen.getAllByRole('gridcell') as HTMLButtonElement[]
    expect(tiles.every(t => t.disabled)).toBe(true)
  })

  it('names who picks, so an inert board does not read as broken', () => {
    render(<Board view={view({ canPick: false })} controlName="Red" onPick={() => {}} />)
    expect(screen.getByRole('status').textContent).toContain('Red')
  })

  it('tells the controlling team it is their turn', () => {
    render(<Board view={view()} controlName="Blue" onPick={() => {}} />)
    expect(screen.getByRole('status').textContent).toMatch(/your team/i)
  })

  it('every live tile is a real button, so the grid is keyboard reachable', () => {
    const { container } = render(<Board view={view()} controlName="Blue" onPick={() => {}} />)
    const live = [...container.querySelectorAll('.board-tile:not(.is-spent)')]
    expect(live).toHaveLength(4)
    expect(live.every(el => el.tagName === 'BUTTON')).toBe(true)
  })

  it('orders rows cheapest first', () => {
    const { container } = render(<Board view={view()} controlName="Blue" onPick={() => {}} />)
    const rows = [...container.querySelectorAll('.board-row:not(.is-head)')]
    expect(rows[0]!.textContent).toContain('100')
    expect(rows[1]!.textContent).toContain('200')
  })
})

describe('Set', () => {
  const players = [player('a', 'blue'), player('b', 'red', 'pumpkin')]

  it('shows both team scores on the rail', () => {
    const { container } = render(
      <GameSet teams={TEAMS} scores={{ blue: 300, red: 100 }} lifelines={{ blue: 2, red: 1 }}
        players={players}>
        <p>panel</p>
      </GameSet>,
    )
    const rails = [...container.querySelectorAll('.score-rail')]
    expect(rails).toHaveLength(2)
    expect(rails[0]!.textContent).toContain('300')
    expect(rails[1]!.textContent).toContain('100')
  })

  it('shows each team remaining lifeline pips', () => {
    const { container } = render(
      <GameSet teams={TEAMS} scores={{ blue: 0, red: 0 }} lifelines={{ blue: 2, red: 1 }}
        players={players}>
        <p>panel</p>
      </GameSet>,
    )
    const rails = [...container.querySelectorAll('.score-rail')]
    expect(rails[0]!.querySelectorAll('.rail-pip.is-lit')).toHaveLength(2)
    expect(rails[1]!.querySelectorAll('.rail-pip.is-lit')).toHaveLength(1)
  })

  it('puts each player avatar on their own team rail', () => {
    const { container } = render(
      <GameSet teams={TEAMS} scores={{ blue: 0, red: 0 }} lifelines={{ blue: 2, red: 2 }}
        players={players}>
        <p>panel</p>
      </GameSet>,
    )
    const rails = [...container.querySelectorAll('.score-rail')]
    expect(rails[0]!.querySelectorAll('.rail-avatar')).toHaveLength(1)
    expect(rails[1]!.querySelectorAll('.rail-avatar')).toHaveLength(1)
  })

  it('renders whatever panel it is given inside the proscenium', () => {
    const { container } = render(
      <GameSet teams={TEAMS} scores={{ blue: 0, red: 0 }} lifelines={{ blue: 2, red: 2 }}
        players={players}>
        <p>the panel</p>
      </GameSet>,
    )
    expect(container.querySelector('.set-panel')!.textContent).toBe('the panel')
  })

  it('announces the lifeline count for a screen reader', () => {
    render(
      <GameSet teams={TEAMS} scores={{ blue: 0, red: 0 }} lifelines={{ blue: 1, red: 0 }}
        players={players}>
        <p>panel</p>
      </GameSet>,
    )
    expect(screen.getByLabelText('1 flashlights left')).toBeTruthy()
    expect(screen.getByLabelText('0 flashlights left')).toBeTruthy()
  })
})
