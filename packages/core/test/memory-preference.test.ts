import { describe, expect, test } from "bun:test"
import { PERSONA_PROJECT_KEY } from "../src/session/memory/belief.js"
import { extractFromSummary, extractFromUserText, toBeliefs } from "../src/session/memory/preference.js"

describe("SessionMemoryPreference.extractFromUserText", () => {
  test("lifts a 记住： directive into short clauses", () => {
    expect(extractFromUserText("记住：我偏好简短回复，改动前先说要改哪些文件。")).toEqual([
      "我偏好简短回复",
      "改动前先说要改哪些文件",
    ])
  })

  test("ignores ordinary questions", () => {
    expect(extractFromUserText("侧边栏底部留白是在哪里控制的？")).toEqual([])
  })

  test("accepts English prefer lines", () => {
    expect(extractFromUserText("Please prefer concise replies and list files before editing.")).toEqual([
      "concise replies",
      "list files before editing",
    ])
    expect(extractFromUserText("prefer: concise replies")).toEqual(["concise replies"])
  })
})

describe("SessionMemoryPreference.extractFromSummary", () => {
  test("keeps preference-like Requirements bullets only", () => {
    const markdown = `## Requirements
- Prefer concise replies
- Use Bun for tests
- (none)

## Decisions
- Ship Flash golden
`
    expect(extractFromSummary(markdown)).toEqual(["Prefer concise replies"])
  })
})

describe("SessionMemoryPreference.toBeliefs", () => {
  test("scopes preferences under PERSONA_PROJECT_KEY", () => {
    const beliefs = toBeliefs("alice", ["Prefer short answers"], 1_000)
    expect(beliefs).toHaveLength(1)
    expect(beliefs[0]?.kind).toBe("preference")
    expect(beliefs[0]?.scope).toEqual({ projectKey: PERSONA_PROJECT_KEY, personaId: "alice" })
    expect(beliefs[0]?.proposition).toBe("Prefer short answers")
  })
})
