/**
 * SiCode: planning soft gate (Cursor-shaped).
 *
 * Cursor lets the model open TodoWrite by discretion and refuses *finish* while todos stay open.
 * SiCode mirrors that split:
 *   - Here: soft remind to open/update a list (never `toolChoice: todowrite` for "you forgot to plan").
 *   - `completion-gate`: refuse idle while *this user turn's* list still has open items (finish
 *     equivalent), escalating to forced `todowrite` only when the model tries to stop mid-list.
 *     Prior-turn leftovers are ledger-only — they do not refuse idle after a new ask.
 *
 * Soft alone used to be ignored for Flash — that cost is accepted to stop mid-turn "force a
 * checklist" theater that Cursor does not do. The finish refuse stays hard.
 *
 * The gate only runs when the tool is in the snapshot (default-on, opt-out via experimental.todo).
 * Simple one-shot answers rarely reach TODO_START_STEPS, so they stay untouched.
 */

import type { SessionMessage } from "../message.js"

/** Assistant steps before the first soft "open a todo list" reminder. */
export const TODO_START_STEPS = 4

/**
 * SiCode: when the user sends a short continue after a fully completed plan, remind earlier
 * (step 1). Soft only — Cursor does not force TodoWrite on continue either.
 */
export const TODO_CONTINUE_START_STEPS = 1

/**
 * SiCode: finished tool calls after the latest `todowrite` before the list counts as stale. Three
 * is the point where the pill has fallen behind by enough work to be misleading, and low enough
 * that the reminder rides on a request the model was going to make anyway.
 */
export const TODO_STALE_STEPS = 3

export const TODO_START_SOFT_PROMPT = `This turn already has several steps and no todo list.

If the remaining work is medium/large implementation (several nontrivial steps), call \`todowrite\` with a short checklist — few large verb-led items, not a micro-breakdown. Skip for one–two step or conversational work. Do not stop other work just to open a list.`

export const TODO_CONTINUE_SOFT_PROMPT = `The user asked to continue after the previous checklist finished.

If the next phase is still medium/large, call \`todowrite\` with a short next checklist (few large items), mark the first in_progress, and act. Prefer a recommended default over asking which path to take.`

export const TODO_STALE_PROMPT = `Your todo list no longer matches the work you have done. The user reads it as a progress bar, so a stale list is a wrong answer about progress.

Call \`todowrite\` with the full list now: mark finished items completed, keep exactly one item in_progress, and only add a new item when real work turned up a new outcome — do not grow a micro-checklist. Then continue without narrating the list in chat.`

/**
 * SiCode: progress drift, not progress absence.
 *
 * `detectPendingTodos` (completion-gate) only looks at the turn boundary, and `hasTodowriteSinceUser`
 * only asks whether a list exists at all. Neither notices the shape the pill actually shows: a list
 * written once, then three or more finished tool calls later still claiming the same item is in
 * progress. The todo tool is stateless — the list is the model's own input echoed back — so the only
 * way to keep the pill honest is to make the model rewrite it.
 *
 * Returns the number of finished tool calls since the latest `todowrite` when the list has open
 * items, else 0. The runner turns that into a steer that rides the next request, so the reminder
 * costs no extra round trip.
 */
export function staleTodoSteps(messages: ReadonlyArray<SessionMessage.Info>): number {
  let finished = 0
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!
    if (message.type !== "assistant") continue
    for (let part = message.content.length - 1; part >= 0; part--) {
      const item = message.content[part]!
      if (item.type !== "tool") continue
      if (item.name !== "todowrite") {
        if (item.state.status === "completed") finished++
        continue
      }
      if (item.state.status !== "completed" && item.state.status !== "running") continue
      // The newest list wins: a `Todos cleared` call is the model's own "done".
      const todos = item.state.input?.todos
      if (!Array.isArray(todos)) return 0
      const open = todos.some((todo) => {
        if (typeof todo !== "object" || todo === null) return false
        const status = (todo as Record<string, unknown>).status
        return status === "pending" || status === "in_progress"
      })
      return open && finished >= TODO_STALE_STEPS ? finished : 0
    }
  }
  return 0
}

/** Whether any completed/running `todowrite` appears after the latest user message. */
export function hasTodowriteSinceUser(messages: ReadonlyArray<SessionMessage.Info>): boolean {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!
    if (message.type === "user") return false
    if (message.type !== "assistant") continue
    for (const part of message.content) {
      if (part.type !== "tool" || part.name !== "todowrite") continue
      if (part.state.status === "completed" || part.state.status === "running") return true
    }
  }
  return false
}

/** Latest user prompt text (SessionMessage.user carries `text`). */
export function latestUserText(messages: ReadonlyArray<SessionMessage.Info>): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!
    if (message.type !== "user") continue
    return typeof message.text === "string" ? message.text.trim() : ""
  }
  return ""
}

/**
 * Short continue / ack — length + shape only (no continue-phrase vocabulary).
 * Latin acks up to 12 chars; other scripts up to 4 graphemes. Rejects questions and path tokens.
 */
export function isContinueUserPrompt(text: string): boolean {
  const trimmed = text.trim().replace(/[。.!！…]+$/u, "")
  if (trimmed.length === 0) return false
  if (/[?？]/u.test(trimmed)) return false
  if (/\b[\w.-]+\.[A-Za-z0-9]{1,8}\b|[A-Za-z]:\\|(?:^|\s)(?:\.\/|~\/|\/)/.test(trimmed)) return false
  const chars = [...trimmed]
  if (/^[a-zA-Z]/.test(trimmed)) return chars.length <= 12 && !/\s{2,}/.test(trimmed)
  return chars.length <= 4
}

/**
 * True when the most recent `todowrite` before the latest user message had no open items — the
 * prior phase finished cleanly, so a short continue means "open the next checklist".
 */
export function priorPlanFullyCompleted(messages: ReadonlyArray<SessionMessage.Info>): boolean {
  const userAt = messages.findLastIndex((message) => message.type === "user")
  if (userAt <= 0) return false

  for (let index = userAt - 1; index >= 0; index--) {
    const message = messages[index]!
    if (message.type !== "assistant") continue
    for (let part = message.content.length - 1; part >= 0; part--) {
      const item = message.content[part]!
      if (item.type !== "tool" || item.name !== "todowrite") continue
      if (item.state.status !== "completed" && item.state.status !== "running") continue
      const todos = item.state.input?.todos
      if (!Array.isArray(todos) || todos.length === 0) return false
      return !todos.some((todo) => {
        if (typeof todo !== "object" || todo === null) return false
        const status = (todo as Record<string, unknown>).status
        return status === "pending" || status === "in_progress"
      })
    }
  }
  return false
}

/** Earlier soft threshold for a continue-after-finished-plan turn, else undefined. */
export function continuePlanStartThresholds(
  messages: ReadonlyArray<SessionMessage.Info>,
): { softAt: number } | undefined {
  if (!isContinueUserPrompt(latestUserText(messages))) return undefined
  if (!priorPlanFullyCompleted(messages)) return undefined
  return { softAt: TODO_CONTINUE_START_STEPS }
}
