import { pumpkinModule } from './pumpkin/index.js'

export const GAMES = [pumpkinModule] as const

export function getGame(id: string) {
  return GAMES.find(g => g.id === id) ?? null
}
