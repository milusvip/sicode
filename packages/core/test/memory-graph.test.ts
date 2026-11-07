import { describe, expect, test } from "bun:test"
import type { Belief, Scope } from "../src/session/memory/belief.js"
import { buildAdjacency, entitiesOf, expandHop, normalizeEntity } from "../src/session/memory/graph.js"
import { searchBeliefs } from "../src/session/memory/search.js"

const scope: Scope = { projectKey: "/repo" }

const belief = (patch: Partial<Belief> & Pick<Belief, "id" | "proposition" | "kind">): Belief => ({
  scope,
  paths: [],
  entities: [],
  validAt: 1_000,
  importance: 0.5,
  confidence: 0.7,
  misses: 0,
  seenAt: 1_000,
  contradicts: [],
  provenance: [],
  ...patch,
})

describe("SessionMemoryGraph", () => {
  test("normalizeEntity strips extensions and case", () => {
    expect(normalizeEntity("Session-Permission-Dock.tsx")).toBe("session-permission-dock")
  })

  test("entitiesOf pulls path basenames, pieces, and CamelCase tokens", () => {
    const keys = entitiesOf(
      belief({
        id: "1",
        kind: "file",
        proposition: "PermissionDock batches always once",
        paths: ["packages/app/src/session/requests/session-permission-dock.tsx"],
        entities: ["PermissionDock"],
      }),
    )
    expect(keys).toContain("session-permission-dock")
    expect(keys).toContain("permission-dock")
    expect(keys).toContain("permission")
    expect(keys).toContain("permissiondock")
  })

  test("shared path piece links two beliefs; expandHop returns the neighbor", () => {
    const a = belief({
      id: "ui",
      kind: "file",
      proposition: "Permission dock buttons",
      paths: ["packages/app/src/session/requests/session-permission-dock.tsx"],
    })
    const b = belief({
      id: "model",
      kind: "decision",
      proposition: "decide() batches always/once for the same action",
      paths: ["packages/app/src/session/requests/model.ts"],
      entities: ["permission-dock"],
    })
    const noise = belief({
      id: "cookies",
      kind: "context",
      proposition: "chrome cookies path filter",
      paths: ["packages/chrome-extension/cookie-scope.js"],
    })
    const adjacency = buildAdjacency([a, b, noise])
    expect(adjacency.get("ui")?.has("model")).toBe(true)
    expect(adjacency.get("ui")?.has("cookies")).toBeFalsy()
    expect(expandHop(["ui"], adjacency)).toContain("model")
  })

  test("OPENCODE_MEMORY_GRAPH=0 yields no hop expansion", () => {
    const previous = process.env.OPENCODE_MEMORY_GRAPH
    process.env.OPENCODE_MEMORY_GRAPH = "0"
    try {
      const adjacency = buildAdjacency([
        belief({
          id: "a",
          kind: "file",
          proposition: "x",
          paths: ["session-permission-dock.tsx"],
        }),
        belief({
          id: "b",
          kind: "file",
          proposition: "y",
          entities: ["permission-dock"],
        }),
      ])
      expect(expandHop(["a"], adjacency)).toEqual([])
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_MEMORY_GRAPH
      else process.env.OPENCODE_MEMORY_GRAPH = previous
    }
  })
})

describe("searchBeliefs M5 graph fusion", () => {
  test("a lexical hit pulls a linked neighbor that the query alone would miss", () => {
    // Shared entity ZebraLayout is NOT in the query — graph hop from the lexical seed surfaces `linked`.
    const previous = process.env.OPENCODE_MEMORY_VECTOR
    process.env.OPENCODE_MEMORY_VECTOR = "0"
    try {
      const bag = [
        belief({
          id: "seed",
          kind: "file",
          proposition: "Sidebar inset uses CSS variables on the aside",
          paths: ["packages/app/src/shell/left-sidebar.tsx"],
          entities: ["ZebraLayout"],
          importance: 0.9,
        }),
        belief({
          id: "linked",
          kind: "decision",
          proposition: "Bottom dock omits pb to avoid double padding",
          entities: ["ZebraLayout"],
          importance: 0.8,
        }),
        belief({
          id: "noise",
          kind: "context",
          proposition: "Unrelated shell timeout defaults",
          importance: 0.95,
        }),
      ]
      const hits = searchBeliefs(bag, "sidebar inset CSS variables", 5)
      expect(hits.map((hit) => hit.belief.id)).toContain("seed")
      const neighbor = hits.find((hit) => hit.belief.id === "linked")
      expect(neighbor).toBeDefined()
      expect(neighbor!.why).toContain("graph")
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_MEMORY_VECTOR
      else process.env.OPENCODE_MEMORY_VECTOR = previous
    }
  })
})
