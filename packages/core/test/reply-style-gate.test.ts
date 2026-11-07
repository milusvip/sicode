import { describe, expect, test } from "bun:test"
import type { SessionMessage } from "../src/session/message.js"
import {
  isMessyReply,
  replyStyleFingerprint,
} from "../src/session/runner/reply-style-gate.js"

const user = (id: string, text = "弄好了吗") =>
  ({ type: "user", id, text, files: [], agents: [], skills: [] }) as unknown as SessionMessage.Info

const assistant = (id: string, text: string) =>
  ({
    type: "assistant",
    id,
    content: [{ type: "text", text }],
  }) as unknown as SessionMessage.Info

describe("isMessyReply", () => {
  test("plain spoken Chinese is fine", () => {
    expect(isMessyReply("排序把基建目录排太前了，已经改完。下一步你刷新一下列表就行。")).toBe(false)
  })

  test("Cursor-shaped bold bullets are fine", () => {
    expect(
      isMessyReply(
        [
          "对这类问题以后默认按结构性修，不再堆提示词补丁。",
          "",
          "结构性的意思是：",
          "- **改触发条件本身**（谁上锁、何时上锁），不是事后认用户怎么说",
          "- **失败模式从机制上消失**，而不是教模型「请说放开路径」",
          "- **测试只钉合同行为**，不钉现场路径和 `ses_*`",
        ].join("\n"),
      ),
    ).toBe(false)
  })

  test("multiple section headings are messy", () => {
    expect(
      isMessyReply(`## Done
- packages/core/src/a.ts
## Open
- still need tests
## Next
- refresh`),
    ).toBe(true)
  })

  test("path inventory with almost no sentences is messy", () => {
    expect(
      isMessyReply(`packages/core/src/session/runner/llm.ts → selectSteer
packages/core/src/session/runner/steer.ts → MAX_STEPS
packages/app/src/session/screen.tsx → SessionScreen
packages/core/src/tool/plugin/todo.ts → todowrite`),
    ).toBe(true)
  })

  test("mostly fenced code is exempt", () => {
    const body = "改动如下：\n\n```ts\nexport const x = 1\nexport const y = 2\nexport const z = 3\n```\n"
    expect(isMessyReply(body)).toBe(false)
  })

  test("three fake section headings count as messy", () => {
    expect(
      isMessyReply(`**改动**
摸了一下。
**验证**
过了。
**后续**
再说。`),
    ).toBe(true)
  })
})

describe("replyStyleFingerprint", () => {
  test("fires once shape for a multi-heading dump", () => {
    const text = `## Done
- a.ts
## Open
- b
## Next
- c`
    const key = replyStyleFingerprint([user("u1"), assistant("a1", text)])
    expect(key).toContain("u1")
  })

  test("skips plain replies", () => {
    expect(
      replyStyleFingerprint([
        user("u1"),
        assistant("a1", "已经修好了。列表排序不再把基建目录顶到最前。"),
      ]),
    ).toBeUndefined()
  })

  test("honors the kill switch", () => {
    process.env.OPENCODE_REPLY_STYLE = "0"
    try {
      expect(
        replyStyleFingerprint([
          user("u1"),
          assistant(
            "a1",
            `## Done
- a.ts
## Open
- b
## Next
- c`,
          ),
        ]),
      ).toBeUndefined()
    } finally {
      delete process.env.OPENCODE_REPLY_STYLE
    }
  })
})
