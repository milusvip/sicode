/**
 * SiCode: parent agents poll background subagents ("still running?", "docs landed?") instead of
 * doing non-overlapping work or ending the turn. ses_e508 burned ~10 wait narrations while A–D ran.
 *
 * Soft once, then hard-stop tools so the model cannot keep spinning. Kill: OPENCODE_SUBAGENT_WAIT=0.
 */
import type { SessionMessage } from "../message.js"

/** Wait-ish assistant texts in the trailing window before the first nudge. */
export const SUBAGENT_WAIT_FIRST = 2
/** Trailing assistant steps scanned for wait narration. */
export const SUBAGENT_WAIT_WINDOW = 8

export const SUBAGENT_WAIT_NUDGE_PROMPT = `Background subagents are still running. Stop polling them.

Do not narrate "still waiting" / "docs haven't landed" / "check whether A–D finished", and do not call subagent just for status.

Either:
1. Do work that does not depend on their deliverables, then end the turn, OR
2. If nothing non-overlapping remains, end the turn now — you will be notified when they finish.`

export const SUBAGENT_WAIT_STOP_PROMPT = `CRITICAL — SUBAGENT WAIT LOOP

You kept waiting on background subagents. Hand back without more tools:

1. What you already launched (session IDs / dimensions).
2. What non-overlapping work you finished (if any).
3. That you are waiting for their completion notification — do not poll again.

Do not call any more tools in this turn.`

type ToolPart = Extract<SessionMessage.AssistantContent, { type: "tool" }>

function isBackgroundRunning(part: ToolPart): boolean {
  if (part.name !== "subagent") return false
  if (part.state.status === "streaming" || part.state.status === "running") return false
  const input = part.state.input as { background?: unknown } | undefined
  if (input?.background === true) return true
  if (part.state.status !== "completed") return false
  const metadata = part.state.metadata as { status?: unknown } | undefined
  return metadata?.status === "running"
}

function turnAssistants(messages: ReadonlyArray<SessionMessage.Info>) {
  const out: SessionMessage.Info[] = []
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!
    if (message.type === "user") break
    if (message.type === "assistant") out.push(message)
  }
  return out.reverse()
}

function hasOutstandingBackground(messages: ReadonlyArray<SessionMessage.Info>): boolean {
  for (const message of turnAssistants(messages)) {
    if (message.type !== "assistant") continue
    for (const part of message.content) {
      if (part.type === "tool" && isBackgroundRunning(part)) return true
    }
  }
  return false
}

/**
 * Idle steps while background subagents are outstanding: assistant messages with no tools.
 * Shape only — no wait-phrase vocabulary. The launch step itself has a subagent tool and is ignored.
 */
function waitNarrations(messages: ReadonlyArray<SessionMessage.Info>): number {
  const steps = turnAssistants(messages).slice(-SUBAGENT_WAIT_WINDOW)
  let count = 0
  for (const message of steps) {
    if (message.type !== "assistant") continue
    if (message.content.some((part) => part.type === "tool")) continue
    count++
  }
  return count
}

export interface SubagentWaitHit {
  readonly fingerprint: string
  readonly waits: number
}

/** Detect wait-polling after background subagents were launched this turn. */
export function detectSubagentWait(messages: ReadonlyArray<SessionMessage.Info>): SubagentWaitHit | null {
  if (process.env.OPENCODE_SUBAGENT_WAIT === "0") return null
  if (!hasOutstandingBackground(messages)) return null
  const waits = waitNarrations(messages)
  if (waits < SUBAGENT_WAIT_FIRST) return null
  return { fingerprint: "subagent_wait", waits }
}
