import { describe, expect, test } from "bun:test"
import type { SessionMessage } from "../src/session/message.js"
import { unansweredPrompt } from "../src/session/runner/final-answer-gate.js"

const user = (id: string, text = "这个函数是干嘛的？") =>
  ({ type: "user", id, text, content: [] }) as unknown as SessionMessage.Info

const tool = (name = "edit", id = `tool-${name}`) =>
  ({ type: "tool", id, name, state: { status: "completed", input: { path: "a.ts" }, content: [] } }) as const

const assistant = (id: string, parts: ReadonlyArray<ReturnType<typeof tool> | { type: "text"; text: string }>) =>
  ({ type: "assistant", id, content: parts }) as unknown as SessionMessage.Info

describe("unansweredPrompt", () => {
  test("a turn that changed files without a word never answered", () => {
    const messages = [user("msg_user"), assistant("msg_a", [tool("edit")]), assistant("msg_b", [tool("write")])]

    expect(unansweredPrompt(messages)).toBe("msg_user")
  })

  test("any assistant text closes the turn", () => {
    const messages = [
      user("msg_user"),
      assistant("msg_a", [tool("edit")]),
      assistant("msg_b", [{ type: "text", text: "改好了。" }]),
    ]

    expect(unansweredPrompt(messages)).toBeUndefined()
  })

  test("whitespace is not an answer", () => {
    const messages = [user("msg_user"), assistant("msg_a", [tool("edit"), { type: "text", text: "   \n\t" }])]

    expect(unansweredPrompt(messages)).toBe("msg_user")
  })

  test("an empty response after a change is not an answer", () => {
    expect(unansweredPrompt([user("msg_user"), assistant("msg_a", [tool("patch")]), assistant("msg_b", [])])).toBe(
      "msg_user",
    )
  })

  test("a read-only turn is left to the exploration budget", () => {
    const messages = [user("msg_user"), assistant("msg_a", [tool("read")]), assistant("msg_b", [tool("grep")])]

    expect(unansweredPrompt(messages)).toBeUndefined()
  })

  test("text written before a steering message does not answer the steer", () => {
    const messages = [
      user("msg_first"),
      assistant("msg_a", [{ type: "text", text: "我先看下。" }]),
      user("msg_steer"),
      assistant("msg_b", [tool("edit")]),
    ]

    expect(unansweredPrompt(messages)).toBe("msg_steer")
  })

  test("a turn nobody asked about is not gated", () => {
    expect(unansweredPrompt([assistant("msg_a", [tool("edit")])])).toBeUndefined()
    expect(unansweredPrompt([])).toBeUndefined()
  })
})
