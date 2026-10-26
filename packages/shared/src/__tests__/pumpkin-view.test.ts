import { describe, expect, it } from 'vitest'
import { createState, reduce, setPhase, slotOf, viewFor } from '../pumpkin.js'
import { asPlayerId } from '../ids.js'
import type { Stroke } from '../carve.js'

// Distinctive ids, so "does this id appear in the payload" is a real check.
const IDS = ['PLAYER_ALPHA_0001', 'PLAYER_BRAVO_0002', 'PLAYER_CHARLIE_003'] as const
const [A, B, C] = IDS.map(asPlayerId) as [
  ReturnType<typeof asPlayerId>, ReturnType<typeof asPlayerId>, ReturnType<typeof asPlayerId>,
]
const players = IDS.map((id, i) =>
  ({ id: asPlayerId(id), displayName: `p${i}`, connected: true, joinedAt: i + 1 , avatar: '', team: null}))

const deep: Stroke[] = Array.from({ length: 40 }, (_, i) => ({
  tool: 'cut' as const, size: 0.3,
  points: [[(i % 8) / 8, Math.floor(i / 8) / 5]] as [number, number][],
}))
const shallow: Stroke[] = [{ tool: 'cut', size: 0.08, points: [[0.4, 0.4]] }]

function carved() {
  let s = setPhase(createState(players, 42), 'carving')
  s = reduce(s, { type: 'SUBMIT', strokes: shallow }, A)
  s = reduce(s, { type: 'SUBMIT', strokes: deep }, B)
  s = reduce(s, { type: 'SUBMIT', strokes: shallow }, C)
  return s
}

describe('viewFor during carving', () => {
  it('returns only the viewers own strokes', () => {
    const view = viewFor(carved(), A)
    expect(view.kind).toBe('carving')
    if (view.kind !== 'carving') throw new Error('wrong view')
    expect(view.myStrokes).toEqual(shallow)
  })

  it('never includes another players strokes', () => {
    const payload = JSON.stringify(viewFor(carved(), A))
    // B carved 40 strokes; A carved 1. A's payload must not carry B's volume.
    expect(payload.match(/"tool"/g) ?? []).toHaveLength(shallow.length)
  })

  it('reports progress as a count, not as identities', () => {
    const view = viewFor(carved(), A)
    if (view.kind !== 'carving') throw new Error('wrong view')
    expect(view.submittedCount).toBe(3)
    expect(view.totalPlayers).toBe(3)
  })

  it('reports the viewers own integrity state', () => {
    const view = viewFor(carved(), B)
    if (view.kind !== 'carving') throw new Error('wrong view')
    expect(view.integrity).toBe('collapsed')
    expect(view.ratio).toBeGreaterThan(0.5)
  })
  /**
   * The carving view was unpinned while the voting view was not, which is the
   * wrong way round for the view that knows who you are: `mySlot` was added
   * here with no test at all, and an owner-shaped field added next to it would
   * not have been caught the way one in the voting view would.
   */
  it('pins the exact top-level key set of the carving view', () => {
    const view = viewFor(setPhase(createState(players, 7), 'carving'), A)
    expect(Object.keys(view).sort()).toEqual(
      ['integrity', 'kind', 'mySlot', 'myStrokes', 'ratio', 'submitted', 'submittedCount', 'totalPlayers'])
  })

  it('tells a carver their own slot, so their screen draws their own pumpkin', () => {
    const s = setPhase(createState(players, 7), 'carving')
    for (const viewer of [A, B, C]) {
      const view = viewFor(s, viewer)
      if (view.kind !== 'carving') throw new Error('wrong view')
      expect(view.mySlot).toBe(slotOf(s, viewer))
      expect(view.mySlot).toBeGreaterThanOrEqual(0)
    }
    // Distinct, so nobody is handed somebody else's pumpkin to carve.
    const slots = [A, B, C].map(v => (viewFor(s, v) as { mySlot: number }).mySlot)
    expect(new Set(slots).size).toBe(3)
  })
})

