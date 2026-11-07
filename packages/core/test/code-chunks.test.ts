import { describe, expect, test } from "bun:test"
import { extractChunk, render, windowStart } from "../src/session/code-chunks.js"

describe("code chunks", () => {
  test("windows around the first needle hit", () => {
    const text = ["a", "b", "target here", "d", "e"].join("\n")
    expect(windowStart(text, ["target"], 3)).toBe(2)
  })

  test("falls back to the file head when nothing matches", () => {
    expect(windowStart("one\ntwo\nthree", ["zzz"], 2)).toBe(1)
  })

  test("extractChunk respects the line budget", () => {
    const lines = Array.from({ length: 100 }, (_, index) => `line-${index}`)
    lines[50] = "needle marker"
    const chunk = extractChunk({ path: "a.ts", text: lines.join("\n"), needles: ["needle"] }, { maxLines: 5 })
    expect(chunk?.path).toBe("a.ts")
    expect(chunk!.text.split("\n").length).toBeLessThanOrEqual(5)
    expect(chunk!.text).toContain("needle marker")
  })

  test("render emits a budgeted code-chunks block", () => {
    const out = render([
      { path: "a.ts", text: "export const a = 1\n", needles: ["export"] },
      { path: "b.ts", text: "export const b = 2\n", needles: ["export"] },
    ])
    expect(out).toContain("<code-chunks>")
    expect(out).toContain("### a.ts:")
    expect(out).toContain("### b.ts:")
  })

  test("OPENCODE_CODE_CHUNKS=0 disables render", () => {
    const previous = process.env.OPENCODE_CODE_CHUNKS
    process.env.OPENCODE_CODE_CHUNKS = "0"
    try {
      expect(render([{ path: "a.ts", text: "hello", needles: ["hello"] }])).toBeUndefined()
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_CODE_CHUNKS
      else process.env.OPENCODE_CODE_CHUNKS = previous
    }
  })
})
