import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Team } from '@tg/shared'
import { Reveal, type RevealView } from '../games/fright/Reveal.js'
import { Results, type ResultsView } from '../games/fright/Results.js'

const TEAMS: Team[] = [
  { id: 'blue', name: 'Blue', color: '#3B82F6' },
  { id: 'red', name: 'Red', color: '#EF4444' },
]

const reveal = (over: Partial<RevealView> = {}): RevealView => ({
  kind: 'fright-reveal',
  categoryName: "Who's That Killer?",
  value: 600,
  clueKind: 'text',
  prompt: 'This Transylvanian count first appeared in an 1897 novel.',
  order: ['Nosferatu', 'Dracula', 'Lord Ruthven', 'Carmilla'],
  correct: 1,
  wonBy: 'blue',
  outcome: 'won',
  scores: { blue: 600, red: 0 },
  lifelines: { blue: 2, red: 2 },
  ...over,
})

const results = (over: Partial<ResultsView> = {}): ResultsView => ({
  kind: 'fright-results',
  scores: { blue: 1400, red: 800 },
  winner: 'blue',
  gallery: [
    { file: 'a.png', answer: 'Jason Voorhees', categoryName: "Who's That Killer?", value: 200 },
    { file: 'b.png', answer: 'Michael Myers', categoryName: "Who's That Killer?", value: 400 },
  ],
  buzzCount: { me: 5, other: 2 },
  correctCount: { me: 3, other: 2 },
  ...over,
})

const LABELS = { me: 'Jocelyn', other: 'Sam' }

describe('Reveal', () => {
  it('marks the correct choice', () => {
    const { container } = render(<Reveal view={reveal()} teams={TEAMS} />)
    const choices = [...container.querySelectorAll('.choice')]
    expect(choices[1]!.className).toContain('is-correct')
    expect(choices[0]!.className).not.toContain('is-correct')
  })

  it('says which team got it, in words', () => {
    render(<Reveal view={reveal()} teams={TEAMS} />)
    expect(screen.getByRole('status').textContent).toMatch(/blue/i)
    expect(screen.getByRole('status').textContent).toMatch(/600/)
  })

  it('distinguishes both teams missing from nobody buzzing', () => {
    const { rerender } = render(
      <Reveal view={reveal({ outcome: 'missed', wonBy: null })} teams={TEAMS} />)
    expect(screen.getByRole('status').textContent).toMatch(/both teams|neither/i)

    rerender(<Reveal view={reveal({ outcome: 'no-buzz', wonBy: null })} teams={TEAMS} />)
    expect(screen.getByRole('status').textContent).toMatch(/nobody buzzed|no one buzzed/i)
  })

  it('never says a team scored when nobody did', () => {
    render(<Reveal view={reveal({ outcome: 'missed', wonBy: null })} teams={TEAMS} />)
    expect(screen.getByRole('status').textContent).not.toMatch(/\+\s*600/)
  })

  it('shows the full photograph for an image clue', () => {
    const { container } = render(
      <Reveal view={reveal({ clueKind: 'image', file: 'x.png' })} teams={TEAMS} />)
    expect(container.querySelector('.pixel-reveal')).toBeTruthy()
  })

  it('shows the answer text in all cases', () => {
    render(<Reveal view={reveal({ outcome: 'no-buzz', wonBy: null })} teams={TEAMS} />)
    expect(screen.getByText('Dracula')).toBeTruthy()
  })
})

describe('Results', () => {
  it('names the winning team', () => {
    render(<Results view={results()} teams={TEAMS} labels={LABELS} onLeave={() => {}} />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/blue/i)
  })

  it('shows a tie as a tie rather than picking someone', () => {
    render(<Results view={results({ winner: null, scores: { blue: 900, red: 900 } })}
      teams={TEAMS} labels={LABELS} onLeave={() => {}} />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/tie|draw/i)
  })

  it('shows both final scores', () => {
    render(<Results view={results()} teams={TEAMS} labels={LABELS} onLeave={() => {}} />)
    expect(screen.getByText('1400')).toBeTruthy()
    expect(screen.getByText('800')).toBeTruthy()
  })

  it('calls out most buzzes and most correct by name', () => {
    const { container } = render(
      <Results view={results()} teams={TEAMS} labels={LABELS} onLeave={() => {}} />)
    const callouts = container.querySelector('.results-callouts')!.textContent!
    expect(callouts).toContain('Jocelyn')
    expect(callouts).toMatch(/most buzzes/i)
    expect(callouts).toMatch(/most correct/i)
  })

  it('shows every image clue un-pixelated with its answer', () => {
    const { container } = render(
      <Results view={results()} teams={TEAMS} labels={LABELS} onLeave={() => {}} />)
    const cards = [...container.querySelectorAll('.gallery-card')]
    expect(cards).toHaveLength(2)
    expect(cards[0]!.textContent).toContain('Jason Voorhees')
    expect(container.querySelectorAll('.gallery-card img')).toHaveLength(2)
  })

  it('survives an empty gallery, for a board with no image clues', () => {
    render(<Results view={results({ gallery: [] })} teams={TEAMS} labels={LABELS}
      onLeave={() => {}} />)
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy()
  })

  it('offers a way out', () => {
    render(<Results view={results()} teams={TEAMS} labels={LABELS} onLeave={() => {}} />)
    expect(screen.getByRole('button', { name: /leave/i })).toBeTruthy()
  })
})
