import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { VoteScreen } from '../games/pumpkin/VoteScreen.js'
import { useConnection } from '../store/connection.js'
import { asPlayerId } from '@tg/shared'
import { PumpkinThumb } from '../games/pumpkin/PumpkinThumb.js'
import { ALL_IN_LINE, WAITING_ROTATE_MS, waitingLine } from '../games/pumpkin/waiting.js'

const NAMES = /Zephyrine|Quillfeather|Bartholomew|Gnarlwick/
/** Identifiable hits: 'text', or 'attr:<name>@<TAG>' for each attribute value matching a name. */
const leaks = (root: Element, walk = true): string[] => {
  const hits: string[] = []
  if (NAMES.test(root.textContent ?? '')) hits.push('text')
  const els = walk ? [root, ...Array.from(root.querySelectorAll('*'))] : [root]
  for (const el of els)
    for (const a of Array.from(el.attributes))
      if (NAMES.test(a.value)) hits.push(`attr:${a.name}@${el.tagName}`)
  return hits
}

const ME = asPlayerId('me')
const entry = (slot: number) => ({ slot, strokes: [], integrity: 'solid' as const })

const setView = (over: Record<string, unknown> = {}) =>
  useConnection.setState({
    status: 'open', phase: 'vote-scariest', me: ME,
    players: [], labels: {}, hostId: null, hostLine: null,
    endsAt: null, clockOffset: 0,
    view: {
      kind: 'voting', award: 'scariest',
      gallery: [entry(0), entry(1), entry(2)],
      mySlot: 1, myVote: null, votedCount: 0, totalVoters: 3, ...over,
    },
  })

beforeEach(() => setView())

