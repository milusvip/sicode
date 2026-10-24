export * as ConfigProjectMemoryPlugin from "./project-memory.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect, Stream } from "effect"
import { KV } from "../../kv.js"
import { Location } from "../../location.js"
import { parseSummary } from "../../session/project-memory.js"
import { ProjectMemoryStore } from "../../session/project-memory-store.js"

/**
 * SiCode: keeps the durable half of every compaction summary as project memory.
 *
 * A summary already separates what the next agent needs from what only described the session, so the facts are read
 * from it rather than asked for again: no extra model call, no work added to the turn. `session/compaction.ts` is left
 * untouched — this listens to the event it publishes.
 *
 * Nothing here writes to the project's files. Memory stays in the local database, keyed by the project directory, so a
 * checkout is never dirtied by a background operation and two checkouts of one repository stay apart.
 */
export const Plugin = define({
  id: "opencode.config.project-memory",
  effect: Effect.fn(function* (ctx) {
    const kv = yield* KV.Service
    const location = yield* Location.Service

    yield* ctx.event.subscribe().pipe(
      Stream.filter((event) => event.type === "session.compaction.ended"),
      Stream.runForEach((event) =>
        ProjectMemoryStore.record(kv, location.project.directory, parseSummary(event.data.text)).pipe(
          // A summary that cannot be kept must never fail the compaction that produced it.
          Effect.catchCause((cause) => Effect.logWarning("project memory not recorded", cause)),
        ),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
})
