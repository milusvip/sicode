export * as CompactionMetrics from "./compaction-metrics.js"

import { Clock, Effect, Layer } from "effect"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import type { Event } from "@opencode/schema/event"
import { SessionEvent } from "@opencode/schema/session-event"
import { Bus } from "./bus.js"

/**
 * SiCode: how long a compaction blocks, and — once background precomputation is on — whether the
 * summary it wrote was actually used. Both answer the same question: is `background_compaction`
 * worth the tokens it spends. Without a record nobody could decide that with numbers, so the
 * setting stayed off. `bun script/compaction-stats.ts` reads these lines back out of the log.
 *
 * The timing here needs no change to `session/compaction.ts`: `Started` and `Ended` already carry
 * the reason and the session, so pairing them measures the wait exactly as a user feels it.
 */
const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const started = new Map<string, number>()

    const isSessionEvent = (event: Event.Payload): event is SessionEvent.Event =>
      Object.hasOwn(SessionEvent.All.cases, event.type)

    const unsubscribe = yield* bus.listen((payload) =>
      Effect.gen(function* () {
        if (!isSessionEvent(payload)) return
        if (payload.type === "session.compaction.started") {
          started.set(payload.data.sessionID, yield* Clock.currentTimeMillis)
          return
        }
        if (payload.type !== "session.compaction.ended" && payload.type !== "session.compaction.failed") return
        const at = started.get(payload.data.sessionID)
        started.delete(payload.data.sessionID)
        // A compaction resumed after a restart has no start to pair with; its duration would be a guess.
        if (at === undefined) return
        yield* Effect.logInfo("compaction.timing", {
          outcome: payload.type === "session.compaction.ended" ? "completed" : "failed",
          reason: payload.data.reason,
          durationMs: (yield* Clock.currentTimeMillis) - at,
        })
      }),
    )
    yield* Effect.addFinalizer(() => unsubscribe)
  }),
)

export const node = makeGlobalNode({ name: "compaction-metrics", layer, deps: [Bus.node] })
