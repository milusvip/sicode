import type { SessionMessageAssistant, SessionMessageAssistantTool } from "@opencode/client/promise"
import { currentToolInput } from "../message/current-tool-state.js"

/**
 * An HTML render the assistant produced by writing a file. The panel hangs off the write
 * tool's part, so the snapshot is the content that call carried — immutable, and it survives a
 * session reload because tool inputs are persisted with the message.
 */
export type HtmlArtifact = {
  path: string
  ref: { messageID: string; partID: string }
  /** The write call is still streaming its arguments; the panel waits until it lands. */
  streaming: boolean
  /** The HTML the write call carried so far. Empty while the arguments are still arriving. */
  content: string
}

/** Extensions an inline render makes sense for. Anything else stays a plain file card. */
const htmlExtensions = new Set([".html", ".htm"])

export function isHtmlPath(path: string): boolean {
  const index = path.lastIndexOf(".")
  if (index < 0) return false

  return htmlExtensions.has(path.slice(index).toLowerCase())
}

function writeArtifact(message: SessionMessageAssistant, tool: SessionMessageAssistantTool): HtmlArtifact | undefined {
  if (tool.name !== "write") return undefined

  // A failed or errored write produced nothing renderable.
  if (tool.state.status === "error") return undefined

  const input = currentToolInput(tool)
  const path = typeof input.path === "string" ? input.path : undefined
  if (!path || !isHtmlPath(path)) return undefined

  return {
    path,
    ref: { messageID: message.id, partID: tool.id },
    streaming: tool.state.status === "streaming",
    content: typeof input.content === "string" ? input.content : "",
  }
}

/**
 * One entry per path per turn: a turn that writes then rewrites a demo keeps only its final call.
 * Multiple paths in one turn each get an entry, in first-written order.
 */
export function htmlArtifactsForTurn(messages: SessionMessageAssistant[]): HtmlArtifact[] {
  const byPath = new Map<string, HtmlArtifact>()

  for (const message of messages) {
    for (const content of message.content) {
      if (content.type !== "tool") continue

      const found = writeArtifact(message, content)
      if (!found) continue

      byPath.set(found.path, found)
    }
  }

  return [...byPath.values()]
}

/**
 * The most recent HTML write across the whole session, in message order — this is what the side
 * panel shows. The write's own part carries the content, so the snapshot is immutable.
 */
export function latestHtmlArtifact(messages: SessionMessageAssistant[]): HtmlArtifact | undefined {
  let latest: HtmlArtifact | undefined

  for (const message of messages) {
    for (const content of message.content) {
      if (content.type !== "tool") continue

      const found = writeArtifact(message, content)
      if (!found) continue

      latest = found
    }
  }

  return latest
}
