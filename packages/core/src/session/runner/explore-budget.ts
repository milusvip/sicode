/**
 * SiCode: exploration budget.
 *
 * A turn can read for a very long time without changing anything: the model keeps opening files,
 * grepping, and re-deriving the same picture, while the user watches a "working" badge with no idea
 * whether it is converging. `silentSteps` only covers the case where it says nothing at all; a model
 * that narrates happily can still spend dozens of steps exploring.
 *
 * Two thresholds, both keyed on consecutive steps that changed nothing in the project:
 *   - soft: ask for a short status (what is confirmed, what is still missing) before the next tool.
 *   - hard (long document): urge the model to hand remaining search to `explore` — hint only
 *     (`stop: false`), because a long read must not be cut off mid-document.
 *   - hard + spin (`spinningSteps` > 0): still hunting *or* grinding throwaway measurement scripts.
 *     Withdraw tools and demand an answer (`stop: true`). `locatingSteps` alone missed ses_e5ea441c
 *     at the hard threshold — the trailing streak was scratch write+run, so locating was 0 and a
 *     hard hint burned another ~15 minutes.
 *
 * A step also changes nothing when its only effect is throwaway work in a scratch/temp directory
 * (see `THROWAWAY_DIR`): writing a measurement script and running it is investigation, not progress.
 *
 * Read-only means nothing was changed, not that the task is pointless: investigation tasks are
 * legitimately read-only. The budget exists so a long investigation reports in instead of running
 * silently until the user gives up.
 *
 * SiCode: soft was 12 — Flash often already knows the bug by ~6–8 steps (ses_e6ce: root cause at
 * step ~7, first edit at ~19). Soften earlier so "act now" lands before another 2 minutes of
 * optional verification. Hard stays 24.
 *
 * When the latest user message already names the answer (path / host token), soft fires every
 * EXPLORE_SOFT_STEPS_USER_HINT steps instead — same prompt, faster cadence (ses_e6cda: user pointed
 * at youxishanhao.com and Flash kept scanning). Do not add a second steer channel for that.
 *
 * SiCode: a soft nudge was advisory, and Flash treated it as advisory — it read the reminder, said
 * nothing, and grepped again. Two escalations sit above it now:
 *   - force: one read-only step after a soft nudge means the reminder was ignored, so the next
 *     request advertises only EXPLORE_FOCUS_TOOLS. The tool list is what actually constrains a
 *     model; a prompt it can decline is not a budget.
 *   - handoff: eight read-only steps that are mostly searches is a locate task that is lost, not a
 *     long document. The request forces `toolChoice: subagent` (explore) and drops grep/glob/shell
 *     so the main context only comes back with file:line. Gated on searches dominating the run —
 *     a long document read never gets this force.
 */
import type { SessionMessage } from "../message.js"

export const EXPLORE_SOFT_STEPS = 6
/** Faster soft cadence after the user already named a path or affirmed a candidate. */
export const EXPLORE_SOFT_STEPS_USER_HINT = 2
export const EXPLORE_HARD_STEPS = 24
/** Read-only steps tolerated after a soft nudge before the next step is narrowed to EXPLORE_FOCUS_TOOLS. */
export const EXPLORE_FORCE_GRACE = 1
/** Read-only steps that are mostly searches before the turn is forced to hand off to `explore`. */
export const EXPLORE_HANDOFF_STEPS = 8
/**
 * Tools a narrowed exploration step may still call: act on what is already known, read a file that
 * was already located, or hand the remaining hunt to a subagent. No `grep`/`glob`/`shell`, which is
 * the whole point — the model cannot answer "search once more" with another search.
 */
// SiCode: include todowrite so a narrowed step can still open/update a plan instead of only hunting.
// No `write`: under force the model authored scratch scripts instead of editing or answering
// (ses_e5ea441c). Real file changes go through `edit`/`patch`; new deliverable files wait until
// the turn is no longer narrowed.
export const EXPLORE_FOCUS_TOOLS = ["read", "edit", "patch", "subagent", "callgraph", "lsp", "todowrite"] as const

