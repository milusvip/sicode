import { createEffect, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"

const target = ["S", "i", "C", "o", "d", "e"] as const

const choices = ["S", "i", "C", "o", "d", "e"] as const

export function AnimatedWordmark(props: { active: boolean }) {
  const [state, setState] = createStore({ letters: [...target] })
  const timers = new Set<ReturnType<typeof setTimeout>>()

  createEffect(
    on(
      () => props.active,
      (active) => {
        timers.forEach(clearTimeout)
        timers.clear()

        if (!active || matchMedia("(prefers-reduced-motion: reduce)").matches) {
          setState("letters", [...target])

          return
        }

        const starts = target.map(() => choices[Math.floor(Math.random() * choices.length)])
        const settles = target.map(() => 6 + Math.floor(Math.random() * 8))
        const last = Math.max(...settles)
        setState("letters", starts)

        Array.from({ length: last }, (_, index) => index + 1).forEach((tick) => {
          const timer = setTimeout(() => {
            setState(
              "letters",
              target.map((letter, index) =>
                tick >= settles[index] ? letter : choices[Math.floor(Math.random() * choices.length)],
              ),
            )
            timers.delete(timer)
          }, tick * 75)

          timers.add(timer)
        })
      },
    ),
  )

  onCleanup(() => timers.forEach(clearTimeout))

  return (
    <svg class="settings-about-wordmark" viewBox="0 0 234 42" aria-hidden="true">
      <text
        x="0"
        y="32"
        fill="currentColor"
        font-family="Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
        font-size="34"
        font-weight="600"
        letter-spacing="-0.6"
      >
        {state.letters.join("")}
      </text>
    </svg>
  )
}
