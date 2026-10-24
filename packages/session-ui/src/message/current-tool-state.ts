import type { SessionMessageAssistant, SessionMessageAssistantTool } from "@opencode/client/promise"
import { Option, Schema } from "effect"

const decodeInput = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))

const empty = {}

const whitespace = /\s/

/**
 * Reads the arguments a streaming tool call has written so far. `JSON.parse` only accepts a finished
 * object, so a running edit had no path and no line counts until its arguments stopped arriving — the
 * row sat there as a bare "编辑". Values still being written come back as they stand, which is what lets
 * the counts climb while the model types.
 */
export function partialToolInput(raw: string): Record<string, unknown> {
  const input: Record<string, unknown> = {}
  let at = 0

  const skip = () => {
    while (at < raw.length && whitespace.test(raw[at]!)) at++
  }

  const readString = () => {
    at++
    let value = ""

    while (at < raw.length) {
      const char = raw[at]!

      if (char === "\\") {
        const escape = raw[at + 1]

        if (escape === undefined) {
          at = raw.length

          break
        }

        if (escape === "u") {
          const code = raw.slice(at + 2, at + 6)

          if (code.length < 4) {
            at = raw.length

            break
          }

          value += String.fromCharCode(Number.parseInt(code, 16) || 0)
          at += 6

          continue
        }

        value += escape === "n" ? "\n" : escape === "t" ? "\t" : escape === "r" ? "\r" : escape
        at += 2

        continue
      }

      if (char === '"') {
        at++

        return value
      }

      value += char
      at++
    }

    return value
  }

  // Nested values are rare in tool arguments; take the slice when it is already balanced, else stop.
  const readNested = () => {
    const start = at
    const opening = raw[at]
    const closing = opening === "{" ? "}" : "]"
    let depth = 0
    let quoted = false

    while (at < raw.length) {
      const char = raw[at]!

      if (quoted) {
        if (char === "\\") at++
        else if (char === '"') quoted = false
      } else if (char === '"') quoted = true
      else if (char === opening) depth++
      else if (char === closing && --depth === 0) {
        at++

        try {
          return { done: true, value: JSON.parse(raw.slice(start, at)) as unknown }
        } catch {
          return { done: true, value: undefined }
        }
      }

      at++
    }

    return { done: false, value: undefined }
  }

  const readLiteral = () => {
    const start = at

    while (at < raw.length && !/[\s,}\]]/.test(raw[at]!)) at++

    const token = raw.slice(start, at)

    if (token === "true") return { done: true, value: true }
    if (token === "false") return { done: true, value: false }
    if (token === "null") return { done: true, value: null }
    const number = Number(token)

    return Number.isFinite(number) && token.length > 0 ? { done: true, value: number } : { done: false, value: undefined }
  }

  skip()
  if (raw[at] !== "{") return input
  at++

  for (;;) {
    skip()
    if (raw[at] !== '"') break

    const key = readString()

    skip()
    if (raw[at] !== ":") break
    at++
    skip()

    const char = raw[at]

    if (char === '"') {
      // A value still being written is kept: that is the text the counts are drawn from.
      input[key] = readString()
    } else if (char === "{" || char === "[") {
      const nested = readNested()
      if (!nested.done) break
      input[key] = nested.value
    } else {
      const literal = readLiteral()
      if (!literal.done) break
      input[key] = literal.value
    }

    skip()

    if (raw[at] === ",") {
      at++

      continue
    }

    break
  }

  return input
}

export function currentToolInput(tool: SessionMessageAssistantTool): Record<string, unknown> {
  if (tool.state.status !== "streaming") return tool.state.input

  const raw = tool.state.input

  if (typeof raw !== "string") return raw

  return Option.getOrElse(decodeInput(raw), () => partialToolInput(raw))
}

export function currentToolMetadata(tool: SessionMessageAssistantTool): Record<string, unknown> {
  if (!("metadata" in tool.state)) return empty

  return tool.state.metadata ?? empty
}

export function currentToolOutput(tool: SessionMessageAssistantTool) {
  if (tool.state.status === "running") {
    const output = tool.state.metadata.output

    return typeof output === "string" ? output : undefined
  }

  if (!("content" in tool.state) || !tool.state.content) return undefined
  const text = tool.state.content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n")

  return text || undefined
}

export function currentToolError(tool: SessionMessageAssistantTool) {
  if (tool.state.status !== "error") return undefined

  return tool.state.error.message
}

export function currentToolFailed(tool: SessionMessageAssistantTool) {
  return (
    tool.state.status === "error" ||
    (tool.name === "execute" && executeToolFailed(currentToolMetadata(tool))) ||
    (tool.name === "shell" && tool.state.status === "completed" && shellResultFailed(currentToolMetadata(tool)))
  )
}

/**
 * Status the row should paint with. A shell that exits non-zero stays `completed` at the tool level,
 * so the row used to render a failing test run exactly like a passing one.
 */
export function currentToolStatus(tool: SessionMessageAssistantTool) {
  if (tool.name === "shell" && tool.state.status === "completed" && shellResultFailed(currentToolMetadata(tool)))
    return "error"

  return tool.state.status
}

export function shellResultFailed(metadata: Record<string, unknown>) {
  // Shell completion reports the process outcome in metadata, not the tool status.
  return metadata.timeout === true || (typeof metadata.exit === "number" && metadata.exit !== 0)
}

export function executeToolFailed(metadata: Record<string, unknown>) {
  // Code Mode can report failed nested calls in a completed tool result.
  const calls = metadata.toolCalls

  return (
    metadata.error === true ||
    (Array.isArray(calls) &&
      calls.some(
        (call) =>
          call !== null &&
          typeof call === "object" &&
          !Array.isArray(call) &&
          "status" in call &&
          call.status === "error",
      ))
  )
}

export function currentToolHasLoadedFiles(tool: SessionMessageAssistantTool) {
  if (tool.name !== "read" || tool.state.status !== "completed") return false
  const loaded = tool.state.metadata?.loaded

  return Array.isArray(loaded) && loaded.some((path) => typeof path === "string")
}

export function readImagePath(input: Record<string, unknown>) {
  if (typeof input.path !== "string" || !/\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i.test(input.path)) return

  return input.path.replaceAll("\\", "/")
}

// Plain file reads render as one comma-separated row; images and loaded instructions keep their own rows.
export function currentToolGroupedRead(tool: SessionMessageAssistantTool) {
  return (
    tool.name === "read" &&
    tool.state.status !== "error" &&
    !readImagePath(currentToolInput(tool)) &&
    !currentToolHasLoadedFiles(tool)
  )
}

export function currentContentDefaultOpen(
  content: SessionMessageAssistant["content"][number],
  shellExpanded: boolean,
  editExpanded: boolean,
) {
  if (content.type !== "tool") return undefined

  // Errored tools render the error card, which starts collapsed.
  if (content.state.status === "error") return false

  if (content.name === "shell" || content.name === "execute") return shellExpanded

  if (content.name === "patch") return editExpanded

  if (content.name !== "edit" && content.name !== "write") return undefined

  if (!editExpanded) return false
  const files = currentToolMetadata(content).files

  if (!Array.isArray(files) || files.length === 0) return true

  return !files.every((file) => !!file && typeof file === "object" && "status" in file && file.status === "deleted")
}
