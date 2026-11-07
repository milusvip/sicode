/**
 * SiCode: Observation → Belief admit. Policies produce observations; this is the only write gate
 * into persona/project bags for auto + explicit memory (aside from the remember tool).
 */
export * as SessionMemoryConsolidate from "./consolidate.js"

import { Effect } from "effect"
import { Database } from "../../database/database.js"
import { normalizeAll, toBelief, type Observation } from "./observation.js"
import { SessionMemoryInject } from "./inject.js"
import { SessionMemoryStore } from "./store.js"

/** Auto policies only — explicit remember / tool still run when this is off. */
export const autoEnabled = () => process.env.OPENCODE_MEMORY_AUTO !== "0"

export const filterForAdmit = (observations: readonly Observation[]): Observation[] => {
  const cleaned = normalizeAll(observations)
  if (autoEnabled()) return cleaned
  return cleaned.filter((item) => item.explicit)
}

/**
 * Persist observations into persona and/or project belief bags.
 * Pure selection is sync; IO is Effect for the store.
 */
export const admit = Effect.fn("SessionMemoryConsolidate.admit")(function* (input: {
  readonly observations: readonly Observation[]
  readonly projectKey: string
  readonly personaId?: string
  readonly now?: number
}) {
  const selected = filterForAdmit(input.observations)
  if (selected.length === 0) return { persona: 0, project: 0 }

  const personaId = input.personaId ?? SessionMemoryInject.personaFromEnv()
  const now = input.now ?? Date.now()

  const personaBeliefs = selected
    .filter((item) => item.scope === "persona")
    .flatMap((item) => {
      const belief = toBelief(item, { personaId, projectKey: input.projectKey, now })
      return belief ? [belief] : []
    })

  const projectBeliefs = selected
    .filter((item) => item.scope === "project")
    .flatMap((item) => {
      const belief = toBelief(item, { projectKey: input.projectKey, now })
      return belief ? [belief] : []
    })

  if (personaBeliefs.length > 0 && personaId) {
    yield* SessionMemoryStore.recordPersona(personaId, personaBeliefs)
  }
  if (projectBeliefs.length > 0) {
    yield* SessionMemoryStore.record(input.projectKey, projectBeliefs)
  }

  return { persona: personaBeliefs.length, project: projectBeliefs.length }
})

export const admitCatching = (input: {
  readonly observations: readonly Observation[]
  readonly projectKey: string
  readonly personaId?: string
  readonly database: Database.Interface
}) =>
  admit({
    observations: input.observations,
    projectKey: input.projectKey,
    personaId: input.personaId,
  }).pipe(
    Effect.provideService(Database.Service, input.database),
    Effect.asVoid,
    Effect.catchCause((cause) => Effect.logWarning("memory observations not admitted", cause)),
  )
