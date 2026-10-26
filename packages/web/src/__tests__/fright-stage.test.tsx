import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { asPlayerId } from '@tg/shared'
import { Stage, type ClueView } from '../games/fright/Stage.js'

const BLUE = asPlayerId('blue1')

const view = (over: Partial<ClueView> = {}): ClueView => ({
  kind: 'fright-clue',
  categoryId: 'killers',
  categoryName: "Who's That Killer?",
  value: 600,
  clueKind: 'text',
  prompt: 'This Transylvanian count first appeared in an 1897 novel.',
  order: ['Dracula', 'Nosferatu', 'Lord Ruthven', 'Carmilla'],
  armed: false,
  canBuzz: false,
  canChoose: false,
  canLifeline: false,
  answeringId: null,
  answeringTeam: null,
  wrongIndexes: [],
  myEliminated: [],
  scores: { blue: 0, red: 0 },
  lifelines: { blue: 2, red: 2 },
  ...over,
})

const noop = {
  onBuzz: () => {}, onChoose: () => {}, onLifeline: () => {},
  secondsLeft: 12, answeringName: null as string | null,
}

beforeEach(() => vi.restoreAllMocks())

describe('the buzzer', () => {
  it('is dead and labelled during reading', () => {
    render(<Stage view={view({ armed: false, canBuzz: false })} {...noop} />)
    const buzzer = screen.getByRole('button', { name: /reading/i }) as HTMLButtonElement
    expect(buzzer.disabled).toBe(true)
  })

  it('is armed during clue and says so', () => {
    render(<Stage view={view({ armed: true, canBuzz: true })} {...noop} />)
    const buzzer = screen.getByRole('button', { name: /buzz in/i }) as HTMLButtonElement
    expect(buzzer.disabled).toBe(false)
  })

  it('buzzes once on a press that began after arming', () => {
    const onBuzz = vi.fn()
    render(<Stage view={view({ armed: true, canBuzz: true })} {...noop} onBuzz={onBuzz} />)
    const buzzer = screen.getByRole('button', { name: /buzz in/i })
    fireEvent.pointerDown(buzzer)
    fireEvent.click(buzzer)
    expect(onBuzz).toHaveBeenCalledTimes(1)
  })

  // Holding the button through `reading` must gain nothing: the press has to
  // start after the arm, or the fastest finger beats the fastest reader.
  it('a press that began before arming does not buzz when it arms', () => {
    const onBuzz = vi.fn()
    const { rerender } = render(
      <Stage view={view({ armed: false, canBuzz: false })} {...noop} onBuzz={onBuzz} />)
    fireEvent.pointerDown(screen.getByRole('button', { name: /reading/i }))
    rerender(<Stage view={view({ armed: true, canBuzz: true })} {...noop} onBuzz={onBuzz} />)
    fireEvent.click(screen.getByRole('button', { name: /buzz in/i }))
    expect(onBuzz).not.toHaveBeenCalled()
  })

  it('a team with its shot spent cannot buzz', () => {
    render(<Stage view={view({ armed: true, canBuzz: false })} {...noop} />)
    expect((screen.getByRole('button', { name: /buzz/i }) as HTMLButtonElement).disabled)
      .toBe(true)
  })
})

describe('the choices', () => {
  it('render for everyone but are inert until a buzz', () => {
    const onChoose = vi.fn()
    render(<Stage view={view({ armed: true, canBuzz: true })} {...noop} onChoose={onChoose} />)
    const dracula = screen.getByRole('button', { name: /Dracula/ }) as HTMLButtonElement
    expect(dracula.disabled).toBe(true)
    fireEvent.click(dracula)
    expect(onChoose).not.toHaveBeenCalled()
  })

  it('come alive only for the buzzing player', () => {
    const onChoose = vi.fn()
    render(<Stage view={view({ canChoose: true, answeringId: BLUE, answeringTeam: 'blue' })}
      {...noop} onChoose={onChoose} />)
    fireEvent.click(screen.getByRole('button', { name: /Nosferatu/ }))
    expect(onChoose).toHaveBeenCalledWith(1)
  })

  it('number keys select for the buzzing player', () => {
    const onChoose = vi.fn()
    render(<Stage view={view({ canChoose: true, answeringId: BLUE })} {...noop}
      onChoose={onChoose} />)
    fireEvent.keyDown(window, { key: '3' })
    expect(onChoose).toHaveBeenCalledWith(2)
  })

  it('number keys do nothing for anyone else', () => {
    const onChoose = vi.fn()
    render(<Stage view={view({ canChoose: false })} {...noop} onChoose={onChoose} />)
    fireEvent.keyDown(window, { key: '2' })
    expect(onChoose).not.toHaveBeenCalled()
  })

  it('a number key past the end of the list does nothing', () => {
    const onChoose = vi.fn()
    render(<Stage view={view({ canChoose: true })} {...noop} onChoose={onChoose} />)
    fireEvent.keyDown(window, { key: '5' })
    expect(onChoose).not.toHaveBeenCalled()
  })

  it('lays out four choices in two columns and six in three', () => {
    const { container, rerender } = render(<Stage view={view()} {...noop} />)
    expect(container.querySelector('.choice-grid')!.getAttribute('data-cols')).toBe('2')
    rerender(<Stage view={view({ order: ['a', 'b', 'c', 'd', 'e', 'f'] })} {...noop} />)
    expect(container.querySelector('.choice-grid')!.getAttribute('data-cols')).toBe('3')
  })

  it('strikes through a wrong pick, for everyone', () => {
    const { container } = render(<Stage view={view({ wrongIndexes: [2] })} {...noop} />)
    const buttons = [...container.querySelectorAll('.choice')]
    expect(buttons[2]!.className).toContain('is-wrong')
    expect(buttons[0]!.className).not.toContain('is-wrong')
  })

  it('a struck-through choice cannot be picked', () => {
    const onChoose = vi.fn()
    render(<Stage view={view({ canChoose: true, wrongIndexes: [1] })} {...noop}
      onChoose={onChoose} />)
    fireEvent.click(screen.getByRole('button', { name: /Nosferatu/ }))
    expect(onChoose).not.toHaveBeenCalled()
  })
})

