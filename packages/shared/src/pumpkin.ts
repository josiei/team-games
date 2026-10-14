import {
  COLLAPSE_BASE, carvedRatio, collapseThresholdFor, integrityState, type Stroke,
} from './carve.js'
import type { Player } from './game.js'
import type { PlayerId } from './ids.js'

export const PUMPKIN_PHASES = [
  'lobby', 'carving',
  'vote-scariest', 'vote-funniest', 'vote-craft', 'vote-cursed',
  'results',
] as const
export type PumpkinPhase = (typeof PUMPKIN_PHASES)[number]

export type AwardKey = 'scariest' | 'funniest' | 'craft' | 'cursed'
export const AWARD_KEYS: readonly AwardKey[] = ['scariest', 'funniest', 'craft', 'cursed']

export const AWARD_BY_PHASE: Partial<Record<PumpkinPhase, AwardKey>> = {
  'vote-scariest': 'scariest',
  'vote-funniest': 'funniest',
  'vote-craft': 'craft',
  'vote-cursed': 'cursed',
}

export const AWARD_LABELS: Record<AwardKey, string> = {
  scariest: '🎃 Scariest',
  funniest: '😂 Funniest',
  craft: '🏆 Best Craftsmanship',
  cursed: '🫠 Most Cursed',
}

export type Pumpkin = { strokes: Stroke[]; submitted: boolean; collapseAt: number }

export type PumpkinState = {
  seed: number
  phase: PumpkinPhase
  slots: PlayerId[]                                   // slot index -> owner
  pumpkins: Record<PlayerId, Pumpkin>
  votes: Record<AwardKey, Record<PlayerId, number>>   // award -> voter -> slot
}

export type PumpkinAction =
  | { type: 'DRAFT'; strokes: Stroke[] }
  | { type: 'SUBMIT'; strokes: Stroke[] }
  | { type: 'VOTE'; award: AwardKey; slot: number }

