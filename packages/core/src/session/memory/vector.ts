/**
 * SiCode: M4 vector leg over Beliefs — cosine scan (corpus ≤200; HNSW only pays off later).
 *
 * Default path embeds on the fly with feat-hash. When `vectors` is supplied (from
 * `memory_vector` cache) those blobs are reused; dims must match the query vec or the
 * belief falls back to a fresh hash embed. `OPENCODE_MEMORY_VECTOR=0` disables the leg.
 */
export * as SessionMemoryVector from "./vector.js"

import { expand } from "../../search-ranked/concepts.js"
import { cosine, embedText } from "./embed.js"
import { isActive, type Belief } from "./belief.js"

export const envDisabled = () => process.env.OPENCODE_MEMORY_VECTOR === "0"

/** Text the embedder sees for one belief — proposition + paths + entities + kind. */
export const documentOf = (belief: Belief) =>
  [belief.kind, belief.proposition, ...belief.paths, ...belief.entities].filter(Boolean).join(" ")

export type VectorHit = {
  readonly id: string
  readonly score: number
}

export type SearchVectorOptions = {
  readonly asOf?: number
  /** Precomputed belief vectors (same dim as queryVec / hash). */
  readonly vectors?: ReadonlyMap<string, Float32Array>
  /** Override query embedding (tests / alternate recipes). */
  readonly queryVec?: Float32Array
}

/**
 * Rank active beliefs by cosine similarity to the (concept-expanded) query.
 * Returns [] when disabled, empty query, or nothing scores above the floor.
 */
export function searchVector(
  beliefs: readonly Belief[],
  query: string,
  limit = 15,
  asOfOrOptions: number | SearchVectorOptions = Date.now(),
): VectorHit[] {
  if (envDisabled()) return []
  const trimmed = query.trim()
  if (!trimmed) return []

  const options: SearchVectorOptions =
    typeof asOfOrOptions === "number" ? { asOf: asOfOrOptions } : asOfOrOptions
  const asOf = options.asOf ?? Date.now()

  const active = beliefs.filter((belief) => isActive(belief, asOf))
  if (active.length === 0) return []

  // CN→EN on the query side so a Chinese intent can land near English propositions.
  const queryVec = options.queryVec ?? embedText(expand(trimmed))
  const floor = 0.08
  const cached = options.vectors

  return active
    .map((belief) => {
      const cachedVec = cached?.get(belief.id)
      const docVec =
        cachedVec && cachedVec.length === queryVec.length ? cachedVec : embedText(documentOf(belief))
      if (docVec.length !== queryVec.length) return { id: belief.id, score: 0 }
      return { id: belief.id, score: cosine(queryVec, docVec) }
    })
    .filter((hit) => hit.score >= floor)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/** Reciprocal rank fusion across ordered id lists. `k` defaults to 60 (Cormack et al.). */
export function rrf(lists: ReadonlyArray<ReadonlyArray<string>>, k = 60): Map<string, number> {
  const scores = new Map<string, number>()
  for (const list of lists) {
    for (let rank = 0; rank < list.length; rank++) {
      const id = list[rank]!
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1))
    }
  }
  return scores
}
