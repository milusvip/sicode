import { describe, expect, test } from "bun:test"
import type { SessionMessage } from "../src/session/message.js"
import { inject } from "../src/session/ui-behavior-hint.js"

const user = (text: string, id = "m1") =>
  ({ id, type: "user", text, time: { created: 0 }, files: [], agents: [], skills: [] }) as unknown as SessionMessage.Info

const assistant = (id = "a1") =>
  ({ id, type: "assistant", time: { created: 0 }, content: [] }) as unknown as SessionMessage.Info

describe("ui-behavior-hint", () => {
  test("fires on a behavior question and points at reproducing before grepping", () => {
    const messages = inject({ messages: [user("Ctrl+Shift+C 元素选取没反应，检查一下")] })
    expect(messages).toHaveLength(2)
    const hint = messages[1] as SessionMessage.Synthetic
    expect(hint.type).toBe("synthetic")
    expect(hint.text).toContain("<ui-behavior-hint>")
    expect(hint.text).toContain("Reproduce the behavior first")
    // Fenced code would break on the backticks the surrounding text already uses.
    expect(hint.text).not.toContain("```")
  })

  test("recognizes the shorthand that names a key chord but no behavior word", () => {
    // The real session asked "Ctrl+Shift+C 元素选取检查" — a trigger chord, no click/panel verb.
    const messages = inject({ messages: [user("Ctrl+Shift+C 元素选取检查")] })
    expect(messages).toHaveLength(2)
  })

  test("stays silent on a styling request, which the design hint owns", () => {
    const messages = inject({ messages: [user("把侧栏的圆角和间距改一下")] })
    expect(messages).toHaveLength(1)
  })

  test("stays silent when the request names no UI at all", () => {
    const messages = inject({ messages: [user("把 max-steps 的默认值改成 30")] })
    expect(messages).toHaveLength(1)
  })

  test("stays out of the way once work under the request has started", () => {
    const messages = [user("为什么点击面板没反应"), assistant()]
    expect(inject({ messages })).toBe(messages)
  })

  test("returns the same array when the request is fine or the switch is off", () => {
    const fine = [user("改一下登录同步的 cookie 写入逻辑")]
    expect(inject({ messages: fine })).toBe(fine)
    const behavior = [user("Ctrl+Shift+C 没反应")]
    expect(inject({ messages: behavior, enabled: false })).toBe(behavior)
  })
})
