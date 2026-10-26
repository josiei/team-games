import { pumpkinModule } from './pumpkin/index.js'
import { frightNightDev } from './fright/index.js'

export const GAMES = [pumpkinModule, frightNightDev] as const

export function getGame(id: string) {
  return GAMES.find(g => g.id === id) ?? null
}
