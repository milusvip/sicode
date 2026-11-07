/**
 * SiCode: persist belief embedding blobs keyed by (belief_id, embed version).
 *
 * Rebuild-on-write mirrors graph-store: replace clears the project slice, then upserts one row
 * per active belief under feat-hash-v1 (no model download).
 */
export * as SessionMemoryVectorStore from "./vector-store.js"

import { and, eq } from "drizzle-orm"
import { Effect } from "effect"
import { Database } from "../../database/database.js"
import { isActive, type Belief } from "./belief.js"
import {
  activeEmbedMeta,
  decodeVectorBlob,
  embedTextAsync,
  encodeVectorBlob,
  type EmbedMeta,
} from "./embed.js"
import { documentOf } from "./vector.js"
import { MemoryVectorTable } from "./sql.js"

/** Replace all cached vectors for a project with embeddings of the active belief bag. */
export const syncVectors = Effect.fn("SessionMemoryVectorStore.syncVectors")(function* (
  projectKey: string,
  beliefs: readonly Belief[],
) {
  const database = yield* Database.Service
  const now = Date.now()
  const active = beliefs.filter((belief) => isActive(belief, now))

  yield* database.db
    .delete(MemoryVectorTable)
    .where(eq(MemoryVectorTable.project_key, projectKey))
    .run()
    .pipe(Effect.orDie)

  if (active.length === 0) return

  const rows: Array<{
    belief_id: string
    project_key: string
    version: string
    dim: number
    values: Buffer
    time_updated: number
  }> = []

  for (const belief of active) {
    const { vec, meta } = yield* Effect.promise(() => embedTextAsync(documentOf(belief)))
    rows.push({
      belief_id: belief.id,
      project_key: projectKey,
      version: meta.version,
      dim: meta.dim,
      values: encodeVectorBlob(vec),
      time_updated: now,
    })
  }

  yield* database.db.insert(MemoryVectorTable).values(rows).run().pipe(Effect.orDie)
})

export type LoadedVectors = {
  readonly meta: EmbedMeta
  readonly byId: ReadonlyMap<string, Float32Array>
}

/**
 * Load cached vectors whose version matches the active recipe. Empty / mismatched → empty map
 * so search falls back to on-the-fly hash embeds.
 */
export const loadVectors = Effect.fn("SessionMemoryVectorStore.loadVectors")(function* (projectKey: string) {
  const database = yield* Database.Service
  const meta = activeEmbedMeta()
  const rows = yield* database.db
    .select()
    .from(MemoryVectorTable)
    .where(and(eq(MemoryVectorTable.project_key, projectKey), eq(MemoryVectorTable.version, meta.version)))
    .all()
    .pipe(Effect.orDie)

  const byId = new Map<string, Float32Array>()
  for (const row of rows) {
    if (row.dim !== meta.dim) continue
    byId.set(row.belief_id, decodeVectorBlob(row.values as Buffer, row.dim))
  }
  return { meta, byId } satisfies LoadedVectors
})
