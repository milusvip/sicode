import { describe, expect, test } from "bun:test"
import { EXPLORE_OUTPUT_CAP, clipExploreOutput } from "../src/session/subagent-completion.js"

describe("SubagentCompletion.clipExploreOutput", () => {
  test("leaves non-explore agents alone", () => {
    const dump = "x".repeat(EXPLORE_OUTPUT_CAP + 100)
    expect(clipExploreOutput(dump, "General")).toBe(dump)
    expect(clipExploreOutput(dump)).toBe(dump)
  })

  test("caps Explore output and keeps short summaries intact", () => {
    expect(clipExploreOutput("short", "Explore")).toBe("short")
    const dump = "y".repeat(EXPLORE_OUTPUT_CAP + 50)
    const clipped = clipExploreOutput(dump, "explore")
    expect(clipped.startsWith(dump.slice(0, EXPLORE_OUTPUT_CAP))).toBe(true)
    expect(clipped).toContain("explore output truncated")
    expect(clipped.length).toBeGreaterThan(EXPLORE_OUTPUT_CAP)
  })
})
