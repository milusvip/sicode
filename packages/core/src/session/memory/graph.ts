/**
 * SiCode: M5 light entity graph — derive entities from beliefs, link by shared entity, expand 1 hop.
 *
 * In-memory `buildAdjacency` remains the fallback; `graph-store` persists entity/edge rows on write
 * and `loadAdjacency` feeds search when the table is warm. Corpus ≤200.
 * `OPENCODE_MEMORY_GRAPH=0` disables the hop list at the fusion site.
 */
export * as SessionMemoryGraph from "./graph.js"

import path from "path"
import { isActive, type Belief } from "./belief.js"

export const envDisabled = () => process.env.OPENCODE_MEMORY_GRAPH === "0"

const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "into",
  "when",
  "then",
  "than",
  "file",
  "files",
  "path",
  "kind",
  "type",
  "true",
  "false",
  "null",
])

/** Normalize an entity label for joining (lowercase, strip extension noise). */
export const normalizeEntity = (raw: string) =>
  raw
    .trim()
    .toLowerCase()
    .replace(/\.(tsx?|jsx?|mjs|cjs|md|json)$/i, "")
    .replace(/[^a-z0-9_\u3400-\u9fff.-]+/g, "")

/**
 * Entities a belief "mentions": explicit `entities`, path basenames, and CamelCase / long tokens
 * from the proposition. Short stopwords are dropped.
 */
export function entitiesOf(belief: Belief): readonly string[] {
  const out = new Set<string>()

  for (const entity of belief.entities) {
    const key = normalizeEntity(entity)
    if (key.length >= 2 && !STOP.has(key)) out.add(key)
  }

  for (const file of belief.paths) {
    const base = path.posix.basename(file.replaceAll("\\", "/").split(":")[0] ?? "")
    const key = normalizeEntity(base)
    if (key.length >= 2) out.add(key)
    // session-permission-dock → permission + dock + permission-dock so aliases can join.
    const parts = base
      .split(/[-_.]/)
      .map((part) => normalizeEntity(part))
      .filter((part) => part.length >= 2 && !STOP.has(part))
    for (const part of parts) {
      if (part.length >= 4) out.add(part)
    }
    for (let index = 0; index + 1 < parts.length; index++) {
      const join = `${parts[index]}-${parts[index + 1]}`
      if (join.length >= 4) out.add(join)
    }
  }

  for (const match of belief.proposition.matchAll(/[A-Z]?[a-z]+(?:[A-Z][a-z]+)+|[A-Z]{2,}[a-z]*|[a-z]{4,}/g)) {
    const key = normalizeEntity(match[0] ?? "")
    if (key.length >= 4 && !STOP.has(key)) out.add(key)
  }

  return [...out]
}

export type Adjacency = Map<string, Set<string>>

/** Undirected belief↔belief links when two active beliefs share ≥1 entity. */
export function buildAdjacency(beliefs: readonly Belief[], asOf = Date.now()): Adjacency {
  const active = beliefs.filter((belief) => isActive(belief, asOf))
  const byEntity = new Map<string, string[]>()

  for (const belief of active) {
    for (const entity of entitiesOf(belief)) {
      const list = byEntity.get(entity)
      if (list) list.push(belief.id)
      else byEntity.set(entity, [belief.id])
    }
  }

  const edges = new Map<string, Set<string>>()
  const touch = (a: string, b: string) => {
    if (a === b) return
    const left = edges.get(a) ?? new Set<string>()
    left.add(b)
    edges.set(a, left)
    const right = edges.get(b) ?? new Set<string>()
    right.add(a)
    edges.set(b, right)
  }

  for (const ids of byEntity.values()) {
    if (ids.length < 2) continue
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) touch(ids[i]!, ids[j]!)
    }
  }

  return edges
}

/**
 * 1-hop neighbors of the seed ids, seed order preserved for first touch, capped.
 * Seeds themselves are omitted from the result (they already appear on other legs).
 */
export function expandHop(
  seeds: readonly string[],
  adjacency: Adjacency,
  limit = 15,
): string[] {
  if (envDisabled() || seeds.length === 0) return []
  const seen = new Set(seeds)
  const out: string[] = []
  for (const seed of seeds) {
    const neighbors = adjacency.get(seed)
    if (!neighbors) continue
    for (const neighbor of neighbors) {
      if (seen.has(neighbor)) continue
      seen.add(neighbor)
      out.push(neighbor)
      if (out.length >= limit) return out
    }
  }
  return out
}
