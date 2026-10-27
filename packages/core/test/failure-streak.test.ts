import { describe, expect, test } from "bun:test"
import type { SessionMessage } from "../src/session/message.js"
import {
  detectFailureStreak,
  FAILURE_STREAK_FIRST,
  FAILURE_STREAK_WINDOW,
} from "../src/session/runner/failure-streak.js"

const completed = (name: string, input: unknown, metadata?: Record<string, unknown>) => ({
  type: "tool",
  id: `tool-${JSON.stringify(input)}-${name}`,
  name,
  state: { status: "completed", input, content: [{ type: "text", text: "ok" }], ...(metadata ? { metadata } : {}) },
})

const failed = (name: string, input: unknown, errorType = "tool") => ({
  type: "tool",
  id: `tool-${JSON.stringify(input)}-${name}`,
  name,
  state: { status: "error", input, error: { type: errorType, message: "boom" } },
})

const step = (tools: unknown[]) =>
  ({ type: "assistant", content: [...tools] }) as unknown as SessionMessage.Info

const user = () => ({ type: "user", content: [{ type: "text", text: "go" }] }) as unknown as SessionMessage.Info

const shellOk = (command: string) => completed("shell", { command }, { exit: 0 })
const shellFail = (command: string) => completed("shell", { command }, { exit: 1 })

describe("detectFailureStreak", () => {
  test("counts errored tools in the trailing window", () => {
    const hit = detectFailureStreak([
      step([failed("edit", { path: "a.ts" })]),
      step([failed("edit", { path: "a.ts", line: 2 })]),
      step([failed("edit", { path: "a.ts", line: 3 })]),
      step([failed("edit", { path: "a.ts", line: 4 })]),
    ])
    expect(hit).not.toBeNull()
    expect(hit!.recent).toBe(4)
    expect(hit!.total).toBe(4)
  })

  test("counts non-zero shell exits — a failing test command is a failure even though it settles completed", () => {
    const hit = detectFailureStreak([
      step([shellFail("npm test"), shellOk("tsc --noEmit")]),
      step([shellFail("npm test -- --grep auth")]),
      step([shellOk("tsc --noEmit")]),
      step([shellFail("npm test"), shellOk("git status")]),
      step([shellFail("npm test -- --grep login")]),
    ])
    expect(hit!.recent).toBe(4)
    expect(hit!.total).toBe(4)
  })

  test("does not count a user decline as the model failing", () => {
    const hit = detectFailureStreak([
      step([failed("shell", { command: "rm x" }, "aborted")]),
      step([failed("shell", { command: "rm y" }, "aborted")]),
      step([failed("shell", { command: "rm z" }, "aborted")]),
      step([failed("shell", { command: "rm w" }, "aborted")]),
    ])
    expect(hit!.recent).toBe(0)
    expect(hit!.total).toBe(0)
  })

  test("healthy success keeps the window quiet", () => {
    const steps = Array.from({ length: 10 }, (_, index) => step([shellOk(`echo ${index}`)]))
    const hit = detectFailureStreak([...steps, step([shellFail("npm test")])])
    expect(hit!.recent).toBe(1)
  })

  test("a success resets nothing but density: old failures age out of the window", () => {
    const grind = Array.from({ length: FAILURE_STREAK_FIRST }, (_, index) => step([failed("edit", { line: index })]))
    const healthy = Array.from({ length: FAILURE_STREAK_WINDOW }, (_, index) => step([shellOk(`echo ${index}`)]))
    const hit = detectFailureStreak([...grind, ...healthy])
    expect(hit!.total).toBe(FAILURE_STREAK_FIRST)
    expect(hit!.recent).toBe(0)
  })

  test("an edit-test grind crosses the threshold despite the interleaved edits", () => {
    const cycle = (index: number) => [step([shellFail(`npm test #${index}`)]), step([completed("edit", { line: index })])]
    const hit = detectFailureStreak([...cycle(1), ...cycle(2), ...cycle(3), ...cycle(4), ...cycle(5)])
    expect(hit!.recent).toBeGreaterThanOrEqual(FAILURE_STREAK_FIRST)
  })

  test("the turn boundary stops the count", () => {
    const hit = detectFailureStreak([
      step([failed("edit", { line: 1 })]),
      step([failed("edit", { line: 2 })]),
      user(),
      step([failed("edit", { line: 3 })]),
      step([failed("edit", { line: 4 })]),
    ])
    expect(hit!.total).toBe(2)
  })

  test("unsettled calls are skipped, and no calls at all yields null", () => {
    expect(detectFailureStreak([step([])])).toBeNull()
    const streaming = {
      type: "tool",
      id: "t",
      name: "read",
      state: { status: "streaming", input: "{}" },
    }
    expect(detectFailureStreak([step([streaming as never])])).toBeNull()
  })
})
