/**
 * SiCode: durable memory beliefs — the M0 contract for project + persona memory.
 *
 * Extends the existing project-memory `Fact` shape with scope, validity, and provenance so later
 * stages (FTS, supersede, inject) have a typed core. Progress (Work State / Next Move) still must
 * not become a belief — that discipline lives in the extractors, not here.
 */
export * as SessionMemoryBelief from "./belief.js"

import { Schema } from "effect"
import { fileOf, MISS_LIMIT, type Fact } from "../project-memory.js"

export const Kind = Schema.Literals(["decision", "file", "context", "preference", "assertion"])
export type Kind = typeof Kind.Type

/**
 * Cross-project persona bag key. Preferences that follow the person (not a checkout) use this
 * `projectKey` plus a `personaId`, so they never collide with a real directory.
 */
export const PERSONA_PROJECT_KEY = ""

/** Where a belief lives. Project facts and cross-project preferences stay apart on purpose. */
export const Scope = Schema.Struct({
  projectKey: Schema.String,
  personaId: Schema.optionalKey(Schema.String),
  sessionId: Schema.optionalKey(Schema.String),
})
export type Scope = typeof Scope.Type

export const Belief = Schema.Struct({
  id: Schema.String,
  scope: Scope,
  kind: Kind,
  /** Atomic proposition; keep short — inject budgets are token-hard. */
  proposition: Schema.String,
  paths: Schema.Array(Schema.String),
  entities: Schema.Array(Schema.String),
  validAt: Schema.Finite,
  invalidAt: Schema.optionalKey(Schema.Finite),
  importance: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1)),
  confidence: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1)),
  misses: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  seenAt: Schema.Finite,
  supersededBy: Schema.optionalKey(Schema.String),
  contradicts: Schema.Array(Schema.String),
  provenance: Schema.Array(Schema.String),
})
export type Belief = typeof Belief.Type

export const Beliefs = Schema.Array(Belief)

/** Still considered true at `asOf` (default: now). */
export function isActive(belief: Belief, asOf = Date.now()) {
  if (belief.invalidAt !== undefined && belief.invalidAt <= asOf) return false
  if (belief.supersededBy !== undefined) return false
  return belief.validAt <= asOf
}

/** Stable id from scope + kind + normalized proposition — same fact re-admitted keeps one row. */
export function beliefId(scope: Scope, kind: Kind, proposition: string) {
  const persona = scope.personaId ?? ""
  return `${scope.projectKey}\u0000${persona}\u0000${kind}\u0000${proposition.toLowerCase().trim()}`
}

/**
 * Lift a legacy project-memory Fact into a Belief under a project scope. Used by M1 migration so
 * existing KV bags are not thrown away.
 */
export function fromFact(fact: Fact, scope: Scope, now = Date.now()): Belief {
  const kind: Kind =
    fact.kind === "decision" || fact.kind === "file" || fact.kind === "context" ? fact.kind : "context"
  return {
    id: beliefId(scope, kind, fact.text),
    scope,
    kind,
    proposition: fact.text,
    paths: [...fact.paths],
    entities: [],
    validAt: fact.seen,
    importance: kind === "decision" ? 0.8 : 0.5,
    confidence: 0.7,
    misses: fact.misses,
    seenAt: fact.seen > 0 ? fact.seen : now,
    contradicts: [],
    provenance: [],
  }
}

/** Narrow Belief back to the Fact shape `recall` / verify still understand during the transition. */
export function toFact(belief: Belief): Fact {
  const kind = belief.kind === "file" || belief.kind === "decision" || belief.kind === "context" ? belief.kind : "context"
  return {
    kind,
    text: belief.proposition,
    paths: belief.paths,
    misses: belief.misses,
    seen: belief.seenAt,
  }
}

/** Active beliefs only, newest confirmation first. */
export function activeOnly(beliefs: readonly Belief[], asOf = Date.now()) {
  return beliefs.filter((belief) => isActive(belief, asOf)).sort((a, b) => b.seenAt - a.seenAt)
}

/** Mark a belief no longer true as of `now` (M3). Idempotent if already invalid. */
export function invalidate(belief: Belief, now = Date.now()): Belief {
  if (belief.invalidAt !== undefined && belief.invalidAt <= now) return belief
  return { ...belief, invalidAt: now }
}

/** Point an older belief at its replacement (M3). Also sets invalidAt. */
export function supersede(older: Belief, replacementId: string, now = Date.now()): Belief {
  return { ...invalidate(older, now), supersededBy: replacementId }
}

/**
 * Mark two active beliefs as unresolved contradictions (M6). Both stay visible; search/inject
 * annotate rather than silently dropping one. Idempotent on repeated links.
 */
export function linkContradicts(left: Belief, right: Belief): [Belief, Belief] {
  if (left.id === right.id) return [left, right]
  const withRight = left.contradicts.includes(right.id) ? left.contradicts : [...left.contradicts, right.id]
  const withLeft = right.contradicts.includes(left.id) ? right.contradicts : [...right.contradicts, left.id]
  return [
    { ...left, contradicts: withRight },
    { ...right, contradicts: withLeft },
  ]
}

