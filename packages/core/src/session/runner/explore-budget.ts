/**
 * SiCode: exploration budget.
 *
 * A turn can read for a very long time without changing anything: the model keeps opening files,
 * grepping, and re-deriving the same picture, while the user watches a "working" badge with no idea
 * whether it is converging. `silentSteps` only covers the case where it says nothing at all; a model
 * that narrates happily can still spend dozens of steps exploring.
 *
 * Two thresholds, both keyed on consecutive read-only steps with no write/edit:
 *   - soft: ask for a short status (what is confirmed, what is still missing) before the next tool.
 *   - hard: stop the turn and make it hand back a summary, the same way the step limit does.
 *
 * Read-only means nothing was changed, not that the task is pointless: investigation tasks are
 * legitimately read-only. The budget exists so a long investigation reports in instead of running
 * silently until the user gives up.
 */
import type { SessionMessage } from "../message.js"

export const EXPLORE_SOFT_STEPS = 12
export const EXPLORE_HARD_STEPS = 24

export const EXPLORE_SOFT_PROMPT = `You have spent several steps reading and searching without changing anything.

Before your next tool call, write one or two sentences: what you have confirmed so far, and what you still need. If you already have enough to answer or to act, do that now instead of reading more.`

export const EXPLORE_BUDGET_PROMPT = `CRITICAL - EXPLORATION BUDGET EXHAUSTED

You have spent many steps reading and searching without changing anything. Stop exploring in this turn.

Reply with:
1. What you have confirmed so far, in a few lines.
2. What you still do not know.
3. The single next action you would take, or the question you need answered to continue.

Do not call any more tools in this turn.`

/** Tools that only look at things. Anything else counts as progress and ends the streak. */
const READ_ONLY_TOOLS = new Set(["read", "grep", "glob", "list", "webfetch", "websearch", "recall"])

/**
 * Trailing assistant steps of the current turn that only read. A step breaks the streak when it
 * changes something (write/edit/patch/execute) or when it carries no tool at all — the latter means
 * the model already stopped to answer.
 */
export function readOnlySteps(messages: ReadonlyArray<SessionMessage.Info>) {
  let count = 0

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!
    if (message.type === "user") break
    if (message.type !== "assistant") continue
    const tools = message.content.filter((part) => part.type === "tool")
    if (tools.length === 0) break
    if (!tools.every((part) => READ_ONLY_TOOLS.has(part.name))) break

    count += 1
  }

  return count
}
