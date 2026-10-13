/**
 * The script line under the wordmark on the neon sign. One is chosen per page
 * load, so the people who open the lobby most often see the most of them.
 *
 * House style: dry, self-aware, and aimed at the idea of mandatory workplace
 * fun rather than at any person in the room. Keep them short — the sign gives
 * this line about 26 characters before the script shrinks to fit.
 */
export const TAGLINES = [
  'Sanctioned Fun',
  "It's Game O'Clock",
  'Attendance Optional',
  'Fun, Allegedly',
  'Now With Coworkers',
  'Morale, Assembled',
  'A Calendar Hold, Improved',
  'Synergy, But Fun',
] as const

export type Tagline = (typeof TAGLINES)[number]

/** The default, and the one a buyer sees in a screenshot: lead with the best. */
export const DEFAULT_TAGLINE: Tagline = TAGLINES[0]

/**
 * `random` is injectable so tests can pin the choice. Out-of-range values from
 * a hostile or broken source clamp to the default rather than returning
 * `undefined` into the sign.
 */
export function pickTagline(random: () => number = Math.random): Tagline {
  const index = Math.floor(random() * TAGLINES.length)
  return TAGLINES[index] ?? DEFAULT_TAGLINE
}
