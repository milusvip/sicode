export * as SessionCompactionDurable from "./compaction-durable.js"

import fs from "node:fs"
import path from "node:path"
import type { SessionMessage } from "./message.js"

/**
 * SiCode: the part of a compaction checkpoint that is not a summary.
 *
 * A summary is a lossy retelling, and everything it drops is gone: the raw text of the files the
 * agent was working in. Measured on a real 12-hour session, 66% of all `read` calls were repeats,
 * and in the six steps after each compaction 90% of reads were of files already read — the agent
 * spends that cost re-acquiring the exact text an edit needs.
 *
 * Peers solve this outside the summary rather than by asking the summarizer to quote code:
 * Claude Code re-reads up to five of the most recently touched files after compacting (a file over
 * 5k tokens comes back as a path only), and Cursor keeps a `todos` block among its "durable
 * blocks". This module does both from data already in hand — the tool calls of the messages being
 * summarized — and the result rides along in the checkpoint metadata rather than in the prompt the
 * summarizer writes.
 *
 * Contents are a snapshot, not a live view: the block says so, and an edit against stale text
 * fails loudly (the `oldString` will not match) instead of corrupting the file.
 */

export interface DurableFile {
  readonly path: string
  readonly text: string
  readonly truncated: boolean
}

export interface DurableTodo {
  readonly content: string
  readonly status: string
}

export interface Durable {
  readonly files: readonly DurableFile[]
  readonly todos: readonly DurableTodo[]
}

/** Most files an edit needs at once; each one costs tokens on every request that replays it. */
const MAX_FILES = 4
const MAX_CHARS_PER_FILE = 12_000
/** A file that was only read gets less room: it is context, not the thing being edited. */
const MAX_CHARS_READ_ONLY = 4_000
const MAX_CHARS_TOTAL = 24_000
/** Anything bigger is a bundle or generated file, not something worth quoting. */
const MAX_SOURCE_BYTES = 512 * 1024

const MODIFYING = new Set(["edit", "write", "patch"])

const input = (state: unknown): Record<string, unknown> | undefined => {
  if (typeof state !== "object" || state === null) return undefined
  const value = (state as { input?: unknown }).input
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined
}

const stringOf = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined

/** The file a tool call names, in whichever field that tool uses. */
const fileOf = (fields: Record<string, unknown> | undefined): string | undefined => {
  if (!fields) return undefined
  return stringOf(fields.filePath) ?? stringOf(fields.path) ?? stringOf(fields.file)
}

/**
 * Files touched by the summarized messages, most recent first, split by how they were touched.
 * A modified file outranks a file that was only read at the same recency: the work continues where
 * the writes were.
 */
export const touched = (messages: readonly SessionMessage.Info[], directory: string) => {
  const seen = new Map<string, { absolute: string; relative: string; modified: boolean }>()
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!
    if (message.type !== "assistant") continue
    for (let j = message.content.length - 1; j >= 0; j--) {
      const part = message.content[j]!
      if (part.type !== "tool") continue
      const name = stringOf(part.name)
      if (!name || (name !== "read" && !MODIFYING.has(name))) continue
      const file = fileOf(input(part.state))
      if (!file) continue
      const absolute = path.isAbsolute(file) ? file : path.resolve(directory, file)
      // Forward slashes regardless of platform: this path ends up inside the prompt, and the agent
      // writes paths that way everywhere else.
      const relative = path.relative(directory, absolute).split(path.sep).join("/") || absolute
      // A path outside the project is a config or reference file; quote it only as a path.
      const existing = seen.get(absolute)
      if (existing) {
        existing.modified ||= MODIFYING.has(name)
        continue
      }
      seen.set(absolute, { absolute, relative, modified: MODIFYING.has(name) })
    }
  }
  return [...seen.values()]
}

const read = (absolute: string, remaining: number): DurableFile | undefined => {
  try {
    const info = fs.statSync(absolute)
    if (!info.isFile() || info.size > MAX_SOURCE_BYTES) return undefined
    const text = fs.readFileSync(absolute, "utf8")
    if (text.includes("\u0000")) return undefined
    const limit = Math.min(MAX_CHARS_PER_FILE, remaining)
    if (limit <= 0) return undefined
    if (text.length <= limit) return { path: absolute, text, truncated: false }
    return { path: absolute, text: text.slice(0, limit), truncated: true }
  } catch {
    return undefined
  }
}

