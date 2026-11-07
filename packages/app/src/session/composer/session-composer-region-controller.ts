import type { Accessor } from "solid-js"
import type { SessionRequestModel } from "../requests/model"

export function createSessionComposerRegionController(input: {
  state: SessionRequestModel
  parentID: Accessor<string | undefined>
  centered: Accessor<boolean>
  onResponseSubmit: () => void
  openParent: () => void
  setPromptRef: (el: HTMLDivElement) => void
  setDockRef: (el: HTMLDivElement) => void
  /** SiCode: expand a background shell/tool in the active timeline without a route change. */
  onReveal?: (target: string) => void
}) {
  return {
    state: input.state,
    centered: input.centered,
    onResponseSubmit: input.onResponseSubmit,
    openParent: input.openParent,
    setPromptRef: input.setPromptRef,
    setDockRef: input.setDockRef,
    onReveal: input.onReveal,
    parentID: input.parentID,
    child: () => !!input.parentID(),
    showComposer: () => !input.state.blocked() || !!input.parentID(),
  }
}

export type SessionComposerRegionController = ReturnType<typeof createSessionComposerRegionController>
