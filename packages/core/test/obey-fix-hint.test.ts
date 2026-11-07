import { describe, expect, test } from "bun:test"
import type { SessionMessage } from "../src/session/message.js"
import { inject, needed } from "../src/session/obey-fix-hint.js"

const user = (text: string, id = "u1") =>
  ({
    id,
    type: "user",
    text,
    time: { created: 0 },
    files: [],
    agents: [],
    skills: [],
  }) as unknown as SessionMessage.Info

const assistant = (id = "a1") =>
  ({ id, type: "assistant", time: { created: 0 }, content: [] }) as unknown as SessionMessage.Info

describe("needed", () => {
  test("matches the closed order set", () => {
    expect(needed("so fix it")).toBe(true)
    expect(needed("then fix it")).toBe(true)
    expect(needed("fix it")).toBe(true)
    expect(needed("what does this mean")).toBe(false)
  })
})

describe("inject", () => {
  test("inserts the hint after the latest user turn", () => {
    const messages = inject({ messages: [user("look first"), assistant(), user("so fix it")] })
    expect(messages).toHaveLength(4)
    const hint = messages[3]
    expect(hint?.type).toBe("synthetic")
    if (hint?.type !== "synthetic") return
    expect(hint.metadata?.notice).toBe("obey-fix-hint")
    expect(hint.text).toContain("<obey-fix-hint>")
  })

  test("skips when the turn already has an assistant reply", () => {
    const messages = inject({
      messages: [user("so fix it"), assistant()],
    })
    expect(messages).toHaveLength(2)
  })

  test("honors the kill switch", () => {
    const messages = inject({
      messages: [user("so fix it")],
      enabled: false,
    })
    expect(messages).toHaveLength(1)
  })
})
