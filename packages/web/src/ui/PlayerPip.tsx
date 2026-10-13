/**
 * A little jack-o'-lantern standing in for each player in the lobby. Its colour
 * comes from the player id, so the same person keeps the same pumpkin for the
 * life of a room without the server having to assign anything.
 */

/** On-theme and far enough apart to tell twelve of them apart at a glance. */
const PALETTE = [
  '#FF7518', '#8B5CF6', '#84CC16', '#FF4FA3', '#FFC24D', '#2DD4BF', '#F97362', '#60A5FA',
] as const

/**
 * A plain string hash. It only has to be stable and spread out — nothing
 * depends on it being hard to predict.
 */
export function pipColor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (Math.imul(hash, 31) + id.charCodeAt(i)) >>> 0
  return PALETTE[hash % PALETTE.length]!
}

export function PlayerPip({ id, connected }: { id: string; connected: boolean }) {
  const fill = pipColor(id)
  return (
    <svg
      className={`pip${connected ? '' : ' is-offline'}`}
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
