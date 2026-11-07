import { describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "../src/database/database.js"
import type { Belief, Scope } from "../src/session/memory/belief.js"
import { HASH_DIM, HASH_VERSION, cosine, embedHash } from "../src/session/memory/embed.js"
import { MemoryVectorTable } from "../src/session/memory/sql.js"
import { load, record } from "../src/session/memory/store.js"
import { documentOf } from "../src/session/memory/vector.js"
import { loadVectors, syncVectors } from "../src/session/memory/vector-store.js"
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

const withDb = <A>(body: Effect.Effect<A, never, Database.Service>) =>
  Effect.runPromise(
    Effect.scoped(body.pipe(Effect.provide(Database.layer({ path: ":memory:" })))) as Effect.Effect<A>,
  )

describe("SessionMemoryVectorStore", () => {
  test("syncVectors caches feat-hash blobs; loadVectors returns matching dim", async () => {
    const dock = belief({
      id: "dock",
      kind: "decision",
      proposition: "Permission dock batches always once",
      paths: ["packages/app/src/session/requests/session-permission-dock.tsx"],
    })

    await withDb(
      Effect.gen(function* () {
        yield* syncVectors("/repo", [dock])
        const database = yield* Database.Service
        const rows = yield* database.db
          .select()
          .from(MemoryVectorTable)
          .where(eq(MemoryVectorTable.project_key, "/repo"))
          .all()
          .pipe(Effect.orDie)

        expect(rows).toHaveLength(1)
        expect(rows[0]!.version).toBe(HASH_VERSION)
        expect(rows[0]!.dim).toBe(HASH_DIM)

        const loaded = yield* loadVectors("/repo")
        expect(loaded.meta.version).toBe(HASH_VERSION)
        const vec = loaded.byId.get("dock")
        expect(vec).toBeDefined()
        expect(vec!.length).toBe(HASH_DIM)
        expect(cosine(vec!, embedHash(documentOf(dock)))).toBeGreaterThan(0.99)
      }),
    )
  })

  test("searchBeliefs accepts cached vectors without changing top hit", async () => {
    const dock = belief({
      id: "dock",
      kind: "decision",
      proposition: "Permission dock batches always once",
      paths: ["packages/app/src/session/requests/session-permission-dock.tsx"],
    })
    const cookies = belief({
      id: "cookies",
      kind: "context",
      proposition: "Chrome cookies path filter merge",
      paths: ["packages/core/src/cookie.ts"],
    })

    await withDb(
      Effect.gen(function* () {
        yield* syncVectors("/repo", [dock, cookies])
        const { byId } = yield* loadVectors("/repo")
        const withCache = searchBeliefs([dock, cookies], "permission-dock", 5, { vectors: byId })
        const without = searchBeliefs([dock, cookies], "permission-dock", 5)
        expect(withCache[0]?.belief.id).toBe("dock")
        expect(without[0]?.belief.id).toBe("dock")
      }),
    )
  })
})

describe("SessionMemoryEmbed", () => {
  test("embedTextAsync is feat-hash only (no model download)", async () => {
    const { embedTextAsync, HASH_VERSION: version } = await import("../src/session/memory/embed.js")
    const { meta, vec } = await embedTextAsync("permission dock")
    expect(meta.version).toBe(version)
    expect(vec.length).toBe(HASH_DIM)
  })
})

describe("SessionMemoryStore concurrent record", () => {
  test("parallel remember-style writes do not fail memory_vector inserts", async () => {
    // ses_e5d81d66: two remember calls in one step both ran syncVectors (delete-all + insert).
    // Without a per-project write lock the second insert hits UNIQUE on belief_id.
    // SiCode: neutral placeholder paths, not the developer's real home directory or private files.
    const a = belief({
      id: "a",
      kind: "context",
      proposition: "样例目录里汇总文件已删除",
      paths: ["C:/Users/test/Downloads/sample"],
    })
    const b = belief({
      id: "b",
      kind: "context",
      proposition: "样例文案已更新完毕",
      paths: ["C:/Users/test/Downloads/sample/note.txt"],
    })

    await withDb(
      Effect.gen(function* () {
        yield* Effect.all([record("/repo", [a]), record("/repo", [b])], { concurrency: "unbounded" })
        const bag = yield* load("/repo")
        expect(bag.map((item) => item.id).sort()).toEqual(["a", "b"])
        const { byId } = yield* loadVectors("/repo")
        expect([...byId.keys()].sort()).toEqual(["a", "b"])
      }),
    )
  })
})
