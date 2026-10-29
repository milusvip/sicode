import { onCleanup } from "solid-js"
import { useComposerState } from "@/composer/persistence"
import { useLanguage } from "@/runtime/i18n/language"
import type { NoteContextItem } from "@/composer/schema"
import { bindSelectionQuote } from "./controller"

/** Origin for notes attached from a conversation selection's quote button. */
export const SELECTION_QUOTE_ORIGIN = "quote"

/**
 * Binds the routed session/draft composer so the selection bar can quote into it.
 * Mount inside `ComposerPersistenceProvider`, next to the ui-inspect bridge.
 */
export function SelectionQuoteBridge() {
  const composer = useComposerState()
  const language = useLanguage()

  const attach = (text: string) => {
    // The quote rides the same note channel as the element picker: a chip above the input the
    // model receives with the message, removable before submit.
    const note: NoteContextItem = {
      type: "note",
      origin: SELECTION_QUOTE_ORIGIN,
      commentID: crypto.randomUUID(),
      label: language.t("session.quote"),
      icon: "speech-bubble",
      subject: "text quoted from the conversation",
      comment: text,
    }
    composer.context.add(note)

    return true
  }

  bindSelectionQuote(attach)
  onCleanup(() => bindSelectionQuote(undefined, attach))

  return null
}
