/**
 * SiCode: agents invent one-off probe scripts (write .py / _tools / _probe, then shell-run them)
 * when grep/read on existing artifacts would answer faster. ses_e508 wrote extractors instead of
 * grepping Chinese UI strings already in the binary dumps.
 *
 * Soft once when ≥PROBE_SCRIPT_FIRST write→run cycles appear in the trailing window.
 * Kill: OPENCODE_PROBE_SCRIPT=0.
 */
import type { SessionMessage } from "../message.js"

/** Write→run probe cycles before the first nudge. */
export const PROBE_SCRIPT_FIRST = 2
/** Trailing assistant steps scanned for probe cycles. */
export const PROBE_SCRIPT_WINDOW = 10

export const PROBE_SCRIPT_PROMPT = `You are writing and running one-off probe scripts instead of using built-in tools.

Before writing another scanner / extractor / "quick Python check":

1. Prefer \`grep\` (batch synonyms / Chinese UI strings / English identifiers in \`patterns\`) or \`read\` on files already under the workspace / \`_analysis\`.
2. Only write a new script when grep/read cannot answer — say why in one line.
3. Do not invent a second probe for the same question.`

const PROBE_WRITE =
  /(?:^|[\\/])(?:_tools|_probe|_scratch|tmp)[\\/].+\.(?:py|ps1|js|mjs|ts)$|\.(?:py|ps1)$/i

type ToolPart = Extract<SessionMessage.AssistantContent, { type: "tool" }>

function turnToolCalls(messages: ReadonlyArray<SessionMessage.Info>): ToolPart[] {
  // Collect per-step batches oldest-first so write→shell order inside a step is preserved
  // (unshift-per-part would reverse tools within the same assistant message).
  const steps: ToolPart[][] = []
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!
    if (message.type === "user") break
    if (message.type !== "assistant") continue
    const batch: ToolPart[] = []
    for (const part of message.content) {
      if (part.type !== "tool") continue
      if (part.state.status === "streaming" || part.state.status === "running") continue
      batch.push(part)
    }
    steps.unshift(batch)
  }
  return steps.flat()
}

function writePath(part: ToolPart): string | null {
  if (part.name !== "write" && part.name !== "edit") return null
  if (part.state.status !== "completed") return null
  const input = part.state.input as { path?: unknown; filePath?: unknown } | undefined
  const path = typeof input?.path === "string" ? input.path : typeof input?.filePath === "string" ? input.filePath : null
  if (!path || !PROBE_WRITE.test(path)) return null
  return path.replace(/\\/g, "/")
}

function shellMentions(part: ToolPart, basename: string): boolean {
  if (part.name !== "shell" || part.state.status !== "completed") return false
  const input = part.state.input as { command?: unknown } | undefined
  if (typeof input?.command !== "string") return false
  return input.command.includes(basename)
}

function basenameOf(path: string): string {
  const slash = path.lastIndexOf("/")
  return slash >= 0 ? path.slice(slash + 1) : path
}

export interface ProbeScriptHit {
  readonly fingerprint: string
  readonly cycles: number
  readonly paths: string[]
}

/** Detect repeated write→shell-run of one-off probe scripts this turn. */
export function detectProbeScript(messages: ReadonlyArray<SessionMessage.Info>): ProbeScriptHit | null {
  if (process.env.OPENCODE_PROBE_SCRIPT === "0") return null
  const calls = turnToolCalls(messages)
  // Limit to the trailing window of assistant steps by scanning recent calls only.
  const window = calls.slice(-PROBE_SCRIPT_WINDOW * 3)
  const cycles: string[] = []
  for (let index = 0; index < window.length; index++) {
    const path = writePath(window[index]!)
    if (!path) continue
    const base = basenameOf(path)
    const ran = window.slice(index + 1, index + 6).some((part) => shellMentions(part, base))
    if (!ran) continue
    cycles.push(path)
  }
  if (cycles.length < PROBE_SCRIPT_FIRST) return null
  return {
    fingerprint: `probe:${cycles.slice(0, 3).join("|")}`,
    cycles: cycles.length,
    paths: cycles,
  }
}
