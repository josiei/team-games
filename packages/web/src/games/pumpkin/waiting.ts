/**
 * Copy for the pause after you have voted and the room has not.
 *
 * Rotated rather than fixed: a vote can take the full fifteen seconds, and one
 * line read four times over is a short wait made to feel long. Nothing here
 * names a number — the real count sits next to it, and flavour text that
 * contradicts the count reads as a bug.
 */
export const WAITING_LINES = [
  'Counting on our fingers.',
  'Someone is zooming in.',
  'Someone is overthinking this.',
  'Tallying. Allegedly.',
  'Waiting on the slow ones.',
  'A difficult decision, apparently.',
  'The judges are conferring.',
  'Deliberating. Loudly, probably.',
] as const

export type WaitingLine = (typeof WAITING_LINES)[number]

export const WAITING_ROTATE_MS = 4000

/** Said once everybody is in, where "waiting on the slow ones" would be a lie. */
export const ALL_IN_LINE = 'That is everyone. Counting.'

/** Takes any integer, including a negative one, and always returns a line. */
export function waitingLine(index: number): WaitingLine {
  const n = WAITING_LINES.length
  return WAITING_LINES[((index % n) + n) % n] ?? WAITING_LINES[0]
}
