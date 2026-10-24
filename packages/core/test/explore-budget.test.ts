import { describe, expect, test } from "bun:test"
import type { SessionMessage } from "../src/session/message.js"
import { EXPLORE_HARD_STEPS, EXPLORE_SOFT_STEPS, readOnlySteps } from "../src/session/runner/explore-budget.js"

const step = (tools: string[], text = "") =>
  ({
    type: "assistant",
    content: [
      ...tools.map((name) => ({ type: "tool", name, state: { status: "completed", content: [] } })),
      ...(text ? [{ type: "text", text }] : []),
    ],
  }) as unknown as SessionMessage.Info

const user = () => ({ type: "user", content: [{ type: "text", text: "go" }] }) as unknown as SessionMessage.Info

describe("readOnlySteps", () => {
  test("counts a run of read-only steps", () => {
    expect(readOnlySteps([step(["read"]), step(["read"]), step(["grep"])])).toBe(3)
  })

  test("treats several read-only tools in one step as a single step", () => {
    expect(readOnlySteps([step(["read", "grep"]), step(["list"])])).toBe(2)
  })

  test("a write breaks the streak", () => {
    // Only the trailing read counts; the write before it is progress.
    expect(readOnlySteps([step(["read"]), step(["write"]), step(["read"])])).toBe(1)
  })

  test("an edit breaks the streak", () => {
    expect(readOnlySteps([step(["grep"]), step(["edit"]), step(["read"]), step(["read"])])).toBe(2)
  })

  test("a step without tools ends the streak", () => {
    // Speaking without acting means the model stopped to answer.
    expect(readOnlySteps([step(["read"]), step([], "here is the answer")])).toBe(0)
  })

  test("stops at the user message that opened the turn", () => {
    expect(readOnlySteps([step(["read"]), user(), step(["read"]), step(["read"])])).toBe(2)
  })

  test("ignores non-assistant messages in between", () => {
    const system = { type: "system", content: [] } as unknown as SessionMessage.Info
    expect(readOnlySteps([step(["read"]), system, step(["read"])])).toBe(2)
  })

  test("returns zero for an empty transcript", () => {
    expect(readOnlySteps([])).toBe(0)
  })

  test("soft budget is below the hard budget", () => {
    expect(EXPLORE_SOFT_STEPS).toBeLessThan(EXPLORE_HARD_STEPS)
  })
})
