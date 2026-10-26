import { useCallback, useEffect, useRef, type CSSProperties } from 'react'
import type { PlayerId } from '@tg/shared'
import { PixelImage } from './PixelImage.js'

export type ClueView = {
  kind: 'fright-clue'
  categoryId: string
  categoryName: string
  value: number
  clueKind: 'image' | 'text'
  prompt: string
  file?: string
  mosaic?: number
  order: string[]
  armed: boolean
  canBuzz: boolean
  canChoose: boolean
  canLifeline: boolean
  answeringId: PlayerId | null
  answeringTeam: string | null
  wrongIndexes: number[]
  myEliminated: number[]
  scores: Record<string, number>
  lifelines: Record<string, number>
}

/**
 * The clue panel: the same layout for a pixelated image and for trivia, with
 * only the middle swapped.
 *
 * The choices are on screen from the moment the clue appears, for everybody,
 * inert until someone buzzes. They are part of the clue, not of the answer
 * step: the room reads the question *and* its options during the reading
 * window, so a buzz means "I know which one" rather than "I'll gamble on a
 * quarter".
 */
export function Stage({
  view, secondsLeft, answeringName, onBuzz, onChoose, onLifeline,
}: {
  view: ClueView
  secondsLeft: number
  answeringName: string | null
  onBuzz(): void
  onChoose(index: number): void
  onLifeline(): void
}) {
  const cols = view.order.length > 4 ? 3 : 2
  const blocked = (index: number) =>
    view.wrongIndexes.includes(index) || view.myEliminated.includes(index)

  const choose = useCallback((index: number) => {
    if (!view.canChoose || blocked(index)) return
    onChoose(index)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.canChoose, view.wrongIndexes, view.myEliminated, onChoose])

  // On a twelve-second clock the keyboard beats the trackpad, and not
  // everyone is using a mouse.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const index = Number(event.key) - 1
      if (!Number.isInteger(index) || index < 0 || index >= view.order.length) return
      choose(index)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [choose, view.order.length])

  return (
    <div className="stage">
      <p className="stage-head">
        <span className="stage-category">{view.categoryName}</span>
        <span className="stage-value">{view.value}</span>
      </p>

      <div className="stage-clue">
        {view.clueKind === 'image' && view.file
          ? <PixelImage src={view.file} mosaic={view.mosaic ?? 12} revealed={false}
              alt="The clue" />
          : null}
        <p className="stage-prompt">{view.prompt}</p>
      </div>

      <div className="choice-grid" data-cols={String(cols)}
        style={{ '--cols': cols } as CSSProperties}>
        {view.order.map((choice, index) => {
          const wrong = view.wrongIndexes.includes(index)
          const cut = view.myEliminated.includes(index)
          return (
            <button
              key={`${choice}-${index}`}
              className={`choice${wrong ? ' is-wrong' : ''}${cut ? ' is-cut' : ''}`}
              disabled={!view.canChoose || wrong || cut}
              onClick={() => choose(index)}
            >
              <span className="choice-number" aria-hidden="true">{index + 1}</span>
              <span className="choice-text">{choice}</span>
            </button>
          )
        })}
      </div>

      {view.canLifeline && (
        <button className="flashlight" onClick={onLifeline}>
          Flashlight &mdash; cut half the wrong answers
        </button>
      )}

      {view.answeringId
        ? <AnswerBanner name={answeringName} team={view.answeringTeam}
            secondsLeft={secondsLeft} />
        : <Buzzer armed={view.armed} canBuzz={view.canBuzz} secondsLeft={secondsLeft}
            onBuzz={onBuzz} />}
    </div>
  )
}

/**
 * Dead, then armed with a flash.
 *
 * A press is only a buzz if it *began* after the arm: holding the button down
 * through the reading window must gain nothing, or the race goes to the
 * fastest trigger finger rather than the fastest reader.
 */
function Buzzer({ armed, canBuzz, secondsLeft, onBuzz }: {
  armed: boolean
  canBuzz: boolean
  secondsLeft: number
  onBuzz(): void
}) {
  const pressStartedArmed = useRef(false)

  return (
    <button
      className={`buzzer${armed ? ' is-armed' : ''}`}
      disabled={!canBuzz}
      onPointerDown={() => { pressStartedArmed.current = armed }}
      onClick={() => {
        if (!canBuzz) return
        // A click with no pointerdown (keyboard activation) is honest input.
        if (!pressStartedArmed.current && !armed) return
        if (!pressStartedArmed.current) return
        pressStartedArmed.current = false
        onBuzz()
      }}
    >
      {armed
        ? <>
            <span className="buzzer-label">Buzz in</span>
            <Clock seconds={secondsLeft} />
          </>
        : <span className="buzzer-label">&middot;&middot;&middot; Reading &middot;&middot;&middot;</span>}
    </button>
  )
}

function AnswerBanner({ name, team, secondsLeft }: {
  name: string | null
  team: string | null
  secondsLeft: number
}) {
  return (
    <p className="answer-banner" role="status">
      <span className="answer-who">
        <strong>{name ?? 'Someone'}</strong> is answering for {team ?? 'their team'}
      </span>
      <Clock seconds={secondsLeft} />
    </p>
  )
}

/**
 * The countdown, set apart from whatever label sits beside it.
 *
 * "BUZZ IN 20" read as a sentence — buzz in twenty seconds' time, or buzz for
 * twenty points — when it means twenty seconds left to buzz. A pill pushed to
 * the far edge reads as an instrument rather than as the next word, which is
 * the only thing that works on a clock this short.
 */
function Clock({ seconds }: { seconds: number }) {
  return (
    <span className="buzzer-clock" aria-label={`${seconds} seconds left`}>
      {seconds}
    </span>
  )
}