/** mulberry32 — small, fast, deterministic. Keeps reduce pure. */
function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function seededShuffle<T>(items: T[], seed: number): T[] {
  const out = [...items]
  const rand = prng(seed)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

export function createState(players: Player[], seed: number): PumpkinState {
  const ordered = [...players].sort((a, b) =>
    a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  const pumpkins: Record<PlayerId, Pumpkin> = {}
  ordered.forEach((player, index) => {
    pumpkins[player.id] = {
      strokes: [],
      submitted: false,
      collapseAt: collapseThresholdFor(seed, index),
    }
  })

  return {
    seed,
    phase: 'lobby',
    slots: seededShuffle(ordered.map(p => p.id), seed),
    pumpkins,
    votes: { scariest: {}, funniest: {}, craft: {}, cursed: {} },
  }
}

export function setPhase(state: PumpkinState, phase: string): PumpkinState {
  return { ...state, phase: phase as PumpkinPhase }
}

export function slotOf(state: PumpkinState, player: PlayerId): number {
  return state.slots.indexOf(player)
}

export function reduce(
  state: PumpkinState,
  action: PumpkinAction,
  by: PlayerId,
): PumpkinState {
  const mine = state.pumpkins[by]
  if (!mine) return state                       // unknown player: ignore

  switch (action.type) {
    case 'DRAFT': {
      if (state.phase !== 'carving' || mine.submitted) return state
      return {
        ...state,
        pumpkins: { ...state.pumpkins, [by]: { ...mine, strokes: action.strokes } },
      }
    }
    case 'SUBMIT': {
      if (state.phase !== 'carving' || mine.submitted) return state
      return {
        ...state,
        pumpkins: {
          ...state.pumpkins,
          [by]: { ...mine, strokes: action.strokes, submitted: true },
        },
      }
    }
    case 'VOTE': {
      const award = AWARD_BY_PHASE[state.phase]
      if (!award || award !== action.award) return state      // wrong phase for this award
      if (!Number.isInteger(action.slot)) return state
      if (action.slot < 0 || action.slot >= state.slots.length) return state
      if (state.slots[action.slot] === by) return state        // no self-votes
      return {
        ...state,
        votes: {
          ...state.votes,
          [award]: { ...state.votes[award], [by]: action.slot },
        },
      }
    }
    default:
      return state                                             // unrecognised action: ignore
  }
}

/**
 * Nothing left to wait for: everyone still here has submitted, or has already
 * voted on the award in play. The room moves on instead of burning the rest of
 * the clock, so a vote between four people takes as long as those four take.
 *
 * An empty room is never complete: one blip that drops everybody must not
 * discard every unsubmitted carving or decide an award on no votes at all. The
 * phase clock stays the backstop for that case.
 *
 * Spectators are filtered out here rather than trusted to be absent, so the
 * rule holds whatever the caller passes.
 */
export function phaseComplete(
  state: PumpkinState, phase: string, players: Player[],
): boolean {
  const taking = players.filter(p => state.pumpkins[p.id] !== undefined)
  if (taking.length === 0) return false

  if (phase === 'carving') {
    return taking.every(p => state.pumpkins[p.id]?.submitted === true)
  }

  const award = AWARD_BY_PHASE[phase as PumpkinPhase]
  if (!award) return false            // lobby, results, or a phase we do not know
  return taking.every(p => state.votes[award][p.id] !== undefined)
}

export type AwardResult = { slot: number; votes: number } | null

/**
 * Winner per award. Ties break to the lower slot index so results are
 * reproducible. Returns null when an award drew no valid votes — which
 * happens in a one-player room, or when everyone disconnects mid-vote.
 */
export function tally(state: PumpkinState): Record<AwardKey, AwardResult> {
  const results = {} as Record<AwardKey, AwardResult>

  for (const award of AWARD_KEYS) {
    const counts = new Map<number, number>()
    for (const slot of Object.values(state.votes[award])) {
      counts.set(slot, (counts.get(slot) ?? 0) + 1)
    }

    let best: AwardResult = null
    for (const [slot, votes] of counts) {
      if (!best || votes > best.votes || (votes === best.votes && slot < best.slot)) {
        best = { slot, votes }
      }
    }
    results[award] = best
  }
  return results
}

export type Integrity = 'solid' | 'sagging' | 'collapsed'

/** Deliberately has no owner field. See the security tests. */
export type GalleryEntry = { slot: number; strokes: Stroke[]; integrity: Integrity }

export type PumpkinView =
  | { kind: 'lobby'; playerCount: number }
  | { kind: 'spectator'; phase: string }
  | {
      kind: 'carving'
      myStrokes: Stroke[]
      submitted: boolean
      ratio: number
      integrity: Integrity
      submittedCount: number
      totalPlayers: number
    }
  | {
      kind: 'voting'
      award: AwardKey
      gallery: GalleryEntry[]
      mySlot: number
      myVote: number | null
      /* Counts, never voter ids: who voted for what stays secret until the
         tally. Both count participants, so a disconnected player is still in
         the denominator even though the phase will not wait for them. */
      votedCount: number
      totalVoters: number
    }
  | {
      kind: 'results'
      gallery: GalleryEntry[]
      winners: Record<AwardKey, AwardResult>
      carvers: Record<number, PlayerId>
    }

/**
 * Counts over the players the phase is actually waiting on, so the total is
 * one the room can reach. Called without that set — the pure-logic tests, a
 * caller that has no connection state — it counts everyone who carved.
 */
function voteProgress(
  state: PumpkinState, award: AwardKey, waiting?: Player[],
): { votedCount: number; totalVoters: number } {
  const owners = waiting
    ? waiting.map(p => p.id).filter(id => state.pumpkins[id] !== undefined)
    : state.slots
  return {
    votedCount: owners.filter(owner => state.votes[award][owner] !== undefined).length,
    totalVoters: owners.length,
  }
}

function gallery(state: PumpkinState): GalleryEntry[] {
  return state.slots.map((owner, slot) => {
    const pumpkin = state.pumpkins[owner]
    const strokes = pumpkin?.strokes ?? []
    return {
      slot,
      strokes,
      integrity: integrityState(carvedRatio(strokes), pumpkin?.collapseAt ?? COLLAPSE_BASE),
    }
  })
}

export function viewFor(
  state: PumpkinState, viewer: PlayerId, waiting?: Player[],
): PumpkinView {
  const totalPlayers = state.slots.length

  if (state.phase === 'lobby') {
    return { kind: 'lobby', playerCount: totalPlayers }
  }

  // A late joiner has no pumpkin and no slot. Anything else would let them
  // vote on a round they did not carve in.
  if (!state.pumpkins[viewer] && state.phase !== 'results') {
    return { kind: 'spectator', phase: state.phase }
  }

  if (state.phase === 'carving') {
    const mine = state.pumpkins[viewer]
    const strokes = mine?.strokes ?? []
    const ratio = carvedRatio(strokes)
    return {
      kind: 'carving',
      myStrokes: strokes,
      submitted: mine?.submitted ?? false,
      ratio,
      integrity: integrityState(ratio, mine?.collapseAt ?? COLLAPSE_BASE),
      submittedCount: Object.values(state.pumpkins).filter(p => p.submitted).length,
      totalPlayers,
    }
  }

  if (state.phase === 'results') {
    const carvers: Record<number, PlayerId> = {}
    state.slots.forEach((owner, slot) => { carvers[slot] = owner })
    return { kind: 'results', gallery: gallery(state), winners: tally(state), carvers }
  }

  const award = AWARD_BY_PHASE[state.phase]
  // Unrecognised phase (setPhase does not validate): degrade to an inert,
  // identity-free view rather than throwing inside a broadcast loop.
  if (!award) return { kind: 'lobby', playerCount: totalPlayers }
  return {
    kind: 'voting',
    award,
    gallery: gallery(state),
    mySlot: slotOf(state, viewer),
    myVote: state.votes[award][viewer] ?? null,
    ...voteProgress(state, award, waiting),
  }
}
