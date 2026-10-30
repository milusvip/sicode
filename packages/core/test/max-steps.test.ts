import { describe, expect, test } from "bun:test"
import type { SessionMessage } from "../src/session/message.js"
import { DEFAULT_STEPS, MAX_STEPS_PROMPT, TODO_HEADROOM, effectiveStepLimit } from "../src/session/runner/max-steps.js"

const todoStep = (todos: Array<{ status: string; content: string }>) =>
  ({
    type: "assistant",
    content: [
      { type: "tool", name: "todowrite", state: { status: "completed", content: [], input: { todos } } },
    ],
  }) as unknown as SessionMessage.Info

describe("max-steps", () => {
  test("provides a positive default step ceiling so a runaway turn always ends", () => {
    expect(Number.isInteger(DEFAULT_STEPS)).toBe(true)
    expect(DEFAULT_STEPS).toBeGreaterThan(0)
    // Aligned with Cursor's 25-call cap: enough for a normal change, short enough to cut off a runaway.
    expect(DEFAULT_STEPS).toBe(25)
  })

  test("the step-limit prompt hands control back instead of dead-ending", () => {
    expect(MAX_STEPS_PROMPT).toContain("continue")
    expect(MAX_STEPS_PROMPT).toContain("next action")
    // It must tell the model to stop calling tools, and that the user can resume it.
    expect(MAX_STEPS_PROMPT).toContain("Do not call any tools")
  })

  test("a configured step count always wins over the default and the todo headroom", () => {
    expect(effectiveStepLimit([], 10)).toBe(10)
    expect(
      effectiveStepLimit(
        [todoStep([{ status: "in_progress", content: "a" }, { status: "pending", content: "b" }])],
        10,
      ),
    ).toBe(10)
  })

  test("a turn with no todo plan keeps the tight default ceiling", () => {
    expect(effectiveStepLimit([])).toBe(DEFAULT_STEPS)
  })

  test("a turn with fewer than two open todos is not treated as a planned long task", () => {
    expect(
      effectiveStepLimit([todoStep([{ status: "completed", content: "a" }, { status: "pending", content: "b" }])]),
    ).toBe(DEFAULT_STEPS)
  })

  test("a turn the model planned with two or more open todos gets headroom", () => {
    const planned = [
      todoStep([
        { status: "in_progress", content: "wire the field" },
        { status: "pending", content: "add a test" },
        { status: "pending", content: "verify on device" },
      ]),
    ]
    expect(effectiveStepLimit(planned)).toBe(DEFAULT_STEPS + TODO_HEADROOM)
  })

  test("an empty todo list after the plan means done, and drops back to the tight ceiling", () => {
    const cleared = [
      todoStep([{ status: "in_progress", content: "a" }, { status: "pending", content: "b" }]),
      todoStep([]),
    ]
    expect(effectiveStepLimit(cleared)).toBe(DEFAULT_STEPS)
  })
})
