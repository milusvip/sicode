import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { SessionMessage } from "../src/session/message.js"
import {
  SEARCH_CAP,
  classifyUserIntent,
  hasPlanWriteThisTurn,
  hasSubagentThisTurn,
  searchToolCount,
  shouldAwaitPlanApproval,
  shouldStopSearchCap,
  shouldSuppressTodoForDesign,
  shouldUpfrontExplore,
  shouldUpfrontPlan,
  turnIsPristine,
} from "../src/session/runner/locate-intent.js"

const user = (text: string) =>
  ({ type: "user", text, content: [{ type: "text", text }] }) as unknown as SessionMessage.Info

const tool = (name: string, status: "completed" | "error" = "completed") =>
  ({
    type: "assistant",
    content: [{ type: "tool", name, state: { status, content: [] } }],
  }) as unknown as SessionMessage.Info

const writePlan = (path = ".sicode/plans/sidebar-layout.md") =>
  ({
    type: "assistant",
    content: [
      {
        type: "tool",
        name: "write",
        state: { status: "completed", content: [], input: { path, content: "# plan" } },
      },
    ],
  }) as unknown as SessionMessage.Info

beforeEach(() => {
  process.env.OPENCODE_EXPLORE_UPFRONT = "1"
  process.env.OPENCODE_PLAN_UPFRONT = "1"
})

afterEach(() => {
  delete process.env.OPENCODE_EXPLORE_UPFRONT
  delete process.env.OPENCODE_PLAN_UPFRONT
})

describe("classifyUserIntent", () => {
  test("broad locate is interrogative / WH without a named path", () => {
    expect(classifyUserIntent("权限弹窗在哪实现的")).toBe("broad")
    expect(classifyUserIntent("侧边栏底部留白是哪个文件")).toBe("broad")
    expect(classifyUserIntent("where is the permission dock implemented")).toBe("broad")
    expect(classifyUserIntent("为什么压缩之后对话会变笨呢？")).toBe("broad")
  })

  test("known locus stays on the main chain", () => {
    expect(classifyUserIntent("改 packages/app/src/session/screen.tsx 的间距")).toBe("known")
    expect(classifyUserIntent("use D:\\foo\\bar.ts")).toBe("known")
    expect(classifyUserIntent("看 session-permission-dock.tsx")).toBe("known")
  })

  test("implement / design phrasing without a path is other — no verb lists", () => {
    expect(classifyUserIntent("给 remember 工具加上 supersede 回报")).toBe("other")
    expect(classifyUserIntent("fix the typecheck error in the memory inject module")).toBe("other")
    expect(classifyUserIntent("fix the typecheck error in inject.ts")).toBe("known")
    expect(classifyUserIntent("先写个方案再改侧边栏")).toBe("other")
    expect(shouldUpfrontExplore([user("给 remember 工具加上 supersede 回报")])).toBe(false)
    expect(shouldUpfrontPlan([user("权限弹窗怎么设计比较好")])).toBe(false)
  })

  test("short continuations are other", () => {
    expect(classifyUserIntent("继续")).toBe("other")
    expect(classifyUserIntent("好的")).toBe("other")
    expect(classifyUserIntent("开干")).toBe("other")
  })
})

describe("shouldUpfrontExplore / search cap", () => {
  test("upfront Explore only on pristine broad turns", () => {
    expect(shouldUpfrontExplore([user("权限弹窗在哪实现的")])).toBe(true)
    expect(shouldUpfrontExplore([user("权限弹窗在哪实现的"), tool("grep")])).toBe(false)
    expect(shouldUpfrontExplore([user("改 inject.ts")])).toBe(false)
  })

  test("default off; OPENCODE_EXPLORE_UPFRONT=1 enables upfront Explore", () => {
    delete process.env.OPENCODE_EXPLORE_UPFRONT
    expect(shouldUpfrontExplore([user("权限弹窗在哪实现的")])).toBe(false)
    process.env.OPENCODE_EXPLORE_UPFRONT = "1"
    expect(shouldUpfrontExplore([user("权限弹窗在哪实现的")])).toBe(true)
  })

  test("search cap counts grep/glob and stops at SEARCH_CAP", () => {
    const messages = [user("find it"), ...Array.from({ length: SEARCH_CAP }, () => tool("grep"))]
    expect(searchToolCount(messages)).toBe(SEARCH_CAP)
    expect(shouldStopSearchCap(messages)).toBe(true)
  })

  test("plan await is structural on .sicode/plans write; upfront plan is gone", () => {
    expect(shouldUpfrontPlan([user("怎么设计权限弹窗")])).toBe(false)
    expect(shouldAwaitPlanApproval([user("design"), writePlan()])).toBe(true)
    expect(shouldSuppressTodoForDesign([user("design")])).toBe(false)
    expect(hasPlanWriteThisTurn([user("design"), writePlan()])).toBe(true)
  })

  test("default off; OPENCODE_PLAN_UPFRONT=1 enables plan await", () => {
    delete process.env.OPENCODE_PLAN_UPFRONT
    expect(shouldAwaitPlanApproval([user("design"), writePlan()])).toBe(false)
    process.env.OPENCODE_PLAN_UPFRONT = "1"
    expect(shouldAwaitPlanApproval([user("design"), writePlan()])).toBe(true)
  })

  test("turn helpers", () => {
    expect(turnIsPristine([user("x")])).toBe(true)
    expect(turnIsPristine([user("x"), tool("read")])).toBe(false)
    expect(hasSubagentThisTurn([user("x"), tool("subagent")])).toBe(true)
  })
})
