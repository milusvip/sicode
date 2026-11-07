import { describe, expect, test } from "bun:test"
import type { SessionMessage } from "../src/session/message.js"
import { fold, inject, MAX_CHARS } from "../src/session/working-pin.js"

const user = (text: string) =>
  ({ type: "user", text, files: [], agents: [], skills: [] }) as unknown as SessionMessage.Info

const assistant = (
  tools: ReadonlyArray<{ name: string; path?: string; status?: string }> = [],
) =>
  ({
    type: "assistant",
    content: tools.map((tool) => ({
      type: "tool",
      name: tool.name,
      state: {
        status: tool.status ?? "completed",
        input: tool.path ? { path: tool.path } : {},
        content: [],
      },
    })),
  }) as unknown as SessionMessage.Info

describe("fold", () => {
  test("keeps the latest user goal and recent edit/read anchors", () => {
    const pin = fold([
      user("old ask"),
      assistant([{ name: "read", path: "packages/a/old.ts" }]),
      user("fix the button in packages/app/src/x.tsx"),
      assistant([
        { name: "read", path: "packages/app/src/x.tsx" },
        { name: "edit", path: "packages/app/src/x.tsx" },
      ]),
      user("leave packages/app/src/x.tsx alone, edit packages/app/src/y.tsx"),
    ])
    expect(pin).toBeDefined()
    expect(pin!).toContain("<working-pin>")
    expect(pin!).toContain("leave packages/app/src/x.tsx alone")
    expect(pin!).toContain("packages/app/src/x.tsx")
    expect(pin!).toContain("packages/app/src/y.tsx")
    expect(pin!).not.toContain("packages/a/old.ts")
    expect(pin!.length).toBeLessThanOrEqual(MAX_CHARS)
  })

  test("lists frozen paths when provided", () => {
    const pin = fold([user("continue")], ["packages/app/src/x.tsx"])
    expect(pin).toContain("frozen:")
    expect(pin).toContain("packages/app/src/x.tsx")
  })
})

describe("inject", () => {
  test("pins after the opening user message of a turn", () => {
    const messages = inject({
      messages: [
        user("old"),
        assistant([{ name: "read", path: "a.ts" }]),
        user("now fix b.ts"),
      ],
      frozen: [],
    })
    expect(messages).toHaveLength(4)
    expect(messages[2]?.type).toBe("user")
    expect(messages[3]?.type).toBe("synthetic")
    if (messages[3]?.type !== "synthetic") return
    expect(messages[3].metadata?.notice).toBe("working-pin")
    expect(messages[3].text).toContain("now fix b.ts")
  })

  test("skips when the turn already has an assistant reply", () => {
    expect(
      inject({
        messages: [user("hi"), assistant([{ name: "read", path: "a.ts" }])],
        frozen: [],
      }),
    ).toHaveLength(2)
  })

  test("honors the kill switch", () => {
    expect(
      inject({
        messages: [user("fix packages/app/src/a.ts")],
        frozen: [],
        enabled: false,
      }),
    ).toHaveLength(1)
  })
})
