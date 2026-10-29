import { DropdownMenu } from "@kobalte/core/dropdown-menu"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createStore } from "solid-js/store"
import { For, onMount, Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { ContextMenuGlyph } from "./icons"
import { startUiInspect } from "@/shell/ui-inspect/controller"
import {
  contextMenuSections,
  contextMenuSelected,
  contextMenuTarget,
  type ContextMenuActionID,
  type ContextMenuPlatform,
  type ContextMenuTarget,
} from "./model"
import "./context-menu.css"

const EDITABLE = 'input, textarea, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]'

// SiCode: message surfaces a whole-bubble copy applies to — the user bubble's text and the
// assistant answer body. `closest()` walks out of nested markdown nodes to the container.
const MESSAGE = '[data-slot="user-message-text"], [data-slot="text-part-body"]'

const EMPTY: ContextMenuTarget = {
  editable: false,
  selection: "",
  link: undefined,
  image: undefined,
  message: undefined,
  dev: false,
}

const EXTERNAL = new Set(["http:", "https:", "mailto:"])

// Developer items only exist in development builds, the way the native menu hides them when packaged.
const DEV = import.meta.env.DEV

function editableText(element: HTMLElement) {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const start = element.selectionStart ?? 0
    const end = element.selectionEnd ?? 0

    return end > start ? element.value.slice(start, end) : ""
  }

  return window.getSelection()?.toString() ?? ""
}

function externalLink(element: Element | null) {
  const anchor = element?.closest("a")

  if (!(anchor instanceof HTMLAnchorElement)) return undefined
  if (!EXTERNAL.has(new URL(anchor.href, location.href).protocol)) return undefined

  return anchor.href
}

// SiCode: `innerText`, not `textContent` — markdown blocks would concatenate without newlines.
function messageText(node: Element) {
  const bubble = node.closest<HTMLElement>(MESSAGE)

  return bubble?.innerText.trim() || undefined
}

function imageSource(node: Element) {
  const image = node.closest("img")

  return image?.src || undefined
}

// SiCode: the write goes through the renderer's own async clipboard — Electron 44 removed the
// main-process writeImage, and ClipboardItem is constructible here only. PNG passes through;
// anything else (webp/avif — what pastes and sites often carry) is re-encoded through a canvas,
// because Chromium only accepts image/png on the system clipboard. A fetch that cannot pass CORS
// or a lost user activation leaves the clipboard untouched; 复制图片地址 still works for that image.
async function copyImage(source: string) {
  try {
    const response = await fetch(source)
    const blob = await response.blob()
    const png = blob.type === "image/png" ? blob : await toPng(blob)

    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })])
  } catch {
    // Nothing sensible to surface from a menu action; the clipboard keeps its previous content.
  }
}

async function toPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement("canvas")
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0)

  const encoded = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("Image encoding failed"))), "image/png"),
  )

  bitmap.close()

  return encoded
}

function menuPlatform(os: string | undefined): ContextMenuPlatform {
  if (os === "macos" || os === "linux") return os

  return "windows"
}

/**
 * One right-click menu for the whole renderer. Native menus are suppressed by preventing the DOM
 * event, which also stops Electron from emitting `context-menu`; components that want their own
 * menu keep working because they prevent the event before it reaches this document listener.
 */
