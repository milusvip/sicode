import { describe, expect, test } from "bun:test"
import type { SessionMessage } from "../src/session/message.js"
import {
  EDIT_SPIRAL_MIN_TRANSITIONS,
  detectEditSpiral,
} from "../src/session/runner/edit-spiral.js"

const user = () =>
  ({ id: "u1", type: "user", text: "fix", files: [], agents: [], skills: [] }) as unknown as SessionMessage.Info

const tool = (name: string, path: string) =>
  ({
    type: "tool",
    name,
    id: `${name}-${path}`,
    state: { status: "completed", input: { path }, content: [{ type: "text", text: "ok" }] },
  }) as unknown as SessionMessage.AssistantContent

const assistant = (...parts: SessionMessage.AssistantContent[]) =>
  ({ type: "assistant", content: parts }) as unknown as SessionMessage.Info

describe("detectEditSpiral", () => {
  test(`fires after ${EDIT_SPIRAL_MIN_TRANSITIONS} mutate↔read transitions on one path`, () => {
    const path = "packages/app/src/a.tsx"
    const messages = [
      user(),
      assistant(tool("edit", path)),
      assistant(tool("read", path)),
      assistant(tool("edit", path)),
      assistant(tool("read", path)),
    ]
    const hit = detectEditSpiral(messages)
    expect(hit?.path).toBe(path)
    expect(hit?.transitions).toBeGreaterThanOrEqual(EDIT_SPIRAL_MIN_TRANSITIONS)
    expect(hit?.fingerprint).toBe(`edit-spiral:${path}`)
  })

  test("does not fire on pure reads", () => {
    const path = "a.ts"
    const messages = [
      user(),
      assistant(tool("read", path)),
      assistant(tool("read", path)),
      assistant(tool("read", path)),
      assistant(tool("read", path)),
    ]
    expect(detectEditSpiral(messages)).toBeNull()
  })

  test("does not fire below the transition threshold", () => {
    const path = "a.ts"
    const messages = [user(), assistant(tool("edit", path)), assistant(tool("read", path))]
    expect(detectEditSpiral(messages)).toBeNull()
  })

  test("honors the kill switch", () => {
    process.env.OPENCODE_EDIT_SPIRAL = "0"
    try {
      const path = "a.ts"
      const messages = [
        user(),
        assistant(tool("edit", path)),
        assistant(tool("read", path)),
        assistant(tool("edit", path)),
        assistant(tool("read", path)),
      ]
      expect(detectEditSpiral(messages)).toBeNull()
    } finally {
      delete process.env.OPENCODE_EDIT_SPIRAL
    }
  })
})
