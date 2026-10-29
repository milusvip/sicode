export * as SessionStats from "./session-stats.js"

import { Schema } from "effect"
import { Model } from "./model.js"
import { Money } from "./money.js"
import { DateTimeUtcFromMillis, NonNegativeInt, optional } from "./schema.js"
import { TokenUsage } from "./token-usage.js"

export const Activity = Schema.Struct({
  date: Schema.String,
  steps: NonNegativeInt,
}).annotate({ identifier: "SessionStats.Activity" })
export type Activity = typeof Activity.Type

/**
 * SiCode: where a step's wall clock went, split at the provider's first output event.
 *
 * `queue` is dispatch→firstOutput (the endpoint acquiring the request and prefilling it) and
 * `generation` is firstOutput→streamed. Only steps recorded after the probe existed can be split,
 * hence `sampled`; `steps` on the parent still counts every step.
 */
export const Latency = Schema.Struct({
  sampled: NonNegativeInt,
  /** Median ms from dispatch to the provider's first output event. */
  queueP50: Schema.Finite.pipe(optional),
  /** Median ms from the first output event to the end of the stream. */
  generationP50: Schema.Finite.pipe(optional),
  /** Median ms for the whole step, including stream end to settled tool results. */
  stepP50: Schema.Finite.pipe(optional),
  /** Share of prompt tokens served by the provider's prefix cache across these steps. */
  cacheRead: Schema.Finite.pipe(optional),
}).annotate({ identifier: "SessionStats.Latency" })
export type Latency = typeof Latency.Type

export const ModelUsage = Schema.Struct({
  model: Model.Ref,
  steps: NonNegativeInt,
  tokens: TokenUsage.Info,
  cost: Money.USD,
  latency: Latency.pipe(optional),
}).annotate({ identifier: "SessionStats.ModelUsage" })
export type ModelUsage = typeof ModelUsage.Type

export const ToolUsage = Schema.Struct({
  name: Schema.String,
  calls: NonNegativeInt,
  succeeded: NonNegativeInt,
  failed: NonNegativeInt,
  unfinished: NonNegativeInt,
  durationP50: Schema.Finite.pipe(optional),
}).annotate({ identifier: "SessionStats.ToolUsage" })
export type ToolUsage = typeof ToolUsage.Type

export const ToolMode = Schema.Literals(["none", "summary", "detail"])
export type ToolMode = typeof ToolMode.Type

export const ToolTotals = Schema.Struct({
  calls: NonNegativeInt,
  succeeded: NonNegativeInt,
  failed: NonNegativeInt,
  unfinished: NonNegativeInt,
}).annotate({ identifier: "SessionStats.ToolTotals" })
export type ToolTotals = typeof ToolTotals.Type

export const Tools = Schema.Union([
  Schema.Struct({ mode: Schema.Literal("none") }),
  Schema.Struct({ mode: Schema.Literal("summary"), totals: ToolTotals }),
  Schema.Struct({ mode: Schema.Literal("detail"), totals: ToolTotals, usage: Schema.Array(ToolUsage) }),
]).annotate({ identifier: "SessionStats.Tools" })
export type Tools = typeof Tools.Type

export const Info = Schema.Struct({
  range: Schema.Struct({
    from: DateTimeUtcFromMillis,
    to: DateTimeUtcFromMillis,
  }),
  sessions: NonNegativeInt,
  subagents: NonNegativeInt,
  prompts: NonNegativeInt,
  steps: NonNegativeInt,
  tokens: TokenUsage.Info,
  cost: Money.USD,
  tools: Tools,
  activeDays: NonNegativeInt,
  streak: NonNegativeInt,
  activity: Schema.Array(Activity),
  models: Schema.Array(ModelUsage),
}).annotate({ identifier: "SessionStats.Info" })
export type Info = typeof Info.Type
