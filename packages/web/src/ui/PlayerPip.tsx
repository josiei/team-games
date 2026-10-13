import type { CSSProperties } from 'react'

/**
 * A little jack-o'-lantern standing in for each player in the lobby. Its colour
 * comes from the player id, so the same person keeps the same pumpkin for the
 * life of a room without the server having to assign anything.
 */

/**
 * Eight on-theme colours. With more than eight players repeats are certain, and
 * at four players a repeat is already better than even odds -- the pip is
 * decoration beside the name, not an identifier, so a shared pumpkin costs
 * nothing.
 */
export const PALETTE = [
  '#FF7518', '#8B5CF6', '#84CC16', '#FF4FA3', '#FFC24D', '#2DD4BF', '#F97362', '#60A5FA',
] as const

/**
 * A plain string hash. It only has to be stable and spread out — nothing
 * depends on it being hard to predict.
 *
 * The avalanche at the end is load-bearing, not decoration: 31 is congruent to
 * -1 mod 8, so without it `hash % 8` collapses to the alternating sum of the
 * character codes, and short structured ids collide constantly ('me' and
 * 'other' both land on 0). Real ids are 21-character nanoids, but the colours
 * should not depend on that.
 */
export function pipHash(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (Math.imul(hash, 31) + id.charCodeAt(i)) >>> 0
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x45d9f3b) >>> 0
  hash ^= hash >>> 16
  return hash >>> 0
}

export function pipColor(id: string): string {
  return PALETTE[pipHash(id) % PALETTE.length]!
}

export function PlayerPip({ id, connected }: { id: string; connected: boolean }) {
  const fill = pipColor(id)
  return (
    <svg
      className={`pip${connected ? '' : ' is-offline'}`}
      // The bob's phase comes from the id, not the row index: an index-based
      // phase shifts when somebody leaves, and changing a negative delay on a
      // running animation makes every pumpkin below them jump.
      style={{ '--phase': pipHash(id) % 8 } as CSSProperties}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M16 8c0-3 1-5 4-6-1.5 2-1.5 4-1 6z" fill="#4E7A34" />
      <ellipse cx="16" cy="19" rx="13" ry="11" fill={fill} />
      {/* Two inset ribs, the shorthand that makes a circle read as a pumpkin. */}
      <ellipse cx="16" cy="19" rx="5.5" ry="11" fill="#000" opacity="0.14" />
      <ellipse cx="16" cy="19" rx="11" ry="11" fill="#000" opacity="0.07" />
      <path d="M10 16l4 2-4 2zM22 16l-4 2 4 2z" fill="#1A0E04" />
      <path d="M10 24h3l1.5-2 1.5 2h1.5l1.5-2 1.5 2h2l-2 2h-8z" fill="#1A0E04" />
    </svg>
  )
}