describe('VoteScreen', () => {
  it('names the current award', () => {
    render(<VoteScreen code="ROOM01" />)
    expect(screen.getByText(/scariest/i)).toBeTruthy()
  })

  it('shows one card per pumpkin', () => {
    render(<VoteScreen code="ROOM01" />)
    expect(screen.getAllByRole('button', { name: /pumpkin/i })).toHaveLength(3)
  })

  it('disables the voters own pumpkin', () => {
    render(<VoteScreen code="ROOM01" />)
    const cards = screen.getAllByRole('button', { name: /pumpkin/i })
    expect((cards[1] as HTMLButtonElement).disabled).toBe(true)
    expect((cards[0] as HTMLButtonElement).disabled).toBe(false)
  })

  it('labels the voters own pumpkin as theirs', () => {
    render(<VoteScreen code="ROOM01" />)
    expect(screen.getByText(/yours/i)).toBeTruthy()
  })

  it('never shows a carver name during voting, in text or any attribute', () => {
    useConnection.setState({
      labels: { me: 'Zephyrine Quillfeather', other: 'Bartholomew Gnarlwick' },
      players: [
        { id: asPlayerId('me'), displayName: 'Zephyrine Quillfeather' },
        { id: asPlayerId('other'), displayName: 'Bartholomew Gnarlwick' },
      ] as never,
    })
    const { container } = render(<VoteScreen code="ROOM01" />)
    expect(leaks(container)).toEqual([])
  })

  it('control: the scan reports a leaked caption by source, text and nested aria-label', () => {
    const { container } = render(
      <div><PumpkinThumb code="ROOM01" entry={entry(0)} caption="Zephyrine Quillfeather" onClick={() => {}} /></div>)
    const hits = leaks(container)
    expect(hits).toContain('text')
    expect(hits).toContain('attr:aria-label@BUTTON')
  })

  it('control: a name in a NESTED attribute is caught only by the descendant walk', () => {
    const root = document.createElement('div')
    const child = document.createElement('span')
    child.setAttribute('data-owner', 'Bartholomew Gnarlwick')
    root.appendChild(child)
    expect(leaks(root)).toEqual(['attr:data-owner@SPAN'])
    expect(leaks(root, false)).toEqual([])   // proves the walk is what finds it
  })

  it('dispatches a vote for the clicked slot', () => {
    const dispatch = vi.fn()
    useConnection.setState({ dispatch })
    render(<VoteScreen code="ROOM01" />)
    fireEvent.click(screen.getAllByRole('button', { name: /pumpkin/i })[2]!)
    expect(dispatch).toHaveBeenCalledWith({ type: 'VOTE', award: 'scariest', slot: 2 })
  })

  it('says so when a vote is cast while the socket is closed, and clears once it sends', () => {
    const dispatch = vi.fn(() => false)
    useConnection.setState({ dispatch })
    render(<VoteScreen code="ROOM01" />)
    expect(screen.getByRole('status').textContent).toBe('')
    fireEvent.click(screen.getAllByRole('button', { name: /pumpkin/i })[2]!)
    expect(screen.getByRole('status').textContent).toMatch(/not sent.*reconnecting/i)
    dispatch.mockReturnValue(true)
    fireEvent.click(screen.getAllByRole('button', { name: /pumpkin/i })[2]!)
    expect(screen.getByRole('status').textContent).toBe('')
  })

  it('marks the current vote as selected', () => {
    setView({ myVote: 2 })
    render(<VoteScreen code="ROOM01" />)
    const cards = screen.getAllByRole('button', { name: /pumpkin/i })
    expect(cards[2]!.getAttribute('aria-pressed')).toBe('true')
    expect(cards[0]!.getAttribute('aria-pressed')).toBe('false')
  })

  it('shows a collapsed pumpkin as collapsed in text', () => {
    setView({ gallery: [{ slot: 0, strokes: [], integrity: 'collapsed' }], mySlot: 5 })
    render(<VoteScreen code="ROOM01" />)
    expect(screen.getByText(/collapsed/i)).toBeTruthy()
  })

  it('slumps a collapsed pumpkin, so shape carries the meaning too', () => {
    setView({ gallery: [{ slot: 0, strokes: [], integrity: 'collapsed' }], mySlot: 5 })
    const { container } = render(<VoteScreen code="ROOM01" />)
    const card = container.querySelector('[data-integrity="collapsed"]') as HTMLElement
    expect(card).toBeTruthy()
    expect(card.style.transform).toMatch(/rotate/)
  })

  it('leaves a solid pumpkin untransformed', () => {
    const { container } = render(<VoteScreen code="ROOM01" />)
    const card = container.querySelector('[data-integrity="solid"]') as HTMLElement
    expect(card.style.transform).toBe('none')
  })

  it('tells a spectator they are watching this round', () => {
    useConnection.setState({ view: { kind: 'spectator', phase: 'vote-scariest' } })
    render(<VoteScreen code="ROOM01" />)
    expect(screen.getByText(/next round/i)).toBeTruthy()
  })

  it('gives a spectator no pumpkins to vote on', () => {
    useConnection.setState({ view: { kind: 'spectator', phase: 'vote-scariest' } })
    render(<VoteScreen code="ROOM01" />)
    expect(screen.queryAllByRole('button', { name: /pumpkin/i })).toHaveLength(0)
  })

  it('leaves outline alone so keyboard focus stays visible, selected or not', () => {
    setView({ myVote: 2 })
    render(<VoteScreen code="ROOM01" />)
    for (const c of screen.getAllByRole('button', { name: /pumpkin/i }))
      expect((c as HTMLElement).style.outline).toBe('')
    const sel = screen.getAllByRole('button', { name: /pumpkin/i })[2] as HTMLElement
    expect(sel.style.border).toMatch(/3px solid/)
    expect(sel.style.boxShadow).not.toBe('none')
  })

  it('puts the caption and integrity state in the accessible name', () => {
    setView({ gallery: [entry(0), { slot: 1, strokes: [], integrity: 'collapsed' }], mySlot: 0 })
    render(<VoteScreen code="ROOM01" />)
    expect(screen.getByRole('button', { name: /pumpkin 1.*yours/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /pumpkin 2.*collapsed/i })).toBeTruthy()
  })

  it('slumps slightly and says so for a sagging pumpkin', () => {
    setView({ gallery: [{ slot: 0, strokes: [], integrity: 'sagging' }], mySlot: 5 })
    const { container } = render(<VoteScreen code="ROOM01" />)
    const card = container.querySelector('[data-integrity="sagging"]') as HTMLElement
    expect(card.style.transform).toBe('scaleY(0.96)')
    expect(screen.getByText(/sagging/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /sagging/i })).toBeTruthy()
  })

  it('renders a static, focusable-free thumb when there is no onClick', () => {
    const { container } = render(<PumpkinThumb code="ROOM01" entry={entry(0)} caption="Someone" />)
    expect(container.querySelector('button')).toBeNull()
    const img = screen.getByRole('img', { name: /pumpkin 1.*someone/i })
    expect(img.getAttribute('aria-pressed')).toBeNull()
    expect((img as HTMLElement).style.opacity).toBe('1')
  })
})

