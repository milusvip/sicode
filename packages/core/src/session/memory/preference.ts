/**
 * SiCode: preference helpers — thin facade over the explicit Observation policy so older call
 * sites keep working. New code should go through Observation → Consolidate.
 */
export * as SessionMemoryPreference from "./preference.js"

import { beliefId, PERSONA_PROJECT_KEY, type Belief } from "./belief.js"
import * as ExplicitPolicy from "./policy/explicit.js"

/** @deprecated Prefer ExplicitPolicy.fromUserText → Consolidate.admit */
export function extractFromUserText(text: string): string[] {
  return ExplicitPolicy.fromUserText(text).map((item) => item.text)
}

/** @deprecated Prefer ExplicitPolicy.fromSummary → Consolidate.admit */
export function extractFromSummary(markdown: string): string[] {
  return ExplicitPolicy.fromSummary(markdown).map((item) => item.text)
}

/** Build preference Beliefs for `recordPersona`. */
export function toBeliefs(personaId: string, propositions: readonly string[], now = Date.now()): Belief[] {
  const scope = { projectKey: PERSONA_PROJECT_KEY, personaId }
  return propositions.map((proposition) => ({
    id: beliefId(scope, "preference", proposition),
    scope,
    kind: "preference" as const,
    proposition,
    paths: [],
    entities: [],
    validAt: now,
    importance: 0.85,
    confidence: 0.85,
    misses: 0,
    seenAt: now,
    contradicts: [],
    provenance: ["user"],
  }))
}
