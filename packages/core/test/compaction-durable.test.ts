import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { join, resolve } from "path"
import type { SessionMessage } from "../src/session/message.js"
import { SessionCompactionDurable } from "../src/session/compaction-durable.js"

/**
 * The module only reads `type`, `content[].name` and `content[].state.input` off the messages, so
 * the fixtures build those three fields rather than a full decoded schema value.
 */
const tool = (name: string, input: Record<string, unknown>) =>
  ({ type: "tool", id: `${name}-${Math.random()}`, name, state: { status: "completed", input } }) as never

const assistant = (...parts: unknown[]) => ({ type: "assistant", content: parts }) as unknown as SessionMessage.Info

describe("touched", () => {
  test("returns files most recent first, marking the ones that were written", () => {
    const messages = [
      assistant(tool("read", { filePath: "/project/a.ts" })),
      assistant(tool("edit", { filePath: "/project/b.ts" })),
      assistant(tool("read", { filePath: "/project/c.ts" })),
    ]
    expect(SessionCompactionDurable.touched(messages, "/project").map((entry) => [entry.relative, entry.modified])).toEqual([
      ["c.ts", false],
      ["b.ts", true],
      ["a.ts", false],
    ])
  })

  test("deduplicates a path touched twice and keeps the write as the stronger signal", () => {
    const messages = [
      assistant(tool("edit", { filePath: "/project/a.ts" })),
      assistant(tool("read", { filePath: "/project/a.ts" })),
    ]
    const result = SessionCompactionDurable.touched(messages, "/project")
    expect(result).toHaveLength(1)
    expect(result[0]!.modified).toBe(true)
  })

  test("resolves relative paths against the session directory and ignores other tools", () => {
    const messages = [assistant(tool("grep", { pattern: "x" }), tool("read", { filePath: "src/a.ts" }))]
    // `path.resolve` rather than a literal: the fixture directory is drive-relative on Windows.
    expect(SessionCompactionDurable.touched(messages, "/project")[0]!.absolute).toBe(resolve("/project", "src/a.ts"))
  })
})

describe("collect", () => {
  test("quotes the files an edit needs and skips binary or missing ones", async () => {
    const root = await mkdtemp(join(tmpdir(), "sicode-durable-"))
    try {
      await mkdir(join(root, "src"), { recursive: true })
      await writeFile(join(root, "src", "edited.ts"), "export const value = 1\n")
      await writeFile(join(root, "src", "read.ts"), "export const other = 2\n")
      await writeFile(join(root, "src", "binary.ts"), "a\u0000b")
      const messages = [
        assistant(tool("edit", { filePath: join(root, "src", "edited.ts") })),
        assistant(tool("read", { filePath: join(root, "src", "read.ts") })),
        assistant(tool("read", { filePath: join(root, "src", "binary.ts") })),
        assistant(tool("read", { filePath: join(root, "src", "gone.ts") })),
      ]
      const durable = SessionCompactionDurable.collect(messages, root, 200_000)
      expect(durable).toBeDefined()
      // The edited file ranks ahead of the read-only one regardless of call order.
      expect(durable!.files.map((file) => file.path)).toEqual(["src/edited.ts", "src/read.ts"])
      expect(durable!.files[0]!.text).toContain("value = 1")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("truncates a long file instead of dropping it, and honours the budget", async () => {
    const root = await mkdtemp(join(tmpdir(), "sicode-durable-budget-"))
    try {
      await writeFile(join(root, "big.ts"), "x".repeat(9_000))
      await writeFile(join(root, "small.ts"), "y".repeat(100))
      const messages = [assistant(tool("edit", { filePath: join(root, "big.ts") })), assistant(tool("read", { filePath: join(root, "small.ts") }))]
      // 4k tokens of budget → 5% → 800 chars, below the per-file cap.
      const durable = SessionCompactionDurable.collect(messages, root, 4_000)
      expect(durable!.files[0]!.truncated).toBe(true)
      expect(durable!.files[0]!.text.length).toBeLessThanOrEqual(800)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("carries the newest todo list even when no file is available", () => {
    const messages = [
      assistant(tool("todowrite", { todos: [{ content: "old task", status: "pending" }] })),
      assistant(tool("todowrite", { todos: [{ content: "write the test", status: "in_progress" }] })),
    ]
    const durable = SessionCompactionDurable.collect(messages, "/project", 200_000)
    expect(durable!.files).toEqual([])
    expect(durable!.todos).toEqual([{ content: "write the test", status: "in_progress" }])
  })

  test("returns nothing when the summarized history touched no file and no todo", () => {
    expect(SessionCompactionDurable.collect([assistant(tool("grep", { pattern: "x" }))], "/project", 200_000)).toBeUndefined()
  })
})

describe("render", () => {
  test("round-trips through message metadata and renders tags, not markdown fences", () => {
    const durable = { files: [{ path: "src/a.ts", text: "const a = `b`", truncated: false }], todos: [{ content: "ship it", status: "pending" }] }
    const restored = SessionCompactionDurable.from({ durable })
    expect(restored).toEqual(durable)
    const text = SessionCompactionDurable.render(restored!)
    expect(text).toContain('<file path="src/a.ts">')
    expect(text).toContain("const a = `b`")
    expect(text).toContain("<todos>")
    expect(text).toContain("- [pending] ship it")
    // Fences would be broken by any file containing a backtick.
    expect(text).not.toContain("```")
  })

  test("metadata without a durable block renders nothing", () => {
    expect(SessionCompactionDurable.from(undefined)).toBeUndefined()
    expect(SessionCompactionDurable.from({ keepID: "x" })).toBeUndefined()
    expect(SessionCompactionDurable.from({ durable: { files: [] } })).toBeUndefined()
  })
})
