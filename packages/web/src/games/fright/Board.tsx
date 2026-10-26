import type { CSSProperties } from 'react'

export type BoardView = {
  kind: 'fright-board'
  categories: { id: string; name: string }[]
  tiles: { categoryId: string; value: number; spent: boolean }[]
  scores: Record<string, number>
  lifelines: Record<string, number>
  control: string
  canPick: boolean
}

/**
 * The category grid.
 *
 * Tiles are live only for the controlling team. For everyone else they are
 * disabled and the status line names who picks — a board that silently
 * swallows clicks reads as broken rather than as "not your turn".
 *
 * Live tiles are real buttons, because thirty click targets in a grid is
 * exactly where a keyboard user otherwise gets stranded.
 */
export function Board({ view, controlName, onPick }: {
  view: BoardView
  controlName: string
  onPick(categoryId: string, value: number): void
}) {
  const values = [...new Set(view.tiles.map(t => t.value))].sort((a, b) => a - b)

  return (
    <div
      className="board"
      style={{ '--cols': view.categories.length } as CSSProperties}
      role="grid"
      aria-label="Clue board"
    >
      <div className="board-row is-head" role="row">
        {view.categories.map(category => (
          <div key={category.id} className="board-head" role="columnheader">
            {category.name}
          </div>
        ))}
      </div>

      {values.map(value => (
        <div key={value} className="board-row" role="row">
          {view.categories.map(category => {
            const tile = view.tiles.find(
              t => t.categoryId === category.id && t.value === value)

            if (!tile || tile.spent) {
              return (
                <div
                  key={category.id}
                  className="board-tile is-spent"
                  role="gridcell"
                  aria-label={`${category.name} ${value}, already played`}
                />
              )
            }

            return (
              <button
                key={category.id}
                className="board-tile"
                role="gridcell"
                disabled={!view.canPick}
                aria-label={`${category.name} for ${value}`}
                onClick={() => onPick(category.id, value)}
              >
                {value}
              </button>
            )
          })}
        </div>
      ))}

      <p className="board-turn" role="status">
        {view.canPick
          ? 'Your team picks — choose a tile'
          : `${controlName} picks a clue`}
      </p>
    </div>
  )
}
