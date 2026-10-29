import { describe, expect } from "bun:test"
import { AIError, ProviderInternalError, RateLimitError } from "@opencode/ai/effect"
import { ModelRetry } from "@opencode/core/model-retry"
import { Effect } from "effect"
import { it } from "./lib/effect"

const delayFor = (cause: AIError) =>
  Effect.gen(function* () {
    const decide = yield* ModelRetry.policy
    const next = yield* decide({ cause, retry: true })
    return next?.delay
  })

// The first gap of the schedule is 2s; jitter keeps it within ±20%, so anything an order of magnitude larger can only
// have come from the provider's `Retry-After`.
const BACKOFF_CEILING = 5_000

describe("ModelRetry.policy", () => {
  it.effect("ignores a relay's Retry-After on a 5xx", () =>
    Effect.gen(function* () {
      // A 502 behind a gateway that asks for 57s. Honouring it froze the session for most of a minute on a blip the
      // backoff schedule recovers from in two.
      const cause = new AIError({
        reason: new ProviderInternalError({ message: "Bad Gateway", retryAfterMs: 57_000 }),
      })
      expect(yield* delayFor(cause)).toBeLessThan(BACKOFF_CEILING)
    }),
  )

  it.effect("honours Retry-After on a throttle", () =>
    Effect.gen(function* () {
      const cause = new AIError({
        reason: new RateLimitError({ message: "Slow down", retryAfterMs: 57_000 }),
      })
      const delay = yield* delayFor(cause)
      expect(delay).toBeGreaterThanOrEqual(57_000)
      expect(delay).toBeLessThan(57_000 + BACKOFF_CEILING)
    }),
  )

  it.effect("still caps a throttle's Retry-After at a minute", () =>
    Effect.gen(function* () {
      const cause = new AIError({
        reason: new RateLimitError({ message: "Come back tomorrow", retryAfterMs: 3_600_000 }),
      })
      expect(yield* delayFor(cause)).toBe(60_000)
    }),
  )
})
