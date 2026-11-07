/**
 * SiCode: memory Observation — the structural ingress for habits and conventions.
 *
 * Runner / UI / prompts must not hardcode habit keywords. Signals become Observations via
 * policies; Consolidate turns them into Beliefs. Progress chatter never belongs here.
 */
export * as SessionMemoryObservation from "./observation.js"

import { beliefId, PERSONA_PROJECT_KEY, type Belief, type Kind } from "./belief.js"

export type ObservationScope = "persona" | "project"

export type ObservationKind = "preference" | "constraint" | "convention" | "decision"

export type ObservationSource = {
  readonly type: "user" | "compaction" | "tool" | "remember"
  readonly ref?: string
}

export type Observation = {
  readonly scope: ObservationScope
  readonly kind: ObservationKind
  readonly text: string
  /** 0..1 — consolidate maps this into belief confidence/importance. */
  readonly strength: number
  readonly paths?: readonly string[]
  readonly source: ObservationSource
  /** When true, survives OPENCODE_MEMORY_AUTO=0 (explicit remember / tool). */
  readonly explicit?: boolean
}

/** Below this grapheme count, text is progress/ack noise — not a durable habit. */
const MIN_LEN = 5
const MAX_LEN = 200

export const normalizeText = (text: string) =>
  text
    .trim()
    .replace(/[。.]+$/, "")
    .replace(/\s+/g, " ")

export const clampStrength = (value: number) => Math.min(1, Math.max(0, value))

/** Drop empty / progress-shaped noise before it reaches consolidate. Length only. */
export const normalize = (raw: Observation): Observation | undefined => {
  const text = normalizeText(raw.text)
  if ([...text].length < MIN_LEN || text.length > MAX_LEN) return undefined
  return {
    ...raw,
    text,
    strength: clampStrength(raw.strength),
    paths: raw.paths?.map((path) => path.replace(/\\/g, "/")).filter(Boolean),
  }
}

export const normalizeAll = (items: readonly Observation[]): Observation[] => {
  const seen = new Set<string>()
  const out: Observation[] = []
  for (const item of items) {
    const next = normalize(item)
    if (!next) continue
    const key = `${next.scope}\0${next.kind}\0${next.text.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(next)
  }
  return out
}

const kindToBelief = (kind: ObservationKind): Kind => {
  if (kind === "preference" || kind === "decision") return kind
  if (kind === "constraint") return "preference"
  return "context"
}

/** Lift an observation into a Belief under the right scope. */
export const toBelief = (
  observation: Observation,
  input: { readonly personaId?: string; readonly projectKey: string; readonly now?: number },
): Belief | undefined => {
  const clean = normalize(observation)
  if (!clean) return undefined
  const now = input.now ?? Date.now()
  const kind = kindToBelief(clean.kind)
  const scope =
    clean.scope === "persona"
      ? { projectKey: PERSONA_PROJECT_KEY, personaId: input.personaId ?? "local" }
      : { projectKey: input.projectKey }

  if (clean.scope === "persona" && !scope.personaId) return undefined

  return {
    id: beliefId(scope, kind, clean.text),
    scope,
    kind,
    proposition: clean.text,
    paths: [...(clean.paths ?? [])],
    entities: [],
    validAt: now,
    importance: clampStrength(Math.max(0.5, clean.strength)),
    confidence: clampStrength(Math.max(0.5, clean.strength)),
    misses: 0,
    seenAt: now,
    contradicts: [],
    provenance: [clean.source.type, ...(clean.source.ref ? [clean.source.ref] : [])],
  }
}
