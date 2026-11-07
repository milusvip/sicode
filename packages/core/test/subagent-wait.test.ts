import { describe, expect, test } from "bun:test"
import type { SessionMessage } from "../src/session/message.js"
import {
  SUBAGENT_WAIT_FIRST,
  detectSubagentWait,
} from "../src/session/runner/subagent-wait.js"

const user = () =>
  ({ id: "u1", type: "user", text: "analyze tipa", files: [], agents: [], skills: [] }) as unknown as SessionMessage.Info

const text = (body: string) => ({ type: "text", text: body }) as SessionMessage.AssistantContent

const subagentRunning = () =>
  ({
    type: "tool",
    name: "subagent",
    id: "sub-bg",
    state: {
      status: "completed",
      input: { background: true, description: "A" },
      content: [{ type: "text", text: "running" }],
      metadata: { status: "running", sessionID: "ses_child" },
    },
  }) as unknown as SessionMessage.AssistantContent

const assistant = (...parts: SessionMessage.AssistantContent[]) =>
  ({ type: "assistant", content: parts }) as unknown as SessionMessage.Info

describe("detectSubagentWait", () => {
  test(`fires after ${SUBAGENT_WAIT_FIRST} wait narrations while a background subagent is outstanding`, () => {
    const messages = [
      user(),
      assistant(subagentRunning(), text("Launched A–D in background.")),
      assistant(text("Still waiting for the docs to land.")),
      assistant(text("Check whether A–D finished — docs haven't landed yet.")),
    ]
    const hit = detectSubagentWait(messages)
    expect(hit).not.toBeNull()
    expect(hit!.fingerprint).toBe("subagent_wait")
    expect(hit!.waits).toBeGreaterThanOrEqual(SUBAGENT_WAIT_FIRST)
  })

  test("does not fire without an outstanding background subagent", () => {
    const messages = [
      user(),
      assistant(text("Still waiting for the docs to land.")),
      assistant(text("Check whether A–D finished.")),
    ]
    expect(detectSubagentWait(messages)).toBeNull()
  })

  test("does not fire below the wait narration threshold", () => {
    const messages = [
      user(),
      assistant(subagentRunning(), text("Launched background work.")),
      assistant(text("Still waiting for the docs to land.")),
    ]
    expect(detectSubagentWait(messages)).toBeNull()
  })

  test("honors the kill switch", () => {
    process.env.OPENCODE_SUBAGENT_WAIT = "0"
    try {
      const messages = [
        user(),
        assistant(subagentRunning()),
        assistant(text("Still waiting for the docs to land.")),
        assistant(text("Check whether A–D finished — docs haven't landed yet.")),
      ]
      expect(detectSubagentWait(messages)).toBeNull()
    } finally {
      delete process.env.OPENCODE_SUBAGENT_WAIT
    }
  })
})
