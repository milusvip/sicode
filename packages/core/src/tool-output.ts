export * as ToolOutput from "./tool-output.js"

import path from "path"
import type { Tool } from "./tool.js"
import { Context, Duration, Effect, Layer, Schedule } from "effect"
import { makeGlobalNode, makeLocationNode } from "@opencode/util/effect/app-node"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Identifier } from "@opencode/schema/identifier"
import { FileRetention } from "./file-retention.js"
import { State } from "./state.js"

export const MAX_LINES = 2_000
export const MAX_BYTES = 50 * 1024 // 50 KiB
export const RETENTION = Duration.days(7)
export const DIRECTORY = "tool-output"

export const fileName = (timestamp?: number) => "tool_" + Identifier.create(false, timestamp)

type Result = Tool.NormalizedResult

type Limits = {
  maxLines: number
  maxBytes: number
}

export type Editor = {
  configure: (limits: Partial<Limits>) => void
}

export interface Interface extends State.Transformable<Editor> {
  readonly truncate: (result: Result) => Effect.Effect<Result>
  /** Writes bytes the model cannot receive inline to a retained file and returns its path. */
  readonly save: (bytes: Uint8Array, extension: string) => Effect.Effect<string>
  readonly cleanup: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ToolOutput") {}

const cleanup = Effect.fn("ToolOutput.cleanup")(function* (fs: FSUtil.Interface, directory: string) {
  const entries = yield* fs.readDirectory(directory).pipe(
    Effect.map((entries) => entries.filter((entry) => /^tool_[0-9a-f]{12}/.test(entry))),
    Effect.orElseSucceed(() => []),
  )
  yield* FileRetention.cleanup(
    fs,
    entries.map((entry) => path.join(directory, entry)),
    RETENTION,
  )
})

/** Share of the line budget the tail reserves, so a long head cannot consume the lines that carry the outcome. */
export const TAIL_SHARE = 0.4

/** The first `lineCap` lines that fit `byteCap`, counting the newline between kept lines. */
const takeHead = (lines: ReadonlyArray<string>, lineCap: number, byteCap: number) => {
  const kept: string[] = []
  let bytes = 0
  for (const line of lines) {
    if (kept.length >= lineCap) break
    const size = Buffer.byteLength(line, "utf-8") + (kept.length > 0 ? 1 : 0)
    if (bytes + size > byteCap) break
    kept.push(line)
    bytes += size
  }
  return kept
}

/** The last lines that fit `byteCap` without reaching back into the head, newest end first chosen last. */
const takeTail = (lines: ReadonlyArray<string>, headLines: number, lineCap: number, byteCap: number) => {
  const kept: string[] = []
  let bytes = 0
  for (let index = lines.length - 1; index >= headLines; index--) {
    if (kept.length >= lineCap) break
    const line = lines[index]
    if (line === undefined) break
    const size = Buffer.byteLength(line, "utf-8") + (kept.length > 0 ? 1 : 0)
    if (bytes + size > byteCap) break
    kept.unshift(line)
    bytes += size
  }
  return kept
}

const bytesOf = (lines: ReadonlyArray<string>) =>
  lines.reduce((total, line, index) => total + Buffer.byteLength(line, "utf-8") + (index > 0 ? 1 : 0), 0)

/** Names the ranges kept and what the file holds, so the model knows both what it lost and where to look. */
const markerOf = (headLines: number, tailLines: number, total: number, file: string) => {
  const spans: string[] = []
  if (headLines > 0) spans.push(`1-${headLines}`)
  const start = total - tailLines + 1
  if (tailLines > 0 && start > headLines) spans.push(`${start}-${total}`)
  const shown = spans.length === 0 ? "0 lines" : `lines ${spans.join(" and ")}`
  return `[showing ${shown} of ${total}; full output saved to ${file}]`
}

/**
 * Keeps both ends of a text-only result. The tail is reserved first so that a long head cannot
 * consume it: when the byte budget is tight the head still goes first, which keeps the old shape.
 */
const boundedEnds = (lines: ReadonlyArray<string>, limits: Limits, file: string): Tool.Content[] => {
  const tailTarget = Math.max(1, Math.floor(limits.maxLines * TAIL_SHARE))
  const head = takeHead(lines, Math.max(0, limits.maxLines - tailTarget), limits.maxBytes)
  const tail = takeTail(lines, head.length, limits.maxLines - head.length, limits.maxBytes - bytesOf(head))
  const bounded: Tool.Content[] = []
  if (head.length > 0) bounded.push({ type: "text", text: head.join("\n") })
  bounded.push({ type: "text", text: markerOf(head.length, tail.length, lines.length, file) })
  if (tail.length > 0) bounded.push({ type: "text", text: tail.join("\n") })
  return bounded
}

/** Keeps the head only, but leaves every file part where it was so the surrounding text still reads. */
const boundedHead = (
  content: ReadonlyArray<Tool.Content>,
  lines: ReadonlyArray<string>,
  limits: Limits,
  file: string,
): Tool.Content[] => {
  const kept = takeHead(lines, limits.maxLines, limits.maxBytes)
  const marker = markerOf(kept.length, 0, lines.length, file)
  const bounded: Tool.Content[] = []
  let remaining = kept.join("\n").length
  let seenText = false
  let marked = false
  for (const item of content) {
    if (item.type === "file") {
      bounded.push(item)
      continue
    }
    if (seenText && remaining > 0) remaining--
    seenText = true
    if (remaining >= item.text.length) {
      bounded.push(item)
      remaining -= item.text.length
      continue
    }
    if (remaining > 0) bounded.push({ ...item, text: item.text.slice(0, remaining) })
    if (!marked) bounded.push({ type: "text", text: marker })
    remaining = 0
    marked = true
  }
  if (!marked) bounded.push({ type: "text", text: marker })
  return bounded
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const directory = path.join(global.data, DIRECTORY)
    const state = State.create<Limits, Editor>({
      name: "tool-output",
      initial: () => ({ maxLines: MAX_LINES, maxBytes: MAX_BYTES }),
      editor: (editor) => ({
        configure: (limits) => {
          if (limits.maxLines !== undefined) editor.maxLines = limits.maxLines
          if (limits.maxBytes !== undefined) editor.maxBytes = limits.maxBytes
        },
      }),
    })

    const truncate = Effect.fnUntraced(function* (result: Result) {
      if (result.metadata?.truncated !== undefined) return result
      const content = result.content
      const text = content.flatMap((item) => (item.type === "text" ? [item.text] : [])).join("\n")
      const limits = state.get()
      const lines = text.split("\n")
      if (text.endsWith("\n")) lines.pop()
      const totalBytes = Buffer.byteLength(text, "utf-8")
      if (lines.length <= limits.maxLines && totalBytes <= limits.maxBytes)
        return { ...result, metadata: { ...result.metadata, truncated: false } }

      const file = path.join(directory, fileName())
      yield* fs.ensureDir(directory).pipe(Effect.orDie)
      yield* fs.writeFileString(file, text).pipe(Effect.orDie)
      // SiCode: a long output's answer is nearly always in its last lines — a stack trace's cause, a
      // test run's tally — so a head-only preview hides exactly what the model needs. Keep both ends.
      // A file part (an image) keeps the head-only path: the text around it is a caption whose order
      // matters more than its tail.
      const bounded = content.some((item) => item.type === "file")
        ? boundedHead(content, lines, limits, file)
        : boundedEnds(lines, limits, file)
      return {
        ...result,
        content: bounded,
        metadata: { ...result.metadata, truncated: true, outputPath: file },
      }
    })
    const save = Effect.fnUntraced(function* (bytes: Uint8Array, extension: string) {
      const file = path.join(directory, fileName() + extension)
      yield* fs.writeWithDirs(file, bytes).pipe(Effect.orDie)
      return file
    })

    return Service.of({
      transform: state.transform,
      reload: state.reload,
      truncate,
      save,
      cleanup: () => cleanup(fs, directory),
    })
  }),
)

const cleanupLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    yield* cleanup(fs, path.join(global.data, DIRECTORY)).pipe(
      Effect.repeat(Schedule.spaced(Duration.hours(1))),
      Effect.forkScoped,
    )
  }),
)

const cleanupNode = makeGlobalNode({
  name: "tool-output-cleanup",
  layer: cleanupLayer,
  deps: [FSUtil.node, Global.node],
})

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [FSUtil.node, Global.node, cleanupNode],
})
