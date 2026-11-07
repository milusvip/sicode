import { describe, expect, test } from "bun:test"
import type { SessionMessage } from "../src/session/message.js"
import {
  detectSearchMissStreak,
  SEARCH_MISS_FIRST,
  shouldNudgeSearchMiss,
  shouldStopSearchMiss,
} from "../src/session/runner/search-miss.js"

const completed = (name: string, input: unknown, metadata?: Record<string, unknown>) => ({
  type: "tool",
  id: `tool-${JSON.stringify(input)}-${name}`,
  name,
  state: { status: "completed", input, content: [{ type: "text", text: "ok" }], ...(metadata ? { metadata } : {}) },
})

const step = (tools: unknown[]) =>
  ({ type: "assistant", content: [...tools] }) as unknown as SessionMessage.Info

const user = (text = "go") =>
  ({ type: "user", text, files: [], agents: [], skills: [] }) as unknown as SessionMessage.Info

const grepMiss = (pattern: string) => completed("grep", { pattern }, { matches: 0 })
const grepHit = (pattern: string) => completed("grep", { pattern }, { matches: 2 })
const globMiss = (pattern: string) => completed("glob", { pattern }, { count: 0 })
const globHit = (pattern: string) => completed("glob", { pattern }, { count: 3 })

describe("detectSearchMissStreak", () => {
  test("counts consecutive empty greps at the end of the turn", () => {
    const hit = detectSearchMissStreak([
      step([grepMiss("sidebar")]),
      step([grepMiss("footer")]),
    ])
    expect(hit).not.toBeNull()
    expect(hit!.streak).toBe(2)
    expect(hit!.total).toBe(2)
    expect(hit!.early).toBe(false)
    expect(hit!.streak).toBeGreaterThanOrEqual(SEARCH_MISS_FIRST)
  })

  test("CJK empty grep marks early so one miss is enough to nudge", () => {
    const hit = detectSearchMissStreak([step([grepMiss("线索码头")])])
    expect(hit!.streak).toBe(1)
    expect(hit!.early).toBe(true)
    expect(shouldNudgeSearchMiss(hit!, 0)).toBe(true)
  })

  test("Chinese user + ASCII-only empty grep is early (bilingual miss)", () => {
    const hit = detectSearchMissStreak([
      user("分析 tipa 物资透视"),
      step([grepMiss("ESP aimbot loot")]),
    ])
    expect(hit!.streak).toBe(1)
    expect(hit!.early).toBe(true)
    expect(shouldNudgeSearchMiss(hit!, 0)).toBe(true)
  })

  test("English still waits for SEARCH_MISS_FIRST before nudging", () => {
    const one = detectSearchMissStreak([user("find sidebar"), step([grepMiss("sidebar")])])!
    expect(one.early).toBe(false)
    expect(shouldNudgeSearchMiss(one, 0)).toBe(false)
    const two = detectSearchMissStreak([
      user("find sidebar"),
      step([grepMiss("sidebar")]),
      step([grepMiss("footer")]),
    ])!
    expect(shouldNudgeSearchMiss(two, 0)).toBe(true)
  })

  test("a successful search resets the trailing streak but keeps total", () => {
    const hit = detectSearchMissStreak([
      step([grepMiss("a")]),
      step([grepMiss("b")]),
      step([grepHit("waitForScan")]),
      step([grepMiss("c")]),
    ])
    expect(hit!.streak).toBe(1)
    expect(hit!.total).toBe(3)
  })

  test("glob empty counts the same as grep empty", () => {
    const hit = detectSearchMissStreak([step([globMiss("**/*foo*"), grepMiss("bar")])])
    expect(hit!.streak).toBe(2)
    expect(hit!.total).toBe(2)
  })

  test("non-search tools do not break or inflate the streak", () => {
    const hit = detectSearchMissStreak([
      step([grepMiss("a")]),
      step([completed("read", { path: "x.ts" })]),
      step([grepMiss("b")]),
    ])
    expect(hit!.streak).toBe(2)
    expect(hit!.total).toBe(2)
  })

  test("a user message ends the turn window", () => {
    const hit = detectSearchMissStreak([
      step([grepMiss("old")]),
      step([grepMiss("older")]),
      user(),
      step([grepMiss("new")]),
    ])
    expect(hit!.streak).toBe(1)
    expect(hit!.total).toBe(1)
  })

  test("returns null when the turn has no search tools", () => {
    expect(detectSearchMissStreak([step([completed("read", { path: "a.ts" })])])).toBeNull()
  })

  test("a glob hit resets the streak", () => {
    const hit = detectSearchMissStreak([
      step([grepMiss("a"), grepMiss("b")]),
      step([globHit("**/*.ts")]),
      step([grepMiss("c")]),
    ])
    expect(hit!.streak).toBe(1)
    expect(hit!.total).toBe(3)
  })
})

describe("shouldStopSearchMiss", () => {
  test("never stops before the soft synonym chance", () => {
    const hit = detectSearchMissStreak([step([grepMiss("sidebar")]), step([grepMiss("footer")])])!
    expect(shouldNudgeSearchMiss(hit, 0)).toBe(true)
    expect(shouldStopSearchMiss(hit, 0, false)).toBe(false)
  })

  test("stops when soft already fired and another empty streak is due", () => {
    const afterSoft = detectSearchMissStreak([
      step([grepMiss("a")]),
      step([grepMiss("b")]),
      step([grepMiss("c")]),
      step([grepMiss("d")]),
    ])!
    // Soft paced at total=2; two more empties make another due window.
    expect(shouldStopSearchMiss(afterSoft, 2, true)).toBe(true)
    expect(shouldStopSearchMiss(afterSoft, 2, false)).toBe(false)
  })

  test("CJK soft once then stop on the next empty", () => {
    const first = detectSearchMissStreak([step([grepMiss("线索码头")])])!
    expect(shouldNudgeSearchMiss(first, 0)).toBe(true)
    expect(shouldStopSearchMiss(first, 0, false)).toBe(false)
    const second = detectSearchMissStreak([step([grepMiss("线索码头")]), step([grepMiss("线索")])])!
    expect(shouldStopSearchMiss(second, 1, true)).toBe(true)
  })
})