export const EXPLORE_SOFT_PROMPT = `You have spent several steps reading and searching without changing anything.

If the user already named the path, file, host, or folder — stop searching. Report that location (or act on it) now. Do not keep verifying live sites, sibling folders, or whole-disk scans.

If you already know the root cause or the file/line to change — stop verifying adjacent code. Edit or write the fix now (or answer the user). Extra confirmation reads are optional and usually waste the turn.

If you are still hunting for where something lives or how something is wired — a multi-file search in plain language, not one exact symbol — stop grepping and reading file after file. Dispatch one \`subagent\` call (subagent_type "explore") with everything you still need, and let it return file:line pointers. Keep your own context small.

If you already have enough to answer or to act, do that now instead of reading more.`

export const EXPLORE_BUDGET_PROMPT = `You have spent many steps reading and searching without changing anything.

If you are still hunting for where something lives or how something is wired, stop grepping and reading file after file: dispatch one \`subagent\` call (subagent_type "explore") with everything you still need, and let it return file:line pointers. Keep your own context small.

If you are not hunting — you are reading a long document, or reasoning through an analysis that legitimately does not change files — ignore this and continue. Do not force an explore call you do not need.`

/**
 * SiCode: hard threshold reached while the turn is still spinning (`spinningSteps` > 0) — either
 * searching or writing/running throwaway measurement scripts. Soft hints already had their chance;
 * withdrawing tools is what ends the spin (ses_e5ea441c kept going ~15 minutes after a hard hint).
 */
export const EXPLORE_HARD_LOCATE_PROMPT = `You have spent many steps searching or measuring without changing the project, and that is still most of what you do.

Stop. Answer with what you have now:

1. What you found (paths, file:line, numbers, conclusions).
2. What you still do not know.
3. The next concrete action for the user — or the edit you would make if you already know it.

Do not call any more tools in this turn. Do not write another scratch script.`

/**
 * SiCode: the soft nudge already went out and the model read again. Prompt-only (full tool list
 * stays advertised for cache); ask it to act or hand off instead of searching again.
 */
export const EXPLORE_FORCE_PROMPT = `You were asked to stop searching and act, and searched again. Do not grep, glob, or shell this step — edit, write, patch, read a known path, or hand off via subagent.

Pick one and do it:

- You already know the file or line — call \`edit\` or \`patch\` and make the change.
- You already know the answer — answer the user now, no more tool calls.
- You still do not know where it lives — call \`subagent\` with agent "explore" and everything you still need. It returns file:line pointers.
- You need one specific file you have already located — call \`read\` on it, then act.

Do not restate the plan. Do not ask to search again. Prefer not to \`write\` throwaway scripts this step.`

/**
 * SiCode: read-only steps that were mostly searches crossed EXPLORE_HANDOFF_STEPS. That is a locate
 * task that is lost, not a long document, so the turn is handed to `explore` instead of continuing
 * to fill the main context with partial hits. Bound by toolChoice=subagent (definitions stay full).
 */
export const EXPLORE_HANDOFF_PROMPT = `You have spent many steps searching without changing anything, and searching is still most of what you do. The hunt is not converging.

This step forces one \`subagent\` call (agent "explore"). Put everything you still need into the prompt — what you are looking for, what you already ruled out, and the terms you tried. It returns file:line pointers; your own context stays small.

Do not search yourself on this step. Once the pointers come back, read only those files and act.

The only allowed call this step is \`subagent\`.`

/**
 * Latest user turn looks like they already pointed at the answer (short affirm / named path),
 * so soft explore should fire sooner — still the same EXPLORE_SOFT_PROMPT.
 */
