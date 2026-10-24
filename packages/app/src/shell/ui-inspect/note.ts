import type { NoteContextItem } from "@/composer/schema"
import type { UiElement } from "./describe"

/** Origin for notes attached from the app chrome element picker. */
export const UI_INSPECT_ORIGIN = "ui"

/**
 * Builds the composer note for a picked UI element. No href: the chip is informational;
 * opening it would need a live element ref this process does not keep.
 */
export function uiElementNote(element: UiElement, comment: string): NoteContextItem {
  return {
    type: "note",
    origin: UI_INSPECT_ORIGIN,
    commentID: crypto.randomUUID(),
    label: element.label,
    icon: "select-element",
    subject: subject(element),
    comment,
  }
}

function subject(element: UiElement) {
  const details = [
    element.role ? `role ${element.role}` : undefined,
    element.name ? `accessible name ${JSON.stringify(element.name)}` : undefined,
    element.text && element.text !== element.name ? `text ${JSON.stringify(element.text.slice(0, 80))}` : undefined,
    element.selector
      ? `selector ${JSON.stringify(element.selector)}${element.selector.includes(" >>> ") ? ' (">>>" enters a shadow root)' : ""}`
      : undefined,
  ].filter((detail) => detail !== undefined)

  return `the ${JSON.stringify(element.label)} element in the SiCode UI${details.length ? ` (${details.join("; ")})` : ""}`
}
