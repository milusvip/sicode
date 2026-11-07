import { describe, expect, test } from "bun:test"
import type { SessionMessage } from "../src/session/message.js"
import { SessionCompaction } from "../src/session/compaction.js"
import {
  COMPACT_MIN_ESTIMATE,
  disjointLocus,
  inject,
  locusOf,
  packageRoot,
  pathsInText,
  pending,
  shouldCompact,
  switched,
  turnContext,
} from "../src/session/topic-switch.js"

const user = (text: string, id = "u1", files?: string[]) =>
  ({
    id,
    type: "user",
    text,
    time: { created: 0 },
    files: files ?? [],
    agents: [],
    skills: [],
  }) as unknown as SessionMessage.Info

const assistantWithEdit = (path: string, id = "a1") =>
  ({
    id,
    type: "assistant",
    time: { created: 0 },
    content: [{ type: "tool", name: "edit", state: { status: "completed", input: { path } } }],
  }) as unknown as SessionMessage.Info

const assistantText = (id = "a0") =>
  ({ id, type: "assistant", time: { created: 0 }, content: [] }) as unknown as SessionMessage.Info

describe("pathsInText", () => {
  test("keeps ASCII package and file paths", () => {
    expect(pathsInText("改 packages/app/src/a.tsx")).toContain("packages/app/src/a.tsx")
    expect(pathsInText("see src/foo/bar.ts please")).toContain("src/foo/bar.ts")
  })

  test("extracts CJK and Windows absolute paths with extensions", () => {
    expect(pathsInText("写到 文档目录/说明-一.md")).toContain("文档目录/说明-一.md")
    expect(pathsInText("可写 _tools/helper.py")).toContain("_tools/helper.py")
    const windows = ["落盘 D:", "项目丨根", "子目录", "文档目录", "说明-二.md"].reduce((left, part, index) =>
      index <= 1 ? left + part : left + "\\" + part,
    )
    const win = pathsInText(windows)
    expect(win.some((path) => /文档目录[\\/]说明-二\.md$/u.test(path))).toBe(true)
  })

  test("skips leading-dash CLI flag paths", () => {
    const found = pathsInText('args ("-S/tmp/x.plist", "src/foo/bar.ts")')
    expect(found.some((path) => path.startsWith("-"))).toBe(false)
    expect(found).toContain("src/foo/bar.ts")
  })
})

describe("locus", () => {
  test("packageRoot and locusOf prefer package roots", () => {
    expect(packageRoot("packages/app/src/shell/left-sidebar.tsx")).toBe("packages/app")
    expect([...locusOf(["packages/app/src/a.tsx", "packages/app/src/b.tsx"])]).toEqual(["packages/app"])
  })

  test("disjointLocus is true only when next sits outside prior", () => {
    expect(disjointLocus(new Set(["packages/app"]), new Set(["packages/core"]))).toBe(true)
    expect(disjointLocus(new Set(["packages/app"]), new Set(["packages/app"]))).toBe(false)
    expect(disjointLocus(new Set(["packages/app"]), new Set(["packages/app/src"]))).toBe(false)
    expect(disjointLocus(new Set(["packages/app"]), new Set())).toBe(false)
  })
})

