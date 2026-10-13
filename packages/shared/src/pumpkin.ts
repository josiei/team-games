import { collapseThresholdFor, type Stroke } from './carve.js'
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
    default:
      return state                              // VOTE handled in Task 6
  }
}
