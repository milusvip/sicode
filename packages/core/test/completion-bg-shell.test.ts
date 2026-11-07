import { describe, expect, test } from "bun:test"
import type { SessionMessage } from "../src/session/message.js"
import { waitingOnBackgroundShell } from "../src/session/runner/completion-gate.js"

const shell = (meta: Record<string, unknown>, name = "shell") => ({
  type: "tool",
  id: "tool-shell",
  name,
  state: {
    status: "completed",
    input: meta.read ? { read: meta.shellID } : { command: "pnpm pack:release", background: true },
    metadata: meta,
    content: [{ type: "text", text: "ok" }],
  },
})

const assistant = (...tools: ReturnType<typeof shell>[]) =>
  ({ type: "assistant", content: tools }) as unknown as SessionMessage.Info

const user = { type: "user", content: [] } as unknown as SessionMessage.Info

describe("waitingOnBackgroundShell", () => {
  test("true when the latest shell metadata says running", () => {
    expect(
      waitingOnBackgroundShell([
        user,
        assistant(shell({ status: "running", shellID: "sh_abc", truncated: false })),
      ]),
    ).toBe(true)
  })

  test("true when a later read still reports the same shell running", () => {
    expect(
      waitingOnBackgroundShell([
        user,
        assistant(shell({ status: "running", shellID: "sh_abc" })),
        assistant(shell({ status: "running", shellID: "sh_abc", read: true })),
      ]),
    ).toBe(true)
  })

  test("false when the background shell later completed", () => {
    expect(
      waitingOnBackgroundShell([
        user,
        assistant(shell({ status: "running", shellID: "sh_abc" })),
        assistant(shell({ status: "completed", shellID: "sh_abc", exit: 0 })),
      ]),
    ).toBe(false)
  })

  test("false with no shell tools or only finished shells", () => {
    expect(waitingOnBackgroundShell([user, assistant()])).toBe(false)
    expect(
      waitingOnBackgroundShell([
        user,
        assistant(shell({ status: "completed", shellID: "sh_done", exit: 0 })),
      ]),
    ).toBe(false)
  })

  test("ignores shells from before the latest user message", () => {
    expect(
      waitingOnBackgroundShell([
        assistant(shell({ status: "running", shellID: "sh_old" })),
        user,
        assistant(),
      ]),
    ).toBe(false)
  })
})
