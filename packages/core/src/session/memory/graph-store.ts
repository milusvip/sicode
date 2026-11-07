/**
 * SiCode: persist entity/edge rows derived from beliefs, and reload adjacency from SQLite.
 *
 * Rebuild-on-write keeps the graph consistent with the belief bag without a separate consolidation
 * worker. Search still falls back to `buildAdjacency` when the table is empty (fresh migrate).
 */
export * as SessionMemoryGraphStore from "./graph-store.js"

import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "../../database/database.js"
import { buildAdjacency, entitiesOf, type Adjacency } from "./graph.js"
import { isActive, type Belief } from "./belief.js"
import { MemoryEdgeTable, MemoryEntityTable } from "./sql.js"

const entityId = (projectKey: string, name: string) => `${projectKey}\u0000${name}`

const edgeId = (projectKey: string, a: string, b: string, entity: string) => {
  const [left, right] = a < b ? [a, b] : [b, a]
  return `${projectKey}\u0000${left}\u0000${right}\u0000${entity}`
}

const entityType = (name: string) => {
  if (name.includes("-") || name.includes(".")) return "file"
  if (/^[a-z]+(?:[A-Z][a-z]+)+$/i.test(name) || name !== name.toLowerCase()) return "symbol"
  return "concept"
}

/** Replace all graph rows for a project scope with edges derived from the active belief bag. */
export const syncGraph = Effect.fn("SessionMemoryGraphStore.syncGraph")(function* (
  projectKey: string,
  beliefs: readonly Belief[],
) {
  const database = yield* Database.Service
  const now = Date.now()
  const active = beliefs.filter((belief) => isActive(belief, now))

  yield* database.db.delete(MemoryEdgeTable).where(eq(MemoryEdgeTable.project_key, projectKey)).run().pipe(Effect.orDie)
  yield* database.db
    .delete(MemoryEntityTable)
    .where(eq(MemoryEntityTable.project_key, projectKey))
    .run()
    .pipe(Effect.orDie)

  const byEntity = new Map<string, string[]>()
  const entityRows: Array<{ id: string; project_key: string; name: string; type: string; time_created: number; time_updated: number }> =
    []

  for (const belief of active) {
    for (const name of entitiesOf(belief)) {
      const id = entityId(projectKey, name)
      if (!byEntity.has(name)) {
        byEntity.set(name, [])
        entityRows.push({
          id,
          project_key: projectKey,
          name,
          type: entityType(name),
          time_created: now,
          time_updated: now,
        })
      }
      byEntity.get(name)!.push(belief.id)
    }
  }

  if (entityRows.length > 0) {
    yield* database.db.insert(MemoryEntityTable).values(entityRows).run().pipe(Effect.orDie)
  }

  const edgeRows: Array<{
    id: string
    project_key: string
    belief_a: string
    belief_b: string
    entity_id: string
    rel: string
    time_created: number
    time_updated: number
  }> = []
  const seenEdge = new Set<string>()

  for (const [name, ids] of byEntity) {
    if (ids.length < 2) continue
    const eid = entityId(projectKey, name)
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i]!
        const b = ids[j]!
        const id = edgeId(projectKey, a, b, eid)
        if (seenEdge.has(id)) continue
        seenEdge.add(id)
        const [belief_a, belief_b] = a < b ? [a, b] : [b, a]
        edgeRows.push({
          id,
          project_key: projectKey,
          belief_a,
          belief_b,
          entity_id: eid,
          rel: "shares",
          time_created: now,
          time_updated: now,
        })
      }
    }
  }

  if (edgeRows.length > 0) {
    yield* database.db.insert(MemoryEdgeTable).values(edgeRows).run().pipe(Effect.orDie)
  }
})

/** Load undirected adjacency from persisted edges; empty table → derive from beliefs. */
export const loadAdjacency = Effect.fn("SessionMemoryGraphStore.loadAdjacency")(function* (
  projectKey: string,
  beliefs: readonly Belief[],
  asOf = Date.now(),
) {
  const database = yield* Database.Service
  const rows = yield* database.db
    .select()
    .from(MemoryEdgeTable)
    .where(eq(MemoryEdgeTable.project_key, projectKey))
    .all()
    .pipe(Effect.orDie)

  if (rows.length === 0) return buildAdjacency(beliefs, asOf)

  const edges: Adjacency = new Map()
  const touch = (a: string, b: string) => {
    if (a === b) return
    const left = edges.get(a) ?? new Set<string>()
    left.add(b)
    edges.set(a, left)
    const right = edges.get(b) ?? new Set<string>()
    right.add(a)
    edges.set(b, right)
  }
  for (const row of rows) touch(row.belief_a, row.belief_b)
  return edges
})
