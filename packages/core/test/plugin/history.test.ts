import { describe, expect, it } from "bun:test"
import type { SessionMessage } from "@opencode/schema/session-message"
import { archiveOf, clip, HistoryTool } from "@opencode/core/tool/plugin/history"

const user = (text: string) => ({ type: "user", text }) as unknown as SessionMessage.Info
const assistant = (text: string) => ({ type: "assistant", content: [{ type: "text", text }] }) as unknown as SessionMessage.Info
const compaction = (status: "completed" | "running") =>
  ({ type: "compaction", status }) as unknown as SessionMessage.Info

describe("history archive", () => {
  it("reports an empty archive before any compaction", () => {
    const result = archiveOf([user("hello"), assistant("hi")])
    expect(result.archived).toEqual([])
    expect(result.compacted).toBe(0)
  })

  it("keeps the exchanges the last compaction took away", () => {
    const result = archiveOf([
      user("why does the build fail"),
      assistant("the lockfile is stale"),
      compaction("completed"),
      user("fix it"),
    ])
    expect(result.archived).toEqual(["[User]: why does the build fail", "[Assistant]: the lockfile is stale"])
    expect(result.compacted).toBe(1)
  })

  // A newer summary covers the whole conversation so far, so everything before the newest
  // compaction is reachable again — not only the exchanges since the one before it.
  it("archives everything the newest compaction covers", () => {
    const result = archiveOf([
      user("old"),
      compaction("completed"),
      user("middle"),
      compaction("completed"),
      user("current"),
    ])
    expect(result.archived).toEqual(["[User]: old", "[User]: middle"])
    expect(result.compacted).toBe(2)
  })

  it("ignores a compaction that has not finished", () => {
    const result = archiveOf([user("before"), compaction("running"), user("after")])
    expect(result.archived).toEqual([])
    expect(result.compacted).toBe(0)
  })
})

describe("history output", () => {
  it("names the ranges and the archive size when it matches", () => {
    const content = HistoryTool.toModelContent([{ text: "[User]: hi" }], 4)
    expect(content).toBe("1 of 4 archived exchanges, from before the last compaction:\n[User]: hi\n---")
  })

  it("says nothing is archived when the session was never compacted", () => {
    expect(HistoryTool.toModelContent([], 0)).toContain("Nothing has been compacted away")
  })

  it("reports a miss without pretending the exchange is gone", () => {
    expect(HistoryTool.toModelContent([], 4)).toContain("No archived exchange matches that.")
  })

  it("clips a long exchange from the middle, keeping both ends", () => {
    const text = `HEAD${"x".repeat(2_000)}TAIL`
    const clipped = clip(text)
    expect(clipped.startsWith("HEAD")).toBe(true)
    expect(clipped.endsWith("TAIL")).toBe(true)
    expect(clipped).toContain("chars clipped")
    expect(clipped.length).toBeLessThan(text.length)
  })

  it("leaves a short exchange untouched", () => {
    expect(clip("[User]: hi")).toBe("[User]: hi")
  })
})
