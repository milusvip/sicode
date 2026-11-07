import { describe, expect, test } from "bun:test"
import type { Belief, Scope } from "../src/session/memory/belief.js"
import { cosine, embedText, EMBED_DIM } from "../src/session/memory/embed.js"
import { searchBeliefs } from "../src/session/memory/search.js"
import { documentOf, rrf, searchVector } from "../src/session/memory/vector.js"

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

describe("SessionMemoryEmbed", () => {
  test("embeds into a fixed unit vector", () => {
    const vec = embedText("permission dock always once")
    expect(vec.length).toBe(EMBED_DIM)
    expect(cosine(vec, vec)).toBeGreaterThan(0.99)
    expect(cosine(embedText(""), embedText("x"))).toBe(0)
  })

  test("similar phrases score higher than unrelated ones", () => {
    const dock = embedText("permission dock batches always once")
    const near = embedText("permission dock always once batching")
    const far = embedText("chrome cookies path filter merge")
    expect(cosine(dock, near)).toBeGreaterThan(cosine(dock, far))
  })
})

describe("SessionMemoryVector", () => {
  const bag = [
    belief({
      id: "dock",
      kind: "file",
      proposition: "Permission dock batches always/once",
      paths: ["packages/app/src/session/requests/session-permission-dock.tsx"],
    }),
    belief({
      id: "cookies",
      kind: "decision",
      proposition: "chrome.cookies getAll url filters by path",
      paths: ["packages/chrome-extension/cookie-scope.js"],
      importance: 0.95,
    }),
  ]

  test("documentOf joins the fields the embedder should see", () => {
    expect(documentOf(bag[0]!)).toContain("permission-dock")
    expect(documentOf(bag[0]!)).toContain("Permission dock")
  })

  test("rrf prefers ids that rank well on multiple lists", () => {
    const scores = rrf([
      ["a", "b", "c"],
      ["b", "a", "d"],
    ])
    expect(scores.get("b")!).toBeGreaterThan(scores.get("c")!)
    expect(scores.get("a")!).toBeGreaterThan(scores.get("d")!)
  })

  test("vector search ranks the dock belief above cookies for a dock paraphrase", () => {
    const hits = searchVector(bag, "always once permission batching UI")
    expect(hits[0]?.id).toBe("dock")
  })

  test("OPENCODE_MEMORY_VECTOR=0 disables the vector leg", () => {
    const previous = process.env.OPENCODE_MEMORY_VECTOR
    process.env.OPENCODE_MEMORY_VECTOR = "0"
    try {
      expect(searchVector(bag, "permission dock")).toEqual([])
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_MEMORY_VECTOR
      else process.env.OPENCODE_MEMORY_VECTOR = previous
    }
  })
})

describe("searchBeliefs M4 fusion", () => {
  test("fused search still prefers path hits and can mark vector in why", () => {
    const bag = [
      belief({
        id: "1",
        kind: "file",
        proposition: "Permission dock batches always/once",
        paths: ["packages/app/src/session/requests/session-permission-dock.tsx"],
        importance: 0.8,
      }),
      belief({
        id: "2",
        kind: "context",
        proposition: "Unrelated shell timeout note",
        importance: 0.2,
      }),
    ]
    const hits = searchBeliefs(bag, "permission-dock")
    expect(hits[0]?.belief.id).toBe("1")
    expect(hits[0]?.why.some((channel) => channel === "path" || channel === "vector")).toBe(true)
  })

  test("Chinese concept query still reaches the dock belief via expand + fusion", () => {
    const bag = [
      belief({
        id: "1",
        kind: "file",
        proposition: "Permission dock UI",
        paths: ["packages/app/src/session/requests/session-permission-dock.tsx"],
      }),
      belief({
        id: "2",
        kind: "context",
        proposition: "shell timeout defaults",
        importance: 0.9,
      }),
    ]
    const hits = searchBeliefs(bag, "权限弹窗")
    expect(hits[0]?.belief.id).toBe("1")
  })
})
