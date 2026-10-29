import { createRoot, createSignal } from "solid-js"

export type SelectionQuote = (text: string) => boolean

const root = createRoot(() => {
  const [menu, setMenu] = createSignal<
    { x: number; y: number; below: boolean; text: string } | undefined
  >()

  return { menu, setMenu }
})

let quote: SelectionQuote | undefined

/**
 * Registers the active session/draft composer's quote handler while that route is mounted.
 * Pass `expected` on clear so a remounted bridge is not wiped by the previous owner's cleanup.
 */
export function bindSelectionQuote(next: SelectionQuote | undefined, expected?: SelectionQuote) {
  if (next === undefined && expected !== undefined && quote !== expected) return
  quote = next
}

export function selectionMenu() {
  return root.menu()
}

/**
 * Shows the bar above the selection's end, or below it when the selection starts near the top
 * where an above-anchor bar would clip.
 */
export function showSelectionMenu(rect: DOMRect, text: string) {
  root.setMenu({ x: rect.left, y: rect.top, below: rect.top < 80, text })
}

export function hideSelectionMenu() {
  root.setMenu(undefined)
}

/** Hands the selected text to the bound composer. False when no session/draft composer is open. */
export function quoteSelection(text: string) {
  return quote?.(text) ?? false
}