export function userPointedAnswer(messages: ReadonlyArray<SessionMessage.Info>): boolean {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!
    if (message.type !== "user") continue
    const text = message.text.trim()
    if (text.length === 0 || text.length > 400) return false
    // Structural: path / host tokens only — no affirm-phrase vocabulary.
    return (
      /[A-Za-z]:\\[^\s]+/.test(text) ||
      /(?:^|\s)(?:\.\/|~\/|\/)[\w./-]+/.test(text) ||
      /\b[\w-]+\.(?:com|cn|net|org|io)\b/i.test(text)
    )
  }
  return false
}

/** Soft explore period for this turn: shorter when the user already named the answer. */
export function exploreSoftEvery(messages: ReadonlyArray<SessionMessage.Info>): number {
  return userPointedAnswer(messages) ? EXPLORE_SOFT_STEPS_USER_HINT : EXPLORE_SOFT_STEPS
}

/** Tools that only look at things. Anything else counts as progress and ends the streak. */
const READ_ONLY_TOOLS = new Set(["read", "grep", "glob", "list", "webfetch", "websearch", "recall", "history", "chats"])

/**
 * SiCode: a `shell` command whose job is only to look. The budget used to treat every shell call as
 * progress, so a model that searched via `rg`, `Get-ChildItem`, `Select-String`, `find`, or `git
 * log` — instead of the `grep`/`glob` tools — reset its read-only streak every step and explored
 * forever without ever tripping the budget. A command whose first word is one of these only reads,
 * so it counts as exploration, not progress.
 */
const SHELL_READ_ONLY_COMMANDS = /^(rg|grep|egrep|Get-ChildItem|Get-Content|Select-String|find|ls|dir|git\s+(log|show|status|diff|grep|branch)|where\.exe|where)\b/

/**
 * SiCode: PowerShell often assigns before reading (`$b=[IO.File]::ReadAllBytes(...)`), so the
 * first-word matcher above never sees Get-Content. Inline .NET reads are still look-only.
 */
const SHELL_READ_ONLY_INLINE = /\[(?:System\.)?IO\.File\]::ReadAll(?:Bytes|Text)\b/

/**
 * SiCode: directories that hold throwaway work, not the deliverable. A model that is asked an open
 * research question has a way to look busy without changing anything: write `.sicode/scratch/audit.ts`,
 * run it, read the numbers, write `audit2.ts`. Every one of those `write` calls used to count as
 * progress and reset the read-only streak, so the budget never fired. Measured on ses_e5ea441c: 21
 * throwaway scripts, `write` broke the streak 9 times, the longest read-only run reached 13 of the 24
 * needed, and the turn spent 30 minutes without a single `edit`. A file nobody asked to change is
 * investigation, so writing one to a scratch/temp directory is exploration.
 */
const THROWAWAY_DIR = /(?:^|[\\/])(?:\.sicode[\\/]scratch|scratch|tmp|temp)(?:[\\/]|$)/i

/** Programs that run a script by path — how a throwaway script actually gets executed. */
const INTERPRETER = /^(?:bun|node|deno|tsx|npx|python|python3|py|pwsh|powershell)(?:\.exe)?$/i

function shellCommand(part: ToolPart): string | undefined {
  const input = part.state.input as { command?: unknown } | undefined
  const command = input?.command
  return typeof command === "string" ? command.trim() : undefined
}

function shellReadsOnly(part: ToolPart): boolean {
  const command = shellCommand(part)
  if (!command) return false
  return SHELL_READ_ONLY_COMMANDS.test(command) || SHELL_READ_ONLY_INLINE.test(command)
}

/** A write into a scratch/temp directory: a measurement script, not a change to the project. */
function writesThrowaway(part: ToolPart): boolean {
  const input = part.state.input as { path?: unknown } | undefined
  const path = input?.path
  return typeof path === "string" && THROWAWAY_DIR.test(path)
}

/** Running a script that lives in a scratch/temp directory — measuring, not building. */
function runsThrowaway(part: ToolPart): boolean {
  const command = shellCommand(part)
  if (!command) return false
  const [program, ...args] = command.split(/\s+/)
  if (!INTERPRETER.test(program ?? "")) return false
  return args.some((argument) => THROWAWAY_DIR.test(argument))
}

