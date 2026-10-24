import { Icon } from "@opencode/ui/icon"
import { LineCommentEditor } from "@opencode/ui/line-comment"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createMemo, onCleanup, onMount, Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { showToast } from "@/shell/notifications/toast"
import {
  cancelUiInspect,
  pickUiInspect,
  setUiInspectDraft,
  setUiInspectHover,
  submitUiInspect,
  uiInspectDraft,
  uiInspectHover,
  uiInspectPhase,
  uiInspectPicked,
} from "./controller"
import { describeElement, elementAtPoint, type UiElement } from "./describe"
import "./ui-inspect.css"

function isInspectChrome(node: Element) {
  return !!node.closest('[data-component="ui-inspect"], [data-component="sicode-context-menu"]')
}

function labelPosition(rect: UiElement["rect"]) {
  const top = rect.y > 24 ? rect.y - 22 : rect.y + rect.height + 4

  return {
    left: `${Math.max(8, Math.min(rect.x, window.innerWidth - 200))}px`,
    top: `${Math.max(8, top)}px`,
  }
}

function editorPosition(rect: UiElement["rect"]) {
  const width = Math.min(400, window.innerWidth - 16)
  const left = Math.max(8, Math.min(rect.x, window.innerWidth - width - 8))
  const below = rect.y + rect.height + 8
  const top = below + 200 > window.innerHeight ? Math.max(8, rect.y - 208) : below

  return {
    left: `${left}px`,
    top: `${top}px`,
  }
}

/**
 * Full-window picker for development "Inspect Element": hover highlight, click to comment,
 * attach a note to the active session/draft composer.
 */
export function UiInspectOverlay() {
  const language = useLanguage()
  const phase = createMemo(() => uiInspectPhase())
  const spotlight = createMemo(() => (phase() === "comment" ? uiInspectPicked() : uiInspectHover()))

  const onMove = (event: PointerEvent) => {
    if (phase() !== "picking") return
    const node = elementAtPoint(event.clientX, event.clientY, isInspectChrome)

    if (!node || node === document.documentElement || node === document.body) {
      setUiInspectHover(undefined)

      return
    }

    setUiInspectHover(describeElement(node))
  }

  const onClick = (event: MouseEvent) => {
    if (phase() !== "picking") return
    event.preventDefault()
    event.stopPropagation()
    const node = elementAtPoint(event.clientX, event.clientY, isInspectChrome)

    if (!node || node === document.documentElement || node === document.body) return
    pickUiInspect(describeElement(node))
  }

  const onKey = (event: KeyboardEvent) => {
    if (phase() === "idle") return

    if (event.key === "Escape") {
      event.preventDefault()
      cancelUiInspect()
    }
  }

  onMount(() => {
    makeEventListener(window, "keydown", onKey, true)
  })

  onCleanup(() => {
    if (phase() !== "idle") cancelUiInspect()
  })

  const submit = (value: string) => {
    if (submitUiInspect(value)) return
    showToast({ title: language.t("uiInspect.noComposer") })
  }

  return (
    <Show when={phase() !== "idle"}>
      <div
        data-component="ui-inspect"
        data-phase={phase()}
        onPointerMove={onMove}
        onPointerDown={(event) => {
          if (phase() === "picking") {
            event.preventDefault()
            event.stopPropagation()
          }

          // A click beside the editor dismisses it unless it would discard a draft.
          if (phase() === "comment" && event.target === event.currentTarget && !uiInspectDraft().trim()) {
            cancelUiInspect()
          }
        }}
        onClick={onClick}
      >
        <Show when={spotlight()}>
          {(current) => (
            <>
              <div
                data-slot="ui-inspect-spotlight"
                style={{
                  left: `${current().rect.x}px`,
                  top: `${current().rect.y}px`,
                  width: `${current().rect.width}px`,
                  height: `${current().rect.height}px`,
                }}
              />
              <Show when={phase() === "picking"}>
                <div data-slot="ui-inspect-label" style={labelPosition(current().rect)}>
                  {current().label}
                </div>
              </Show>
            </>
          )}
        </Show>
        <Show when={phase() === "comment" && uiInspectPicked()}>
          {(current) => (
            <div
              data-slot="ui-inspect-editor"
              data-prevent-autofocus
              style={editorPosition(current().rect)}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <LineCommentEditor
                value={uiInspectDraft()}
                onInput={setUiInspectDraft}
                onCancel={cancelUiInspect}
                onSubmit={submit}
                placeholder={language.t("uiInspect.placeholder")}
                selection={
                  <span class="flex min-w-0 items-center gap-1" dir="ltr">
                    <Icon name="select-element" size="small" class="shrink-0" />
                    <span class="min-w-0 truncate leading-[var(--line-height-tight)]">{current().label}</span>
                  </span>
                }
              />
            </div>
          )}
        </Show>
        <p class="sr-only" role="status" aria-live="polite">
          {phase() === "picking" ? language.t("uiInspect.active") : ""}
        </p>
      </div>
    </Show>
  )
}
