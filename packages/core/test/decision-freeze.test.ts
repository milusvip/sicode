import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { SessionMessage } from "../src/session/message.js"
import {
  METADATA_KEY,
  blocked,
  clear,
  fold,
  matches,
  pathsOf,
  remember,
  sync,
  wantsFreeze,
  wantsUnfreeze,
  withPaths,
} from "../src/session/decision-freeze.js"

const user = (text: string, files?: string[]) =>
  ({
    id: "u",
    type: "user",
    text,
    time: { created: 0 },
    files: (files ?? []).map((name) => ({
      data: "",
      mime: "text/plain",
      source: { type: "uri", uri: `file:///repo/${name}` },
      name,
    })),
    agents: [],
    skills: [],
  }) as unknown as SessionMessage.Info

beforeEach(() => {
  process.env.OPENCODE_DECISION_FREEZE = "1"
})

afterEach(() => {
  clear()
  delete process.env.OPENCODE_DECISION_FREEZE
})

describe("wantsFreeze / wantsUnfreeze", () => {
  test("recognizes the closed freeze set", () => {
    expect(wantsFreeze("keep it as is")).toBe(true)
    expect(wantsFreeze("don't touch")).toBe(true)
    expect(wantsFreeze("looks fine")).toBe(true)
    expect(wantsFreeze("just looking around")).toBe(false)
  })

  test("unfreeze loses when freeze words are also present", () => {
    expect(wantsUnfreeze("change it packages/app/src/a.tsx")).toBe(true)
    expect(wantsUnfreeze("don't touch, change it")).toBe(false)
  })
})

describe("fold", () => {
  test("freezes the named path and sticky-reuses lastNamed", () => {
    const frozen = fold([
      user("packages/app/src/shell/left-sidebar.tsx looks fine, leave it"),
      user("other work next"),
      user("still leave it"),
    ])
    expect(frozen).toEqual(["packages/app/src/shell/left-sidebar.tsx"])
  })

  test("unfreeze clears the sticky path", () => {
    const frozen = fold([
      user("packages/core/src/tool/plugin/shell.ts don't change"),
      user("packages/core/src/tool/plugin/shell.ts change it"),
    ])
    expect(frozen).toEqual([])
  })

  test("attachment name freezes without a path in the prose", () => {
    const frozen = fold([user("looks fine, leave it", ["packages/app/src/a.tsx"])])
    expect(frozen).toEqual(["packages/app/src/a.tsx"])
  })
})

describe("matches / blocked", () => {
  test("matches absolute or relative forms of the frozen path", () => {
    const frozen = ["packages/app/src/a.tsx"]
    expect(matches(frozen, "packages/app/src/a.tsx")).toBe(true)
    expect(matches(frozen, "E:/repo/packages/app/src/a.tsx")).toBe(true)
    expect(matches(frozen, "packages/app/src/b.tsx")).toBe(false)
  })

  test("blocked reads the hot cache and respects the kill switch", () => {
    remember("ses_1", ["packages/app/src/a.tsx"])
    expect(blocked("ses_1", "packages/app/src/a.tsx")).toContain("froze edits")
    process.env.OPENCODE_DECISION_FREEZE = "0"
    expect(blocked("ses_1", "packages/app/src/a.tsx")).toBeUndefined()
  })

  test("blocked falls back to session metadata when the cache is empty", () => {
    const metadata = withPaths({}, ["packages/core/src/x.ts"])
    expect(pathsOf(metadata)).toEqual(["packages/core/src/x.ts"])
    expect(blocked("ses_empty", "packages/core/src/x.ts", metadata)).toContain("froze edits")
    expect(metadata[METADATA_KEY]).toEqual({ paths: ["packages/core/src/x.ts"] })
  })
})

describe("sync", () => {
  test("folds history onto metadata and warms the cache", () => {
    const next = sync({
      sessionID: "ses_2",
      messages: [user("packages/app/src/a.tsx don't touch")],
      metadata: {},
    })
    expect(next).toEqual(["packages/app/src/a.tsx"])
    expect(blocked("ses_2", "packages/app/src/a.tsx")).toContain("froze edits")
  })
})
