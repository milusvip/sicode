/**
 * SiCode: M1 belief store — SQLite table with one-shot migration from the KV project-memory bag.
 *
 * `recall` and the compaction plugin keep calling through adapters that speak Facts until those
 * call sites move; this module owns Belief persistence.
 */
export * as SessionMemoryStore from "./store.js"

import { and, eq, isNull } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"
import { Database } from "../../database/database.js"
import { KeyedMutex } from "../../effect/keyed-mutex.js"
import type { KV } from "../../kv.js"
import { ProjectMemoryStore } from "../project-memory-store.js"
import {
  Beliefs,
  PERSONA_PROJECT_KEY,
  activeOnly,
  fromFact,
  mergeBeliefs,
  toFact,
  verifyBeliefs,
  type Belief,
  type Scope,
} from "./belief.js"

export { PERSONA_PROJECT_KEY }
import { syncGraph } from "./graph-store.js"
import { MemoryBeliefTable } from "./sql.js"
import { syncVectors } from "./vector-store.js"

/**
 * SiCode: syncVectors/syncGraph are rebuild-on-write (delete project slice → insert). Two parallel
 * `remember` calls (ses_e5d81d66) raced that path and hit UNIQUE on memory_vector.belief_id.
 * Serialize writers per project/persona bag; load+merge must sit under the same lock.
 */
const writeLocks = KeyedMutex.makeUnsafe<string>()

const writeKey = (projectKey: string, personaId?: string) =>
  personaId === undefined ? `project:${projectKey}` : `persona:${projectKey}:${personaId}`

const withWriteLock = <A, E, R>(projectKey: string, personaId: string | undefined, effect: Effect.Effect<A, E, R>) =>
  writeLocks.withLock(writeKey(projectKey, personaId))(effect)

const encode = (belief: Belief) => ({
  id: belief.id,
  project_key: belief.scope.projectKey,
  persona_id: belief.scope.personaId,
  session_id: belief.scope.sessionId,
  kind: belief.kind,
  proposition: belief.proposition,
  paths: belief.paths,
  entities: belief.entities,
  valid_at: belief.validAt,
  invalid_at: belief.invalidAt,
  importance: Math.round(belief.importance * 100),
  confidence: Math.round(belief.confidence * 100),
  misses: belief.misses,
  seen_at: belief.seenAt,
  superseded_by: belief.supersededBy,
  contradicts: belief.contradicts,
  provenance: belief.provenance,
})

const decode = (row: typeof MemoryBeliefTable.$inferSelect): Belief => ({
  id: row.id,
  scope: {
    projectKey: row.project_key,
    ...(row.persona_id ? { personaId: row.persona_id } : {}),
    ...(row.session_id ? { sessionId: row.session_id } : {}),
  },
  kind: row.kind,
  proposition: row.proposition,
  paths: row.paths,
  entities: row.entities,
  validAt: row.valid_at,
  ...(row.invalid_at != null ? { invalidAt: row.invalid_at } : {}),
  importance: row.importance / 100,
  confidence: row.confidence / 100,
  misses: row.misses,
  seenAt: row.seen_at,
  ...(row.superseded_by ? { supersededBy: row.superseded_by } : {}),
  contradicts: row.contradicts,
  provenance: row.provenance,
})

const projectScope = (projectKey: string): Scope => ({ projectKey })

export const load = Effect.fn("SessionMemoryStore.load")(function* (projectKey: string, personaId?: string) {
  const database = yield* Database.Service
  const rows = yield* database.db
    .select()
    .from(MemoryBeliefTable)
    .where(
      personaId === undefined
        ? and(eq(MemoryBeliefTable.project_key, projectKey), isNull(MemoryBeliefTable.persona_id))
        : and(eq(MemoryBeliefTable.project_key, projectKey), eq(MemoryBeliefTable.persona_id, personaId)),
    )
    .all()
    .pipe(Effect.orDie)

  return rows.map(decode)
})

/** Unlocked bag rewrite — callers that already hold `withWriteLock` use this. */
const replaceUnlocked = Effect.fn("SessionMemoryStore.replaceUnlocked")(function* (
  projectKey: string,
  beliefs: readonly Belief[],
  personaId?: string,
) {
  const database = yield* Database.Service
  const scopeFilter =
    personaId === undefined
      ? and(eq(MemoryBeliefTable.project_key, projectKey), isNull(MemoryBeliefTable.persona_id))
      : and(eq(MemoryBeliefTable.project_key, projectKey), eq(MemoryBeliefTable.persona_id, personaId))

  yield* database.db.delete(MemoryBeliefTable).where(scopeFilter).run().pipe(Effect.orDie)

  if (beliefs.length > 0) {
    const now = Date.now()
    yield* database.db
      .insert(MemoryBeliefTable)
      .values(beliefs.map((belief) => ({ ...encode(belief), time_created: now, time_updated: now })))
      .run()
      .pipe(Effect.orDie)
  }

  // SiCode: keep entity/edge + vector cache in lockstep with the belief bag (rebuild-on-write).
  yield* syncGraph(projectKey, beliefs)
  yield* syncVectors(projectKey, beliefs)
})

