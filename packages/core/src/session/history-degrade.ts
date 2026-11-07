import type { SessionMessage } from "./message.js"

/** Messages this close to the tail are never touched: the model is actively working on them. */
const RECENT_MESSAGES = 8

type ToolState = {
  status?: string
  error?: unknown
  content?: unknown[]
}

type ToolPart = {
  type?: string
  name?: string
  state?: ToolState
}

type TextPart = { type: "text"; text: string }

type Tier = {
  /** Results at or under this line count stay whole. */
  minLines: number
  head: number
  tail: number
  note: (tool: string, omitted: number) => string
}

/**
 * SiCode: tool-noise tiers (long-context-use P0). Older results are cut by how reusable they are —
 * mutation summaries stay wide; shell/snapshot dumps shrink hard; errors collapse to one line.
 */
const PRESERVE: Tier = {
  minLines: 400,
  head: 80,
  tail: 40,
  note: (tool, omitted) =>
    `[... ${omitted} lines omitted from this earlier ${tool} result; the kept head/tail are the mutation summary — re-read the file only if you need a range outside them ...]`,
}

const REOPEN: Tier = {
  minLines: 120,
  head: 25,
  tail: 15,
  // SiCode: never say "run the whole tool again" — that caused 21 full re-reads of one file.
  note: (tool, omitted) =>
    `[... ${omitted} lines omitted from this earlier ${tool} result; re-open only the range you need (for read, pass offset and limit) rather than running the whole tool again ...]`,
}

const NOISY: Tier = {
  minLines: 60,
  head: 15,
  tail: 10,
  note: (tool, omitted) =>
    `[... ${omitted} lines omitted from this earlier ${tool} result; treat as noise — re-run with a narrower command or a fresh browser.snapshot only if you still need a specific slice ...]`,
}

const isTextPart = (part: unknown): part is TextPart => {
  if (!part || typeof part !== "object") return false
  const candidate = part as Partial<TextPart>
  return candidate.type === "text" && typeof candidate.text === "string"
}

const toolKey = (name: string) => name.replaceAll(".", "_").toLowerCase()

/** Exported for tests — maps a tool name onto the degrade tier. */
export function tierFor(name: string): Tier {
  const key = toolKey(name)
  if (
    key === "edit" ||
    key === "patch" ||
    key === "write" ||
    key === "todowrite" ||
    key.startsWith("todo_")
  )
    return PRESERVE
  if (
    key === "shell" ||
    key.includes("snapshot") ||
    key.includes("browser_console") ||
    key.includes("network_list") ||
    key.includes("network_get")
  )
    return NOISY
  return REOPEN
}

const errorLine = (tool: string, state: ToolState) => {
  const raw =
    typeof state.error === "string"
      ? state.error
      : state.error && typeof state.error === "object" && "message" in state.error
        ? String((state.error as { message: unknown }).message)
        : "failed"
  const first = raw.split("\n").find((line) => line.trim()) ?? "failed"
  return `[earlier ${tool} error] ${first.slice(0, 240)}`
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
  if (!candidate.state) return part

  // SiCode: failed tools are tier D — one status line, drop the body that failure-streak already saw.
  if (candidate.state.status === "error") {
    return {
      ...candidate,
      state: {
        ...candidate.state,
        content: [{ type: "text" as const, text: errorLine(tool, candidate.state) }],
      },
    }
  }

  if (candidate.state.status !== "completed") return part
  if (!Array.isArray(candidate.state.content)) return part
  if (!candidate.state.content.every(isTextPart)) return part

  const text = (candidate.state.content as TextPart[]).map((item) => item.text).join("\n")
  const lines = text.split("\n")
  const tier = tierFor(tool)
  if (lines.length <= tier.minLines) return part

  const omitted = lines.length - tier.head - tier.tail
  return {
    ...candidate,
    state: {
      ...candidate.state,
      content: [
        {
          type: "text" as const,
          text: [...lines.slice(0, tier.head), tier.note(tool, omitted), ...lines.slice(-tier.tail)].join("\n"),
        },
      ],
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
