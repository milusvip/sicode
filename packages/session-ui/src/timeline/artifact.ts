import type { SessionMessageAssistant, SessionMessageAssistantTool } from "@opencode/client/promise"
import { changedFileDiff } from "../components/apply-patch-file.js"
import { currentToolInput, currentToolMetadata } from "../message/current-tool-state.js"

/**
 * A newly created deliverable the timeline shows as a capsule. Only a `write` that added the file
 * counts — overwrites and edits stay in the turn's file list, not here.
 */
export type CreatedArtifact = {
  path: string
  ref: { messageID: string; partID: string }
}

/**
 * SiCode: deliverable extensions for capsules. Source/code files stay in the turn's change list
 * only — capsules are for pages, documents and archives the user opens to accept the result.
 */
const artifactExtensions = new Set([
  // Pages and documents.
  ".html",
  ".htm",
  ".md",
  ".markdown",
  ".mdx",
  ".txt",
  ".rtf",
  ".csv",
  ".tsv",
  // Office documents.
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".odt",
  ".ods",
  ".odp",
  // Archives and packages.
  ".zip",
  ".tar",
  ".gz",
  ".tgz",
  ".bz2",
  ".xz",
  ".7z",
  ".rar",
  ".jar",
  ".apk",
  ".ipa",
  ".dmg",
  ".iso",
  // Data and logs.
  ".json",
  ".jsonl",
  ".xml",
  ".yaml",
  ".yml",
  ".log",
])

export function isArtifactPath(path: string): boolean {
  const index = path.lastIndexOf(".")
  if (index < 0) return false

  return artifactExtensions.has(path.slice(index).toLowerCase())
}

/** @deprecated Prefer `isArtifactPath`. Kept for older call sites and tests. */
export const isHtmlPath = isArtifactPath

/**
 * Whether this completed write created the file. Prefers `metadata.files` status; a write recorded
 * before that field existed cannot tell create from overwrite, so it is read as a create — same
 * rule the turn's file list uses.
 */
export function isCreatedWrite(tool: SessionMessageAssistantTool): boolean {
  if (tool.name !== "write") return false
  if (tool.state.status !== "completed") return false

  const files = currentToolMetadata(tool).files
  const reported = Array.isArray(files) ? files.filter(changedFileDiff) : []
  if (reported.length > 0) return reported.some((file) => file.status === "added")

  return true
}

/**
 * Newly created artifact files across the given assistant messages, first path wins. Same-path
 * later writes (even creates that somehow reappear) do not add another capsule.
 */
export function createdArtifacts(messages: SessionMessageAssistant[]): CreatedArtifact[] {
  const seen = new Set<string>()
  const items: CreatedArtifact[] = []

  for (const message of messages) {
    for (const content of message.content) {
      if (content.type !== "tool") continue
      if (!isCreatedWrite(content)) continue

      const input = currentToolInput(content)
      const path = typeof input.path === "string" ? input.path : undefined
      if (!path || !isArtifactPath(path)) continue
      if (seen.has(path)) continue

      seen.add(path)
      items.push({ path, ref: { messageID: message.id, partID: content.id } })
    }
  }

  return items
}

/**
 * @deprecated Auto-open was removed; capsules open on click. Kept so older tests compile until
 * they migrate to `createdArtifacts`.
 */
export type HtmlArtifact = {
  path: string
  ref: { messageID: string; partID: string }
  streaming: boolean
  content?: string
}

/** @deprecated See `createdArtifacts`. */
export function latestHtmlChange(messages: SessionMessageAssistant[]): HtmlArtifact | undefined {
  let latest: HtmlArtifact | undefined

  for (const message of messages) {
    for (const content of message.content) {
      if (content.type !== "tool") continue
      if (content.name !== "write" && content.name !== "edit") continue
      if (content.state.status === "error") continue

      const input = currentToolInput(content)
      const path = typeof input.path === "string" ? input.path : undefined
      if (!path || !isArtifactPath(path)) continue

      latest = {
        path,
        ref: { messageID: message.id, partID: content.id },
        streaming: content.state.status === "streaming",
        content: content.name === "write" && typeof input.content === "string" ? input.content : undefined,
      }
    }
  }

  return latest
}