/** The newest `todowrite` call in the summarized history: the list the agent was working against. */
export const todos = (messages: readonly SessionMessage.Info[]): DurableTodo[] => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!
    if (message.type !== "assistant") continue
    for (let j = message.content.length - 1; j >= 0; j--) {
      const part = message.content[j]!
      if (part.type !== "tool" || part.name !== "todowrite") continue
      const list = input(part.state)?.todos
      if (!Array.isArray(list)) continue
      return list.flatMap((entry) => {
        if (typeof entry !== "object" || entry === null) return []
        const record = entry as Record<string, unknown>
        const content = stringOf(record.content)
        const status = stringOf(record.status)
        return content && status ? [{ content, status }] : []
      })
    }
  }
  return []
}

/**
 * `budget` is the compaction token budget. The durable block is capped at 5% of it, so choosing a
 * smaller window shrinks the block instead of pushing the checkpoint past the limit it exists to
 * stay under.
 */
export const collect = (
  messages: readonly SessionMessage.Info[],
  directory: string,
  budget: number,
): Durable | undefined => {
  const files: DurableFile[] = []
  const limit = Math.min(MAX_CHARS_TOTAL, Math.max(500, Math.floor(budget * 0.05 * 4)))
  let remaining = limit
  // Modified files first, then read-only ones, each already ordered by recency. Two passes rather
  // than one sort: a file that was edited is worth full size, while a file that was only read is
  // context and gets the smaller cap, which keeps the block from being eaten by one large document.
  const candidates = touched(messages, directory)
  const ordered = [...candidates.filter((entry) => entry.modified), ...candidates.filter((entry) => !entry.modified)]
  for (const candidate of ordered) {
    if (files.length >= MAX_FILES) break
    const cap = candidate.modified ? MAX_CHARS_PER_FILE : MAX_CHARS_READ_ONLY
    const file = read(candidate.absolute, Math.min(cap, remaining))
    if (!file) continue
    remaining -= file.text.length
    files.push({ ...file, path: candidate.relative })
  }
  const list = todos(messages)
  if (files.length === 0 && list.length === 0) return undefined
  return { files, todos: list }
}

/** Validates what came back out of message metadata, which is stored as JSON. */
export const from = (metadata: Record<string, unknown> | undefined): Durable | undefined => {
  const value = metadata?.durable
  if (typeof value !== "object" || value === null) return undefined
  const record = value as { files?: unknown; todos?: unknown }
  const files = Array.isArray(record.files)
    ? record.files.flatMap((entry) => {
        if (typeof entry !== "object" || entry === null) return []
        const item = entry as Record<string, unknown>
        const file = stringOf(item.path)
        return file && typeof item.text === "string"
          ? [{ path: file, text: item.text, truncated: item.truncated === true }]
          : []
      })
    : []
  const list = Array.isArray(record.todos)
    ? record.todos.flatMap((entry) => {
        if (typeof entry !== "object" || entry === null) return []
        const item = entry as Record<string, unknown>
        const content = stringOf(item.content)
        const status = stringOf(item.status)
        return content && status ? [{ content, status }] : []
      })
    : []
  return files.length === 0 && list.length === 0 ? undefined : { files, todos: list }
}

/**
 * Rendered inside `<conversation-checkpoint>`, after the summary and before the transcript pointer.
 * Tag delimiters rather than markdown fences: file contents routinely contain backticks.
 */
export const render = (durable: Durable): string => {
  const parts = ["", "<working-files>"]
  if (durable.files.length > 0) {
    parts.push(
      "Contents of the files that were open when this checkpoint was written, as they were on disk at that moment. They are here so you do not have to read them again; if an edit no longer matches, re-read the file and it will be current.",
      ...durable.files.map(
        (file) =>
          `<file path="${file.path}"${file.truncated ? ' truncated="true"' : ""}>\n${file.text}\n</file>`,
      ),
    )
  }
  if (durable.todos.length > 0) {
    parts.push(
      "",
      "<todos>",
      ...durable.todos.map((todo) => `- [${todo.status}] ${todo.content}`),
      "</todos>",
    )
  }
  parts.push("</working-files>")
  return parts.join("\n")
}
