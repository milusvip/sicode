import type { SessionMessage } from "./message.js"

/** Messages this close to the tail are never touched: the model is actively working on them. */
const RECENT_MESSAGES = 8
/** Results shorter than this are cheap and often quoted later, so they are left whole. */
const MIN_LINES = 120
const HEAD_LINES = 25
const TAIL_LINES = 15

type ToolState = {
  status?: string
  content?: unknown[]
}

type ToolPart = {
  type?: string
  name?: string
  state?: ToolState
}

type TextPart = { type: "text"; text: string }

const isTextPart = (part: unknown): part is TextPart => {
  if (!part || typeof part !== "object") return false
  const candidate = part as Partial<TextPart>
  return candidate.type === "text" && typeof candidate.text === "string"
}

/**
 * Replaces the body of an older tool result with its head and tail. The omission note keeps the
 * model aware that it already ran this tool, so it can decide to re-read instead of assuming the
 * file is empty.
 */
function degradeToolPart(part: unknown, tool: string) {
  if (!part || typeof part !== "object") return part
  const candidate = part as ToolPart
  if (candidate.type !== "tool") return part
  if (candidate.state?.status !== "completed") return part
  if (!Array.isArray(candidate.state.content)) return part
  if (!candidate.state.content.every(isTextPart)) return part

  const text = (candidate.state.content as TextPart[]).map((item) => item.text).join("\n")
  const lines = text.split("\n")
  if (lines.length <= MIN_LINES) return part

  const omitted = lines.length - HEAD_LINES - TAIL_LINES
  const note = `[... ${omitted} lines omitted from this earlier ${tool} result; run it again if you need them ...]`

  return {
    ...candidate,
    state: {
      ...candidate.state,
      content: [{ type: "text" as const, text: [...lines.slice(0, HEAD_LINES), note, ...lines.slice(-TAIL_LINES)].join("\n") }],
    },
  }
}

/**
 * Shrinks tool output in everything except the recent tail. Prefill cost scales with context size,
 * and a long agent run is dominated by file reads and command output it no longer needs verbatim.
 * Only the message shape handed to the model changes; the stored session is untouched.
 */
export function degradeHistory(messages: SessionMessage.Info[]): SessionMessage.Info[] {
  const cutoff = messages.length - RECENT_MESSAGES
  if (cutoff <= 0) return messages

  return messages.map((message, index) => {
    if (index >= cutoff) return message
    if (message.type !== "assistant") return message

    const content = (message as { content?: unknown }).content
    if (!Array.isArray(content)) return message

    let changed = false
    const next = content.map((part) => {
      const tool = (part as ToolPart | undefined)?.name ?? "tool"
      const degraded = degradeToolPart(part, tool)
      if (degraded !== part) changed = true
      return degraded
    })

    return changed ? ({ ...message, content: next } as SessionMessage.Info) : message
  })
}
