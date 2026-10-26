/**
 * The shared avatar set, used by every game's lobby rather than one game's.
 *
 * The `id` is the contract: it is what travels on the wire, what the database
 * stores, and what artwork is keyed by. The emoji is a stand-in so the lobby
 * works before any art exists, and swapping in drawn avatars later changes
 * only what renders for a given id — no migration, no protocol change.
 *
 * Twelve of them: more than a dozen in a row stops being a choice and starts
 * being a search, and a work team of fifteen only needs enough to tell each
 * other apart.
 */
export type Avatar = { id: string; emoji: string; label: string }

export const AVATARS: readonly Avatar[] = [
  { id: 'vampire', emoji: '🧛', label: 'Vampire' },
  { id: 'ghost', emoji: '👻', label: 'Ghost' },
  { id: 'bat', emoji: '🦇', label: 'Bat' },
  { id: 'pumpkin', emoji: '🎃', label: 'Jack-o-lantern' },
  { id: 'zombie', emoji: '🧟', label: 'Zombie' },
  { id: 'spider', emoji: '🕷️', label: 'Spider' },
  { id: 'black-cat', emoji: '🐈‍⬛', label: 'Black cat' },
  { id: 'skull', emoji: '💀', label: 'Skull' },
  { id: 'witch', emoji: '🧙', label: 'Witch' },
  { id: 'wolf', emoji: '🐺', label: 'Wolf' },
  { id: 'mummy', emoji: '🧻', label: 'Mummy' },
  { id: 'owl', emoji: '🦉', label: 'Owl' },
] as const

const BY_ID = new Set(AVATARS.map(a => a.id))

/**
 * Whether a value names an avatar. Everything that reaches a player's profile
 * came off the network, and an unchecked string here would render in every
 * other player's lobby.
 */
export function isAvatarId(value: unknown): value is string {
  return typeof value === 'string' && BY_ID.has(value)
}

export function avatarById(id: string): Avatar | null {
  return AVATARS.find(a => a.id === id) ?? null
}
