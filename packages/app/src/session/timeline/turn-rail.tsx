import type { SessionMessageUser } from "@opencode/client/promise"
import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, type Accessor } from "solid-js"
import { readPromptPresentation } from "@/composer/comment-note"
import { useLanguage } from "@/runtime/i18n/language"
import "./turn-rail.css"

const previewMax = 160

const minTurns = 2

const waveRadius = 4

const tickPitch = 14

function turnPreview(message: SessionMessageUser) {
  const presentation = readPromptPresentation(message.metadata)
  const text = (presentation?.displayText ?? message.text).trim().replace(/\s+/g, " ")

  if (!text) return ""

  if (text.length <= previewMax) return text

  return `${text.slice(0, previewMax).trimEnd()}…`
}

function activeTurnID(scroller: HTMLDivElement, turns: SessionMessageUser[]) {
  const box = scroller.getBoundingClientRect()
  const line = box.top + 100
  const first = turns[0]?.id
  const last = turns.at(-1)?.id

  const list = [...scroller.querySelectorAll<HTMLElement>("[data-message-id]")].flatMap((element) => {
    const id = element.dataset.messageId

    if (!id) return []
    const rect = element.getBoundingClientRect()

    return [{ id, top: rect.top, bottom: rect.bottom }]
  })

  if (list.length === 0) return scroller.scrollTop < 8 ? first : last

  const shown = list.filter((item) => item.bottom > box.top && item.top < box.bottom)
  const hit = shown.find((item) => item.top <= line && item.bottom >= line)

  if (hit) return hit.id

  const near = [...shown].sort((a, b) => {
    const aDistance = Math.abs(a.top - line)
    const bDistance = Math.abs(b.top - line)

    if (aDistance !== bDistance) return aDistance - bDistance

    return a.top - b.top
  })[0]

  if (near) return near.id

  return list.filter((item) => item.top <= line).at(-1)?.id ?? list[0]?.id ?? last
}

function selectionIn(scroller: HTMLDivElement) {
  const selection = document.getSelection()

  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false
  const node = selection.anchorNode

  if (!node) return false

  // SAFETY: the ELEMENT_NODE branch is the only one that can reach the assertion.
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement

  return !!element && scroller.contains(element)
}

