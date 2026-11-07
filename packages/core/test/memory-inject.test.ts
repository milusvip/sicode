import { describe, expect, test } from "bun:test"
import { PERSONA_PROJECT_KEY, type Belief, type Scope } from "../src/session/memory/belief.js"
import {
  CHAR_BUDGET,
  MAX_BELIEFS,
  PROJECT_BUDGET,
  lineOf,
  personaFromEnv,
  render,
  renderPersona,
  renderProject,
  selectProject,
  withConflictPeers,
} from "../src/session/memory/inject.js"

const scope: Scope = { projectKey: "/repo" }
const personaScope: Scope = { projectKey: PERSONA_PROJECT_KEY, personaId: "alice" }

const belief = (patch: Partial<Belief> & Pick<Belief, "id" | "proposition" | "kind" | "importance">): Belief => ({
  scope,
  paths: [],
  entities: [],
  validAt: 1,
  confidence: 0.7,
  misses: 0,
  seenAt: 1,
  contradicts: [],
  provenance: [],
  ...patch,
})

describe("SessionMemoryInject.render", () => {
  test("returns empty when there is nothing to show", () => {
    expect(render([])).toBe("")
  })

  test("prefers higher importance and stays under the character budget", () => {
    const bag = Array.from({ length: 20 }, (_, i) =>
      belief({
        id: String(i),
        kind: "context",
        proposition: `Fact number ${i} with some padding text to spend budget ${"x".repeat(80)}`,
        importance: i / 20,
        seenAt: i,
      }),
    )
    const body = render(bag, 100, CHAR_BUDGET)
    expect(body).toContain("# Project memory")
    expect(body.length).toBeLessThanOrEqual(CHAR_BUDGET + 200)
    const bullets = body.split("\n").filter((line) => line.startsWith("- ["))
    expect(bullets.length).toBeGreaterThan(0)
    expect(bullets.length).toBeLessThanOrEqual(MAX_BELIEFS)
    expect(body).toContain("Fact number 19")
  })

  test("OPENCODE_MEMORY_INJECT=0 disables output", () => {
    const previous = process.env.OPENCODE_MEMORY_INJECT
    process.env.OPENCODE_MEMORY_INJECT = "0"
    try {
      expect(
        render([belief({ id: "1", kind: "decision", proposition: "hidden", importance: 1 })]),
      ).toBe("")
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_MEMORY_INJECT
      else process.env.OPENCODE_MEMORY_INJECT = previous
    }
  })

  test("splits project facts and cross-project persona prefs into labeled sections", () => {
    const body = render(
      [
        belief({ id: "p", kind: "decision", proposition: "Use Bun for tests", importance: 0.9 }),
        belief({
          id: "u",
          kind: "preference",
          proposition: "Prefer concise replies",
          importance: 0.8,
          scope: personaScope,
        }),
      ],
      100,
    )
    expect(body).toContain("# Project memory")
    expect(body).toContain("Use Bun for tests")
    expect(body).toContain("# Persona preferences")
    expect(body).toContain("Prefer concise replies")
  })

  test(`keeps persona and project in separate blocks with separate budgets`, () => {
    const project = Array.from({ length: MAX_BELIEFS }, (_, i) =>
      belief({
        id: `p${i}`,
        kind: "context",
        proposition: `project fact ${i}`,
        importance: 1,
      }),
    )
    const persona = [
      belief({
        id: "u0",
        kind: "preference",
        proposition: "Prefer concise replies",
        importance: 1,
        scope: personaScope,
      }),
    ]
    const system = renderPersona([...project, ...persona])
    const messages = renderProject([...project, ...persona])

    // Persona alone is the system block: no project fact may leak into the cacheable prefix.
    expect(system).toContain("# Persona preferences")
    expect(system).toContain("Prefer concise replies")
    expect(system).not.toContain("# Project memory")
    expect(system).not.toContain("project fact")

    expect(messages).toContain("# Project memory")
    expect(messages).not.toContain("# Persona preferences")
    expect(messages.length).toBeLessThanOrEqual(PROJECT_BUDGET + 400)
  })

  test("the system block does not change when the user's words change", () => {
    const bag = [
      belief({
        id: "cookies",
        kind: "decision",
        proposition: "chrome.cookies path filter merge",
        paths: ["packages/chrome-extension/cookie-scope.js"],
        importance: 0.99,
        seenAt: 9_000,
      }),
      belief({
        id: "dock",
        kind: "file",
        proposition: "Permission dock batches always/once",
        paths: ["packages/app/src/session/requests/session-permission-dock.tsx"],
        importance: 0.5,
        seenAt: 1_000,
      }),
      belief({
        id: "u0",
        kind: "preference",
        proposition: "Prefer concise replies",
        importance: 0.8,
        scope: personaScope,
      }),
    ]
    // The whole point of the split: the cacheable prefix is byte-identical across turns.
    const first = renderPersona(bag, { now: 10_000, query: "权限弹窗" })
    const second = renderPersona(bag, { now: 10_000, query: "chrome cookies" })
    expect(first).toBe(second)
    expect(first).toContain("Prefer concise replies")

    // The query-ranked half is the part that is allowed to move.
    expect(renderProject(bag, { now: 10_000, query: "权限弹窗" })).toContain("Permission dock")
    expect(renderProject(bag, { now: 10_000, query: "chrome cookies" })).toContain("chrome.cookies")
  })

  test("query ranks project beliefs so recent noise loses to a matching path", () => {
    const bag = [
      belief({
        id: "noise",
        kind: "decision",
        proposition: "chrome.cookies path filter merge",
        paths: ["packages/chrome-extension/cookie-scope.js"],
        importance: 0.99,
        seenAt: 9_000,
      }),
      belief({
        id: "hit",
        kind: "file",
        proposition: "Permission dock batches always/once",
        paths: ["packages/app/src/session/requests/session-permission-dock.tsx"],
        importance: 0.5,
        seenAt: 1_000,
      }),
    ]
    const ranked = selectProject(bag, "权限弹窗 always once", 10_000)
    expect(ranked[0]?.id).toBe("hit")

    const body = render(bag, { now: 10_000, query: "权限弹窗" })
    expect(body).toContain("Permission dock")
    expect(body).not.toContain("chrome.cookies")
  })

  test("a query with no lexical hit stays silent instead of dumping importance", () => {
    const bag = [
      belief({
        id: "cookies",
        kind: "decision",
        proposition: "chrome.cookies path filter merge",
        paths: ["packages/chrome-extension/cookie-scope.js"],
        importance: 0.99,
        seenAt: 9_000,
      }),
    ]
    expect(selectProject(bag, "完全无关的问法 xyzzy", 10_000)).toEqual([])
    expect(renderProject(bag, { now: 10_000, query: "完全无关的问法 xyzzy" })).toBe("")
  })

  test("inject co-selects contradict peers and names the other claim", () => {
    const bun = belief({
      id: "bun",
      kind: "decision",
      proposition: "Use Bun for package scripts",
      importance: 0.95,
      contradicts: ["node"],
    })
    const node = belief({
      id: "node",
      kind: "decision",
      proposition: "Use Node for package scripts",
      importance: 0.4,
      contradicts: ["bun"],
    })
    const noise = belief({
      id: "noise",
      kind: "context",
      proposition: "cookies path filter",
      paths: ["packages/chrome-extension/cookie-scope.js"],
      importance: 0.99,
    })
    const ranked = withConflictPeers(selectProject([bun, node, noise], "package scripts Bun", 10_000), [
      bun,
      node,
      noise,
    ])
    expect(ranked.map((item) => item.id)).toContain("bun")
    expect(ranked.map((item) => item.id)).toContain("node")

    const body = render([bun, node, noise], { now: 10_000, query: "package scripts Bun" })
    expect(body).toContain("Use Bun for package scripts")
    expect(body).toContain('conflicts: "Use Node for package scripts"')
    expect(body).toContain("Use Node for package scripts")
  })

  test("lineOf marks path misses as stale and ages old confirmations", () => {
    const stale = belief({
      id: "stale",
      kind: "file",
      proposition: "old dock path",
      paths: ["gone.tsx"],
      misses: 1,
      importance: 0.8,
      seenAt: 1,
    })
    const now = 10 * 86_400_000
    expect(lineOf(stale, undefined, now)).toContain("[stale: path miss — verify in code]")
    expect(lineOf(stale, undefined, now)).toContain("[seen ~9d ago]")
  })

  test("personaFromEnv defaults to local and can be disabled", () => {
    const previous = process.env.OPENCODE_PERSONA
    try {
      delete process.env.OPENCODE_PERSONA
      expect(personaFromEnv()).toBe("local")
      process.env.OPENCODE_PERSONA = "  "
      expect(personaFromEnv()).toBe("local")
      process.env.OPENCODE_PERSONA = " alice "
      expect(personaFromEnv()).toBe("alice")
      process.env.OPENCODE_PERSONA = "0"
      expect(personaFromEnv()).toBeUndefined()
      process.env.OPENCODE_PERSONA = "off"
      expect(personaFromEnv()).toBeUndefined()
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_PERSONA
      else process.env.OPENCODE_PERSONA = previous
    }
  })
})
