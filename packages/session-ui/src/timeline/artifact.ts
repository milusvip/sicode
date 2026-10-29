import type { SessionMessageAssistant, SessionMessageAssistantTool } from "@opencode/client/promise"
import { currentToolInput } from "../message/current-tool-state.js"

/**
 * An HTML page the assistant produced or changed. The side panel shows the file the write
 * carried — immutable, and it survives a session reload because tool inputs are persisted with
 * the message. An edit carries no snapshot: the browser pane reloads the file from disk instead.
 */
export type HtmlArtifact = {
  path: string
  ref: { messageID: string; partID: string }
  /** The call is still streaming its arguments; the panel waits until it lands. */
  streaming: boolean
  /**
   * The whole page, only for a `write`. An `edit` changes a file the pane already shows, so it
   * has no snapshot to render — absent means "refresh, do not open".
   */
  content?: string
}

/** Extensions an inline render makes sense for. Anything else stays a plain file card. */
const htmlExtensions = new Set([".html", ".htm"])

export function isHtmlPath(path: string): boolean {
  const index = path.lastIndexOf(".")
  if (index < 0) return false

  return htmlExtensions.has(path.slice(index).toLowerCase())
}

/** A demo is built in steps: writes rewrite the page, edits patch it. Both land on one path. */
function htmlChange(message: SessionMessageAssistant, tool: SessionMessageAssistantTool): HtmlArtifact | undefined {
  if (tool.name !== "write" && tool.name !== "edit") return undefined

  // A failed call changed nothing renderable.
  if (tool.state.status === "error") return undefined

  const input = currentToolInput(tool)
  const path = typeof input.path === "string" ? input.path : undefined
  if (!path || !isHtmlPath(path)) return undefined

  return {
    path,
    ref: { messageID: message.id, partID: tool.id },
    streaming: tool.state.status === "streaming",
    content: tool.name === "write" && typeof input.content === "string" ? input.content : undefined,
  }
}

/**
 * The most recent change to an HTML page across the session, in message order. A write carries
 * the page; an edit only says the file moved on, which the browser pane answers by reloading it.
 */
export function latestHtmlChange(messages: SessionMessageAssistant[]): HtmlArtifact | undefined {
  let latest: HtmlArtifact | undefined

  for (const message of messages) {
    for (const content of message.content) {
      if (content.type !== "tool") continue

      const found = htmlChange(message, content)
      if (!found) continue

      latest = found
    }
  }

  return latest
}
