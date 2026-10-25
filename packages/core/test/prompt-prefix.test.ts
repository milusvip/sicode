import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { PromptPrefix } from "../src/session/prompt-prefix.js"

const base = {
  sessionID: "ses_prefix_test",
  model: { providerID: "relay", id: "gpt-x" },
  tools: [{ name: "read" }, { name: "edit" }, { name: "bash" }],
  system: [{ text: "you are a coding agent" }, { text: "project rules" }],
}

const observe = (input: Parameters<typeof PromptPrefix.observe>[0]) => Effect.runPromise(PromptPrefix.observe(input))

describe("prompt prefix fingerprint", () => {
  test("the first step of a session is not a rebuild", async () => {
    PromptPrefix.forget(base.sessionID)
    expect(await observe(base)).toBe(false)
  })

  test("an identical step keeps the prefix", async () => {
    PromptPrefix.forget(base.sessionID)
    await observe(base)
    expect(await observe(base)).toBe(false)
  })

  test("reordering tools does not count as a rebuild", async () => {
    PromptPrefix.forget(base.sessionID)
    await observe(base)
    expect(await observe({ ...base, tools: [...base.tools].reverse() })).toBe(false)
  })

  test("adding a tool rebuilds the prefix", async () => {
    PromptPrefix.forget(base.sessionID)
    await observe(base)
    expect(await observe({ ...base, tools: [...base.tools, { name: "grep" }] })).toBe(true)
  })

  test("changed system text rebuilds the prefix", async () => {
    PromptPrefix.forget(base.sessionID)
    await observe(base)
    expect(await observe({ ...base, system: [{ text: "you are a coding agent" }, { text: "new rules" }] })).toBe(true)
  })

  test("a different model rebuilds the prefix", async () => {
    PromptPrefix.forget(base.sessionID)
    await observe(base)
    expect(await observe({ ...base, model: { providerID: "relay", id: "gpt-y" } })).toBe(true)
  })

  test("sessions are tracked independently", async () => {
    PromptPrefix.forget("ses_a")
    PromptPrefix.forget("ses_b")
    await observe({ ...base, sessionID: "ses_a" })
    expect(await observe({ ...base, sessionID: "ses_b" })).toBe(false)
  })
})
