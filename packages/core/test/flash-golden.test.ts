/**
 * SiCode: Flash dual-track golden pins — hard-capability regressions without a live model.
 *
 * Session-trajectory medians live in `flash-trajectory.test.ts` + the baseline fixture.
 * These pins lock hard capabilities: concept expand, multi-pattern, empty-candidate fallback,
 * search-miss nudge, and budgeted project+persona inject.
 */
import { describe, expect, test } from "bun:test"
import { PERSONA_PROJECT_KEY, type Belief, type Scope } from "../src/session/memory/belief.js"
import { CHAR_BUDGET, MAX_BELIEFS, render } from "../src/session/memory/inject.js"
import { searchBeliefs } from "../src/session/memory/search.js"
import { detectSearchMissStreak, SEARCH_MISS_FIRST, SEARCH_MISS_PROMPT } from "../src/session/runner/search-miss.js"
import type { SessionMessage } from "../src/session/message.js"
import { SearchRankedConcepts } from "../src/search-ranked/concepts.js"
import { MAX_GREP_PATTERNS, resolveGrepPatterns, usablePrefilter } from "../src/tool/plugin/grep.js"

const scope: Scope = { projectKey: "/repo" }
const personaScope: Scope = { projectKey: PERSONA_PROJECT_KEY, personaId: "flash-user" }

const belief = (patch: Partial<Belief> & Pick<Belief, "id" | "proposition" | "kind">): Belief => ({
  scope,
  paths: [],
  entities: [],
  validAt: 1,
  importance: 0.7,
  confidence: 0.7,
  misses: 0,
  seenAt: 1,
  contradicts: [],
  provenance: [],
  ...patch,
})

const completed = (name: string, input: unknown, metadata?: Record<string, unknown>) => ({
  type: "tool",
  id: `tool-${name}-${JSON.stringify(input)}`,
  name,
  state: { status: "completed", input, content: [{ type: "text", text: "ok" }], ...(metadata ? { metadata } : {}) },
})

const step = (tools: unknown[]) =>
  ({ type: "assistant", content: [...tools] }) as unknown as SessionMessage.Info

/** Chinese concept queries Flash actually asks — expand must land English identifiers. */
const CONCEPT_GOLDENS: ReadonlyArray<{ query: string; mustInclude: string }> = [
  { query: "侧边栏底部留白", mustInclude: "sidebar" },
  { query: "权限弹窗 always", mustInclude: "permission-dock" },
  { query: "上下文压缩之后变笨", mustInclude: "compaction" },
  { query: "项目记忆跨会话", mustInclude: "project-memory" },
  { query: "仓库地图", mustInclude: "repo-map" },
]

describe("Flash golden: retrieval hard path", () => {
  test.each(CONCEPT_GOLDENS)("concepts expand $query → $mustInclude", ({ query, mustInclude }) => {
    const expanded = SearchRankedConcepts.expand(query)
    expect(expanded).toContain(mustInclude)
    expect(SearchRankedConcepts.extrasOf(query).length).toBeGreaterThan(0)
  })

  test("grep patterns batch synonyms in one call (Flash must not serial-guess)", () => {
    const resolved = resolveGrepPatterns({
      pattern: "sidebar",
      patterns: ["left-sidebar", "留白", "footer padding", "sidebar"],
    })
    expect(resolved[0]).toBe("sidebar")
    expect(resolved).toContain("left-sidebar")
    expect(resolved).toContain("留白")
    expect(resolved.length).toBeLessThanOrEqual(MAX_GREP_PATTERNS)
  })

  test("concept extras ride along with a single wrong guess (compress → compaction)", () => {
    const resolved = resolveGrepPatterns({ pattern: "compress a long session" })
    expect(resolved).toContain("compress a long session")
    expect(resolved).toContain("compaction")
  })

  test("empty trigram candidates fall back to a full sweep", () => {
    expect(usablePrefilter([])).toBeNull()
    expect(usablePrefilter(null)).toBeNull()
  })

  test(`search-miss fires after ${SEARCH_MISS_FIRST} empty greps with the Flash nudge copy`, () => {
    const hit = detectSearchMissStreak([
      step([completed("grep", { pattern: "sidebar" }, { matches: 0 })]),
      step([completed("grep", { pattern: "footer" }, { matches: 0 })]),
    ])
    expect(hit).not.toBeNull()
    expect(hit!.streak).toBeGreaterThanOrEqual(SEARCH_MISS_FIRST)
    expect(SEARCH_MISS_PROMPT).toContain("patterns")
    expect(SEARCH_MISS_PROMPT).toContain("Do not guess one English keyword at a time")
    // Soft asks for a synonym batch; hard stop (SEARCH_MISS_STOP_PROMPT) is what bans Explore.
    expect(SEARCH_MISS_PROMPT).toContain("Do not ask the user in prose")
  })

  test("CJK empty grep nudges on the first miss; plain a|b|c expands like patterns[]", () => {
    const hit = detectSearchMissStreak([
      step([completed("grep", { pattern: "线索码头" }, { matches: 0 })]),
    ])
    expect(hit!.early).toBe(true)
    expect(hit!.streak).toBe(1)
    expect(SearchRankedConcepts.expand("线索码头")).toContain("context-hints")
    expect(resolveGrepPatterns({ pattern: "sidebar|left-sidebar|留白" })).toEqual([
      "sidebar",
      "left-sidebar",
      "留白",
    ])
  })
})

describe("Flash golden: memory hard path", () => {
  test("passive inject surfaces project + persona without waiting for recall", () => {
    const body = render(
      [
        belief({
          id: "dec",
          kind: "decision",
          proposition: "Permission dock owns always/once batching",
          paths: ["packages/app/src/session/requests/session-permission-dock.tsx"],
          importance: 0.95,
        }),
        belief({
          id: "pref",
          kind: "preference",
          proposition: "Prefer Flash golden baselines",
          importance: 0.9,
          scope: personaScope,
        }),
      ],
      100,
      CHAR_BUDGET,
    )
    expect(body).toContain("# Project memory")
    expect(body).toContain("Permission dock owns always/once batching")
    expect(body).toContain("# Persona preferences")
    expect(body).toContain("Prefer Flash golden baselines")
    expect(body).toContain("Do not call recall just to re-read these")
    const bullets = body.split("\n").filter((line) => line.startsWith("- ["))
    expect(bullets.length).toBeLessThanOrEqual(MAX_BELIEFS)
  })

  test("memory BM25 finds a Chinese-concept path belief Flash would otherwise miss", () => {
    const bag = [
      belief({
        id: "1",
        kind: "file",
        proposition: "Permission dock UI",
        paths: ["packages/app/src/session/requests/session-permission-dock.tsx"],
        importance: 0.8,
      }),
      belief({
        id: "2",
        kind: "context",
        proposition: "Unrelated note about shell timeouts",
        importance: 0.9,
      }),
    ]
    const hits = searchBeliefs(bag, "权限弹窗")
    expect(hits[0]?.belief.id).toBe("1")
  })
})
