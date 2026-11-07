import { describe, expect, test } from "bun:test"
import type { SessionMessage } from "../src/session/message.js"
import {
  PROBE_SCRIPT_FIRST,
  detectProbeScript,
} from "../src/session/runner/probe-script.js"

const user = () =>
  ({ id: "u1", type: "user", text: "find strings", files: [], agents: [], skills: [] }) as unknown as SessionMessage.Info

const completed = (name: string, input: unknown) =>
  ({
    type: "tool",
    name,
    id: `${name}-${JSON.stringify(input)}`,
    state: { status: "completed", input, content: [{ type: "text", text: "ok" }] },
  }) as unknown as SessionMessage.AssistantContent

const assistant = (...parts: SessionMessage.AssistantContent[]) =>
  ({ type: "assistant", content: parts }) as unknown as SessionMessage.Info

const writeRun = (path: string) => [
  completed("write", { path, content: "print(1)" }),
  completed("shell", { command: `python ${path}` }),
]

describe("detectProbeScript", () => {
  test(`fires after ${PROBE_SCRIPT_FIRST} write→shell probe cycles`, () => {
    const messages = [
      user(),
      assistant(...writeRun("_tools/extract_a.py")),
      assistant(...writeRun("_tools/extract_b.py")),
    ]
    const hit = detectProbeScript(messages)
    expect(hit).not.toBeNull()
    expect(hit!.cycles).toBeGreaterThanOrEqual(PROBE_SCRIPT_FIRST)
    expect(hit!.paths.some((path) => path.endsWith("extract_a.py"))).toBe(true)
  })

  test("does not fire on a single write→run", () => {
    const messages = [user(), assistant(...writeRun("_tools/once.py"))]
    expect(detectProbeScript(messages)).toBeNull()
  })

  test("does not fire when the script is never shelled", () => {
    const messages = [
      user(),
      assistant(completed("write", { path: "_tools/a.py", content: "x" })),
      assistant(completed("write", { path: "_tools/b.py", content: "y" })),
    ]
    expect(detectProbeScript(messages)).toBeNull()
  })

  test("honors the kill switch", () => {
    process.env.OPENCODE_PROBE_SCRIPT = "0"
    try {
      const messages = [
        user(),
        assistant(...writeRun("_tools/a.py")),
        assistant(...writeRun("_tools/b.py")),
      ]
      expect(detectProbeScript(messages)).toBeNull()
    } finally {
      delete process.env.OPENCODE_PROBE_SCRIPT
    }
  })
})
