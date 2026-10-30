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

If you are still hunting for where something lives or how something is wired — a multi-file search in plain language, not one exact symbol — stop grepping and reading file after file. Dispatch one \`subagent\` call (subagent_type "explore") with everything you still need, and let it return file:line pointers. Keep your own context small.

If you already have enough to answer or to act, do that now instead of reading more.`

export const EXPLORE_BUDGET_PROMPT = `You have spent many steps reading and searching without changing anything.

If you are still hunting for where something lives or how something is wired, stop grepping and reading file after file: dispatch one \`subagent\` call (subagent_type "explore") with everything you still need, and let it return file:line pointers. Keep your own context small.

If you are not hunting — you are reading a long document, or reasoning through an analysis that legitimately does not change files — ignore this and continue. Do not force an explore call you do not need.`

/** Tools that only look at things. Anything else counts as progress and ends the streak. */
const READ_ONLY_TOOLS = new Set(["read", "grep", "glob", "list", "webfetch", "websearch", "recall"])

/**
 * SiCode: a `shell` command whose job is only to look. The budget used to treat every shell call as
 * progress, so a model that searched via `rg`, `Get-ChildItem`, `Select-String`, `find`, or `git
 * log` — instead of the `grep`/`glob` tools — reset its read-only streak every step and explored
 * forever without ever tripping the budget. A command whose first word is one of these only reads,
 * so it counts as exploration, not progress.
 */
const SHELL_READ_ONLY_COMMANDS = /^(rg|grep|egrep|Get-ChildItem|Get-Content|Select-String|find|ls|dir|git\s+(log|show|status|diff|grep|branch)|where\.exe|where)\b/

function shellReadsOnly(part: Extract<SessionMessage.AssistantContent, { type: "tool" }>): boolean {
  const input = part.state.input as { command?: string } | undefined
  const command = input?.command?.trim()
  if (!command) return false
  return SHELL_READ_ONLY_COMMANDS.test(command)
}

/** Whether a single tool part only looks at things, rather than changing or building anything. */
function isReadOnlyTool(part: Extract<SessionMessage.AssistantContent, { type: "tool" }>): boolean {
  if (READ_ONLY_TOOLS.has(part.name)) return true
  if (part.name === "shell") return shellReadsOnly(part)
  return false
}

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
    if (!tools.every((part) => isReadOnlyTool(part))) break

    count += 1
  }

  return count
}
