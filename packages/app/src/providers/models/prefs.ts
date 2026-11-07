import { Schema } from "effect"
import { Persistence } from "@/runtime/persistence/schema"
import { Persist, persisted } from "@/runtime/persistence/storage"

export type ModelSelectorTab = "mine" | "free" | "all"

export { compareProviderOrder, reorderProviderOrder } from "./provider-order"

const ModelSelectorPrefsSchema = Persistence.struct({
  tab: Schema.Literals(["mine", "free", "all"]),
  providerOrder: Schema.Array(Schema.String),
})

type ModelSelectorPrefsStore = ReturnType<typeof createModelSelectorPrefsStore>

let shared: ModelSelectorPrefsStore | undefined

function createModelSelectorPrefsStore() {
  return persisted(
    { ...Persist.global("model-selector.prefs.v1"), sync: true },
    ModelSelectorPrefsSchema,
    {
      tab: "mine" as ModelSelectorTab,
      providerOrder: [] as string[],
    },
  )
}

/** Shared picker segment + provider order. One store so manage and select stay in sync. */
export function useModelSelectorPrefs() {
  shared ??= createModelSelectorPrefsStore()
  return shared
}
