import { createEffect, onCleanup } from "solid-js"
import "./marquee-text.css"

/**
 * SiCode: a single-line label that ellipsises at rest and, while hovered, scrolls its hidden tail
 * into view.
 *
 * The session column is narrow, so long titles are the norm rather than the exception, and the
 * `title` tooltip route is slow: it makes you wait a second over the row you are already pointing
 * at, and it cannot be read while clicking. A hover scroll shows the whole title immediately and
 * costs nothing when the title fits (we measure first and stay inert).
 *
 * The distance is measured on every hover, so a resized sidebar or a retitled session is handled
 * without any bookkeeping. Timing is proportional to the distance travelled — a fixed duration
 * either blurs past a slightly-too-long title or crawls on a very long one.
 */
const TIMING = {
  /** Hover has to settle before sliding, or a pointer crossing the list makes every row twitch. */
  startDelay: 160,
  /** Sliding back is a dismissal, not a reading pass: it should be quick. */
  reset: 180,
  minRun: 450,
  maxRun: 3200,
  /** Roughly 70px per second — fast enough to feel responsive, slow enough to read. */
  msPerPx: 14,
}

export function MarqueeText(props: { text: string; class?: string }) {
  let root!: HTMLSpanElement
  let track!: HTMLSpanElement
  let label!: HTMLSpanElement
  let startTimer: ReturnType<typeof setTimeout> | undefined
  let resetTimer: ReturnType<typeof setTimeout> | undefined
  let frame = 0

  const clearTimers = () => {
    clearTimeout(startTimer)
    clearTimeout(resetTimer)

    startTimer = undefined
    resetTimer = undefined
  }

  /** Back to the resting state: ellipsis on, no transform, no transition. */
  const rest = () => {
    clearTimers()
    cancelAnimationFrame(frame)

    frame = 0
    delete root.dataset.marquee
    track.style.transition = ""
    track.style.transform = ""
  }

  const run = () => {
    // Measured while still truncated: on an overflow-hidden box `scrollWidth` reports the full
    // content width, i.e. the tail the ellipsis is hiding. Measuring after switching to visible
    // would report the box width instead and collapse the distance to zero.
    const distance = label.scrollWidth - root.clientWidth

    if (distance <= 1) return

    const duration = Math.min(TIMING.maxRun, Math.max(TIMING.minRun, Math.round(distance * TIMING.msPerPx)))
    root.dataset.marquee = "run"

    // Reduced motion asks for no sliding, not for a hidden title: jump straight to the tail.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      track.style.transition = "none"
      track.style.transform = `translateX(-${distance}px)`

      return
    }

    // Start from rest explicitly: a second hover can begin after a partial slide back.
    track.style.transition = "none"
    track.style.transform = "translateX(0)"
    frame = requestAnimationFrame(() => {
      frame = 0
      track.style.transition = `transform ${duration}ms cubic-bezier(0.33, 1, 0.68, 1)`
      track.style.transform = `translateX(-${distance}px)`
    })
  }

  const enter = () => {
    clearTimers()

    if (root.dataset.marquee === "run") return

    startTimer = setTimeout(run, TIMING.startDelay)
  }

  const leave = () => {
    clearTimers()

    if (root.dataset.marquee !== "run") return

    track.style.transition = `transform ${TIMING.reset}ms ease-out`
    track.style.transform = "translateX(0)"
    resetTimer = setTimeout(rest, TIMING.reset + 20)
  }

  // A retitled session (titles are generated after the first message) must not keep an offset that
  // was measured for the previous string.
  createEffect(() => {
    props.text
    rest()
  })

  onCleanup(clearTimers)

  return (
    <span
      ref={root}
      data-slot="marquee"
      class={props.class}
      onPointerEnter={(event) => {
        if (event.pointerType === "touch") return

        enter()
      }}
      onPointerLeave={leave}
    >
      <span ref={track} data-slot="marquee-track">
        <span ref={label} data-slot="marquee-label">
          {props.text}
        </span>
      </span>
    </span>
  )
}
