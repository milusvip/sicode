export * as ModelRetry from "./model-retry.js"

import { AIError, isRetryable } from "@opencode/ai/effect"
import { Clock, Duration, Effect, Pull, Schedule } from "effect"

interface Input {
  readonly cause: AIError
  readonly retry: boolean
}

// SiCode: a provider-requested delay used to be honoured up to 15 minutes, which froze a session for longer than any
// hang it was meant to avoid and gave the user nothing to look at. Cap it at a minute; anything longer is better
// surfaced as a failure the timeline can show than as silence.
const RETRY_AFTER_MAX = Duration.toMillis("1 minute")

// SiCode: only a throttle gets to dictate the wait. A 429 means "come back when the window reopens" and the provider
// is the one authority on that, so honouring it avoids burning the whole attempt budget on a wall that is still up.
// A 5xx (`ProviderInternal`) carries `Retry-After` too, but from relays it is routinely nonsense — a 502 behind a
// gateway reported 57s, which turned one transient blip into a minute of a frozen session while our own backoff
// (2s/4s/8s, then 10s) would have recovered the same blip in a fraction of that. Ignore it there and let the
// schedule above decide.
const retryAfter = (input: Input) => {
  if (input.cause.reason._tag !== "RateLimit") return undefined
  if (input.cause.reason.retryAfterMs === undefined) return undefined
  return Math.min(input.cause.reason.retryAfterMs, RETRY_AFTER_MAX)
}

// Exponential from 2s capped at 10s per gap, for 10 retries: 2, 4, 8, then 10 × 7, about 84s of
// waiting when every attempt fails (67–101s with jitter). `min` takes the faster schedule, so the
// cap applies per gap; `max` with `recurs` bounds the count.
const schedule = Schedule.max([
  Schedule.min([Schedule.exponential("2 seconds"), Schedule.spaced("10 seconds")]),
  Schedule.recurs(10),
]).pipe(
  Schedule.jittered,
  Schedule.setInputType<Input>(),
  Schedule.modifyDelay(({ input, duration: delay }) => {
    // SiCode: a timeout attempt already spent its whole window (30s by default) waiting for a frame, so backing off
    // another 2s/4s/10s buys nothing — it just stretches the silence the user is staring at. Resend at once and let
    // the attempt budget, not the schedule, decide when to give up.
    const timedOut = input.cause.reason._tag === "Transport" && input.cause.reason.code === "Timeout"
    const minimum = retryAfter(input)
    if (timedOut) return Effect.succeed(minimum === undefined ? Duration.zero : Duration.millis(minimum))
    const duration = minimum === undefined ? delay : Duration.max(delay, Duration.millis(minimum))
    return Effect.succeed(Duration.millis(Math.ceil(Duration.toMillis(duration))))
  }),
)

// A timed-out attempt already waited minutes before failing, so the general allowance would let a
// dead provider hold a call for most of an hour. Cap those attempts well below it.
const MAX_TIMEOUT_RETRIES = 3

export const policy = Effect.gen(function* () {
  const step = yield* Schedule.toStep(schedule)
  let attempt = 1
  let timeouts = 0
  return (input: Input) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const next = yield* step(now, input).pipe(Pull.catchDone(() => Effect.succeed(undefined)))
      if (!next) return undefined
      const [, duration] = next
      attempt++
      if (input.cause.reason._tag === "Transport" && input.cause.reason.code === "Timeout") timeouts++
      return {
        attempt,
        delay: Math.ceil(Duration.toMillis(duration)),
        retry: input.retry && timeouts <= MAX_TIMEOUT_RETRIES,
      }
    })
})

/** Retry a buffered model call from scratch; failed attempts never contribute to its returned output. */
export const retry = <A, R>(effect: Effect.Effect<A, AIError, R>) =>
  Effect.gen(function* () {
    const decide = yield* policy
    while (true) {
      const result = yield* Effect.result(effect)
      if (result._tag === "Success") return result.success
      const decision = yield* decide({ cause: result.failure, retry: isRetryable(result.failure) })
      if (!decision?.retry) return yield* result.failure
      yield* Effect.sleep(Duration.millis(decision.delay))
    }
  })
