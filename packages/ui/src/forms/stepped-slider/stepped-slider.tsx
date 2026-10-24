import { Icon } from "@opencode/ui/icon"
import { Popover } from "@opencode/ui/popover"
import { createEffect, For, onCleanup, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import "./stepped-slider.css"

export type SteppedSliderLevel = {
  value: string
  label: string
}

export interface SteppedSliderProps {
  levels: SteppedSliderLevel[]
  value: string
  onChange: (value: string) => void
  /** Panel heading, for example "Thinking". */
  title: string
  /** Accessible name of the rail. */
  label: string
  /** Accessible name of the trigger, which shows only the current level. */
  triggerLabel: string
  disabled?: boolean
}

/**
 * Discrete slider in a popover. Every position is a level, so dragging always
 * lands on a level while the thumb eases toward it instead of jumping.
 */
export function SteppedSlider(props: SteppedSliderProps) {
  let rail: HTMLDivElement | undefined
  let rect: DOMRect | undefined
  let frame = 0
  let last = 0
  let motion: MediaQueryList | undefined

  const max = () => Math.max(1, props.levels.length - 1)

  const selected = () => {
    const found = props.levels.findIndex((level) => level.value === props.value)

    return found < 0 ? 0 : found
  }

  const current = () => props.levels[selected()]

  const [store, setStore] = createStore({
    open: false,
    position: selected(),
    target: selected(),
    moving: false,
    rtl: false,
  })

  const reduced = () => (motion ??= window.matchMedia("(prefers-reduced-motion: reduce)")).matches

  const tick = (now: number) => {
    frame = 0
    const dt = last ? now - last : 16
    last = now
    const target = store.target

    const next = reduced()
      ? target
      : store.position + (target - store.position) * (1 - Math.exp(-dt / (store.moving ? 55 : 110)))

    const settled = Math.abs(target - next) < 0.0008

    setStore("position", settled ? target : next)

    if (settled) {
      last = 0

      return
    }

    frame = requestAnimationFrame(tick)
  }

  const move = (next: number) => {
    const target = Math.min(Math.max(Math.round(next), 0), max())

    if (target === store.target) return

    setStore("target", target)

    if (reduced()) {
      setStore("position", target)

      return
    }

    if (!frame) frame = requestAnimationFrame(tick)
  }

  const select = (next: number) => {
    move(next)
    const level = props.levels[store.target]

    if (level && level.value !== props.value) props.onChange(level.value)
  }

  const aim = (clientX: number) => {
    if (!rail) return
    // Measure once per gesture: pointermove fires above frame rate, and a layout
    // read on every event makes the thumb stutter behind the cursor.
    rect ??= rail.getBoundingClientRect()
    const ratio = (clientX - rect.left) / rect.width

    select((store.rtl ? 1 - ratio : ratio) * max())
  }

  const release = () => {
    if (store.moving) setStore("moving", false)
  }

  const readDirection = () => {
    if (!rail) return

    setStore("rtl", getComputedStyle(rail).direction === "rtl")
  }

  createEffect(() => {
    const value = props.value
    const levels = props.levels

    untrack(() => {
      const found = levels.findIndex((level) => level.value === value)

      move(found < 0 ? 0 : found)
    })
  })

  createEffect(() => {
    if (!store.open) return

    requestAnimationFrame(() => {
      readDirection()
      rail?.focus({ preventScroll: true })
    })
  })

  onCleanup(() => {
    if (frame) cancelAnimationFrame(frame)
  })

  return (
    <Popover
      placement="top-start"
      gutter={9}
      open={store.open}
      onOpenChange={(open) => setStore("open", open)}
      triggerAs="button"
      triggerProps={{
        type: "button",
        class: "stepped-slider-trigger",
        "aria-label": props.triggerLabel,
        disabled: props.disabled,
      }}
      trigger={
        <>
          <Icon name="sliders" />
          <span data-slot="stepped-slider-value">{current()?.label ?? props.value}</span>
        </>
      }
      class="stepped-slider-panel"
    >
      <div data-slot="stepped-slider-head">
        <span data-slot="stepped-slider-title">{props.title}</span>
        <span data-slot="stepped-slider-current">{current()?.label ?? props.value}</span>
      </div>
      <div
        ref={rail}
        data-slot="stepped-slider-rail"
        role="slider"
        tabIndex={0}
        aria-label={props.label}
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={max()}
        aria-valuenow={selected()}
        aria-valuetext={current()?.label}
        classList={{ "is-moving": store.moving }}
        onDragStart={(event) => event.preventDefault()}
        onFocus={readDirection}
        onPointerDown={(event) => {
          if (event.pointerType === "mouse" && event.button !== 0) return
          // Without this the browser anchors a text selection on the panel while
          // dragging; a later drag then becomes a native text drag and the
          // composer's drop overlay takes over the gesture.
          event.preventDefault()
          setStore("moving", true)
          readDirection()
          rect = event.currentTarget.getBoundingClientRect()
          event.currentTarget.setPointerCapture(event.pointerId)
          event.currentTarget.focus({ preventScroll: true })
          aim(event.clientX)
        }}
        onPointerMove={(event) => {
          if (store.moving) aim(event.clientX)
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
        onKeyDown={(event) => {
          const step =
            event.key === "ArrowRight" || event.key === "ArrowUp"
              ? 1
              : event.key === "ArrowLeft" || event.key === "ArrowDown"
                ? -1
                : 0

          if (step) {
            event.preventDefault()
            select(store.target + step * (store.rtl ? -1 : 1))

            return
          }

          if (event.key !== "Home" && event.key !== "End") return
          event.preventDefault()
          select(event.key === "Home" ? 0 : max())
        }}
      >
        <div data-slot="stepped-slider-groove" />
        <div data-slot="stepped-slider-fill" style={{ width: `${(store.position / max()) * 100}%` }} />
        <div data-slot="stepped-slider-thumb" style={{ "inset-inline-start": `${(store.position / max()) * 100}%` }}>
          <i />
          <i />
          <i />
        </div>
      </div>
      <div data-slot="stepped-slider-scale" aria-hidden="true">
        <For each={Array.from({ length: max() * 2 + 1 })}>
          {(_, index) => (
            <i
              style={{ "inset-inline-start": `${(index() / (max() * 2)) * 100}%` }}
              data-active={index() === selected() * 2 ? "" : undefined}
            />
          )}
        </For>
      </div>
      <div data-slot="stepped-slider-labels">
        <For each={props.levels}>
          {(level, index) => (
            <span
              style={{ "inset-inline-start": `${(index() / max()) * 100}%` }}
              data-active={index() === selected() ? "" : undefined}
            >
              {level.label}
            </span>
          )}
        </For>
      </div>
    </Popover>
  )
}
