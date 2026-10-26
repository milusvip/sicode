/**
 * SiCode: completion gate.
 *
 * `loop-detection` catches a model that repeats itself, `explore-budget` one that only reads,
 * and `narrate` one that goes silent. None catches the remaining shape: a model that wrote a todo
 * list, then stops to answer while tasks are still `pending` or `in_progress`. Nothing is stuck —
 * the model simply declares itself done before the work is. The todo tool is stateless (its result
 * is echoed, never persisted), so the only ledger of "what was promised" is the most recent
 * `todowrite` in the transcript.
 *
 * Cursor enforces this with a structured `<completion_spec>` that refuses the `finish`/`summary`
 * tool until every todo resolves. SiCode has no finish tool — a turn ends when the model stops
 * calling tools — so the gate is a nudge: when the runner is about to end the turn but the latest
 * todo list still has unfinished items, it injects one reminder and forces one more step instead of
 * letting the turn die. It fires once per fingerprint, so a model that genuinely considers the
 * todos stale is not nagged twice.
 */

import type { SessionMessage } from "../message.js"

/** An unfinished todo, read back out of the latest `todowrite` call. */
export interface PendingTodo {
  readonly content: string
  readonly status: string
}

/** Todos that matter for the gate: still open, not merely listed as done or cancelled. */
const OPEN_STATUSES = new Set(["pending", "in_progress"])

/**
 * The unfinished todos from the most recent `todowrite`, or `[]` when the transcript has none. The
 * scan stops at the first `todowrite` walking backwards: a later `Todos cleared` (empty list) is the
 * model's own "done", and must win over any earlier list.
 */
export function detectPendingTodos(messages: ReadonlyArray<SessionMessage.Info>): PendingTodo[] {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.type !== "assistant") continue
    for (const part of message.content) {
      if (part.type !== "tool" || part.name !== "todowrite") continue
      if (part.state.status !== "completed" && part.state.status !== "running") continue
      const todos = part.state.input?.todos
      if (!Array.isArray(todos)) continue
      const pending: PendingTodo[] = []
      for (const todo of todos) {
        if (typeof todo !== "object" || todo === null) continue
        const status = String((todo as Record<string, unknown>).status ?? "")
        if (!OPEN_STATUSES.has(status)) continue
        pending.push({
          content: String((todo as Record<string, unknown>).content ?? "").trim(),
          status,
        })
      }
      return pending
    }
  }
  return []
}

/** A stable key for "these todos are still open", so a second idle stop is not nagged again. */
export function completionFingerprint(todos: ReadonlyArray<PendingTodo>): string {
  return todos.map((todo) => `${todo.status}:${todo.content}`).join("\n")
}

/** The reminder injected when the turn is about to end with unfinished todos. */
export function completionGatePrompt(todos: ReadonlyArray<PendingTodo>): string {
  const lines = todos.map((todo) => `- ${todo.content}`)
  return [
    "You stopped with todos still open. Finish them before answering, or update the list:",
    ...lines,
    "",
    "Either resolve each remaining item, or mark it completed/cancelled if it is actually done. Do not end the turn while tasks are still pending.",
  ].join("\n")
}