describe('viewFor during voting', () => {
  const state = () => setPhase(carved(), 'vote-scariest')

  const VOTE_PHASES = [
    ['vote-scariest', 'scariest'],
    ['vote-funniest', 'funniest'],
    ['vote-craft', 'craft'],
    ['vote-cursed', 'cursed'],
  ] as const

  // Votes are keyed by voter id inside state, so they must actually exist
  // for this check to be able to catch a leaked derivative of state.votes.
  function withVotes(phase: (typeof VOTE_PHASES)[number][0], award: (typeof VOTE_PHASES)[number][1]) {
    let s = setPhase(carved(), phase)
    s = reduce(s, { type: 'VOTE', award, slot: slotOf(s, B) }, A)
    s = reduce(s, { type: 'VOTE', award, slot: slotOf(s, C) }, B)
    s = reduce(s, { type: 'VOTE', award, slot: slotOf(s, A) }, C)
    expect(Object.keys(s.votes[award])).toHaveLength(3)
    return s
  }

  it('transmits no player id for any viewer in any vote phase, with votes cast', () => {
    for (const [phase, award] of VOTE_PHASES) {
      const s = withVotes(phase, award)
      for (const viewer of [A, B, C]) {
        const payload = JSON.stringify(viewFor(s, viewer))
        for (const id of IDS) expect(payload).not.toContain(id)
      }
    }
  })

  it('pins the exact top-level key set of the voting view', () => {
    for (const [phase, award] of VOTE_PHASES) {
      const view = viewFor(withVotes(phase, award), A)
      expect(Object.keys(view).sort()).toEqual(
        ['award', 'gallery', 'kind', 'mySlot', 'myVote', 'totalVoters', 'votedCount'])
    }
  })

  it('counts votes cast without saying whose they are', () => {
    const [phase, award] = VOTE_PHASES[0]!
    let s = setPhase(carved(), phase)
    const seen = (viewer: typeof A) => {
      const v = viewFor(s, viewer)
      if (v.kind !== 'voting') throw new Error('wrong view')
      return [v.votedCount, v.totalVoters]
    }
    expect(seen(A)).toEqual([0, 3])
    s = reduce(s, { type: 'VOTE', award, slot: slotOf(s, B) }, A)
    expect(seen(A)).toEqual([1, 3])
    // Every viewer sees the same count: it is the room's progress, not theirs.
    expect(seen(C)).toEqual([1, 3])
    // Changing your mind is not a second vote.
    s = reduce(s, { type: 'VOTE', award, slot: slotOf(s, C) }, A)
    expect(seen(A)).toEqual([1, 3])
    s = reduce(s, { type: 'VOTE', award, slot: slotOf(s, A) }, B)
    s = reduce(s, { type: 'VOTE', award, slot: slotOf(s, A) }, C)
    expect(seen(A)).toEqual([3, 3])
  })

  it('exposes no owner-shaped key on gallery entries', () => {
    const view = viewFor(state(), A)
    if (view.kind !== 'voting') throw new Error('wrong view')
    for (const entry of view.gallery) {
      expect(Object.keys(entry).sort()).toEqual(['integrity', 'slot', 'strokes'])
    }
  })

  it('shows every pumpkin in shuffled slot order', () => {
    const view = viewFor(state(), A)
    if (view.kind !== 'voting') throw new Error('wrong view')
    expect(view.gallery.map(g => g.slot)).toEqual([0, 1, 2])
  })

  it('tells the viewer their own slot so they cannot self-vote', () => {
    const s = state()
    const view = viewFor(s, A)
    if (view.kind !== 'voting') throw new Error('wrong view')
    expect(view.mySlot).toBe(slotOf(s, A))
  })

  it('reports only the viewers own vote', () => {
    let s = state()
    s = reduce(s, { type: 'VOTE', award: 'scariest', slot: slotOf(s, B) }, A)
    s = reduce(s, { type: 'VOTE', award: 'scariest', slot: slotOf(s, C) }, B)

    const aView = viewFor(s, A)
    const bView = viewFor(s, B)
    if (aView.kind !== 'voting' || bView.kind !== 'voting') throw new Error('wrong view')
    expect(aView.myVote).toBe(slotOf(s, B))
    expect(bView.myVote).toBe(slotOf(s, C))
  })

  it('does not leak running vote counts mid-phase', () => {
    let s = state()
    s = reduce(s, { type: 'VOTE', award: 'scariest', slot: slotOf(s, B) }, A)
    const payload = JSON.stringify(viewFor(s, C))
    expect(payload).not.toContain('votes')
  })
})

describe('viewFor at results', () => {
  it('finally reveals which player carved each slot', () => {
    const s = setPhase(carved(), 'results')
    const view = viewFor(s, A)
    if (view.kind !== 'results') throw new Error('wrong view')
    expect(view.carvers[slotOf(s, B)]).toBe(B)
  })

  it('includes the winner per award', () => {
    let s = setPhase(carved(), 'vote-scariest')
    s = reduce(s, { type: 'VOTE', award: 'scariest', slot: slotOf(s, B) }, A)
    const view = viewFor(setPhase(s, 'results'), A)
    if (view.kind !== 'results') throw new Error('wrong view')
    expect(view.winners.scariest).toEqual({ slot: slotOf(s, B), votes: 1 })
    expect(view.winners.funniest).toBeNull()
  })

  it('is identical for every viewer, since nothing is secret any more', () => {
    const s = setPhase(carved(), 'results')
    expect(viewFor(s, A)).toEqual(viewFor(s, B))
  })
})

describe('viewFor in the lobby', () => {
  it('reports the player count and nothing else', () => {
    const view = viewFor(createState(players, 42), A)
    expect(view).toEqual({ kind: 'lobby', playerCount: 3 })
  })
})

describe('viewFor with an unrecognised phase', () => {
  it('does not throw and degrades to an inert lobby-shaped view', () => {
    const s = setPhase(carved(), 'definitely-not-a-phase')
    for (const viewer of [A, B, C]) {
      expect(() => viewFor(s, viewer)).not.toThrow()
      const payload = JSON.stringify(viewFor(s, viewer))
      for (const id of IDS) expect(payload).not.toContain(id)
    }
    expect(viewFor(s, A)).toEqual({ kind: 'lobby', playerCount: 3 })
  })
})
