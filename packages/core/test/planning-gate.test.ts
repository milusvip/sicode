import { describe, expect, test } from "bun:test"
import type { SessionMessage } from "../src/session/message.js"
import { hasTodowriteSinceUser, staleTodoSteps, TODO_STALE_STEPS } from "../src/session/runner/planning-gate.js"

const todo = (status: "completed" | "running" | "streaming" = "completed") => ({
  type: "tool" as const,
  id: "tool-todo",
  name: "todowrite",
  state: { status, input: { todos: [] }, content: [{ type: "text", text: "ok" }] },
})

const write = (todos: ReadonlyArray<{ content: string; status: string }>, status: "completed" | "running" = "completed") => ({
  type: "tool" as const,
  id: "tool-todo",
  name: "todowrite",
  state: { status, input: { todos }, content: [{ type: "text", text: "ok" }] },
})

const work = (status: "completed" | "running" | "error" = "completed") => ({
  type: "tool" as const,
  id: "tool-work",
  name: "read",
  state: { status, input: {}, content: [{ type: "text", text: "ok" }] },
})

const assistant = (tools: ReadonlyArray<ReturnType<typeof todo> | ReturnType<typeof write> | ReturnType<typeof work>>) =>
  ({
    type: "assistant",
    content: tools,
  }) as unknown as SessionMessage.Info

const user = { type: "user", content: [] } as unknown as SessionMessage.Info

describe("staleTodoSteps", () => {
  const open = [
    { content: "a", status: "completed" },
    { content: "b", status: "in_progress" },
  ]
  const finished = Array.from({ length: TODO_STALE_STEPS }, () => work())

  test("0 when no todowrite exists", () => {
    expect(staleTodoSteps([user, assistant(finished)])).toBe(0)
  })

  test("0 while the list is still fresh", () => {
    expect(staleTodoSteps([user, assistant([write(open), work(), work()])])).toBe(0)
  })

  test("counts finished calls since the latest write", () => {
    expect(staleTodoSteps([user, assistant([write(open), ...finished])])).toBe(TODO_STALE_STEPS)
  })

  test("0 once every item is resolved", () => {
    const done = [
      { content: "a", status: "completed" },
      { content: "b", status: "cancelled" },
    ]
    expect(staleTodoSteps([user, assistant([write(done), ...finished])])).toBe(0)
  })

  test("a cleared list wins over an earlier open one", () => {
    expect(staleTodoSteps([user, assistant([write(open), ...finished, write([])])])).toBe(0)
  })

  test("ignores calls that did not finish", () => {
    const running = Array.from({ length: TODO_STALE_STEPS }, () => work("running"))
    expect(staleTodoSteps([user, assistant([write(open), ...running])])).toBe(0)
  })
})

describe("hasTodowriteSinceUser", () => {
  test("false when the turn has no todowrite yet", () => {
    expect(hasTodowriteSinceUser([user, assistant([])])).toBe(false)
  })

  test("true when a completed todowrite sits after the latest user", () => {
    expect(hasTodowriteSinceUser([user, assistant([todo()])])).toBe(true)
  })

  test("true for a still-running todowrite", () => {
    expect(hasTodowriteSinceUser([user, assistant([todo("running")])])).toBe(true)
  })

  test("false for a todowrite that never completed", () => {
    expect(hasTodowriteSinceUser([user, assistant([todo("streaming")])])).toBe(false)
  })

  test("stops at the latest user — earlier todos do not count", () => {
    expect(hasTodowriteSinceUser([assistant([todo()]), user, assistant([])])).toBe(false)
  })
})