/**
 * Same scope + kind + overlapping paths → the new belief replaces the old decision/file fact.
 * Preferences without paths: same kind alone is not enough (too aggressive); only path overlap.
 */
function conflictsWith(prior: Belief, next: Belief) {
  if (prior.id === next.id) return false
  if (prior.kind !== next.kind) return false
  if (prior.scope.projectKey !== next.scope.projectKey) return false
  if ((prior.scope.personaId ?? "") !== (next.scope.personaId ?? "")) return false
  if (prior.paths.length === 0 || next.paths.length === 0) return false
  const nextPaths = new Set(next.paths.map((path) => path.toLowerCase()))
  return prior.paths.some((path) => nextPaths.has(path.toLowerCase()))
}

const PROSE_KINDS = new Set<Kind>(["decision", "preference", "assertion"])

const tokensOf = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9\u3400-\u9fff]+/)
      .filter((token) => token.length >= 3),
  )

const jaccard = (left: Set<string>, right: Set<string>) => {
  if (left.size === 0 || right.size === 0) return 0
  let inter = 0
  for (const token of left) if (right.has(token)) inter++
  return inter / (left.size + right.size - inter)
}

/**
 * Same-kind prose that shares a topic but is not identical — cannot auto-supersede without paths,
 * so mark as contradictory and keep both visible (consolidation step 5).
 */
export function proseContradicts(prior: Belief, next: Belief) {
  if (prior.id === next.id) return false
  if (!PROSE_KINDS.has(prior.kind) || prior.kind !== next.kind) return false
  if (prior.scope.projectKey !== next.scope.projectKey) return false
  if ((prior.scope.personaId ?? "") !== (next.scope.personaId ?? "")) return false
  if (conflictsWith(prior, next)) return false
  if (prior.proposition.toLowerCase().trim() === next.proposition.toLowerCase().trim()) return false
  const overlap = jaccard(tokensOf(prior.proposition), tokensOf(next.proposition))
  return overlap >= 0.34 && overlap < 1
}

const unionStrings = (left: readonly string[] | undefined, right: readonly string[]) => {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of [...(left ?? []), ...right]) {
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

/**
 * Fold incoming into current: same id refreshes seen/misses and *enriches* paths/entities/
 * provenance (confirming a fact must make the bag smarter, not overwrite it); path-overlapping
 * same-kind actives are superseded by the newcomer (M3); overlapping prose without shared paths
 * is linked as a contradiction (M6 consolidation) instead of silently picking a winner.
 */
export function mergeBeliefs(current: readonly Belief[], incoming: readonly Belief[], now = Date.now()): Belief[] {
  const merged = new Map(current.map((belief) => [belief.id, belief]))

  for (const belief of incoming) {
    const prior = merged.get(belief.id)
    const next: Belief = {
      ...belief,
      // SiCode: re-admit is a confirmation — keep the richer of both sides, never drop known paths.
      paths: unionStrings(prior?.paths, belief.paths),
      entities: unionStrings(prior?.entities, belief.entities),
      provenance: unionStrings(prior?.provenance, belief.provenance),
      contradicts: unionStrings(prior?.contradicts, belief.contradicts),
      importance: Math.max(prior?.importance ?? 0, belief.importance),
      confidence: Math.max(prior?.confidence ?? 0, belief.confidence),
      misses: 0,
      seenAt: now,
      validAt: prior?.validAt ?? belief.validAt,
      invalidAt: undefined,
      supersededBy: undefined,
    }
    merged.set(belief.id, next)

    for (const [id, existing] of merged) {
      if (id === next.id) continue
      if (!isActive(existing, now)) continue
      if (conflictsWith(existing, next)) {
        merged.set(id, supersede(existing, next.id, now))
        continue
      }
      if (!proseContradicts(existing, merged.get(next.id)!)) continue
      const [left, right] = linkContradicts(merged.get(id)!, merged.get(next.id)!)
      merged.set(left.id, left)
      merged.set(right.id, right)
    }
  }

  return [...merged.values()].sort((a, b) => b.seenAt - a.seenAt)
}

/**
 * Path freshness for beliefs (same mechanical rule as Fact.verify). Pathless prose is kept.
 * Beliefs that hit MISS_LIMIT are invalidated, not deleted — history stays queryable with asOf.
 */
export function verifyBeliefs(
  beliefs: readonly Belief[],
  exists: (path: string) => boolean,
  now = Date.now(),
): { beliefs: Belief[]; dropped: Belief[] } {
  const next: Belief[] = []
  const dropped: Belief[] = []

  for (const belief of beliefs) {
    if (!isActive(belief, now)) {
      next.push(belief)
      continue
    }
    const missing = belief.paths.length > 0 && belief.paths.some((path) => !exists(fileOf(path)))
    const updated = missing ? { ...belief, misses: belief.misses + 1 } : { ...belief, misses: 0 }
    if (updated.misses >= MISS_LIMIT) {
      const dead = invalidate(updated, now)
      next.push(dead)
      dropped.push(dead)
      continue
    }
    next.push(updated)
  }

  return { beliefs: next, dropped }
}