export function AppContextMenu() {
  const platform = usePlatform()
  const language = useLanguage()
  const [state, setState] = createStore({
    open: false,
    x: 0,
    y: 0,
    target: EMPTY,
    focus: undefined as HTMLElement | undefined,
  })

  const openAt = (x: number, y: number, target: ContextMenuTarget, focus: HTMLElement | undefined) => {
    // A right-click while the menu is open has to reopen: the popper only measures the anchor when
    // it mounts, so moving the anchor under a live menu would leave it at the old position.
    const reopen = state.open
    setState({ open: false, x, y, target, focus })

    if (!reopen) {
      setState("open", true)

      return
    }

    // The next frame guarantees the closed state flushed, so the menu remounts at the new anchor.
    requestAnimationFrame(() => setState("open", true))
  }

  const run = (action: ContextMenuActionID) => {
    // The menu owns focus while it is open; put it back before the native edit action runs.
    if (state.focus?.isConnected) state.focus.focus({ preventScroll: true })

    switch (action) {
      case "link.open": {
        if (state.target.link) platform.openExternal(state.target.link)

        return
      }
      case "link.copy": {
        if (state.target.link) void platform.writeClipboardText?.(state.target.link)

        return
      }
      case "message.copy": {
        if (state.target.message) void platform.writeClipboardText?.(state.target.message)

        return
      }
      case "image.copy": {
        // Focus first the same way the text actions do: the menu owns it while open.
        if (state.focus?.isConnected) state.focus.focus({ preventScroll: true })

        if (state.target.image) void copyImage(state.target.image)

        return
      }
      case "image.copyAddress": {
        if (state.target.image) void platform.writeClipboardText?.(state.target.image)

        return
      }
      case "edit.copy": {
        // Read-only selections are copied from the captured text: clicking a menu item can
        // collapse the document selection before the native action would read it.
        if (!state.target.editable && contextMenuSelected(state.target)) {
          void platform.writeClipboardText?.(state.target.selection)

          return
        }

        void platform.runDesktopMenuAction?.("edit.copy")

        return
      }
      case "view.inspectElement":
        // Dev Inspect Element picks app UI into the composer, not Electron DevTools.
        startUiInspect()

        return
      default:
        void platform.runDesktopMenuAction?.(action)
    }
  }

  onMount(() => {
    makeEventListener(
      document,
      "contextmenu",
      (event) => {
        // A component already claimed this click (session rows, project rows, editors).
        if (event.defaultPrevented) return

        const origin = event.target
        const node = origin instanceof Element ? origin : origin instanceof Node ? origin.parentElement : null

        if (!node) return
        // Never stack a menu on a menu: poppers and this menu handle their own surface.
        if (node.closest('[data-component="sicode-context-menu"], [data-popper-positioner]')) {
          event.preventDefault()

          return
        }

        const focus = node.closest<HTMLElement>(EDITABLE) ?? undefined
        const target = contextMenuTarget({
          editable: !!focus,
          selection: focus ? editableText(focus) : (window.getSelection()?.toString() ?? ""),
          link: externalLink(node),
          image: imageSource(node),
          message: messageText(node),
          dev: DEV,
        })

        event.preventDefault()

        // Keyboard-invoked context menus report no pointer position; anchor to the element instead.
        if (event.clientX === 0 && event.clientY === 0) {
          const bounds = node.getBoundingClientRect()
          openAt(bounds.left, bounds.bottom, target, focus)

          return
        }

        openAt(event.clientX, event.clientY, target, focus)
      },
      { capture: false },
    )
  })

  const sections = () => contextMenuSections(state.target, menuPlatform(platform.os))

  return (
    <DropdownMenu
      open={state.open}
      onOpenChange={(open) => setState("open", open)}
      modal={false}
      placement="bottom-start"
      gutter={2}
      shift={8}
      flip
      slide
    >
      <DropdownMenu.Trigger
        as="div"
        tabIndex={-1}
        aria-hidden="true"
        style={{
          position: "fixed",
          left: `${state.x}px`,
          top: `${state.y}px`,
          width: "0px",
          height: "0px",
          "pointer-events": "none",
        }}
      />
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          data-component="sicode-context-menu"
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <Show when={contextMenuSelected(state.target)}>
            <div data-slot="sicode-context-menu-selection">{state.target.selection}</div>
          </Show>
          <For each={sections()}>
            {(section, index) => (
              <>
                <Show when={index() > 0}>
                  <DropdownMenu.Separator data-slot="sicode-context-menu-separator" />
                </Show>
                <For each={section}>
                  {(item) => (
                    <DropdownMenu.Item
                      data-slot="sicode-context-menu-item"
                      data-variant={item.danger ? "danger" : undefined}
                      disabled={item.disabled}
                      onSelect={() => run(item.action)}
                    >
                      <span data-slot="sicode-context-menu-icon">
                        <ContextMenuGlyph action={item.action} />
                      </span>
                      <span data-slot="sicode-context-menu-label">{language.t(item.labelKey)}</span>
                      <Show when={item.shortcut}>
                        {(shortcut) => <span data-slot="sicode-context-menu-shortcut">{shortcut()}</span>}
                      </Show>
                    </DropdownMenu.Item>
                  )}
                </For>
              </>
            )}
          </For>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}