describe('waiting for the rest of the room', () => {
  afterEach(() => { vi.useRealTimers() })

  it('says nothing until your vote is in', () => {
    render(<VoteScreen code="ROOM01" />)
    expect(screen.queryByLabelText('Your vote is in')).toBeNull()
  })

  it('appears with the room\'s progress once you have voted', () => {
    setView({ myVote: 0, votedCount: 2, totalVoters: 3 })
    render(<VoteScreen code="ROOM01" />)
    expect(screen.getByLabelText('Your vote is in')).toBeTruthy()
    expect(screen.getByText('2 of 3 votes in')).toBeTruthy()
    expect(screen.getByText(waitingLine(0))).toBeTruthy()
  })

  it('leaves the pumpkins live, so a mis-tap can still be changed', () => {
    setView({ myVote: 0, votedCount: 2, totalVoters: 3 })
    render(<VoteScreen code="ROOM01" />)
    expect(screen.getByText(/changed your mind/i)).toBeTruthy()
    const cards = screen.getAllByRole('button', { name: /pumpkin/i })
    const mine = cards.filter(c => !(c as HTMLButtonElement).disabled)
    expect(mine.length).toBe(2)       // every pumpkin but my own
    expect(() => fireEvent.click(mine[1]!)).not.toThrow()
  })

  it('rotates the line rather than repeating one for the whole wait', () => {
    vi.useFakeTimers()
    setView({ myVote: 0, votedCount: 1, totalVoters: 3 })
    render(<VoteScreen code="ROOM01" />)
    expect(screen.getByText(waitingLine(0))).toBeTruthy()
    act(() => { vi.advanceTimersByTime(WAITING_ROTATE_MS) })
    expect(screen.getByText(waitingLine(1))).toBeTruthy()
    act(() => { vi.advanceTimersByTime(WAITING_ROTATE_MS) })
    expect(screen.getByText(waitingLine(2))).toBeTruthy()
  })

  it('stops claiming it is waiting on anyone once everybody is in', () => {
    vi.useFakeTimers()
    setView({ myVote: 0, votedCount: 3, totalVoters: 3 })
    render(<VoteScreen code="ROOM01" />)
    expect(screen.getByText(ALL_IN_LINE)).toBeTruthy()
    // The room moves on in well under a second; offering a change there is a lie.
    expect(screen.queryByText(/changed your mind/i)).toBeNull()
    // And no interval left ticking behind it: the room is about to move on.
    expect(vi.getTimerCount()).toBe(0)
    act(() => { vi.advanceTimersByTime(WAITING_ROTATE_MS * 3) })
    expect(screen.getByText(ALL_IN_LINE)).toBeTruthy()
  })

  it('starts the rotation over on the next award', () => {
    vi.useFakeTimers()
    setView({ myVote: 0, votedCount: 1, totalVoters: 3 })
    const { rerender } = render(<VoteScreen code="ROOM01" />)
    act(() => { vi.advanceTimersByTime(WAITING_ROTATE_MS) })
    expect(screen.getByText(waitingLine(1))).toBeTruthy()

    act(() => { setView({ award: 'funniest', myVote: 0, votedCount: 1, totalVoters: 3 }) })
    rerender(<VoteScreen code="ROOM01" />)
    expect(screen.getByText(waitingLine(0))).toBeTruthy()
  })

  it('paints no NaN if a voting view ever arrives with nobody in it', () => {
    setView({ myVote: 0, votedCount: 0, totalVoters: 0 })
    render(<VoteScreen code="ROOM01" />)
    const fill = document.querySelector('.vote-wait-fill') as HTMLElement
    expect(fill.style.width).toBe('0%')
    expect(document.body.textContent).not.toMatch(/NaN/)
  })

  it('names nobody while it waits', () => {
    setView({ myVote: 0, votedCount: 2, totalVoters: 3 })
    render(<VoteScreen code="ROOM01" />)
    expect(leaks(screen.getByLabelText('Your vote is in'))).toEqual([])
  })
})
