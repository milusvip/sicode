import { describe, expect, test } from "bun:test"
import type { SessionMessage } from "../src/session/message.js"
import {
  BATCH_FOCUS_TOOLS,
  BATCH_PROMPT,
  SERIAL_SINGLE_STEPS,
  serialSingleToolSteps,
  shouldNudgeBatch,
} from "../src/session/runner/batch-pace.js"

const step = (tools: string[]) =>
  ({
    type: "assistant",
    content: tools.map((name) => ({ type: "tool", name, state: { status: "completed", content: [] } })),
  }) as unknown as SessionMessage.Info

const writeStep = (path: string) =>
  ({
    type: "assistant",
    content: [
      { type: "tool", name: "write", state: { status: "completed", content: [], input: { path, content: "x" } } },
    ],
  }) as unknown as SessionMessage.Info

const shellStep = (command: string) =>
  ({
    type: "assistant",
    content: [{ type: "tool", name: "shell", state: { status: "completed", content: [], input: { command } } }],
  }) as unknown as SessionMessage.Info

const user = (text = "go") =>
  ({ type: "user", text, content: [{ type: "text", text }] }) as unknown as SessionMessage.Info

describe("serialSingleToolSteps", () => {
  test(`nudges after ${SERIAL_SINGLE_STEPS} trailing single look tool(s)`, () => {
    expect(serialSingleToolSteps([step(["grep"])])).toBe(1)
    expect(shouldNudgeBatch([step(["grep"])])).toBe(true)
    expect(serialSingleToolSteps([step(["grep"]), step(["read"])])).toBe(2)
    expect(shouldNudgeBatch([step(["grep"]), step(["read"])])).toBe(true)
  })

  test("a multi-tool step breaks the streak", () => {
    expect(serialSingleToolSteps([step(["grep"]), step(["grep", "read"])])).toBe(0)
    expect(shouldNudgeBatch([step(["grep"]), step(["grep", "read"])])).toBe(false)
  })

  test("a write breaks the streak", () => {
    expect(serialSingleToolSteps([step(["grep"]), step(["edit"]), step(["read"])])).toBe(1)
  })

  test("a throwaway measurement script does not break the streak", () => {
    // The serial-look streak must survive the "write a script, run it, grep again" shape, which is
    // write must not break the serial-look streak the way explore-budget used to.
    expect(
      serialSingleToolSteps([step(["grep"]), writeStep(".sicode/scratch/audit.ts"), shellStep("bun .sicode/scratch/audit.ts")]),
    ).toBe(3)
    expect(shouldNudgeBatch([step(["grep"]), writeStep(".sicode/scratch/audit.ts")])).toBe(true)
    expect(shouldNudgeBatch([writeStep(".sicode/scratch/audit.ts")])).toBe(true)
  })

  test("a write into the project still breaks the streak", () => {
    expect(serialSingleToolSteps([step(["grep"]), writeStep("src/session/runner/llm.ts"), step(["read"])])).toBe(1)
  })

  test("a PowerShell inline file read counts as a look, not a break", () => {
    expect(
      serialSingleToolSteps([
        step(["grep"]),
        shellStep("$b=[IO.File]::ReadAllBytes('packages/core/src/x.ts')"),
      ]),
    ).toBe(2)
  })

  test("stops at the user message that opened the turn", () => {
    expect(serialSingleToolSteps([step(["grep"]), user(), step(["read"])])).toBe(1)
  })

  test("todowrite alone does not break the serial look streak", () => {
    expect(serialSingleToolSteps([step(["grep"]), step(["todowrite"]), step(["read"])])).toBe(2)
    expect(shouldNudgeBatch([step(["grep"]), step(["todowrite"]), step(["read"])])).toBe(true)
    expect(serialSingleToolSteps([step(["todowrite"])])).toBe(0)
    expect(shouldNudgeBatch([step(["todowrite"])])).toBe(false)
  })

  test("batch focus tools are the look-only fan-out set", () => {
    expect([...BATCH_FOCUS_TOOLS]).toEqual(["grep", "glob", "read"])
    expect(BATCH_PROMPT).toContain("patterns")
  })
})
