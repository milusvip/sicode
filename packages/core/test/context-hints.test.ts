import { describe, expect, test } from "bun:test"
import type { SessionMessage } from "@opencode/schema/session-message"
import { hintTerms, taskStart } from "../src/session/context-hints"

function user(text: string, id = "msg_user"): SessionMessage.Info {
  return { id, type: "user", text, time: { created: 1 } } as unknown as SessionMessage.Info
}

function assistant(id = "msg_assistant"): SessionMessage.Info {
  return { id, type: "assistant", content: [], time: { created: 2 } } as unknown as SessionMessage.Info
}

describe("context hint terms", () => {
  test("takes explicit mentions, file names, paths and signal-bearing identifiers", () => {
    const terms = hintTerms(
      "为什么 `htmlArtifactsForTurn` 没触发？看 session/context.ts 和 settings/model.tsx，还有 plan.ts",
    )

    expect(terms).toContain("htmlArtifactsForTurn")
    expect(terms).toContain("session/context.ts")
    expect(terms).toContain("settings/model.tsx")
    expect(terms).toContain("plan.ts")
  })

  test("skips plain lowercase words, noise, and duplicates", () => {
    const terms = hintTerms("session session request please something")

    expect(terms).toEqual([])
  })

  test("keeps the most explicit terms when there are many, capped at five", () => {
    const terms = hintTerms(
      "a.ts b.ts c.ts d.ts e.ts f.ts g.ts `pickedOne` createTimelineController",
    )

    expect(terms.length).toBeLessThanOrEqual(5)
    // A backticked token is explicit, so it outranks the file names that follow it.
    expect(terms[0]).toBe("pickedOne")
  })

  test("a prompt with no usable terms yields nothing", () => {
    expect(hintTerms("继续")).toEqual([])
    expect(hintTerms("")).toEqual([])
  })
})

describe("task start", () => {
  test("a prompt with nothing after it is a new task", () => {
    const start = taskStart([assistant(), user("这个会话的折叠箭头为什么不一致？")])

    expect(start?.index).toBe(1)
  })

  test("a turn that already produced work is mid-flight, not a new task", () => {
    expect(taskStart([user("看看侧边栏的箭头为什么不一致，改一下"), assistant()])).toBeUndefined()
  })

  test("short continuations are not worth a lookup", () => {
    expect(taskStart([user("继续")])).toBeUndefined()
  })

  test("no user message means nothing to hint", () => {
    expect(taskStart([assistant()])).toBeUndefined()
    expect(taskStart([])).toBeUndefined()
  })
})
