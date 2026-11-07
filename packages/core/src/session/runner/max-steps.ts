/**
 * SiCode: the default step ceiling that ends a turn when a model runs away.
 *
 * Upstream leaves `agent.steps` undefined by default, so `stepLimitReached` — the only
 * unconditional hard stop in the runner — never fired. A model that kept editing and re-verifying
 * (not a loop, not read-only, not a failure streak) could run 77 or 132 steps while the user
 * watched. Cursor caps its agent at 25 tool calls by default and turns "stop" into a checkpoint
 * the user resumes with one word; this mirrors that: 25 steps is enough for a normal multi-file
 * change, and short enough to cut off a runaway turn before it eats minutes.
 */

import type { SessionMessage } from "../message.js"
import { detectCompletableTodos } from "./completion-gate.js"

/** Steps a turn may take before the runner stops it and hands back to the user. */
export const DEFAULT_STEPS = 25

/**
 * SiCode: extra headroom granted to a turn the model itself planned out as multi-step.
 *
 * `DEFAULT_STEPS` is tuned to cut off a runaway turn — a model that edits and re-verifies in circles
 * without a plan. But a real multi-file change (wire a field, add a test, verify) legitimately needs
 * more than 25 steps, and hitting the ceiling mid-task leaves the user a "remaining work" list
 * instead of a finished job. The signal that separates the two is the todo list: the todo tool's own
 * contract is "use it when a task has 3 or more distinct steps", so a model that wrote a plan and is
 * still working through it is a real long task, while a runaway turn plans nothing.
 */
export const TODO_HEADROOM = 25

/**
 * SiCode: the step ceiling that actually applies this turn, given what the model has planned.
 *
 * A configured `agent.steps` always wins. Otherwise a turn whose *current-user-turn* todowrite left
 * at least two items open is treated as a real long task and granted `DEFAULT_STEPS + TODO_HEADROOM`;
 * a turn with no such plan keeps the tight `DEFAULT_STEPS` so a runaway spiral is still cut off.
 */
export function effectiveStepLimit(
  messages: ReadonlyArray<SessionMessage.Info>,
  configuredSteps?: number,
): number {
  if (configuredSteps !== undefined) return configuredSteps
  if (plannedMultiStepTurn(messages)) return DEFAULT_STEPS + TODO_HEADROOM
  return DEFAULT_STEPS
}

/**
 * Whether *this user turn* planned a multi-step job (≥2 open todos after the latest user message).
 * Prior-turn leftovers must not grant headroom or closeout — that fought new asks (ses_e4e536).
 */
function plannedMultiStepTurn(messages: ReadonlyArray<SessionMessage.Info>): boolean {
  return detectCompletableTodos(messages).length >= 2
}

export const MAX_STEPS_PROMPT = `CRITICAL - MAXIMUM STEPS REACHED

You have reached the maximum number of steps for this turn. Stop calling tools now and hand control back to the user.

Respond with a concise text summary only:
1. What you have accomplished so far.
2. What remains unfinished, and the exact next action that would continue it.

Do not call any tools. End the turn here — the user can ask you to continue and you will pick up from this summary.`

/** Extra steps after the ceiling when todos are still open — close out, do not status-essay. */
export const TODO_CLOSEOUT_STEPS = 3

/**
 * Step ceiling hit but todos still open. One short closeout window: finish/cancel via todowrite
 * or land the in_progress deliverable — not a "remaining work" report.
 */
export const MAX_STEPS_TODO_CLOSEOUT_PROMPT = `CRITICAL - STEP BUDGET HIT WITH OPEN TODOS

You hit the step ceiling, but the todo list still has open items. Do not write a status essay.

This closeout window: call \`todowrite\` to mark finished work completed and drop impossible items cancelled, then do at most one real deliverable for the current in_progress item (write/edit). Prefer closing the list over starting new investigation.`
