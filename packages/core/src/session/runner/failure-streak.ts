/**
 * SiCode: failure-streak detection — the deterministic trigger for "stop grinding, go research".
 *
 * The prompt rules ask the model to search the web for prior art when stuck, but the model counts
 * "the same approach failing twice" itself, and a grinder always has a variant: change a selector,
 * move a bracket, rerun with one flag different — each retry is a "new approach" in its own
 * ledger, so the rule never fires. Tool failures are objective events the runner can count instead.
 *
 * What counts as failed: a tool that settled in `error` (user declines and interrupts are
 * `aborted`, not the model's fault, so excluded), and a shell command that exited non-zero or
 * timed out — the shell reports those as completed results, and a failing test command is the
 * most common grind signal there is.
 *
 * Triggering uses a trailing window, not the whole turn: four failures scattered across a long
 * turn is exploration, four in the last twelve calls is a grind. The nudge re-fires every few
 * further failures so a model that ignores it keeps hearing it until the step limit ends the turn.
 */
import type { SessionMessage } from "../message.js"

/** Failed calls inside the window before the first research nudge. */
export const FAILURE_STREAK_FIRST = 4
/** Whole-turn failures that must accumulate again between nudges. */
export const FAILURE_STREAK_EVERY = 3
/** Only the trailing tool calls count; earlier scattered failures age out. */
export const FAILURE_STREAK_WINDOW = 12

export const FAILURE_RESEARCH_PROMPT = `You have produced several failed tool calls in a row of work that is not converging.

Stop retrying variants of the same approach — repeated failure is evidence the route is wrong, not that you were unlucky. Before your next attempt:

1. Search the web (websearch) for how others solved this exact problem — an existing project, library, or write-up usually beats another attempt from scratch. Fetch the most promising result (webfetch) and read it.
2. If you already searched and it did not help, change the angle of the query, pick a different route, or ask the user.
3. Say in one line what you are switching to and why.`

type ToolPart = Extract<SessionMessage.AssistantContent, { type: "tool" }>

/** A declined call or an interrupted step is not the model failing; everything else settling badly is. */
function isFailure(part: ToolPart): boolean {
  if (part.state.status === "error") return part.state.error.type !== "aborted"
  if (part.state.status === "completed") {
    const metadata = part.state.metadata
    if (!metadata) return false
    if (metadata.timeout === true) return true
    return typeof metadata.exit === "number" && metadata.exit !== 0
  }
  return false
}

/** Settled tool calls of this turn, oldest first; a user message ends the turn. */
function trailingToolCalls(messages: ReadonlyArray<SessionMessage.Info>): ToolPart[] {
  const calls: ToolPart[] = []
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!
    if (message.type === "user") break
    if (message.type !== "assistant") continue
    for (const part of message.content) {
      if (part.type !== "tool") continue
      if (part.state.status === "streaming" || part.state.status === "running") continue
      calls.unshift(part)
    }
  }
  return calls
}

export interface FailureStreak {
  /** Failed calls in the trailing window — what the trigger compares against. */
  readonly recent: number
  /** Failed calls in the whole turn — monotonic, so the caller can pace re-nudges on it. */
  readonly total: number
}

/** How much of the recent work is failing, or `null` when there is nothing settled to count. */
export function detectFailureStreak(messages: ReadonlyArray<SessionMessage.Info>): FailureStreak | null {
  const calls = trailingToolCalls(messages)
  if (calls.length === 0) return null
  const failed = calls.map(isFailure)
  const total = failed.filter(Boolean).length
  const recent = failed.slice(-FAILURE_STREAK_WINDOW).filter(Boolean).length
  return { recent, total }
}
