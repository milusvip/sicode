import { blob, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../../database/schema.sql.js"
import type { Kind } from "./belief.js"

/**
 * SiCode: one row per belief. JSON columns keep paths/entities/provenance flexible without a
 * join table in M1; FTS (M2) can index proposition + paths later.
 */
export const MemoryBeliefTable = sqliteTable("memory_belief", {
  id: text().primaryKey(),
  project_key: text().notNull(),
  persona_id: text(),
  session_id: text(),
  kind: text().$type<Kind>().notNull(),
  proposition: text().notNull(),
  paths: text({ mode: "json" }).$type<readonly string[]>().notNull(),
  entities: text({ mode: "json" }).$type<readonly string[]>().notNull(),
  valid_at: integer().notNull(),
  invalid_at: integer(),
  importance: integer().notNull(),
  confidence: integer().notNull(),
  misses: integer().notNull(),
  seen_at: integer().notNull(),
  superseded_by: text(),
  contradicts: text({ mode: "json" }).$type<readonly string[]>().notNull(),
  provenance: text({ mode: "json" }).$type<readonly string[]>().notNull(),
  ...Timestamps,
})

/** Normalized entity names derived from beliefs (path pieces, symbols, aliases). */
export const MemoryEntityTable = sqliteTable("memory_entity", {
  id: text().primaryKey(),
  project_key: text().notNull(),
  name: text().notNull(),
  type: text().notNull(),
  ...Timestamps,
})

/** Undirected belief↔belief link justified by a shared entity. */
export const MemoryEdgeTable = sqliteTable("memory_edge", {
  id: text().primaryKey(),
  project_key: text().notNull(),
  belief_a: text().notNull(),
  belief_b: text().notNull(),
  entity_id: text().notNull(),
  rel: text().notNull(),
  ...Timestamps,
})

/** Cached embedding for a belief under a pinned embed version. */
export const MemoryVectorTable = sqliteTable("memory_vector", {
  belief_id: text().primaryKey(),
  project_key: text().notNull(),
  version: text().notNull(),
  dim: integer().notNull(),
  values: blob().notNull(),
  time_updated: integer().notNull(),
})
