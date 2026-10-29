import { describe, expect, test } from "bun:test"
import type { SessionMessage } from "../src/session/message.js"
import { assess, inject } from "../src/session/clarify-hint.js"
import { hintTerms } from "../src/session/context-hints.js"

const user = (text: string, id = "m1") =>
  ({ id, type: "user", text, time: { created: 0 }, files: [], agents: [], skills: [] }) as unknown as SessionMessage.Info

const assistant = (id = "a1") =>
  ({ id, type: "assistant", time: { created: 0 }, content: [] }) as unknown as SessionMessage.Info

describe("assess", () => {
  test("flags the real short prompts that name no target", () => {
    // Verbatim from the local session database.
    for (const prompt of ["写个demo", "你睡吧写个demo给我", "你帮我修复好", "你在网上搜搜看看", "写个显卡排行榜"])
      expect(assess(prompt).length).toBeGreaterThan(0)
  })

  test("says what is missing, and what counts as done for a change", () => {
    expect(assess("你帮我修复好")).toEqual([
      "which file, module, or symbol it refers to",
      "what counts as done",
    ])
    expect(assess("写个demo")[1]).toBe("what form the result should take")
  })

  test("stays silent once the request names something concrete", () => {
    for (const prompt of [
      "改 utils.ts 的 stem 匹配",
      "把 packages/core/src/tool/plugin/read.ts 里的 missing 改成前缀匹配",
      "`hintTerms` 为什么对中文零命中",
      "把超时改成 30",
      "看看 https://example.com/docs",
      "修一下 left-sidebar.tsx",
    ])
      expect(assess(prompt)).toEqual([])
  })

  test("stays silent when the user hands the choice over", () => {
    // "随便写个demo我看看" was in the data; asking here would contradict the request.
    expect(assess("随便写个demo我看看")).toEqual([])
    expect(assess("随便给我一段代码我看看样式")).toEqual([])
  })

  test("treats continuations as a resumption, not a new ask", () => {
    for (const prompt of ["继续", "好", "嗯", "ok", "继续吧", "可以。"]) expect(assess(prompt)).toEqual([])
  })

  test("stays silent without an action verb, and for long requests", () => {
    expect(assess("这个是啥")).toEqual([])
    expect(assess("把 hintTerms 对中文口语零命中的问题修掉，顺便把整句交给 fff 兜底试试")).toEqual([])
  })

  test("answers a question instead of asking another one", () => {
    // A change verb alone is not an instruction: these want an answer, not a clarification.
    for (const prompt of ["这次改动之后用户实际能感觉到什么，逐项说", "改完快吗", "这个为什么不行"])
      expect(assess(prompt)).toEqual([])
  })

  test("never fires on a prompt the context hints already handle", () => {
    // Both ride the same request; an anchored prompt belongs to the hints, an empty one here.
    for (const prompt of ["改 utils.ts", "看 `bus.ts`"]) {
      expect(hintTerms(prompt).length).toBeGreaterThan(0)
      expect(assess(prompt)).toEqual([])
    }
  })
})

describe("inject", () => {
  test("places the hint right after the request it belongs to", () => {
    const messages = inject({ messages: [user("写个demo")] })
    expect(messages).toHaveLength(2)
    expect(messages[0]!.type).toBe("user")
    const hint = messages[1] as SessionMessage.Synthetic
    expect(hint.type).toBe("synthetic")
    expect(hint.text).toContain("<clarify-hint>")
    expect(hint.text).toContain("question tool")
    // Fenced code would break on the backticks the surrounding text already uses.
    expect(hint.text).not.toContain("```")
  })

  test("works on a later turn too, not just the first one of the session", () => {
    // A thin request in the fifth turn costs the same wrong guess as one in the first.
    const messages = [user("先看仓库结构", "m1"), assistant("a1"), user("写个demo", "m2")]
    const out = inject({ messages })
    expect(out).toHaveLength(4)
    expect((out[3] as SessionMessage.Synthetic).type).toBe("synthetic")
  })

  test("stays out of the way once work under the request has started", () => {
    const messages = [user("写个demo"), assistant()]
    expect(inject({ messages })).toBe(messages)
  })

  test("returns the same array when the request is fine or the switch is off", () => {
    const fine = [user("改 utils.ts 的匹配")]
    expect(inject({ messages: fine })).toBe(fine)
    const thin = [user("写个demo")]
    expect(inject({ messages: thin, enabled: false })).toBe(thin)
  })
})
