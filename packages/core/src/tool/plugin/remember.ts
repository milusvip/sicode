/**
 * SiCode: M6 explicit memory write — admit a project fact or persona preference without waiting
 * for compaction. Complements passive inject + `recall` (search). Progress chatter must not be
 * written here; keep propositions short and durable.
 */
export * as RememberTool from "./remember.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { ToolFailure } from "@opencode/ai/effect"
import { Effect, Schema } from "effect"
import { Database } from "../../database/database.js"
import { Location } from "../../location.js"
import { beliefId, PERSONA_PROJECT_KEY, type Belief, type Kind } from "../../session/memory/belief.js"
import { SessionMemoryInject } from "../../session/memory/inject.js"
import { SessionMemoryStore } from "../../session/memory/store.js"

export const name = "remember"

const KindInput = Schema.Literals(["decision", "file", "context", "preference", "assertion"])

export const Input = Schema.Struct({
  text: Schema.String.check(Schema.isMinLength(4), Schema.isMaxLength(400)).annotate({
    description: "The durable fact or preference to keep, in one short sentence",
  }),
  kind: Schema.optionalKey(KindInput).annotate({
    description: 'Belief kind (default: "preference" for persona scope, otherwise "context")',
  }),
  paths: Schema.optionalKey(Schema.Array(Schema.String)).annotate({
    description: "File paths this fact depends on, when known",
  }),
  scope: Schema.optionalKey(Schema.Literals(["project", "persona"])).annotate({
    description: 'Where to store it: "project" (this checkout) or "persona" (follows the user). Default: persona for preferences, else project.',
  }),
})

export const Output = Schema.Struct({
  id: Schema.String,
  scope: Schema.Literals(["project", "persona"]),
  kind: KindInput,
  text: Schema.String,
})

type EncodedOutput = typeof Output.Encoded

/** SiCode: tell the model when remember consolidated — otherwise merge stays invisible. */
export const toModelContent = (
  saved: EncodedOutput,
  outcome?: { readonly superseded?: readonly string[]; readonly conflicts?: readonly string[] },
) => {
  const base = `Remembered as ${saved.scope} [${saved.kind}]: ${saved.text}`
  const parts: string[] = []
  if (outcome?.superseded && outcome.superseded.length > 0)
    parts.push(`superseded prior: ${outcome.superseded.map((text) => `"${text}"`).join("; ")}`)
  if (outcome?.conflicts && outcome.conflicts.length > 0)
    parts.push(`conflicts with: ${outcome.conflicts.map((text) => `"${text}"`).join("; ")}`)
  if (parts.length === 0) return base
  return `${base} (${parts.join("; ")})`
}

const outcomeOf = (bag: readonly Belief[], id: string) => {
  const saved = bag.find((belief) => belief.id === id)
  const superseded = bag
    .filter((belief) => belief.supersededBy === id)
    .map((belief) => belief.proposition)
  const conflicts = (saved?.contradicts ?? [])
    .map((peerId) => bag.find((belief) => belief.id === peerId)?.proposition)
    .filter((text): text is string => !!text)
  return { superseded, conflicts }
}

export const Plugin = {
  id: "opencode.tool.remember",
  effect: Effect.fn("RememberTool.Plugin")(function* (ctx: Context) {
    const location = yield* Location.Service
    const database = yield* Database.Service

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description:
            "Store a durable project fact or a cross-project user preference for later sessions. Use when the user says to remember something, or when a decision should outlive this turn. Prefer short propositions; do not store progress, todos, or transient work state. Look up later with `recall`.",
          input: Input,
          output: Output,
          execute: (input) =>
            Effect.gen(function* () {
              const directory = location.project.directory
              const scopeName =
                input.scope ?? (input.kind === "preference" ? "persona" : "project")
              const kind: Kind =
                input.kind ?? (scopeName === "persona" ? "preference" : "context")
              const now = Date.now()
              const paths = input.paths ?? []

              if (scopeName === "persona") {
                const personaId = SessionMemoryInject.personaFromEnv()
                if (!personaId) {
                  return yield* new ToolFailure({
                    message:
                      'Persona memory is disabled (OPENCODE_PERSONA=0). Re-enable it or store with scope "project".',
                  })
                }
                const scope = { projectKey: PERSONA_PROJECT_KEY, personaId }
                const belief: Belief = {
                  id: beliefId(scope, kind, input.text),
                  scope,
                  kind,
                  proposition: input.text,
                  paths,
                  entities: [],
                  validAt: now,
                  importance: kind === "preference" ? 0.85 : 0.7,
                  confidence: 0.9,
                  misses: 0,
                  seenAt: now,
                  contradicts: [],
                  provenance: ["remember"],
                }
                yield* SessionMemoryStore.recordPersona(personaId, [belief])
                const bag = yield* SessionMemoryStore.loadPersona(personaId)
                const outcome = outcomeOf(bag, belief.id)
                const saved = { id: belief.id, scope: "persona" as const, kind, text: input.text }
                return {
                  output: saved,
                  content: toModelContent(saved, outcome),
                  metadata: { stored: true, ...outcome },
                }
              }

              const scope = { projectKey: directory }
              const belief: Belief = {
                id: beliefId(scope, kind, input.text),
                scope,
                kind,
                proposition: input.text,
                paths,
                entities: [],
                validAt: now,
                importance: kind === "decision" ? 0.8 : 0.6,
                confidence: 0.9,
                misses: 0,
                seenAt: now,
                contradicts: [],
                provenance: ["remember"],
              }
              yield* SessionMemoryStore.record(directory, [belief])
              const bag = yield* SessionMemoryStore.load(directory)
              const outcome = outcomeOf(bag, belief.id)
              const saved = { id: belief.id, scope: "project" as const, kind, text: input.text }
              return {
                output: saved,
                content: toModelContent(saved, outcome),
                metadata: { stored: true, ...outcome },
              }
            }).pipe(Effect.provideService(Database.Service, database)),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
