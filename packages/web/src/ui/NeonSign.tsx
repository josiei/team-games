import type { Tagline } from '../lobby/taglines.js'

/**
 * The lobby's neon sign: a tube-lit wordmark over a script line, inside a
 * glowing frame. Built from text and CSS rather than an image so it stays sharp
 * on any display and takes its colors from the theme tokens.
 *
 * The wordmark is split so one letter can flicker, which inserts word
 * boundaries into the computed accessible name ("TEAM G A MES"). The explicit
 * `aria-label` restores it; the split spans are presentation only.
 */
export function NeonSign({ tagline }: { tagline: Tagline }) {
  return (
    <div className="neon-sign">
      <h1 className="neon-word" aria-label="Team Games">
        <span aria-hidden="true">TEAM G<span className="neon-flicker">A</span>MES</span>
      </h1>
      <p className="neon-script">{tagline}</p>
    </div>
  )
}
