import {
  AWARD_LABELS, PUMPKIN_PHASES, createState, phaseComplete, reduce, setPhase, tally, viewFor,
  type GameModule, type PumpkinAction, type PumpkinState, type PumpkinView,
} from '@tg/shared'

export const pumpkinModule: GameModule<PumpkinState, PumpkinAction, PumpkinView> = {
  id: 'pumpkin-carve',
  name: 'Jack-o-Lantern Carving',
  description:
    'Carve a pumpkin against the clock without collapsing it, then vote on everyone elses.',
  minPlayers: 2,
  maxPlayers: 16,
  estimatedMinutes: 6,
  thumbnail: '/games/pumpkin-carve/thumb.png',
  phases: PUMPKIN_PHASES,

  theme: { accent: '#FF7518', accent2: '#8B5CF6', glow: '#FFC24D', danger: '#84CC16' },

  hostLines: {
    carving: [
      'Three minutes. Try not to maim it.',
      'Carve deep for drama. Carve too deep and it folds.',
    ],
    'vote-scariest': ['Which of these would you not want on your porch?'],
    'vote-funniest': ['Now the one that made you snort.'],
    'vote-craft': ['Credit where it is due. Who actually tried?'],
    'vote-cursed': ['And finally. The one that should not exist.'],
    results: ['Votes are in. Some of you should be ashamed.'],
  },

  createState,
  setPhase,
  reduce,
  viewFor,
  phaseComplete,

  onPhaseEnter(state, phase, ctx) {
    const line = this.hostLines[phase]?.[0]
    if (line) ctx.hostLine(line)

    if (phase === 'results') {
      ctx.saveResult({
        winners: tally(state),
        awards: AWARD_LABELS,
        slots: state.slots,
      })
    }
  },
}
