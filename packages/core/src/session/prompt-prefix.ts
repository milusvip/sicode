export * as PromptPrefix from "./prompt-prefix.js"

import { Hash } from "@opencode/util/hash"
import { Effect, Metric } from "effect"

/**
 * SiCode: the client-side half of what Cursor measures as `agent.prompt_prefix.rebuilt`.
 *
 * A provider caches on a byte-stable prefix. Everything the request puts in front of the changing conversation —
 * system prompt, tool definitions, model identity — has to stay identical between steps or the cache misses and the
 * turn pays full input price again. Nothing in the request path currently notices when that happens, so a change that
 * quietly reorders tools (or injects per-step text before the transcript) shows up only as "the agent got slower".
 *
 * The fingerprint is deliberately coarse: same model, same sorted tool names, same system parts ⇒ same prefix. It is
 * recorded per session, so the metric counts real rebuilds inside a conversation rather than requests overall.
 */
const rebuilds = Metric.counter("opencode_session_prompt_prefix_rebuilt_total", {
  description: "Requests whose cacheable prompt prefix changed since the previous step",
  incremental: true,
})

/** Sessions are long-lived but bounded per process; cap the bookkeeping rather than growing it forever. */
const MAX_TRACKED_SESSIONS = 512
const seen = new Map<string, string>()

export interface Input {
  readonly sessionID: string
  readonly model: { readonly providerID: string; readonly id: string; readonly variant?: string }
  readonly tools: ReadonlyArray<{ readonly name: string }>
  readonly system: ReadonlyArray<{ readonly text: string }>
}

const fingerprint = (input: Input) =>
  Hash.fast(
    JSON.stringify({
      model: `${input.model.providerID}/${input.model.id}${input.model.variant ? `#${input.model.variant}` : ""}`,
      // Sorted: providers cache on the rendered list, so only a membership change is a rebuild.
      tools: input.tools.map((tool) => tool.name).sort(),
      // Per-part hashes keep the CPU cost flat as the system prompt grows with rules and project files.
      system: input.system.map((part) => Hash.fast(part.text)),
    }),
  )

/** Record this step's prefix and report whether it differs from the session's previous one. */
export const observe = (input: Input) =>
  Effect.gen(function* () {
    const current = fingerprint(input)
    const previous = seen.get(input.sessionID)
    if (seen.size >= MAX_TRACKED_SESSIONS && !seen.has(input.sessionID)) seen.clear()
    seen.set(input.sessionID, current)
    if (previous === undefined) return false
    if (previous === current) return false
    yield* Metric.update(rebuilds, 1)
    yield* Effect.logDebug("prompt prefix rebuilt", { sessionID: input.sessionID, previous, current })
    return true
  })

/** Drop a session's record so a resumed conversation starts from a clean slate. */
export const forget = (sessionID: string) => {
  seen.delete(sessionID)
}