/**
 * SiCode: a refused or failed mutation did not change the project. Counting it as progress used to
 * reset the explore streak whenever Ask/Plan denied edit, or a write raced permissions — the model
 * could retry forever below the hard budget (smart-no-spin T1).
 */
const MUTATING_TOOLS = new Set(["write", "edit", "patch", "execute"])

function isFailedMutation(part: ToolPart): boolean {
  return MUTATING_TOOLS.has(part.name) && part.state.status === "error"
}

/** Whether a single tool part only looks at things, rather than changing or building anything. */
function isReadOnlyTool(part: ToolPart): boolean {
  if (isFailedMutation(part)) return true
  if (READ_ONLY_TOOLS.has(part.name)) return true
  if (part.name === "shell") return shellReadsOnly(part) || runsThrowaway(part)
  if (part.name === "write") return writesThrowaway(part)
  return false
}

/** Tools that look for something, as opposed to reading something already found. */
const SEARCH_TOOLS = new Set(["grep", "glob"])

function isSearchTool(part: Extract<SessionMessage.AssistantContent, { type: "tool" }>): boolean {
  if (SEARCH_TOOLS.has(part.name)) return true
  if (part.name === "shell") return shellReadsOnly(part)
  return false
}

type ToolPart = Extract<SessionMessage.AssistantContent, { type: "tool" }>

/**
 * Trailing read-only steps of the current turn, newest last. A step breaks the streak when it
 * changes something (write/edit/patch/execute) or when it carries no tool at all — the latter means
 * the model already stopped to answer.
 */
function trailingReadOnlySteps(messages: ReadonlyArray<SessionMessage.Info>): ToolPart[][] {
  const steps: ToolPart[][] = []

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!
    if (message.type === "user") break
    if (message.type !== "assistant") continue
    const tools = message.content.filter((part) => part.type === "tool")
    if (tools.length === 0) break
    if (!tools.every((part) => isReadOnlyTool(part))) break

    steps.unshift(tools)
  }

  return steps
}

export function readOnlySteps(messages: ReadonlyArray<SessionMessage.Info>) {
  return trailingReadOnlySteps(messages).length
}

/** A throwaway measurement: writing or running a scratch/temp script. */
function isThrowawayTool(part: ToolPart): boolean {
  if (part.name === "write") return writesThrowaway(part)
  if (part.name === "shell") return runsThrowaway(part)
  return false
}

/** Search, throwaway measurement, or failed mutate — busy without delivering, not a long document read. */
function isSpinTool(part: ToolPart): boolean {
  return isSearchTool(part) || isThrowawayTool(part) || isFailedMutation(part)
}

/**
 * Trailing read-only steps, but only when the run is a hunt: at least half of it carried a search.
 * A turn reading one long document, or paging through one big file, is read-only and not locating,
 * so it stays at 0 and never gets pushed into a subagent.
 */
export function locatingSteps(messages: ReadonlyArray<SessionMessage.Info>) {
  const steps = trailingReadOnlySteps(messages)
  if (steps.length === 0) return 0
  const searches = steps.filter((tools) => tools.some(isSearchTool)).length
  return searches * 2 >= steps.length ? steps.length : 0
}

/**
 * Trailing read-only steps that are still spinning: searching *or* grinding throwaway scripts.
 * Used for the hard stop. Broader than `locatingSteps`, which stays search-only so a measurement
 * streak is not forced into an explore subagent mid-turn — but at the hard threshold it must stop
 * (ses_e5ea441c: locating=0 at hard because the streak was scratch write+run).
 */
export function spinningSteps(messages: ReadonlyArray<SessionMessage.Info>) {
  const steps = trailingReadOnlySteps(messages)
  if (steps.length === 0) return 0
  const busy = steps.filter((tools) => tools.some(isSpinTool)).length
  return busy * 2 >= steps.length ? steps.length : 0
}
