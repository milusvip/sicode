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
 * Cursor refuses finish until every todo resolves. SiCode has no finish tool — a turn ends when the
 * model stops calling tools — so this gate refuses idle while the latest list still has open items.
 *
 * Structural rules (ses_e58cab861ffd: 40 idle-with-pending; content-only progress rewrites burned
 * soft continues then handed back):
 *   1. Open todos from *this user turn* ⇒ never idle from this gate alone. Escapes are only
 *      waitingOnUser / background shell / stepLimit (wired by the runner, not here).
 *   2. Fingerprint is status + stable id (or slot index). Content rewrites alone must NOT reset the
 *      continue budget — Flash otherwise renames "wait for user" forever and never escalates
 *      (ses_e4e536). Progress numbers in content also do not count as progress.
 *   3. Soft continues up to MAX_COMPLETION_CONTINUES; beyond that escalate to `toolChoice: todowrite`
 *      so the model must mark items completed/cancelled or keep working — still no idle handoff.
 *   4. Work blocked on the user (asset / answer) → `cancelled` now. Leaving it pending/in_progress
 *      is what keeps the drain spinning.
 *   5. Turn scope (ses_e4e536): hard force only for todos written *after* the latest user message.
 *      A new ask must not be yanked back to a prior-turn checklist — that fought corrections like
 *      「要中文的提示词」 after a misplanned PNG list. `detectPendingTodos` still sees the full
 *      ledger (UI / pill); `detectCompletableTodos` is what refuses idle.
 */

import type { SessionMessage } from "../message.js"
import { hasTodowriteSinceUser } from "./planning-gate.js"

/** An unfinished todo, read back out of the latest `todowrite` call. */
export interface PendingTodo {
  readonly content: string
  readonly status: string
  /** Stable id from todowrite when present — preferred over content for the fingerprint. */
  readonly id?: string
}

/** Continues already spent against the current open-todo fingerprint this drain. */
export interface CompletionContinueState {
  fingerprint: string
  count: number
  /**
   * SiCode: next request must call todowrite — soft continues exhausted without a status change.
   * Cleared when the open set fingerprint changes (item completed/cancelled) or the list clears.
   */
  toolChoice?: "todowrite"
}

/** Open todos that matter for the gate: still open, not merely listed as done or cancelled. */
const OPEN_STATUSES = new Set(["pending", "in_progress"])

/**
 * Soft continues against one unchanged open set before escalating to forced `todowrite`.
 * Completing/cancelling an item changes the fingerprint and resets the budget.
 */
export const MAX_COMPLETION_CONTINUES = 8

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
        const row = todo as Record<string, unknown>
        const status = String(row.status ?? "")
        if (!OPEN_STATUSES.has(status)) continue
        const id = typeof row.id === "string" && row.id.trim() ? row.id.trim() : undefined
        pending.push({
          content: String(row.content ?? "").trim(),
          status,
          ...(id ? { id } : {}),
        })
      }
      return pending
    }
  }
  return []
}

/**
 * Open todos that may refuse idle / inflate step closeout. Empty when the latest list is from
 * before the current user message — the user spoke, so that checklist is no longer a hard debt.
 */
export function detectCompletableTodos(messages: ReadonlyArray<SessionMessage.Info>): PendingTodo[] {
  if (!hasTodowriteSinceUser(messages)) return []
  return detectPendingTodos(messages)
}

/**
 * SiCode: progress text ("11.9/134.7 MB") must not reset the continue budget — only status /
 * membership changes count. Strip common progress noise from the content key.
 */
