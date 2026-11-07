import { describe, expect, test } from "bun:test"
import type { SessionMessage } from "../src/session/message.js"
import {
  MAX_COMPLETION_CONTINUES,
  completionContinue,
  completionFingerprint,
  completionGateEscalatePrompt,
  completionGatePrompt,
  detectCompletableTodos,
  detectPendingTodos,
  isCompletionHolding,
  resolveStepToolChoice,
  stableTodoKey,
} from "../src/session/runner/completion-gate.js"

const todo = (todos: ReadonlyArray<{ content: string; status: string; id?: string }>) => ({
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

const user = (text: string) =>
  ({
    type: "user",
    text,
  }) as unknown as SessionMessage.Info

describe("detectPendingTodos", () => {
  test("reports open todos from the latest todowrite", () => {
    const pending = detectPendingTodos([
      step([todo([{ content: "write tests", status: "completed" }, { content: "run them", status: "pending" }])]),
    ])
    expect(pending).toEqual([{ content: "run them", status: "pending" }])
  })

  test("treats in_progress as still open and keeps id", () => {
    const pending = detectPendingTodos([
      step([todo([{ id: "t1", content: "ship it", status: "in_progress" }])]),
    ])
    expect(pending).toEqual([{ content: "ship it", status: "in_progress", id: "t1" }])
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

describe("detectCompletableTodos", () => {
  test("forces only todos written after the latest user message", () => {
    const open = todo([{ content: "draw png", status: "in_progress" }, { content: "wire desk", status: "pending" }])
    expect(
      detectCompletableTodos([
        step([open]),
        user("我是说要中文的提示词"),
        step([], "这里是中文提示词"),
      ]),
    ).toEqual([])
    expect(
      detectCompletableTodos([
        user("做桌子"),
        step([open]),
        step([], "先画铭牌"),
      ]),
    ).toEqual([
      { content: "draw png", status: "in_progress" },
      { content: "wire desk", status: "pending" },
    ])
  })

  test("still exposes the full ledger via detectPendingTodos after a new ask", () => {
    const open = todo([{ content: "draw png", status: "pending" }])
    const messages = [step([open]), user("要中文的提示词")]
    expect(detectPendingTodos(messages)).toEqual([{ content: "draw png", status: "pending" }])
    expect(detectCompletableTodos(messages)).toEqual([])
  })
})

describe("completionFingerprint / stableTodoKey", () => {
  test("same open slot+status share a fingerprint; content rewrites do not diverge", () => {
    const a = completionFingerprint([{ content: "wait for asset", status: "pending" }])
    expect(a).toBe(completionFingerprint([{ content: "wait for user png then crop", status: "pending" }]))
    expect(a).toBe("pending:#0")
    expect(a).not.toBe(completionFingerprint([{ content: "x", status: "pending" }, { content: "y", status: "pending" }]))
  })

  test("status is part of the key", () => {
    expect(completionFingerprint([{ content: "x", status: "pending" }])).not.toBe(
      completionFingerprint([{ content: "x", status: "in_progress" }]),
    )
  })

  test("id prefers over slot index; progress text does not change the fingerprint", () => {
    expect(stableTodoKey({ content: "download JDK (11.9/134.7 MB)", status: "in_progress" })).toBe(
      stableTodoKey({ content: "download JDK (47.4/134.7 MB)", status: "in_progress" }),
    )
    expect(
      completionFingerprint([{ content: "download JDK (11.9/134.7 MB)", status: "in_progress" }]),
    ).toBe(completionFingerprint([{ content: "download JDK (47.4/134.7 MB)", status: "in_progress" }]))
    expect(stableTodoKey({ id: "dl", content: "a", status: "pending" })).toBe("dl")
    expect(completionFingerprint([{ id: "dl", content: "a", status: "pending" }])).toBe("pending:dl")
  })
})

describe("completionGatePrompt", () => {
  test("lists the open todos", () => {
    const prompt = completionGatePrompt([{ content: "write tests", status: "pending" }])
    expect(prompt).toContain("write tests")
    expect(prompt).toContain("todos still open")
    expect(prompt).toContain("blocked on the user")
  })

  test("escalate prompt demands todowrite status changes", () => {
    const prompt = completionGateEscalatePrompt([{ content: "stuck", status: "in_progress" }])
    expect(prompt).toContain("todowrite")
    expect(prompt).toContain("cancelled")
  })
})

describe("completionContinue", () => {
  test("forces while todos are still open", () => {
    const first = completionContinue({
      pending: [{ content: "a", status: "pending" }, { content: "b", status: "pending" }],
      state: { fingerprint: "", count: 0 },
    })
    expect(first.force).toBe(true)
    expect(first.state.count).toBe(1)
    expect(first.state.toolChoice).toBeUndefined()
    expect(first.prompt).toContain("todos still open")

    const second = completionContinue({
      pending: [{ content: "a", status: "pending" }, { content: "b", status: "pending" }],
      state: first.state,
    })
    expect(second.force).toBe(true)
    expect(second.state.count).toBe(2)
  })

  test("resets the budget when a todo is completed", () => {
    const stuck = completionContinue({
      pending: [{ content: "a", status: "pending" }, { content: "b", status: "pending" }],
      state: { fingerprint: "", count: 0 },
    })
    const afterProgress = completionContinue({
      pending: [{ content: "b", status: "pending" }],
      state: { fingerprint: stuck.state.fingerprint, count: MAX_COMPLETION_CONTINUES, toolChoice: "todowrite" },
    })
    expect(afterProgress.force).toBe(true)
    expect(afterProgress.state.count).toBe(1)
    expect(afterProgress.state.toolChoice).toBeUndefined()
  })

  test("stops forcing once the list is clear", () => {
    expect(
      completionContinue({
        pending: [],
        state: { fingerprint: "pending:a", count: 3, toolChoice: "todowrite" },
      }),
    ).toEqual({ force: false, state: { fingerprint: "", count: 0 } })
  })

  test("escalates to forced todowrite after MAX_COMPLETION_CONTINUES — never hands back", () => {
    let state = { fingerprint: "", count: 0 }
    const pending = [{ content: "stuck", status: "in_progress" as const }]
    for (let i = 0; i < MAX_COMPLETION_CONTINUES; i++) {
      const next = completionContinue({ pending, state })
      expect(next.force).toBe(true)
      expect(next.state.toolChoice).toBeUndefined()
      state = next.state
    }
    const escalated = completionContinue({ pending, state })
    expect(escalated.force).toBe(true)
    expect(escalated.state.toolChoice).toBe("todowrite")
    expect(escalated.prompt).toContain("todowrite")
  })

  test("rewriting progress MB does not reset the escalate path", () => {
    const first = completionContinue({
      pending: [{ content: "下载 JDK（11.9/134.7 MB）", status: "in_progress" }],
      state: { fingerprint: "", count: 0 },
    })
    const rewritten = completionContinue({
      pending: [{ content: "下载 JDK（47.4/134.7 MB）", status: "in_progress" }],
      state: first.state,
    })
    expect(rewritten.state.fingerprint).toBe(first.state.fingerprint)
    expect(rewritten.state.count).toBe(2)
  })
})

describe("isCompletionHolding / resolveStepToolChoice", () => {
  test("holding only while open todos and at least one forced continue", () => {
    expect(isCompletionHolding(2, 0)).toBe(false)
    expect(isCompletionHolding(0, 3)).toBe(false)
    expect(isCompletionHolding(2, 1)).toBe(true)
  })

  test("completion todowrite outranks search-cap none", () => {
    expect(
      resolveStepToolChoice({
        completionToolChoice: "todowrite",
        steerToolChoice: "none",
        steerStop: true,
      }),
    ).toBe("todowrite")
    expect(resolveStepToolChoice({ steerToolChoice: "none", steerStop: true })).toBe("none")
    expect(resolveStepToolChoice({ steerStop: true })).toBe("none")
    expect(resolveStepToolChoice({})).toBeUndefined()
  })
})
