import { makeEventListener } from "@solid-primitives/event-listener"
import { onMount, Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { hideSelectionMenu, quoteSelection, selectionMenu, showSelectionMenu } from "./controller"

const EDITABLE = 'input, textarea, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]'

// Conversation rows only: the composer, the file tree, and editors keep their own selection flows.
const CONVERSATION = "[data-timeline-key]"

/**
 * The drag-selection bar for the conversation: a small 复制 / 引用 pair anchored to the selection.
 * Mounted at the app shell next to the right-click menu; the quote target is bound per route.
 */
export function SelectionMenu() {
  const platform = usePlatform()
  const language = useLanguage()

  onMount(() => {
    makeEventListener(document, "mouseup", (event) => {
      // Right-click keeps the selection for the context menu; presses on the bar are handled there.
      if (event.button !== 0) return
      const node = event.target instanceof Element ? event.target : null

      if (node?.closest('[data-component="selection-menu"]')) return

      const selection = window.getSelection()
      const text = selection?.toString() ?? ""

      if (!selection || selection.isCollapsed || !text.trim()) return hideSelectionMenu()

      const anchor = selection.anchorNode?.parentElement

      if (!anchor?.closest(CONVERSATION) || anchor.closest(EDITABLE)) return hideSelectionMenu()

      showSelectionMenu(selection.getRangeAt(0).getBoundingClientRect(), text)
    })
    // The anchor moves with every scroll, so the bar hides instead of chasing the selection.
    makeEventListener(window, "scroll", () => hideSelectionMenu(), { capture: true })
    makeEventListener(document, "keydown", (event) => {
      if (event.key === "Escape") hideSelectionMenu()
    })
  })

  const quote = () => {
    const menu = selectionMenu()

    if (!menu) return
    if (quoteSelection(menu.text)) {
      window.getSelection()?.removeAllRanges()
      hideSelectionMenu()
    }
  }

  const copy = () => {
    const menu = selectionMenu()

    if (menu) void platform.writeClipboardText?.(menu.text)
    hideSelectionMenu()
  }

  return (
    <Show when={selectionMenu()}>
      {(menu) => (
        <div
          data-component="selection-menu"
          class="fixed z-50 flex items-center overflow-hidden rounded-lg border border-v2-border-border-weak-base bg-v2-background-bg-layer-02 text-v2-text-text-base shadow-lg"
          style={{
            left: `${menu().x}px`,
            top: `${menu().y}px`,
            // Above the selection's end by default; flipped below near the viewport top.
            transform: menu().below ? "translateY(8px)" : "translateY(-100%) translateY(-6px)",
          }}
          // The press must not collapse the selection the buttons act on.
          onPointerDown={(event) => event.preventDefault()}
        >
          <button
            type="button"
            class="cursor-pointer px-3 py-1.5 text-13-regular hover:bg-v2-overlay-simple-overlay-hover"
            onClick={copy}
          >
            {language.t("desktop.menu.copy")}
          </button>
          <button
            type="button"
            class="cursor-pointer px-3 py-1.5 text-13-regular hover:bg-v2-overlay-simple-overlay-hover"
            onClick={quote}
          >
            {language.t("session.quote")}
          </button>
        </div>
      )}
    </Show>
  )
}
