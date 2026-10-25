export * as SessionRunnerRetry from "./retry.js"

import { AIError, isRetryable } from "@opencode/ai"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { SessionError } from "@opencode/schema/session-error"
import { Clock, Duration, Effect, Metric } from "effect"
import { Bus } from "../../bus.js"
import { ModelRetry } from "../../model-retry.js"
import type { PluginHooks } from "../../plugin/hooks.js"
import { SessionEvent } from "../event.js"
import { SessionMessage } from "../message.js"
import { SessionSchema } from "../schema.js"

export { isRetryable }

// SiCode: Cursor's retry story is three telemetry events — retry_attempt, retry_success, max_retries_exhausted — and
// no UI at all. Same shape here, as one counter differentiated by `event`, so a bad relay can be diagnosed from
// metrics instead of from a user reporting "it just span". The user-visible half is the RetryScheduled session event.
const retryEvents = Metric.counter("opencode_session_retry_total", {
  description: "Provider retry lifecycle events",
  incremental: true,
})
const telemetry = (event: "attempt" | "success" | "exhausted", attributes: Record<string, string> = {}) =>
  Metric.update(retryEvents.pipe(Metric.withAttributes({ event, ...attributes })), 1).pipe(Effect.asVoid)

interface Input {
  readonly cause: AIError
  readonly error: SessionError.Error
  readonly agent: Agent.ID
  readonly model: Model.Ref
  readonly hook: (event: PluginHooks.Domains["session"]["retry"]) => Effect.Effect<void>
  readonly retry: boolean
}

export interface Decision {
  readonly retry: true
  readonly attempt: number
  readonly delay: number
}

export const policy = (sessionID: SessionSchema.ID) =>
  Effect.gen(function* () {
    const decide = yield* ModelRetry.policy
    return (input: Input) =>
      Effect.gen(function* () {
        const next = yield* decide(input)
        if (!next) {
          // The attempt schedule ran out. Only count it when we actually wanted to retry: a non-retryable failure
          // (bad request, auth, user cancel) is not an exhausted budget.
          if (input.retry) yield* telemetry("exhausted")
          return { retry: false as const }
        }
        const event: PluginHooks.Domains["session"]["retry"] = {
          sessionID,
          agent: input.agent,
          model: input.model,
          error: input.error,
          attempt: next.attempt,
          decision: next.retry ? { retry: true, delay: next.delay } : { retry: false },
        }
        yield* input.hook(event)
        if (!event.decision.retry) {
          if (input.retry) yield* telemetry("exhausted")
          return event.decision
        }
        const normalized =
          Number.isFinite(event.decision.delay) && event.decision.delay >= 0
            ? Math.ceil(event.decision.delay)
            : next.delay
        return { retry: true as const, attempt: next.attempt, delay: normalized }
      })
  })

export const make = (bus: Bus.Interface, sessionID: SessionSchema.ID) =>
  Effect.gen(function* () {
    const decide = yield* policy(sessionID)
    // Retries are scoped to one logical Step (`runStep` builds this service once per Step), so the count resets
    // whenever the step is settled — which is exactly the unit Cursor reports as retry_success.
    let attempts = 0
    const wait = (input: {
      readonly decision: Decision
      readonly assistantMessageID: SessionMessage.ID
      readonly error: SessionError.Error
    }) =>
      Effect.gen(function* () {
        attempts = input.decision.attempt
        yield* telemetry("attempt", { attempt: String(input.decision.attempt) })
        const scheduled = yield* Clock.currentTimeMillis
        yield* bus.publish(SessionEvent.RetryScheduled, {
          sessionID,
          assistantMessageID: input.assistantMessageID,
          attempt: input.decision.attempt,
          at: scheduled + input.decision.delay,
          error: input.error,
        })
        const remaining = Math.max(0, scheduled + input.decision.delay - (yield* Clock.currentTimeMillis))
        yield* Effect.sleep(Duration.millis(remaining))
      })
    // Called when the Step completes: a completion after one or more retries is the only evidence that the retry
    // actually rescued the turn.
    const succeed = () => (attempts === 0 ? Effect.void : telemetry("success", { attempts: String(attempts) }))
    return { decide, wait, succeed }
  })
