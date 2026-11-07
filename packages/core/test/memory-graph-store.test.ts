import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Database } from "../src/database/database.js"
import type { Belief, Scope } from "../src/session/memory/belief.js"
import { buildAdjacency } from "../src/session/memory/graph.js"
import { loadAdjacency, syncGraph } from "../src/session/memory/graph-store.js"
import { MemoryEdgeTable, MemoryEntityTable } from "../src/session/memory/sql.js"
import { eq } from "drizzle-orm"

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

const withDb = <A>(body: Effect.Effect<A, never, Database.Service>) =>
  Effect.runPromise(
    Effect.scoped(body.pipe(Effect.provide(Database.layer({ path: ":memory:" })))) as Effect.Effect<A>,
  )

describe("SessionMemoryGraphStore", () => {
  test("syncGraph writes entities and edges; loadAdjacency matches in-memory build", async () => {
    const a = belief({
      id: "ui",
      kind: "file",
      proposition: "Permission dock buttons",
      paths: ["packages/app/src/session/requests/session-permission-dock.tsx"],
    })
    const b = belief({
      id: "css",
      kind: "context",
      proposition: "Sidebar inset uses CSS variables",
      paths: ["packages/app/src/shell/sidebar-inset.css"],
      entities: ["permission-dock"],
    })
    // Force a shared entity so an edge is guaranteed regardless of path tokenization.
    const c = belief({
      id: "pref",
      kind: "preference",
      proposition: "Always batch permission dock once",
      entities: ["permission-dock"],
    })

    await withDb(
      Effect.gen(function* () {
        yield* syncGraph("/repo", [a, b, c])
        const database = yield* Database.Service
        const entities = yield* database.db
          .select()
          .from(MemoryEntityTable)
          .where(eq(MemoryEntityTable.project_key, "/repo"))
          .all()
          .pipe(Effect.orDie)
        const edges = yield* database.db
          .select()
          .from(MemoryEdgeTable)
          .where(eq(MemoryEdgeTable.project_key, "/repo"))
          .all()
          .pipe(Effect.orDie)

        expect(entities.some((row) => row.name === "permission-dock")).toBe(true)
        expect(edges.length).toBeGreaterThan(0)

        const fromDb = yield* loadAdjacency("/repo", [a, b, c])
        const fromMem = buildAdjacency([a, b, c])
        // Shared entity should link pref ↔ at least one peer in both views.
        const prefNeighbors = [...(fromDb.get("pref") ?? [])]
        expect(prefNeighbors.length).toBeGreaterThan(0)
        expect([...(fromMem.get("pref") ?? [])].sort()).toEqual(prefNeighbors.sort())
      }),
    )
  })

  test("empty bag clears prior graph rows", async () => {
    const a = belief({
      id: "a",
      kind: "file",
      proposition: "dock",
      entities: ["permission-dock"],
    })
    const b = belief({
      id: "b",
      kind: "file",
      proposition: "dock peer",
      entities: ["permission-dock"],
    })

    await withDb(
      Effect.gen(function* () {
        yield* syncGraph("/repo", [a, b])
        yield* syncGraph("/repo", [])
        const database = yield* Database.Service
        const entities = yield* database.db
          .select()
          .from(MemoryEntityTable)
          .where(eq(MemoryEntityTable.project_key, "/repo"))
          .all()
          .pipe(Effect.orDie)
        const edges = yield* database.db
          .select()
          .from(MemoryEdgeTable)
          .where(eq(MemoryEdgeTable.project_key, "/repo"))
          .all()
          .pipe(Effect.orDie)
        expect(entities).toEqual([])
        expect(edges).toEqual([])
      }),
    )
  })

  test("loadAdjacency falls back to buildAdjacency when table is empty", async () => {
    const a = belief({
      id: "a",
      kind: "file",
      proposition: "dock",
      entities: ["permission-dock"],
    })
    const b = belief({
      id: "b",
      kind: "file",
      proposition: "dock peer",
      entities: ["permission-dock"],
    })

    await withDb(
      Effect.gen(function* () {
        const fromDb = yield* loadAdjacency("/repo", [a, b])
        const fromMem = buildAdjacency([a, b])
        expect([...(fromDb.get("a") ?? [])].sort()).toEqual([...(fromMem.get("a") ?? [])].sort())
      }),
    )
  })
})