export const replace = Effect.fn("SessionMemoryStore.replace")(function* (
  projectKey: string,
  beliefs: readonly Belief[],
  personaId?: string,
) {
  yield* withWriteLock(projectKey, personaId, replaceUnlocked(projectKey, beliefs, personaId))
})

export const record = Effect.fn("SessionMemoryStore.record")(function* (
  projectKey: string,
  incoming: readonly Belief[],
  personaId?: string,
) {
  if (incoming.length === 0) return yield* load(projectKey, personaId)
  // SiCode: load+merge+replace under one lock so a concurrent remember neither loses the other
  // belief nor races syncVectors' delete/insert (ses_e5d81d66).
  return yield* withWriteLock(
    projectKey,
    personaId,
    Effect.gen(function* () {
      const current = yield* load(projectKey, personaId)
      const next = mergeBeliefs(current, incoming)
      yield* replaceUnlocked(projectKey, next, personaId)
      return next
    }),
  )
})

/**
 * One-shot: if the SQLite bag is empty, lift legacy KV Facts into beliefs and write them.
 * Safe to call on every session start — a non-empty table is left alone.
 */
export const migrateFromKv = Effect.fn("SessionMemoryStore.migrateFromKv")(function* (
  kv: KV.Interface,
  projectKey: string,
) {
  const existing = yield* load(projectKey)
  if (existing.length > 0) return existing

  const legacy = yield* ProjectMemoryStore.load(kv, projectKey)
  if (legacy.length === 0) return []

  const scope = projectScope(projectKey)
  const beliefs = legacy.map((fact) => fromFact(fact, scope))
  // Validate before write so a corrupt KV bag cannot poison the table.
  const decoded = Schema.decodeUnknownOption(Beliefs)(beliefs)
  if (Option.isNone(decoded)) return []

  yield* replace(projectKey, decoded.value)
  return decoded.value
})

/** Fact view for callers not yet on Belief (recall / verify). */
export const loadFacts = Effect.fn("SessionMemoryStore.loadFacts")(function* (projectKey: string) {
  return activeOnly(yield* load(projectKey)).map(toFact)
})

export const recordFacts = Effect.fn("SessionMemoryStore.recordFacts")(function* (
  projectKey: string,
  facts: readonly ReturnType<typeof toFact>[],
) {
  const scope = projectScope(projectKey)
  const beliefs = facts.map((fact) => fromFact(fact, scope))
  const next = yield* record(projectKey, beliefs)
  return activeOnly(next).map(toFact)
})

export const loadPersona = Effect.fn("SessionMemoryStore.loadPersona")(function* (personaId: string) {
  const database = yield* Database.Service
  const rows = yield* database.db
    .select()
    .from(MemoryBeliefTable)
    .where(and(eq(MemoryBeliefTable.project_key, PERSONA_PROJECT_KEY), eq(MemoryBeliefTable.persona_id, personaId)))
    .all()
    .pipe(Effect.orDie)
  return rows.map(decode)
})

export const recordPersona = Effect.fn("SessionMemoryStore.recordPersona")(function* (
  personaId: string,
  incoming: readonly Belief[],
) {
  if (incoming.length === 0) return yield* loadPersona(personaId)
  const scoped = incoming.map((belief) => ({
    ...belief,
    scope: { projectKey: PERSONA_PROJECT_KEY, personaId },
  }))
  return yield* record(PERSONA_PROJECT_KEY, scoped, personaId)
})

/**
 * What a request should see: project facts (no persona) plus optional cross-project persona prefs.
 * Dedupes by id; project rows win on collision.
 */
export const loadForInject = Effect.fn("SessionMemoryStore.loadForInject")(function* (
  projectKey: string,
  personaId?: string,
) {
  const project = yield* load(projectKey)
  if (!personaId) return project
  const persona = yield* loadPersona(personaId)
  const byId = new Map(persona.map((belief) => [belief.id, belief]))
  for (const belief of project) byId.set(belief.id, belief)
  return [...byId.values()]
})

/**
 * Bump path misses / invalidate after MISS_LIMIT. Writes only when something changed.
 * Persona bags are skipped here — preferences rarely name checkout paths.
 */
export const verifyPaths = Effect.fn("SessionMemoryStore.verifyPaths")(function* (
  projectKey: string,
  exists: (path: string) => boolean,
) {
  const current = yield* load(projectKey)
  const { beliefs, dropped } = verifyBeliefs(current, exists)
  const priorById = new Map(current.map((belief) => [belief.id, belief]))
  const changed =
    dropped.length > 0 ||
    current.length !== beliefs.length ||
    beliefs.some((belief) => {
      const prior = priorById.get(belief.id)
      return !prior || prior.misses !== belief.misses || prior.invalidAt !== belief.invalidAt
    })
  if (changed) yield* replace(projectKey, beliefs)
  return { beliefs, dropped }
})

/** Decode helper for tests. */
export const decodeRow = decode
export const encodeBelief = encode