describe('the flashlight', () => {
  it('is offered only to the buzzing player', () => {
    render(<Stage view={view({ canLifeline: true, canChoose: true })} {...noop} />)
    expect(screen.getByRole('button', { name: /flashlight/i })).toBeTruthy()
  })

  it('is absent for everyone else', () => {
    render(<Stage view={view({ canLifeline: false })} {...noop} />)
    expect(screen.queryByRole('button', { name: /flashlight/i })).toBeNull()
  })

  it('dispatches when pressed', () => {
    const onLifeline = vi.fn()
    render(<Stage view={view({ canLifeline: true })} {...noop} onLifeline={onLifeline} />)
    fireEvent.click(screen.getByRole('button', { name: /flashlight/i }))
    expect(onLifeline).toHaveBeenCalled()
  })

  it('dims this viewer own eliminations', () => {
    const { container } = render(<Stage view={view({ myEliminated: [1, 3] })} {...noop} />)
    const buttons = [...container.querySelectorAll('.choice')]
    expect(buttons[1]!.className).toContain('is-cut')
    expect(buttons[3]!.className).toContain('is-cut')
    expect(buttons[0]!.className).not.toContain('is-cut')
  })

  it('a dimmed choice cannot be picked, by click or by number key', () => {
    const onChoose = vi.fn()
    render(<Stage view={view({ canChoose: true, myEliminated: [1] })} {...noop}
      onChoose={onChoose} />)
    fireEvent.click(screen.getByRole('button', { name: /Nosferatu/ }))
    fireEvent.keyDown(window, { key: '2' })
    expect(onChoose).not.toHaveBeenCalled()
  })
})

describe('what the room sees', () => {
  it('names who is answering and for which team', () => {
    render(<Stage view={view({ answeringId: BLUE, answeringTeam: 'blue' })} {...noop}
      answeringName="wosie" />)
    // The name is its own <strong>, so match the banner's rendered text.
    expect(screen.getByRole('status').textContent).toMatch(/wosie is answering for blue/i)
  })

  it('shows the countdown', () => {
    render(<Stage view={view({ armed: true })} {...noop} secondsLeft={7} />)
    expect(screen.getByText('7')).toBeTruthy()
  })

  it('shows the category and value', () => {
    render(<Stage view={view()} {...noop} />)
    expect(screen.getByText(/Who's That Killer\?/)).toBeTruthy()
    expect(screen.getByText(/600/)).toBeTruthy()
  })

  it('renders the prompt for a text clue and no image', () => {
    const { container } = render(<Stage view={view()} {...noop} />)
    expect(screen.getByText(/Transylvanian count/)).toBeTruthy()
    expect(container.querySelector('canvas')).toBeNull()
  })

  it('renders a canvas for an image clue', () => {
    const { container } = render(
      <Stage view={view({ clueKind: 'image', file: 'x.png', mosaic: 10 })} {...noop} />)
    expect(container.querySelector('canvas')).toBeTruthy()
  })
})

describe('an image clue that has not arrived yet', () => {
  it('shows a placeholder rather than an empty box', () => {
    // The canvas only paints in image.onload. On conference wifi that can be
    // most of the clue, and the spec promises a placeholder meanwhile.
    const { container } = render(
      <Stage view={view({ clueKind: 'image', file: 'x.png', mosaic: 10 })} {...noop} />)
    expect(container.querySelector('.pixel-placeholder')).toBeTruthy()
  })

  it('still renders the prompt, so the clue runs on its text', () => {
    render(<Stage view={view({ clueKind: 'image', file: 'x.png', mosaic: 10 })} {...noop} />)
    expect(screen.getByText(/Transylvanian count/)).toBeTruthy()
  })
})