describe("switched", () => {
  test("fires when the new ask names a different package than the prior tool locus", () => {
    expect(
      switched({
        previousToolPaths: ["packages/app/src/shell/left-sidebar.tsx"],
        previousUser: "改左栏",
        nextUser: "packages/core 的 trigram 失效策略是怎样的",
      }),
    ).toBe(true)
  })

  test("fires when the new message attaches a file outside the prior locus", () => {
    expect(
      switched({
        previousToolPaths: ["packages/app/src/shell/left-sidebar.tsx"],
        nextUser: "看看这个",
        nextFiles: ["packages/core/src/session/memory/vector.ts"],
      }),
    ).toBe(true)
    // Real attachment shape: path lives on name / uri, not as a bare string on the message.
    const messages = inject({
      messages: [
        user("改左栏"),
        assistantWithEdit("packages/app/src/shell/left-sidebar.tsx"),
        {
          ...user("看看这个"),
          files: [
            {
              data: "",
              mime: "text/plain",
              source: { type: "uri", uri: "file:///repo/packages/core/src/session/memory/vector.ts" },
              name: "packages/core/src/session/memory/vector.ts",
            },
          ],
        } as SessionMessage.Info,
      ],
    })
    expect(messages.some((message) => message.type === "synthetic" && message.metadata?.notice === "topic-switch")).toBe(
      true,
    )
  })

  test("stays put with no structural locus on the new message", () => {
    // Pure prose — no path/attachment → no structural evidence.
    expect(
      switched({
        previousToolPaths: ["packages/app/src/shell/left-sidebar.tsx"],
        nextUser: "memory 的 vector store 怎么查",
      }),
    ).toBe(false)
  })

  test("stays put when the new ask stays in the same package", () => {
    expect(
      switched({
        previousToolPaths: ["packages/app/src/shell/left-sidebar.tsx"],
        nextUser: "packages/app 里再给 running 会话加个 spinner",
      }),
    ).toBe(false)
  })
})

describe("turnContext / inject", () => {
  test("needs a prior tool-using turn before the current user message", () => {
    expect(turnContext([user("第一问")])).toBeUndefined()
    expect(turnContext([user("第一问"), assistantText(), user("第二问")])).toBeUndefined()
    expect(
      turnContext([
        user("修 sidebar"),
        assistantWithEdit("packages/app/src/shell/left-sidebar.tsx"),
        user("packages/core memory"),
      ]),
    ).toMatchObject({ nextUser: "packages/core memory" })
  })

  test("injects when structure says the locus moved", () => {
    const messages = inject({
      messages: [
        user("把左栏圆角改小"),
        assistantWithEdit("packages/app/src/shell/left-sidebar.tsx"),
        user("packages/core 的 trigram 失效策略是怎样的"),
      ],
    })
    expect(messages).toHaveLength(4)
    expect(messages[3]).toMatchObject({ type: "synthetic", metadata: { notice: "topic-switch" } })
    const text = (messages[3] as { text: string }).text
    expect(text).toContain("packages/app")
    expect(text).toContain("packages/core")
    expect(text).toContain("Structural locus moved")
  })

  test("stays silent without a structural move", () => {
    expect(
      inject({
        messages: [
          user("修 left-sidebar"),
          assistantWithEdit("packages/app/src/shell/left-sidebar.tsx"),
          user("继续"),
        ],
      }),
    ).toHaveLength(3)
  })
})

describe("pending / shouldCompact", () => {
  test("pending is true only at turn start after a topic-switch inject", () => {
    const messages = inject({
      messages: [
        user("改左栏"),
        assistantWithEdit("packages/app/src/shell/left-sidebar.tsx"),
        user("packages/core trigram"),
      ],
    })
    expect(pending(messages)).toBe(true)
    expect(pending([user("alone")])).toBe(false)
  })

  test("shouldCompact requires pending plus a large enough estimate", () => {
    const messages = inject({
      messages: [
        user("改左栏"),
        assistantWithEdit("packages/app/src/shell/left-sidebar.tsx"),
        user("packages/core trigram"),
      ],
    })
    expect(shouldCompact({ messages, estimate: COMPACT_MIN_ESTIMATE - 1 })).toBe(false)
    expect(shouldCompact({ messages, estimate: COMPACT_MIN_ESTIMATE })).toBe(true)
  })

  test("splitAtLatestUser keeps from the newest user message", () => {
    const u1 = user("old", "u1")
    const a1 = assistantWithEdit("packages/app/src/a.tsx", "a1")
    const u2 = user("packages/core next", "u2")
    expect(SessionCompaction.splitAtLatestUser([u1, a1, u2])).toEqual({ keepID: u2.id })
    expect(SessionCompaction.splitAtLatestUser([u2])).toBeUndefined()
  })
})
