import { describe, expect, test } from "bun:test"
import type { SessionMessage } from "../src/session/message.js"
import {
  TODO_CONTINUE_SOFT_PROMPT,
  TODO_CONTINUE_START_STEPS,
  TODO_START_SOFT_PROMPT,
  isContinueUserPrompt,
  priorPlanFullyCompleted,
  continuePlanStartThresholds,
} from "../src/session/runner/planning-gate.js"

const todo = (todos: ReadonlyArray<{ content: string; status: string }>) => ({
  type: "tool",
  id: "tool-todo",
  name: "todowrite",
  state: { status: "completed", input: { todos }, content: [{ type: "text", text: "ok" }] },
})

const assistant = (...parts: unknown[]) =>
  ({ type: "assistant", content: parts }) as unknown as SessionMessage.Info

const user = (text: string) =>
  ({
    type: "user",
    text,
    content: [],
  }) as unknown as SessionMessage.Info

describe("isContinueUserPrompt", () => {
  test("matches short continue / ack by length", () => {
    expect(isContinueUserPrompt("go")).toBe(true)
    expect(isContinueUserPrompt("  ok.")).toBe(true)
    expect(isContinueUserPrompt("continue")).toBe(true)
    expect(isContinueUserPrompt("next")).toBe(true)
  })

  test("rejects questions, paths, and longer prompts", () => {
    expect(isContinueUserPrompt("please start optimizing the pack step")).toBe(false)
    expect(isContinueUserPrompt("continue after checking the logs for errors")).toBe(false)
    expect(isContinueUserPrompt("fix inject.ts")).toBe(false)
    expect(isContinueUserPrompt("continue?")).toBe(false)
    expect(isContinueUserPrompt("")).toBe(false)
  })
})

describe("priorPlanFullyCompleted", () => {
  test("true when the todowrite before the latest user had only completed/cancelled items", () => {
    expect(
      priorPlanFullyCompleted([
        user("optimize"),
        assistant(todo([{ content: "a", status: "completed" }, { content: "b", status: "completed" }])),
        user("continue"),
      ]),
    ).toBe(true)
  })

  test("false when the prior list still had open items", () => {
    expect(
      priorPlanFullyCompleted([
        user("optimize"),
        assistant(todo([{ content: "a", status: "completed" }, { content: "b", status: "pending" }])),
        user("continue"),
      ]),
    ).toBe(false)
  })

  test("false with no prior todowrite", () => {
    expect(priorPlanFullyCompleted([user("continue")])).toBe(false)
  })
})

describe("continuePlanStartThresholds", () => {
  test("softs earlier when the user said continue after a finished plan", () => {
    const messages = [
      user("optimize"),
      assistant(todo([{ content: "p1", status: "completed" }])),
      user("continue"),
    ]
    expect(continuePlanStartThresholds(messages)).toEqual({
      softAt: TODO_CONTINUE_START_STEPS,
    })
  })

  test("returns undefined for a normal turn", () => {
    expect(continuePlanStartThresholds([user("start optimizing the pack")])).toBeUndefined()
  })
})

describe("soft prompts stay soft", () => {
  test("start and continue softs name todowrite without forcing a call", () => {
    expect(TODO_START_SOFT_PROMPT).toContain("todowrite")
    expect(TODO_START_SOFT_PROMPT).toContain("Do not stop other work just to open a list")
    expect(TODO_CONTINUE_SOFT_PROMPT).toContain("todowrite")
    expect(TODO_CONTINUE_SOFT_PROMPT).not.toMatch(/forces one/i)
  })
})
