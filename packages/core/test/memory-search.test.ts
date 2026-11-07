import { describe, expect, test } from "bun:test"
import type { Belief, Scope } from "../src/session/memory/belief.js"
import { searchAsFacts, searchBeliefs } from "../src/session/memory/search.js"

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

describe("searchBeliefs", () => {
  const bag: Belief[] = [
    belief({
      id: "1",
      kind: "file",
      proposition: "Permission dock batches always/once",
      paths: ["packages/app/src/session/requests/session-permission-dock.tsx"],
      importance: 0.8,
    }),
    belief({
      id: "2",
      kind: "decision",
      proposition: "Prefer Flash golden baselines for retrieval",
      importance: 0.9,
      seenAt: 9_000,
    }),
    belief({
      id: "3",
      kind: "context",
      proposition: "Unrelated shell timeout note",
      importance: 0.2,
    }),
  ]

  test("path hits outrank bare proposition noise", () => {
    const hits = searchBeliefs(bag, "permission-dock")
    expect(hits[0]?.belief.id).toBe("1")
    expect(hits[0]?.why).toContain("path")
  })

  test("decision text is findable without a path", () => {
    const hits = searchBeliefs(bag, "Flash golden")
    expect(hits.map((hit) => hit.belief.id)).toContain("2")
  })

  test("searchAsFacts keeps recall's Fact shape", () => {
    const facts = searchAsFacts(bag, "permission dock")
    expect(facts[0]?.kind).toBe("file")
    expect(facts[0]?.paths[0]).toContain("session-permission-dock")
  })

  test("inactive beliefs are excluded", () => {
    const gone = belief({
      id: "x",
      kind: "context",
      proposition: "gone",
      invalidAt: 500,
      paths: ["gone.ts"],
    })
    expect(searchBeliefs([...bag, gone], "gone")).toEqual([])
  })
})
