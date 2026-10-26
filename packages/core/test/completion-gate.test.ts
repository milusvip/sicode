import { describe, expect, test } from "bun:test"
import type { SessionMessage } from "../src/session/message.js"
import {
  completionFingerprint,
  completionGatePrompt,
  detectPendingTodos,
} from "../src/session/runner/completion-gate.js"

const todo = (todos: ReadonlyArray<{ content: string; status: string }>) => ({
  type: "tool",
  id: "tool-todo",
  name: "todowrite",
  state: { status: "completed", input: { todos }, content: [{ type: "text", text: "ok" }] },
})

const step = (tools: ReadonlyArray<ReturnType<typeof todo>>, text = "") =>
  ({
    type: "assistant",
    content: [...tools, ...(text ? [{ type: "text", text }] : [])],
  }) as unknown as SessionMessage.Info

describe("detectPendingTodos", () => {
  test("reports open todos from the latest todowrite", () => {
    const pending = detectPendingTodos([
      step([todo([{ content: "write tests", status: "completed" }, { content: "run them", status: "pending" }])]),
    ])
    expect(pending).toEqual([{ content: "run them", status: "pending" }])
  })

  test("treats in_progress as still open", () => {
    const pending = detectPendingTodos([
      step([todo([{ content: "ship it", status: "in_progress" }])]),
    ])
    expect(pending).toEqual([{ content: "ship it", status: "in_progress" }])
  })

  test("returns empty when everything is completed or cancelled", () => {
    expect(
      detectPendingTodos([
        step([todo([{ content: "done", status: "completed" }, { content: "dropped", status: "cancelled" }])]),
      ]),
    ).toEqual([])
  })

  test("returns empty when the latest todowrite clears the list", () => {
    // A later "Todos cleared" (empty list) wins over an earlier open list.
    expect(
      detectPendingTodos([
        step([todo([{ content: "open", status: "pending" }])]),
        step([todo([])]),
      ]),
    ).toEqual([])
  })

  test("ignores other tools and non-todo messages", () => {
    expect(detectPendingTodos([{ type: "user", content: [] } as unknown as SessionMessage.Info])).toEqual([])
    expect(detectPendingTodos([])).toEqual([])
  })

  test("ignores a todowrite that never completed", () => {
    const streaming = {
      type: "tool",
      id: "tool-todo",
      name: "todowrite",
      state: { status: "streaming", input: "..." },
    }
    const stepStreaming = {
      type: "assistant",
      content: [streaming],
    } as unknown as SessionMessage.Info
    expect(detectPendingTodos([stepStreaming])).toEqual([])
  })
})

describe("completionFingerprint", () => {
  test("same open todos share a fingerprint, different ones do not", () => {
    const a = completionFingerprint([{ content: "x", status: "pending" }])
    expect(a).toBe(completionFingerprint([{ content: "x", status: "pending" }]))
    expect(a).not.toBe(completionFingerprint([{ content: "y", status: "pending" }]))
  })

  test("status is part of the key", () => {
    expect(completionFingerprint([{ content: "x", status: "pending" }])).not.toBe(
      completionFingerprint([{ content: "x", status: "in_progress" }]),
    )
  })
})

describe("completionGatePrompt", () => {
  test("lists the open todos", () => {
    const prompt = completionGatePrompt([{ content: "write tests", status: "pending" }])
    expect(prompt).toContain("write tests")
    expect(prompt).toContain("todos still open")
  })
})
