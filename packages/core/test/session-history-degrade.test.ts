import { describe, expect, test } from "bun:test"
import { degradeHistory } from "../src/session/history-degrade.js"
import type { SessionMessage } from "../src/session/message.js"

const text = (lines: number) => Array.from({ length: lines }, (_, index) => `line ${index}`).join("\n")

const toolMessage = (lines: number, name = "read") =>
  ({
    type: "assistant",
    content: [
      { type: "reasoning", text: "thinking" },
      { type: "tool", name, state: { status: "completed", content: [{ type: "text", text: text(lines) }] } },
    ],
  }) as unknown as SessionMessage.Info

const filler = (count: number) =>
  Array.from({ length: count }, () => ({ type: "user", text: "hi" }) as unknown as SessionMessage.Info)

const bodyOf = (message: SessionMessage.Info) =>
  (message as unknown as { content: Array<{ type: string; state?: { content?: Array<{ text: string }> } }> }).content.find(
    (part) => part.type === "tool",
  )!.state!.content![0]!.text

describe("degradeHistory", () => {
  test("leaves short sessions untouched", () => {
    const messages = [toolMessage(500), ...filler(3)]
    expect(degradeHistory(messages)).toBe(messages)
  })

  test("keeps the recent tail whole", () => {
    // 10 messages, cutoff at index 2, so the tool result at index 9 is inside the recent tail.
    const messages = [...filler(9), toolMessage(500)]
    const result = degradeHistory(messages)
    expect(bodyOf(result[9]).split("\n")).toHaveLength(500)
  })

  test("shrinks an older oversized result to head, note and tail", () => {
    const messages = [...filler(2), toolMessage(500), ...filler(8)]
    const result = degradeHistory(messages)
    const lines = bodyOf(result[2]).split("\n")

    expect(lines).toHaveLength(25 + 1 + 15)
    expect(lines[0]).toBe("line 0")
    expect(lines[24]).toBe("line 24")
    expect(lines[25]).toContain("460 lines omitted")
    expect(lines[26]).toBe("line 485")
    expect(lines.at(-1)).toBe("line 499")
  })

  test("leaves results under the line budget alone", () => {
    const messages = [...filler(2), toolMessage(80), ...filler(8)]
    const result = degradeHistory(messages)
    expect(bodyOf(result[2]).split("\n")).toHaveLength(80)
  })

  test("does not mutate the input message", () => {
    const messages = [...filler(2), toolMessage(500), ...filler(8)]
    degradeHistory(messages)
    expect(bodyOf(messages[2]).split("\n")).toHaveLength(500)
  })

  test("keeps non-tool parts and unfinished tools intact", () => {
    const running = {
      type: "assistant",
      content: [{ type: "tool", name: "shell", state: { status: "running", content: [{ type: "text", text: text(500) }] } }],
    } as unknown as SessionMessage.Info
    const messages = [...filler(2), running, ...filler(8)]
    const result = degradeHistory(messages) as unknown as Array<{
      content: Array<{ state: { content: Array<{ text: string }> } }>
    }>
    expect(result[2].content[0].state.content[0].text.split("\n")).toHaveLength(500)
  })

  test("shell noise shrinks harder than an edit summary of the same length", () => {
    const messages = [
      ...filler(2),
      toolMessage(200, "shell"),
      toolMessage(200, "edit"),
      ...filler(8),
    ]
    const result = degradeHistory(messages)
    const shellLines = bodyOf(result[2]).split("\n").length
    const editLines = bodyOf(result[3]).split("\n").length
    expect(shellLines).toBeLessThan(editLines)
    expect(shellLines).toBe(15 + 1 + 10)
    expect(editLines).toBe(200)
  })

  test("browser snapshot uses the noisy tier", () => {
    const messages = [...filler(2), toolMessage(200, "browser_snapshot"), ...filler(8)]
    const lines = bodyOf(degradeHistory(messages)[2]).split("\n")
    expect(lines).toHaveLength(15 + 1 + 10)
    expect(lines[15]).toContain("omitted")
  })

  test("failed tool bodies collapse to a one-line status", () => {
    const failed = {
      type: "assistant",
      content: [
        {
          type: "tool",
          name: "shell",
          state: {
            status: "error",
            error: "exit 1: boom\nmore detail\n",
            content: [{ type: "text", text: text(200) }],
          },
        },
      ],
    } as unknown as SessionMessage.Info
    const messages = [...filler(2), failed, ...filler(8)]
    const body = bodyOf(degradeHistory(messages)[2])
    expect(body.split("\n")).toHaveLength(1)
    expect(body).toContain("shell")
    expect(body).toContain("exit 1: boom")
  })
})
