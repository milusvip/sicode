import { describe, expect, test } from "bun:test"
import type { SessionMessage } from "../src/session/message.js"
import { CHECKPOINT_STEPS, checkpointFingerprint } from "../src/session/checkpoint-hint.js"

const user = (id = "u1") =>
  ({ id, type: "user", text: "go", files: [], agents: [], skills: [] }) as unknown as SessionMessage.Info

const assistant = (tools: number) =>
  ({
    type: "assistant",
    content: Array.from({ length: Math.max(tools, 0) }, (_, i) => ({
      type: "tool",
      name: "read",
      id: `t${i}`,
      state: { status: "completed", content: [] },
    })),
  }) as unknown as SessionMessage.Info

describe("checkpointFingerprint", () => {
  test(`fires once the turn reaches ${CHECKPOINT_STEPS} assistant steps with tools`, () => {
    process.env.OPENCODE_CHECKPOINT = "1"
    try {
      const messages = [user("msg_long"), ...Array.from({ length: CHECKPOINT_STEPS }, () => assistant(1))]
      expect(checkpointFingerprint(messages)).toBe("msg_long")
    } finally {
      delete process.env.OPENCODE_CHECKPOINT
    }
  })

  test("does not fire before the step threshold", () => {
    process.env.OPENCODE_CHECKPOINT = "1"
    try {
      const messages = [user(), ...Array.from({ length: CHECKPOINT_STEPS - 1 }, () => assistant(1))]
      expect(checkpointFingerprint(messages)).toBeUndefined()
    } finally {
      delete process.env.OPENCODE_CHECKPOINT
    }
  })

  test("does not fire on text-only assistant steps", () => {
    process.env.OPENCODE_CHECKPOINT = "1"
    try {
      const prose = {
        type: "assistant",
        content: [{ type: "text", text: "still thinking" }],
      } as unknown as SessionMessage.Info
      const messages = [user(), ...Array.from({ length: CHECKPOINT_STEPS }, () => prose)]
      expect(checkpointFingerprint(messages)).toBeUndefined()
    } finally {
      delete process.env.OPENCODE_CHECKPOINT
    }
  })

  test("resets counting after a new user message", () => {
    process.env.OPENCODE_CHECKPOINT = "1"
    try {
      const messages = [
        user("old"),
        ...Array.from({ length: CHECKPOINT_STEPS }, () => assistant(1)),
        user("new"),
        assistant(1),
      ]
      expect(checkpointFingerprint(messages)).toBeUndefined()
    } finally {
      delete process.env.OPENCODE_CHECKPOINT
    }
  })

  test("stays off unless OPENCODE_CHECKPOINT=1", () => {
    delete process.env.OPENCODE_CHECKPOINT
    const messages = [user("msg"), ...Array.from({ length: CHECKPOINT_STEPS }, () => assistant(1))]
    expect(checkpointFingerprint(messages)).toBeUndefined()
    process.env.OPENCODE_CHECKPOINT = "0"
    try {
      expect(checkpointFingerprint(messages)).toBeUndefined()
    } finally {
      delete process.env.OPENCODE_CHECKPOINT
    }
  })
})
