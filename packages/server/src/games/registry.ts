import { pumpkinModule } from './pumpkin/index.js'
import { frightNight, frightNightDev } from './fright/index.js'

export const GAMES = [pumpkinModule, frightNight, frightNightDev] as const

export function getGame(id: string) {
  return GAMES.find(g => g.id === id) ?? null
}
