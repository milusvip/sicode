/**
 * SiCode: serial single-tool steps — Flash's default is one grep or one read per step (~70%),
 * which burns wall-clock even when patterns[] and parallel reads are available. When the trailing
 * N assistant steps each carried exactly one look-only tool, the next request drops everything
 * except grep/glob/read and tells the model to fan out in one message.
 *
 * Soft prompt alone does not move Flash; the narrowed tool list is the constraint.
 */
import type { SessionMessage } from "../message.js"

/**
 * Trailing single-tool look steps before the next request is forced to batch.
 * SiCode: was 2; long-context-use P5 tightens to 1 so the second look step already fans out
 * (every solo grep/read after the first pays a full TTFT tax).
 */
export const SERIAL_SINGLE_STEPS = 1

/** Tools a batching step may still call — fan out, no side quests. */
export const BATCH_FOCUS_TOOLS = ["grep", "glob", "read"] as const

export const BATCH_PROMPT = `You have been calling one search or read per step. That is too slow.

In one message, fan out (do not serial-guess one keyword per step):

1. Call \`grep\` once with \`patterns\` (or a plain \`a|b|c\` OR) covering every synonym you still need.
2. In the same message, \`read\` the files you already know matter (or \`glob\` then \`read\`) in parallel.

Prefer grep/glob/read this step; fan out first, act after the batch returns.`

const LOOK_TOOLS = new Set(["grep", "glob", "read", "list"])

type ToolPart = Extract<SessionMessage.AssistantContent, { type: "tool" }>

/**
 * SiCode: directories that hold throwaway work. A `write` there is a measurement script, not
 * progress, so it must not reset the serial-single-tool streak either — the same hole
 * `explore-budget` had (ses_e5ea441c: `write` broke this streak 5 times).
 */
const THROWAWAY_DIR = /(?:^|[\\/])(?:\.sicode[\\/]scratch|scratch|tmp|temp)(?:[\\/]|$)/i

/** Programs that run a script by path — how a throwaway script actually gets executed. */
const INTERPRETER = /^(?:bun|node|deno|tsx|npx|python|python3|py|pwsh|powershell)(?:\.exe)?$/i

const SHELL_READ_ONLY =
  /^(rg|grep|egrep|Get-ChildItem|Get-Content|Select-String|find|ls|dir|git\s+(log|show|status|diff|grep|branch)|where\.exe|where)\b/

/** PowerShell `$b=[IO.File]::ReadAllBytes(...)` — first word is the assignment, not Get-Content. */
const SHELL_READ_ONLY_INLINE = /\[(?:System\.)?IO\.File\]::ReadAll(?:Bytes|Text)\b/

function shellCommand(part: ToolPart): string | undefined {
  const input = part.state.input as { command?: unknown } | undefined
  const command = input?.command
  return typeof command === "string" ? command.trim() : undefined
}

/** A part that only looks, or only measures in a scratch/temp directory. */
function looksOnly(part: ToolPart): boolean {
  if (LOOK_TOOLS.has(part.name)) return true
  if (part.name === "write") {
    const input = part.state.input as { path?: unknown } | undefined
    return typeof input?.path === "string" && THROWAWAY_DIR.test(input.path)
  }
  if (part.name !== "shell") return false
  const command = shellCommand(part)
  if (!command) return false
  if (SHELL_READ_ONLY.test(command) || SHELL_READ_ONLY_INLINE.test(command)) return true
  const [program, ...args] = command.split(/\s+/)
  return INTERPRETER.test(program ?? "") && args.some((argument) => THROWAWAY_DIR.test(argument))
}

/**
 * Trailing steps that each carried exactly one look-only tool. A multi-tool step, a real write, or
 * a text-only answer breaks the streak — those already fan out or progress. `todowrite` alone is
 * transparent: updating the progress bar must not reset the serial-look streak (ses_e58cab861ffd
 * burned hundreds of todowrite steps that otherwise cancelled batching).
 */
export function serialSingleToolSteps(messages: ReadonlyArray<SessionMessage.Info>): number {
  let count = 0

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!
    if (message.type === "user") break
    if (message.type !== "assistant") continue
    const tools = message.content.filter((part): part is ToolPart => part.type === "tool")
    if (tools.length === 0) break
    const active = tools.filter((part) => part.name !== "todowrite")
    if (active.length === 0) continue
    if (active.length !== 1) break
    if (!looksOnly(active[0]!)) break
    count += 1
  }

  return count
}

export function shouldNudgeBatch(messages: ReadonlyArray<SessionMessage.Info>): boolean {
  return serialSingleToolSteps(messages) >= SERIAL_SINGLE_STEPS
}
