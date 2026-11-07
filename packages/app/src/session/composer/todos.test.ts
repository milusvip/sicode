import { describe, expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client/promise"
import { currentTodo, sessionTodos, todoFinished } from "./todos"

const assistant = (todos: unknown) =>
  ({
    id: "msg_1",
    type: "assistant",
    content: [
      {
        type: "tool",
        name: "todowrite",
        state: { status: "completed", input: { todos } },
      },
    ],
  }) as unknown as SessionMessageInfo

describe("sessionTodos", () => {
  test("reads the latest completed todowrite list", () => {
    expect(
      sessionTodos([
        assistant([
          { content: "a", status: "completed" },
          { content: "b", status: "in_progress" },
        ]),
      ]),
    ).toEqual([
      { content: "a", status: "completed" },
      { content: "b", status: "in_progress" },
    ])
  })

  test("ignores empty content and unknown statuses", () => {
    expect(sessionTodos([assistant([{ content: "", status: "pending" }, { content: "x", status: "weird" }])])).toEqual([
      { content: "x", status: "pending" },
    ])
  })
})

describe("currentTodo / todoFinished", () => {
  test("prefers in_progress, then pending, then last completed", () => {
    expect(
      currentTodo([
        { content: "a", status: "completed" },
        { content: "b", status: "pending" },
      ])?.content,
    ).toBe("b")
    expect(currentTodo([{ content: "a", status: "completed" }])?.content).toBe("a")
  })

  test("finished covers completed and cancelled", () => {
    expect(todoFinished({ content: "a", status: "completed" })).toBe(true)
    expect(todoFinished({ content: "a", status: "cancelled" })).toBe(true)
    expect(todoFinished({ content: "a", status: "pending" })).toBe(false)
  })
})
