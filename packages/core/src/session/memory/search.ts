/**
 * SiCode: Belief recall — BM25F (M2) ∥ local vector (M4) ∥ 1-hop entity graph (M5), fused with RRF.
 *
 * Lexical path/symbol hits stay first-class; the vector leg recovers paraphrases; the graph leg
 * pulls in beliefs that share a file/entity with an already-strong hit. Corpus ≤200 → all legs
 * are in-memory. `OPENCODE_MEMORY_VECTOR=0` / `OPENCODE_MEMORY_GRAPH=0` drop those lists.
 *
 * Callers with a warm DB can pass persisted adjacency / cached vectors; otherwise both legs
 * rebuild from the belief bag (feat-hash embed on the fly).
 */
export * as SessionMemorySearch from "./search.js"

import { expand } from "../../search-ranked/concepts.js"
import { rank, type Doc } from "../../search-ranked/score.js"
import { termsOf } from "../../search-ranked/terms.js"
import { isActive, toFact, type Belief } from "./belief.js"
import type { Fact } from "../project-memory.js"
import { buildAdjacency, expandHop, type Adjacency } from "./graph.js"
import { rrf, searchVector } from "./vector.js"

type BeliefField = "path" | "symbol" | "content"

const toDoc = (belief: Belief): Doc => ({
  path: belief.id,
  fields: {
    path: belief.paths.flatMap((path) => termsOf(path)),
    // Entities + kind act as the "symbol" channel: short, high-signal labels.
    symbol: [...belief.entities.flatMap((entity) => termsOf(entity)), ...termsOf(belief.kind)],
    content: termsOf(belief.proposition),
  } satisfies Record<BeliefField, readonly string[]>,
})

export type BeliefWhy = "path" | "symbol" | "content" | "vector" | "graph"

export interface BeliefHit {
  readonly belief: Belief
  readonly score: number
  readonly why: readonly BeliefWhy[]
  /** Peer belief ids this hit conflicts with — never silently drop; callers should surface them. */
  readonly contradicts: readonly string[]
}

export type SearchBeliefsOptions = {
  readonly asOf?: number
  /** Persisted undirected adjacency; falls back to `buildAdjacency`. */
  readonly adjacency?: Adjacency
  /** Cached belief vectors (same dim as the query embed). */
  readonly vectors?: ReadonlyMap<string, Float32Array>
  /** Override query embedding (tests / alternate recipes). */
  readonly queryVec?: Float32Array
}

/**
 * Rank active beliefs for a free-text query. Empty query → empty; no match → empty (caller may
 * fall back to "no memory"). Soft boosts: importance, recency, and a miss penalty.
 */
export function searchBeliefs(
  beliefs: readonly Belief[],
  query: string,
  limit = 5,
  asOfOrOptions: number | SearchBeliefsOptions = Date.now(),
): BeliefHit[] {
  const options: SearchBeliefsOptions =
    typeof asOfOrOptions === "number" ? { asOf: asOfOrOptions } : asOfOrOptions
  const asOf = options.asOf ?? Date.now()

  const trimmed = query.trim()
  if (!trimmed) return []

  const active = beliefs.filter((belief) => isActive(belief, asOf))
  if (active.length === 0) return []

  const byId = new Map(active.map((belief) => [belief.id, belief]))
  const pool = Math.max(limit * 3, 15)
  const expanded = expand(trimmed)

  const lexical = rank(active.map(toDoc), expanded, pool)
  const lexicalWhy = new Map(lexical.map((hit) => [hit.path, hit.why as BeliefWhy[]]))
  const lexicalIds = lexical.map((hit) => hit.path)

  const vector = searchVector(active, trimmed, pool, {
    asOf,
    vectors: options.vectors,
    queryVec: options.queryVec,
  })
  const vectorIds = vector.map((hit) => hit.id)
  const vectorSet = new Set(vectorIds)

  // Graph expands from lexical hits only — neighbors of a word match, not of a soft vector neighbor.
  const adjacency = options.adjacency ?? buildAdjacency(active, asOf)
  const graphIds = expandHop(lexicalIds.slice(0, 5), adjacency, pool)
  const graphSet = new Set(graphIds)

  const fused = rrf([lexicalIds, vectorIds, graphIds])
  if (fused.size === 0) return []

  return [...fused.entries()]
    .flatMap(([id, rrfScore]) => {
      const belief = byId.get(id)
      if (!belief) return []
      const ageDays = Math.max(0, (asOf - belief.seenAt) / 86_400_000)
      const recency = Math.max(0, 1 - ageDays / 30) * 0.1
      // Soft downrank only — contradictory peers stay in the list so the conflict stays visible.
      const conflictPenalty = belief.contradicts.length > 0 ? 0.12 : 0
      const score =
        rrfScore * (0.7 + 0.3 * belief.importance) * (1 + recency) -
        (belief.misses > 0 ? 0.35 : 0) -
        conflictPenalty
      const why: BeliefWhy[] = [...(lexicalWhy.get(id) ?? [])]
      if (vectorSet.has(id) && !why.includes("vector")) why.push("vector")
      if (graphSet.has(id) && !why.includes("graph")) why.push("graph")
      return [{ belief, score, why, contradicts: belief.contradicts }]
    })
    .sort((a, b) => b.score - a.score || b.belief.seenAt - a.belief.seenAt)
    .slice(0, limit)
}

/** Fact-shaped view for `recall` during the transition off project-memory.search. */
export function searchAsFacts(beliefs: readonly Belief[], query: string, limit = 5): Fact[] {
  return searchBeliefs(beliefs, query, limit).map((hit) => toFact(hit.belief))
}