export function SessionTurnRail(props: {
  turns: Accessor<SessionMessageUser[]>
  failed: Accessor<ReadonlySet<string>>
  /** The loaded messages are the whole session, so a tick's position is its real turn number. */
  complete: Accessor<boolean>
  scroller: Accessor<HTMLDivElement | undefined>
  onJump: (message: SessionMessageUser) => void
}) {
  const language = useLanguage()
  const [activeID, setActiveID] = createSignal<string>()
  const [hover, setHover] = createSignal<{ id: string; top: number }>()
  const [trackHeight, setTrackHeight] = createSignal(0)
  const [previewHeight, setPreviewHeight] = createSignal(0)
  const [selecting, setSelecting] = createSignal(false)

  let rail: HTMLElement | undefined
  let hovered: HTMLElement | undefined
  let preview: HTMLDivElement | undefined
  const [trackEl, setTrackEl] = createSignal<HTMLElement>()

  const visible = createMemo(() => props.turns().length >= minTurns)

  const hoveredMessage = createMemo(() => {
    const id = hover()?.id

    if (!id) return

    return props.turns().find((message) => message.id === id)
  })

  // Index of the hovered tick, driving the focus wave: the hovered tick is the crest and its
  // neighbours taper by distance.
  const focusIndex = createMemo(() => {
    const id = hover()?.id

    if (!id) return -1

    return props.turns().findIndex((message) => message.id === id)
  })

  const previewText = createMemo(() => {
    const message = hoveredMessage()

    if (!message) return ""

    return turnPreview(message)
  })

  // A paged history starts mid-session, so a tick's position only matches its turn number once every page has
  // loaded. Before that the prompt names the tick, since a number counted from a partial page would be wrong.
  const turnLabel = (message: SessionMessageUser, index: number) =>
    props.complete()
      ? language.t("session.historyRail.jumpToTurn", { index: String(index + 1) })
      : turnPreview(message) || language.t("session.historyRail.jump")

  const previewLabel = createMemo(() => {
    const message = hoveredMessage()

    if (!message) return ""

    return turnLabel(message, props.turns().indexOf(message))
  })

  // A preview near either end would hang off the window, so it stays inside the rail's box.
  const clampPreview = (top: number) => {
    const bounds = rail?.getBoundingClientRect().height ?? 0
    const half = previewHeight() / 2

    if (!bounds || !half) return top

    return Math.min(Math.max(top, half), Math.max(bounds - half, half))
  }

  // DSH-style ladder: fixed pitch, centered when it fits; overflow scrolls instead of compressing.
  const layout = createMemo(() => {
    const count = props.turns().length
    const height = trackHeight()
    const contentHeight = tickPitch * Math.max(count, 0)

    if (count <= 0 || height <= 0) {
      return { pitch: tickPitch, offset: 0, scrollable: false, contentHeight }
    }

    if (contentHeight <= height) {
      return { pitch: tickPitch, offset: (height - contentHeight) / 2, scrollable: false, contentHeight: height }
    }

    return { pitch: tickPitch, offset: 0, scrollable: true, contentHeight }
  })

  const showHover = (id: string, target: HTMLElement) => {
    if (!rail) return
    const railBox = rail.getBoundingClientRect()
    const tickBox = target.getBoundingClientRect()
    hovered = target
    setHover({ id, top: tickBox.top + tickBox.height / 2 - railBox.top })
  }

  // The ladder scrolls under a still pointer, so the preview follows its tick instead of staying where it opened.
  const followHover = () => {
    const current = hover()

    if (!current || !hovered?.isConnected) return
    showHover(current.id, hovered)
  }

  // Measured after the preview renders: the clamp above needs its height, and the text decides that height.
  createEffect(
    on(
      () => [hover()?.id, previewText(), previewLabel()] as const,
      () => {
        const element = preview

        requestAnimationFrame(() => {
          setPreviewHeight(element?.isConnected ? element.offsetHeight : 0)
        })
      },
    ),
  )

  createEffect(() => {
    const scroller = props.scroller()
    const turns = props.turns()

    if (!scroller || turns.length < minTurns) {
      setActiveID(undefined)

      return
    }

    let frame: number | undefined

    const sync = () => {
      if (frame !== undefined) return
      frame = requestAnimationFrame(() => {
        frame = undefined
        setActiveID(activeTurnID(scroller, turns))
      })
    }

    sync()
    scroller.addEventListener("scroll", sync, { passive: true })
    onCleanup(() => {
      scroller.removeEventListener("scroll", sync)

      if (frame !== undefined) cancelAnimationFrame(frame)
    })
  })

  // While the user is selecting message text, disable hit-testing so ticks do not steal the drag.
  createEffect(() => {
    const scroller = props.scroller()

    if (!scroller || !visible()) {
      setSelecting(false)

      return
    }

    const sync = () => setSelecting(selectionIn(scroller))
    sync()
    document.addEventListener("selectionchange", sync)
    onCleanup(() => document.removeEventListener("selectionchange", sync))
  })

  // The rail only renders once there are enough turns, which can happen long after this
  // component mounts, so measure the track reactively instead of once on mount.
  createEffect(() => {
    const element = trackEl()

    if (!element) return
    setTrackHeight(element.clientHeight)

    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => setTrackHeight(element.clientHeight))
    observer.observe(element)
    onCleanup(() => observer.disconnect())
  })

  // Keep the active tick in view when the ladder is taller than the rail viewport. Scrolling the track itself
  // leaves every other scroller alone, which `scrollIntoView` would not.
  createEffect(() => {
    const id = activeID()
    const track = trackEl()
    const scrollable = layout().scrollable

    if (!id || !track || !scrollable) return

    const tick = track.querySelector<HTMLElement>(`[data-slot="session-turn-rail-tick"][data-active="true"]`)

    if (!tick) return

    const top = tick.offsetTop
    const bottom = top + tick.offsetHeight

    if (top < track.scrollTop) {
      track.scrollTop = top

      return
    }

    if (bottom <= track.scrollTop + track.clientHeight) return

    track.scrollTop = bottom - track.clientHeight
  })

  return (
    <Show when={visible()}>
      <nav
        ref={(element) => {
          rail = element
        }}
        data-component="session-turn-rail"
        data-selecting={selecting() ? "true" : undefined}
        data-scrollable={layout().scrollable ? "true" : undefined}
        aria-label={language.t("session.historyRail.label")}
      >
        <div
          ref={setTrackEl}
          data-slot="session-turn-rail-track"
          data-hovering={hover() ? "true" : undefined}
          data-scrollable={layout().scrollable ? "true" : undefined}
          onScroll={followHover}
          onWheel={(event) => {
            if (!layout().scrollable) return
            // Keep chat scroll from fighting the rail ladder while the pointer is over it.
            event.stopPropagation()
          }}
        >
          <div
            data-slot="session-turn-rail-ladder"
            style={{ height: `${layout().contentHeight.toFixed(2)}px` }}
          >
            <For each={props.turns()}>
              {(message, index) => {
                const active = () => activeID() === message.id
                const failed = () => props.failed().has(message.id)

                const wave = () => {
                  const focus = focusIndex()

                  if (focus < 0) return 0

                  return Math.max(0, 1 - Math.abs(index() - focus) / waveRadius)
                }

                const label = () => turnLabel(message, index())

                return (
                  <button
                    type="button"
                    data-slot="session-turn-rail-tick"
                    data-active={active() ? "true" : undefined}
                    data-failed={failed() ? "true" : undefined}
                    style={{
                      top: `${(layout().offset + index() * layout().pitch).toFixed(2)}px`,
                      height: `${layout().pitch.toFixed(2)}px`,
                      "--turn-rail-wave": wave().toFixed(3),
                    }}
                    aria-label={label()}
                    aria-current={active() ? "true" : undefined}
                    onMouseEnter={(event) => showHover(message.id, event.currentTarget)}
                    onMouseLeave={() => setHover((value) => (value?.id === message.id ? undefined : value))}
                    onFocus={(event) => showHover(message.id, event.currentTarget)}
                    onBlur={() => setHover((value) => (value?.id === message.id ? undefined : value))}
                    onClick={() => props.onJump(message)}
                  />
                )
              }}
            </For>
          </div>
        </div>
        <Show when={selecting() ? undefined : hover()}>
          {(state) => (
            <div
              ref={(element) => {
                preview = element
              }}
              data-slot="session-turn-rail-preview"
              data-empty={!previewText() ? "true" : undefined}
              style={{
                top: `${clampPreview(state().top)}px`,
                "inset-inline-end": "100%",
                "margin-inline-end": "8px",
              }}
            >
              {previewText() || previewLabel()}
            </div>
          )}
        </Show>
      </nav>
    </Show>
  )
}
