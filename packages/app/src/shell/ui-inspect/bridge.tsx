import { onCleanup } from "solid-js"
import { useComposerState } from "@/composer/persistence"
import type { NoteContextItem } from "@/composer/schema"
import { bindUiInspectComposer } from "./controller"

/**
 * Binds the routed session/draft composer so the root inspect overlay can attach notes.
 * Mount inside `ComposerPersistenceProvider`.
 */
export function UiInspectComposerBridge() {
  const composer = useComposerState()

  // Do not read `context.items()` to verify: that accessor is resource-wrapped and stays
  // stale until the next tick, which made submit look like "no composer" while already in a session.
  const attach = (note: NoteContextItem) => {
    composer.context.add(note)

    return true
  }

  bindUiInspectComposer(attach)
  onCleanup(() => bindUiInspectComposer(undefined, attach))

  return null
}
