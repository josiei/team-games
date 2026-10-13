/**
 * The lobby's neon sign: a tube-lit wordmark over a script line, inside a
 * glowing frame. Built from text and CSS rather than an image so it stays sharp
 * on any display and takes its colors from the theme tokens.
 *
 * The wordmark is split so one letter can flicker. Browsers compute the
 * accessible name from inline spans without inserting spaces, so the name would
 * be "TEAM GAMES" either way; the explicit `aria-label` pins it rather than
 * leaving it to each engine's name computation.
 */
export function NeonSign({ tagline }: { tagline: string }) {
  return (
    <div className="neon-sign">
      <h1 className="neon-word" aria-label="Team Games">
        <span aria-hidden="true">TEAM G<span className="neon-flicker">A</span>MES</span>
      </h1>
      <p className="neon-script">{tagline}</p>
    </div>
  )
}
