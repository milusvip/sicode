import { describe, expect, test } from "bun:test"
import type { SessionMessage } from "../src/session/message.js"
import { detectLoop, LOOP_MIN_REPETITIONS } from "../src/session/runner/loop-detection.js"

const tool = (name: string, input: unknown, result = "ok") => ({
  type: "tool",
  id: `tool-${JSON.stringify(input)}`,
  name,
  state: { status: "completed", input, content: [{ type: "text", text: result }] },
})

const step = (tools: ReturnType<typeof tool>[], text = "") =>
  ({
    type: "assistant",
    content: [...tools, ...(text ? [{ type: "text", text }] : [])],
  }) as unknown as SessionMessage.Info

const user = () => ({ type: "user", content: [{ type: "text", text: "go" }] }) as unknown as SessionMessage.Info

const read = (path: string, result = "ok") => tool("read", { path }, result)

describe("detectLoop", () => {
  test("catches one call repeated with the same arguments and the same result", () => {
    const hit = detectLoop([step([read("a.ts")]), step([read("a.ts")]), step([read("a.ts")])])
    expect(hit).not.toBeNull()
    expect(hit!.repeats).toBe(LOOP_MIN_REPETITIONS)
    expect(hit!.period).toBe(1)
    expect(hit!.kind).toBe("same_calls_and_results")
  })

  test("stays quiet on fewer repeats than the threshold", () => {
    expect(detectLoop([step([read("a.ts")]), step([read("a.ts")])])).toBeNull()
  })

  test("stays quiet when the arguments change", () => {
    expect(detectLoop([step([read("a.ts")]), step([read("b.ts")]), step([read("c.ts")])])).toBeNull()
  })

  test("stays quiet when the result keeps changing, because that is progress", () => {
    // Polling a file that grows: same call, different answer each time.
    const hit = detectLoop([
      step([read("log.txt", "line 1")]),
      step([read("log.txt", "line 1\nline 2")]),
      step([read("log.txt", "line 1\nline 2\nline 3")]),
    ])
    expect(hit).toBeNull()
  })

  test("falls back to comparing calls alone when the prose changes each step", () => {
    const hit = detectLoop([
      step([read("a.ts")], "let me look at the file"),
      step([read("a.ts")], "looking again at the same file"),
      step([read("a.ts")], "checking that file once more"),
    ])
    expect(hit).not.toBeNull()
    expect(hit!.kind).toBe("same_calls_only")
  })

  test("catches a repeating two-step cycle", () => {
    const hit = detectLoop([
      step([read("a.ts")]),
      step([tool("edit", { path: "a.ts", oldString: "x", newString: "y" })]),
      step([read("a.ts")]),
      step([tool("edit", { path: "a.ts", oldString: "x", newString: "y" })]),
      step([read("a.ts")]),
      step([tool("edit", { path: "a.ts", oldString: "x", newString: "y" })]),
    ])
    expect(hit).not.toBeNull()
    expect(hit!.period).toBe(2)
    expect(hit!.repeats).toBe(3)
  })

  test("an edit that keeps changing its arguments is real work", () => {
    expect(
      detectLoop([
        step([tool("edit", { path: "a.ts", oldString: "x", newString: "y1" })]),
        step([tool("edit", { path: "a.ts", oldString: "y1", newString: "y2" })]),
        step([tool("edit", { path: "a.ts", oldString: "y2", newString: "y3" })]),
      ]),
    ).toBeNull()
  })

  test("only looks at the current turn", () => {
    // Three identical steps, but a new user message means the turn restarted.
    expect(detectLoop([user(), step([read("a.ts")]), step([read("a.ts")]), user(), step([read("a.ts")])])).toBeNull()
  })

  test("a step without tools ends the scan, because the model already answered", () => {
    expect(detectLoop([step([read("a.ts")]), step([], "here is the answer"), step([read("a.ts")]), step([read("a.ts")])])).toBeNull()
  })

  test("never nudges todo churn", () => {
    expect(
      detectLoop([
        step([tool("todowrite", { todos: [] })]),
        step([tool("todowrite", { todos: [] })]),
        step([tool("todowrite", { todos: [] })]),
      ]),
    ).toBeNull()
  })

  test("one fingerprint per loop, so the caller can tell a repeat from a fresh loop", () => {
    const run = (path: string) => detectLoop([step([read(path)]), step([read(path)]), step([read(path)])])
    expect(run("a.ts")!.fingerprint).toBe(run("a.ts")!.fingerprint)
    expect(run("a.ts")!.fingerprint).not.toBe(run("b.ts")!.fingerprint)
  })

  test("argument key order does not change the fingerprint", () => {
    const left = detectLoop([
      step([tool("edit", { path: "a.ts", oldString: "x" })]),
      step([tool("edit", { path: "a.ts", oldString: "x" })]),
      step([tool("edit", { path: "a.ts", oldString: "x" })]),
    ])
    const right = detectLoop([
      step([tool("edit", { oldString: "x", path: "a.ts" })]),
      step([tool("edit", { oldString: "x", path: "a.ts" })]),
      step([tool("edit", { oldString: "x", path: "a.ts" })]),
    ])
    expect(left!.fingerprint).toBe(right!.fingerprint)
  })

  test("an empty transcript has nothing to detect", () => {
    expect(detectLoop([])).toBeNull()
  })
})
