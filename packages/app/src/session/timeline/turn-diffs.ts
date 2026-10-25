import type { FileDiffInfo } from "@opencode/client/promise"
import type { TurnDiffInput } from "@opencode/session-ui/context"
import { createStore } from "solid-js/store"

/**
 * One tab's in-memory cache of the files each finished prompt changed. A finished prompt's snapshots
 * never change, so each prompt loads once per tab and survives the timeline remounting; closing the tab
 * drops it.
 */
export function createTurnDiffCache() {
  const [diffs, setDiffs] = createStore<Record<string, readonly FileDiffInfo[] | undefined>>({})
  const loading = new Set<string>()
  // The prompt flag selects a different range for the same message, so it is part of the identity.
  const key = (input: TurnDiffInput) => `${input.sessionID}/${input.from}${input.prompt ? ":prompt" : ""}`

  return {
    get: (input: TurnDiffInput) => diffs[key(input)],
    load(input: TurnDiffInput, fetch: () => Promise<readonly FileDiffInfo[]>) {
      const id = key(input)

      if (diffs[id] || loading.has(id)) return
      loading.add(id)
      // A failed load leaves the turn unloaded, so the next request retries.
      void fetch()
        .then(
          (value) => setDiffs(id, value),
          () => undefined,
        )
        .finally(() => loading.delete(id))
    },
  }
}
