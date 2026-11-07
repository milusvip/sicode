import { describe, expect, test } from "bun:test"
import type { SessionMessage } from "../src/session/message.js"
import {
  CONTINUE_INTENT_MAX_CHARS,
  continueIntentFingerprint,
  endsAsQuestion,
  mixedProseQuestionFingerprint,
  turnAwaitingUser,
} from "../src/session/runner/continue-intent-gate.js"

const user = (id: string, text = "save data is gone") =>
  ({ type: "user", id, text, content: [] }) as unknown as SessionMessage.Info

const tool = (name = "shell", status: "completed" | "running" = "completed") =>
  ({
    type: "tool",
    id: `tool-${name}`,
    name,
    state: { status, input: {}, content: [] },
  }) as const

const assistant = (
  id: string,
  parts: ReadonlyArray<ReturnType<typeof tool> | { type: "text"; text: string }>,
) => ({ type: "assistant", id, content: parts }) as unknown as SessionMessage.Info

describe("continueIntentFingerprint", () => {
  test("fires on a short next-step announce with no tools", () => {
    const text = "Path looks wrong. Checking install and data dirs next:"
    const messages = [user("msg_user"), assistant("msg_a", [{ type: "text", text }])]
    expect(continueIntentFingerprint(messages)).toBe(`msg_user\n${text}`)
  })

  test("a tool call means the announce already started", () => {
    const messages = [
      user("msg_user"),
      assistant("msg_a", [
        { type: "text", text: "Checking the install dir:" },
        tool("shell"),
      ]),
    ]
    expect(continueIntentFingerprint(messages)).toBeUndefined()
  })

  test("a long conclusion is not an empty stop", () => {
    const body = `${"Root cause is clear.".padEnd(CONTINUE_INTENT_MAX_CHARS + 20, "x")}\n## What happened\ntrailing colon: would not matter past the length cap`
    expect(continueIntentFingerprint([user("msg_user"), assistant("msg_a", [{ type: "text", text: body }])])).toBeUndefined()
  })

  test("plain answers without announce punctuation are not gated", () => {
    expect(
      continueIntentFingerprint([
        user("msg_user"),
        assistant("msg_a", [{ type: "text", text: "A driver update does not delete saves." }]),
      ]),
    ).toBeUndefined()
    expect(
      continueIntentFingerprint([
        user("msg_user"),
        assistant("msg_a", [{ type: "text", text: "Root cause is clear. Here is the summary." }]),
      ]),
    ).toBeUndefined()
  })

  test("numbered how-to without announce punctuation is a finished answer, not a continue", () => {
    const text = ["Done.", "1. First step", "2. Second step", "3. Third step"].join("\n")
    expect(
      continueIntentFingerprint([user("msg_user"), assistant("msg_a", [{ type: "text", text }])]),
    ).toBeUndefined()
  })

  test("English announce with trailing colon is gated", () => {
    const text = "Path looks wrong. Checking the Steam install next:"
    expect(continueIntentFingerprint([user("msg_user"), assistant("msg_a", [{ type: "text", text }])])).toBe(
      `msg_user\n${text}`,
    )
  })

  test("only the latest announce after the latest user counts", () => {
    const messages = [
      user("msg_first"),
      assistant("msg_old", [{ type: "text", text: "Checking A:" }]),
      user("msg_steer"),
      assistant("msg_new", [{ type: "text", text: "Checking B:" }]),
    ]
    expect(continueIntentFingerprint(messages)).toBe(`msg_steer\nChecking B:`)
  })

  test("no user prompt is not gated", () => {
    expect(continueIntentFingerprint([assistant("msg_a", [{ type: "text", text: "Checking dir:" }])])).toBeUndefined()
    expect(continueIntentFingerprint([])).toBeUndefined()
  })

  test("interrogative message shape idles without a word list", () => {
    expect(endsAsQuestion("Should we inspect the protocol before the static patch?")).toBe(true)
    expect(endsAsQuestion("Checking the install dir:")).toBe(false)
    expect(
      continueIntentFingerprint([
        user("msg_user"),
        assistant("msg_a", [{ type: "text", text: "Should we inspect the protocol before the static patch?" }]),
      ]),
    ).toBeUndefined()
  })

  test("running question tool blocks auto-continue structurally", () => {
    const messages = [
      user("msg_user"),
      assistant("msg_a", [
        { type: "text", text: "Pick a direction:" },
        tool("question", "running"),
      ]),
    ]
    expect(turnAwaitingUser(messages)).toBe(true)
    expect(continueIntentFingerprint(messages)).toBeUndefined()
  })

  test("prose ending in ? does not count as waitingOnUser — open todos must still refuse idle", () => {
    const messages = [
      user("msg_user"),
      assistant("msg_a", [{ type: "text", text: "First item is done. Continue?" }]),
    ]
    expect(turnAwaitingUser(messages)).toBe(false)
    expect(endsAsQuestion("First item is done. Continue?")).toBe(true)
    expect(continueIntentFingerprint(messages)).toBeUndefined()
  })
})

describe("mixedProseQuestionFingerprint", () => {
  test("fires when prose asks and non-question tools ran in the same message", () => {
    const messages = [
      user("msg_user"),
      assistant("msg_a", [
        { type: "text", text: "Which side should we change?\nChecking both call sites." },
        tool("grep"),
      ]),
    ]
    expect(mixedProseQuestionFingerprint(messages)).toContain("msg_a")
  })

  test("ignores question-tool asks and tool-only steps", () => {
    expect(
      mixedProseQuestionFingerprint([
        user("msg_user"),
        assistant("msg_a", [
          { type: "text", text: "Pick one?" },
          tool("question", "running"),
        ]),
      ]),
    ).toBeUndefined()
    expect(
      mixedProseQuestionFingerprint([user("msg_user"), assistant("msg_a", [tool("grep")])]),
    ).toBeUndefined()
    expect(
      mixedProseQuestionFingerprint([
        user("msg_user"),
        assistant("msg_a", [{ type: "text", text: "Reading inject.ts." }, tool("read")]),
      ]),
    ).toBeUndefined()
  })
})
