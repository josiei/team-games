import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  fright, validatePack,
  type FrightAction, type FrightState, type GameModule, type Pack,
} from '@tg/shared'

const here = dirname(fileURLToPath(import.meta.url))
/** packages/server/src/games/fright -> repo root. */
const REPO_ROOT = resolve(here, '..', '..', '..', '..', '..')

export function packDir(packId: string): string {
  return join(REPO_ROOT, 'content', 'packs', packId)
}

/**
 * Read a pack off disk and refuse to start with a broken one.
 *
 * A pack that fails validation is a content bug, and a content bug found at
 * boot is a fixable evening — found at game time it is the evening.
 */
export function loadPack(packId: string): Pack {
  const dir = packDir(packId)
  const pack = JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8')) as Pack
  const problems = validatePack(pack, () => true)
  if (problems.length > 0) {
    // Validator messages name a clue by category and value, never by its text,
    // so this is safe to print in a terminal the repo's owner is reading.
    throw new Error(`pack "${packId}" is invalid:\n  ${problems.join('\n  ')}`)
  }
  return pack
}

const TEAMS = [
  { id: 'blue', name: 'Blue', color: '#3B82F6' },
  { id: 'red', name: 'Red', color: '#EF4444' },
] as const

const TEAM_IDS = TEAMS.map(t => t.id)

export function makeFrightModule(opts: {
  id: string
  name: string
  pack: Pack
  hidden?: boolean
}): GameModule<FrightState, FrightAction, unknown> {
  const createState = fright.makeCreateState(opts.pack, TEAM_IDS)

  return {
    id: opts.id,
    name: opts.name,
    description:
      'Two teams, one haunted board. Pixelated icons and Halloween trivia, '
      + 'answered on the buzzer.',
    minPlayers: 2,
    maxPlayers: 16,
    estimatedMinutes: 20,
    phases: fright.FRIGHT_PHASES,
    thumbnail: '/games/fright-night/thumb.png',
    teams: TEAMS,
    ...(opts.hidden ? { hidden: true } : {}),

    theme: { accent: '#7C3AED', accent2: '#FF7518', glow: '#C4B5FD', danger: '#EF4444' },

    // SKIP and END change the game, so only the host may send them. reduce is
    // pure and cannot know who that is; the runtime checks this list.
    hostActions: ['SKIP', 'END'],

    hostLines: {
      board: ['Pick your poison.', 'The board is yours. Choose wisely.'],
      reading: ['Read it. The buzzer is not live yet.'],
      clue: ['Buzzers are LIVE.'],
      steal: ['Wrong. The other team can steal this.'],
      answer: ['Clock is running.'],
      reveal: ['Let us see.'],
      results: ['That is the board. Some of you should be ashamed.'],
    },

    createState,
    setPhase: fright.setPhase,
    reduce: fright.reduce,
    viewFor: fright.viewFor,
    phaseComplete: fright.phaseComplete,
    nextPhase: fright.nextPhase,

    onPhaseEnter(state, phase, ctx) {
      const line = this.hostLines[phase]?.[0]
      if (line) ctx.hostLine(line)

      if (phase === 'results') {
        const { scores, winner } = fright.tally(state)
        ctx.saveResult({
          scores, winner,
          buzzCount: state.buzzCount,
          correctCount: state.correctCount,
        })
      }
    },
  }
}

/**
 * The same game over synthetic content. Hidden from the picker but reachable
 * by id, so every test and the e2e suite play a board nobody has to avoid
 * reading.
 */
export const frightNightDev = makeFrightModule({
  id: 'fright-night-dev',
  name: 'Fright Night (dev pack)',
  pack: loadPack('dev'),
  hidden: true,
})

// The real `fright-night` module is registered alongside its pack, once that
// pack exists and has been verified. Registering it against a placeholder
// would mean a half-written board could reach the picker without anyone
// noticing, and the one thing this game cannot survive is shipping content
// nobody checked.
