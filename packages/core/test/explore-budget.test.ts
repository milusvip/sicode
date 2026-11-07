import { describe, expect, test } from "bun:test"
import type { SessionMessage } from "../src/session/message.js"
import {
  EXPLORE_FOCUS_TOOLS,
  EXPLORE_HARD_STEPS,
  EXPLORE_SOFT_PROMPT,
  EXPLORE_SOFT_STEPS,
  EXPLORE_SOFT_STEPS_USER_HINT,
  exploreSoftEvery,
  locatingSteps,
  readOnlySteps,
  spinningSteps,
  userPointedAnswer,
} from "../src/session/runner/explore-budget.js"

const step = (tools: string[], text = "") =>
  ({
    type: "assistant",
    content: [
      ...tools.map((name) => ({ type: "tool", name, state: { status: "completed", content: [] } })),
      ...(text ? [{ type: "text", text }] : []),
    ],
  }) as unknown as SessionMessage.Info

const shellStep = (command: string) =>
  ({
    type: "assistant",
    content: [
      { type: "tool", name: "shell", state: { status: "completed", content: [], input: { command } } },
    ],
  }) as unknown as SessionMessage.Info

const writeStep = (path: string) =>
  ({
    type: "assistant",
    content: [
      {
        type: "tool",
        name: "write",
        state: { status: "completed", content: [], input: { path, content: "x" } },
      },
    ],
  }) as unknown as SessionMessage.Info

const user = (text = "go") =>
  ({ type: "user", text, content: [{ type: "text", text }] }) as unknown as SessionMessage.Info

describe("readOnlySteps", () => {
  test("counts a run of read-only steps", () => {
    expect(readOnlySteps([step(["read"]), step(["read"]), step(["grep"])])).toBe(3)
  })

  test("treats several read-only tools in one step as a single step", () => {
    expect(readOnlySteps([step(["read", "grep"]), step(["list"])])).toBe(2)
  })

  test("a write breaks the streak", () => {
    // Only the trailing read counts; the write before it is progress.
    expect(readOnlySteps([step(["read"]), step(["write"]), step(["read"])])).toBe(1)
  })

  test("an edit breaks the streak", () => {
    expect(readOnlySteps([step(["grep"]), step(["edit"]), step(["read"]), step(["read"])])).toBe(2)
  })

  test("a step without tools ends the streak", () => {
    // Speaking without acting means the model stopped to answer.
    expect(readOnlySteps([step(["read"]), step([], "here is the answer")])).toBe(0)
  })

  test("stops at the user message that opened the turn", () => {
    expect(readOnlySteps([step(["read"]), user(), step(["read"]), step(["read"])])).toBe(2)
  })

  test("ignores non-assistant messages in between", () => {
    const system = { type: "system", content: [] } as unknown as SessionMessage.Info
    expect(readOnlySteps([step(["read"]), system, step(["read"])])).toBe(2)
  })

  test("returns zero for an empty transcript", () => {
    expect(readOnlySteps([])).toBe(0)
  })

  test("a shell search command counts as read-only, not progress", () => {
    expect(readOnlySteps([step(["read"]), shellStep("rg -n \"cache\" src/"), step(["grep"])])).toBe(3)
  })

  test("a PowerShell inline file read counts as read-only, not progress", () => {
    // Inline `[IO.File]::ReadAllBytes` is a read, not a progress write — first-token matching alone misses it.
    expect(
      readOnlySteps([
        step(["read"]),
        shellStep("$b=[IO.File]::ReadAllBytes('packages/core/src/plugin/system-prompt/deepseek.txt'); $s=[Text.Encoding]::UTF8.GetString($b)"),
        step(["grep"]),
      ]),
    ).toBe(3)
  })

  test("a shell search command keeps a streak going across several steps", () => {
    expect(
      readOnlySteps([
        shellStep('Get-ChildItem -Recurse -Filter "edit*.ts"'),
        shellStep('Select-String -Path notes.md -Pattern "batch"'),
        shellStep("git log --oneline -5"),
      ]),
    ).toBe(3)
  })

  test("a shell command that runs or builds breaks the streak", () => {
    expect(readOnlySteps([step(["read"]), shellStep("bun test src/browser/"), step(["read"])])).toBe(1)
  })

  test("a write into the project is progress and breaks the streak", () => {
    expect(readOnlySteps([step(["read"]), writeStep("src/session/runner/llm.ts"), step(["read"])])).toBe(1)
  })

  test("a failed project write is not progress and keeps the streak", () => {
    // SiCode: refused/errored mutations must not reset explore-budget (smart-no-spin T1).
    const failedWrite = {
      type: "assistant",
      content: [
        {
          type: "tool",
          name: "write",
          state: { status: "error", content: [], input: { path: "src/x.ts", content: "x" } },
        },
      ],
    } as unknown as SessionMessage.Info
    expect(readOnlySteps([step(["grep"]), failedWrite, step(["read"])])).toBe(3)
  })

  test("a failed execute is not progress", () => {
    const failedExecute = {
      type: "assistant",
      content: [{ type: "tool", name: "execute", state: { status: "error", content: [], input: { code: "1" } } }],
    } as unknown as SessionMessage.Info
    expect(readOnlySteps([step(["grep"]), failedExecute, step(["grep"])])).toBe(3)
  })

  test("a throwaway measurement script is exploration, not progress", () => {
    // Scratch write+run must keep the read-only streak so the hard budget can still fire.
    expect(
      readOnlySteps([step(["grep"]), writeStep(".sicode/scratch/audit.ts"), shellStep("bun .sicode/scratch/audit.ts")]),
    ).toBe(3)
  })

  test("running a scratch script through a package script or a built binary is still progress", () => {
    expect(readOnlySteps([step(["read"]), shellStep("bun run audit"), step(["read"])])).toBe(1)
  })

  test("soft budget is below the hard budget", () => {
    expect(EXPLORE_SOFT_STEPS).toBeLessThan(EXPLORE_HARD_STEPS)
    expect(EXPLORE_SOFT_STEPS_USER_HINT).toBeLessThan(EXPLORE_SOFT_STEPS)
  })

  test("force/handoff focus tools can act or hand off, but cannot write throwaway scripts", () => {
    // Under force, write must stay withdrawn so scratch authoring cannot replace edit/patch/subagent.
    expect(EXPLORE_FOCUS_TOOLS).not.toContain("write")
    expect(EXPLORE_FOCUS_TOOLS).toContain("edit")
    expect(EXPLORE_FOCUS_TOOLS).toContain("patch")
    expect(EXPLORE_FOCUS_TOOLS).toContain("subagent")
  })
})

