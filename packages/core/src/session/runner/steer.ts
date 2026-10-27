/**
 * SiCode: which steering message, if any, replaces the tail of a step's request.
 *
 * A turn can go wrong in several ways at once — out of steps, stuck in a loop, exploring forever,
 * going quiet. Only one message is sent, so the order below is the priority: the conditions that
 * also withdraw tools come first, because they end the turn, and among those a reached step limit
 * outranks everything else. The softer pacing hints come last.
 *
 * Kept pure and separate from the runner so the ordering is testable without simulating a model.
 */
import { EXPLORE_BUDGET_PROMPT, EXPLORE_SOFT_PROMPT } from "./explore-budget.js"
import { FAILURE_RESEARCH_PROMPT } from "./failure-streak.js"
import { LOOP_NUDGE_PROMPT, LOOP_STOP_PROMPT } from "./loop-detection.js"
import { MAX_STEPS_PROMPT } from "./max-steps.js"
import { NARRATE_PROMPT } from "./narrate.js"

export interface Steer {
  readonly prompt: string
  /** `assistant` states the situation as the model's own; `system` is an instruction about form. */
  readonly role: "assistant" | "system"
  /** Withdraws tools for this request, which is what actually ends the turn. */
  readonly stop: boolean
}

export interface SteerInput {
  readonly stepLimitReached: boolean
  /** A loop that already survived a nudge this turn. */
  readonly loopStopped: boolean
  readonly exploreHard: boolean
  /** A loop seen for the first time this turn. */
  readonly loopNudged: boolean
  /** A failure streak that crossed its threshold this step. */
  readonly failureNudged: boolean
  readonly narrate: boolean
  readonly exploreSoft: boolean
}

export function selectSteer(input: SteerInput): Steer | undefined {
  if (input.stepLimitReached) return { prompt: MAX_STEPS_PROMPT, role: "assistant", stop: true }
  if (input.loopStopped) return { prompt: LOOP_STOP_PROMPT, role: "assistant", stop: true }
  if (input.exploreHard) return { prompt: EXPLORE_BUDGET_PROMPT, role: "assistant", stop: true }
  if (input.loopNudged) return { prompt: LOOP_NUDGE_PROMPT, role: "system", stop: false }
  if (input.failureNudged) return { prompt: FAILURE_RESEARCH_PROMPT, role: "system", stop: false }
  if (input.narrate) return { prompt: NARRATE_PROMPT, role: "system", stop: false }
  if (input.exploreSoft) return { prompt: EXPLORE_SOFT_PROMPT, role: "system", stop: false }
  return undefined
}