export function stableTodoKey(todo: PendingTodo): string {
  if (todo.id) return todo.id
  return todo.content
    .replace(/\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?/g, "#/#")
    .replace(/\d+(?:\.\d+)?\s*%/g, "#%")
    .replace(/\d+(?:\.\d+)?\s*(?:MB|GB|KB|mb|gb|kb)\b/g, "#u")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Stable key for "these todos are still open". Prefer id; otherwise slot index — never content.
 * Content-only rewrites used to reset the budget and loop forever on "wait for user" items.
 */
export function completionFingerprint(todos: ReadonlyArray<PendingTodo>): string {
  return todos.map((todo, index) => `${todo.status}:${todo.id ?? `#${index}`}`).join("\n")
}

/** Soft reminder: finish or update statuses. */
export function completionGatePrompt(todos: ReadonlyArray<PendingTodo>): string {
  const lines = todos.map((todo) => `- [${todo.status}] ${todo.content}`)
  return [
    "You stopped with todos still open. Finish them before answering, or update the list:",
    ...lines,
    "",
    "Do the next open item now without narrating the checklist. Do not ask the user whether to continue while work is still pending/in_progress.",
    "If an item is blocked on the user (they must supply a file, answer, or asset), mark it cancelled now — do not leave it pending/in_progress.",
    "Resolve each remaining item, or mark it completed/cancelled. Do not end the turn while tasks are still pending.",
  ].join("\n")
}

/**
 * SiCode: soft continues were ignored — force a todowrite that changes status. Rewriting the
 * progress sentence alone is not progress.
 */
export function completionGateEscalatePrompt(todos: ReadonlyArray<PendingTodo>): string {
  const lines = todos.map((todo) => `- [${todo.status}] ${todo.content}`)
  return [
    "You keep stopping with the same open todos. This step must call `todowrite`.",
    ...lines,
    "",
    "Update statuses now: finished → completed; blocked on the user / impossible → cancelled; only real remaining work stays pending/in_progress.",
    "Do not rewrite the wording of a wait-for-user item and leave it open. Then do the next open item — or clear the list. Do not end the turn while tasks are still pending.",
  ].join("\n")
}

/**
 * True while completion-gate already forced at least one continue this drain and todos are still
 * open. Search-cap / search-miss must not withdraw tools in this window — their `none` used to beat
 * escalate's `todowrite` (prose idle × escalate syn when steer.none outranks).
 */
export function isCompletionHolding(openTodoCount: number, continueCount: number): boolean {
  return openTodoCount > 0 && continueCount > 0
}

/**
 * Provider toolChoice for a step. Completion escalate outranks steer stops (`none`) so the model
 * can still call `todowrite` after a search budget stop.
 */
export function resolveStepToolChoice(input: {
  readonly completionToolChoice?: "todowrite" | string
  readonly steerToolChoice?: "none" | "required" | string
  readonly steerStop?: boolean
}): "none" | "required" | string | undefined {
  if (input.completionToolChoice) return input.completionToolChoice
  if (input.steerToolChoice) return input.steerToolChoice
  if (input.steerStop) return "none"
  return undefined
}

/**
 * Decide whether to refuse idle. Empty pending → allow. Open pending → always force; after the soft
 * budget, escalate to `toolChoice: todowrite`. Never hand back solely because the budget expired.
 */
export function completionContinue(input: {
  readonly pending: ReadonlyArray<PendingTodo>
  readonly state: CompletionContinueState
}): {
  readonly force: boolean
  readonly state: CompletionContinueState
  readonly prompt?: string
} {
  if (input.pending.length === 0) return { force: false, state: { fingerprint: "", count: 0 } }

  const fingerprint = completionFingerprint(input.pending)
  const count = fingerprint === input.state.fingerprint ? input.state.count : 0
  const next = count + 1
  const escalate = count >= MAX_COMPLETION_CONTINUES

  return {
    force: true,
    state: {
      fingerprint,
      count: next,
      ...(escalate ? { toolChoice: "todowrite" as const } : {}),
    },
    prompt: escalate ? completionGateEscalatePrompt(input.pending) : completionGatePrompt(input.pending),
  }
}

/**
 * SiCode: ses_e537b4fa — open todos ("Finish pack:release") + a still-running background shell made
 * completion-gate force another step; the model only `read` the shell ID in a loop until interrupt.
 * BACKGROUND_INSTRUCTION already says idle until the finish notification. Treat a live background
 * shell like `turnAwaitingUser`: do not refuse idle for open todos while that shell is still running.
 *
 * Source of truth is the transcript metadata the shell tool writes (`status: "running"` + shellID),
 * not the live process table — the runner may not hold Shell.Service in every drain path.
 */
export function waitingOnBackgroundShell(messages: ReadonlyArray<SessionMessage.Info>): boolean {
  const userAt = messages.findLastIndex((message) => message.type === "user")
  if (userAt < 0) return false

  const lastByID = new Map<string, string>()
  for (let index = userAt + 1; index < messages.length; index++) {
    const message = messages[index]!
    if (message.type !== "assistant") continue
    for (const part of message.content) {
      if (part.type !== "tool" || part.name !== "shell") continue
      if (part.state.status !== "completed" && part.state.status !== "running" && part.state.status !== "error") continue
      const metadata = part.state.metadata as Record<string, unknown> | undefined
      const shellID = typeof metadata?.shellID === "string" ? metadata.shellID : undefined
      if (!shellID) continue
      const status = typeof metadata?.status === "string" ? metadata.status : undefined
      if (status === "running") lastByID.set(shellID, "running")
      else if (status === "completed" || status === "error" || status === "timeout" || status === "cancelled")
        lastByID.set(shellID, status)
      // A kill call leaves no status — treat missing status after a prior running as still unknown.
    }
  }

  for (const status of lastByID.values()) {
    if (status === "running") return true
  }
  return false
}