describe("userPointedAnswer / exploreSoftEvery", () => {
  test("treats a short affirm naming a folder as a pointed answer", () => {
    // SiCode: neutral placeholder domain, not a real site the developer named.
    expect(userPointedAnswer([user("site is example.com")])).toBe(true)
    expect(exploreSoftEvery([user("site is example.com")])).toBe(EXPLORE_SOFT_STEPS_USER_HINT)
  })

  test("treats an explicit Windows path as a pointed answer", () => {
    expect(userPointedAnswer([user("就在 D:\\www\\foo")])).toBe(true)
  })

  test("leaves an open question on the default soft cadence", () => {
    expect(userPointedAnswer([user("帮我在 D 盘找一下这个站点的目录")])).toBe(false)
    expect(exploreSoftEvery([user("继续查一下根因")])).toBe(EXPLORE_SOFT_STEPS)
  })

  test("soft prompt still covers user-named answers without a second steer", () => {
    expect(EXPLORE_SOFT_PROMPT).toContain("user already named the path")
  })
})

describe("locatingSteps / spinningSteps", () => {
  test("a search-heavy streak counts as both locating and spinning", () => {
    const messages = [step(["grep"]), step(["grep"]), step(["read"]), step(["grep"])]
    expect(locatingSteps(messages)).toBe(4)
    expect(spinningSteps(messages)).toBe(4)
  })

  test("a long-document read streak is neither locating nor spinning", () => {
    // Mostly reads, no hunt and no measurement scripts — hard budget must stay a hint.
    const messages = [step(["read"]), step(["read"]), step(["read"]), step(["read"])]
    expect(locatingSteps(messages)).toBe(0)
    expect(spinningSteps(messages)).toBe(0)
  })

  test("a scratch-script streak is spinning but not locating", () => {
    // ses_e5ea441c at hard: trailing steps were write+bun scratch, so locatingSteps was 0 and the
    // hard-locate stop never fired. spinningSteps must catch that measurement spin.
    const messages = [
      writeStep(".sicode/scratch/a.ts"),
      shellStep("bun .sicode/scratch/a.ts"),
      writeStep(".sicode/scratch/b.ts"),
      shellStep("bun .sicode/scratch/b.ts"),
    ]
    expect(locatingSteps(messages)).toBe(0)
    expect(spinningSteps(messages)).toBe(4)
  })

  test("a failed-mutation streak is spinning but not locating", () => {
    const failed = (name: string) =>
      ({
        type: "assistant",
        content: [{ type: "tool", name, state: { status: "error", content: [], input: {} } }],
      }) as unknown as SessionMessage.Info
    const messages = [failed("write"), failed("execute"), failed("edit"), failed("patch")]
    expect(locatingSteps(messages)).toBe(0)
    expect(spinningSteps(messages)).toBe(4)
  })
})
