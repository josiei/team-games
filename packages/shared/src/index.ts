export * from './ids.js'
export * from './avatars.js'
export * from './code.js'
export * from './fright-pack.js'
// Namespaced, not flattened: pumpkin.ts and fright.ts both export a `reduce`
// and a `setPhase`, and a bare `export *` of both silently resolves the
// collision in favour of whichever came last. The barrel cannot hold two
// games' reducers under their natural names, so the second game gets a
// namespace and pumpkin keeps the names it already published.
export * as fright from './fright.js'
export type {
  ActiveClue, FrightAction, FrightPhase, FrightState, Tile,
} from './fright.js'
export * from './carve.js'
export * from './game.js'
export * from './events.js'
export * from './pumpkin.js'
