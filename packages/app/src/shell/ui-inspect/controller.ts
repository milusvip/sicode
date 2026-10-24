import { createRoot, createSignal } from "solid-js"
import type { NoteContextItem } from "@/composer/schema"
import type { UiElement } from "./describe"
import { uiElementNote } from "./note"

export type UiInspectPhase = "idle" | "picking" | "comment"

type Attach = (note: NoteContextItem) => boolean

const root = createRoot(() => {
  const [phase, setPhase] = createSignal<UiInspectPhase>("idle")
  const [hover, setHover] = createSignal<UiElement | undefined>()
  const [picked, setPicked] = createSignal<UiElement | undefined>()
  const [draft, setDraft] = createSignal("")

  return { phase, setPhase, hover, setHover, picked, setPicked, draft, setDraft }
})

let attach: Attach | undefined

/**
 * Registers the active session/draft composer's attach handler while that route is mounted.
 * Pass `expected` on clear so a remounted bridge is not wiped by the previous owner's cleanup.
 */
export function bindUiInspectComposer(next: Attach | undefined, expected?: Attach) {
  if (next === undefined && expected !== undefined && attach !== expected) return
  attach = next
}

export function uiInspectPhase() {
  return root.phase()
}

export function uiInspectHover() {
  return root.hover()
}

export function uiInspectPicked() {
  return root.picked()
}

export function uiInspectDraft() {
  return root.draft()
}

export function setUiInspectDraft(value: string) {
  root.setDraft(value)
}

/** Starts picking an app UI element to attach as a composer note. */
export function startUiInspect() {
  root.setHover(undefined)
  root.setPicked(undefined)
  root.setDraft("")
  root.setPhase("picking")
}

export function cancelUiInspect() {
  root.setHover(undefined)
  root.setPicked(undefined)
  root.setDraft("")
  root.setPhase("idle")
}

export function setUiInspectHover(element: UiElement | undefined) {
  if (root.phase() !== "picking") return
  root.setHover(element)
}

export function pickUiInspect(element: UiElement) {
  root.setHover(undefined)
  root.setPicked(element)
  root.setDraft("")
  root.setPhase("comment")
}

/** Attaches the note to the bound composer. Returns false when no session/draft composer is open. */
export function submitUiInspect(comment: string) {
  const element = root.picked()
  const trimmed = comment.trim()

  if (!element || !trimmed) return false

  const attached = attach?.(uiElementNote(element, trimmed)) ?? false

  if (!attached) return false
  cancelUiInspect()

  return true
}
