export * as RecallTool from "./recall.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { existsSync } from "fs"
import path from "path"
import { Database } from "../../database/database.js"
import { KV } from "../../kv.js"
import { Location } from "../../location.js"
import { fileOf, Kind } from "../../session/project-memory.js"
import { PERSONA_PROJECT_KEY } from "../../session/memory/belief.js"
import { loadAdjacency } from "../../session/memory/graph-store.js"
import { SessionMemoryInject } from "../../session/memory/inject.js"
import { searchBeliefs } from "../../session/memory/search.js"
import { SessionMemoryStore } from "../../session/memory/store.js"
import { loadVectors } from "../../session/memory/vector-store.js"

export const name = "recall"

export const Input = Schema.Struct({
  query: Schema.String.annotate({
    description: "What you are looking for: a file, an area, or a decision, in your own words",
  }),
  limit: Schema.optionalKey(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(20)).annotate({
      description: "Maximum number of facts to return (default: 5)",
    }),
  ),
})

export const Output = Schema.Array(
  Schema.Struct({
    kind: Kind,
    text: Schema.String,
    paths: Schema.Array(Schema.String),
    /** A recent path check could not find one of its paths; verify before trusting it. */
    stale: Schema.Boolean,
    /** This fact conflicts with another stored memory; both are returned — do not pick silently. */
    conflicts: Schema.Boolean,
  }),
)

type EncodedOutput = typeof Output.Encoded

/** Line-oriented output: the model reads a fact and the path to open, nothing else. */
export const toModelContent = (facts: EncodedOutput, kept: number) => {
  if (facts.length > 0)
    return [
      `${facts.length} of ${kept} memories (project + persona) matched:`,
      ...facts.flatMap((fact) => [
        `- [${fact.kind}] ${fact.text}`,
        ...(fact.paths.length > 0 ? [`  ${fact.paths.join(" ")}`] : []),
        ...(fact.stale ? ["  (a recent check could not find one of these paths; confirm before relying on it)"] : []),
        ...(fact.conflicts ? ["  (conflicts with another memory — verify in the code; do not silently pick one)"] : []),
      ]),
    ].join("\n")

  if (kept === 0) return "This project has no memory yet. Search the code as usual."

  return `No stored fact matches that. ${kept} memories are kept; try another word, use \`remember\` to store one, or search the code as usual.`
}

export const Plugin = {
  id: "opencode.tool.recall",
  effect: Effect.fn("RecallTool.Plugin")(function* (ctx: Context) {
    const kv = yield* KV.Service
    const location = yield* Location.Service
    const database = yield* Database.Service

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description:
            "Search project + persona memory (decisions, file locations, preferences kept from earlier sessions). A hit saves searching; a miss means nothing was recorded. Store new durable facts with `remember`. Prefer this over re-asking the user for preferences already stated.",
          input: Input,
          output: Output,
          execute: (input) =>
            Effect.gen(function* () {
              const directory = location.project.directory
              // SiCode: lift any legacy KV bag once, refresh path freshness, then search.
              yield* SessionMemoryStore.migrateFromKv(kv, directory)
              yield* SessionMemoryStore.verifyPaths(directory, (relative) =>
                existsSync(path.isAbsolute(relative) ? relative : path.join(directory, fileOf(relative))),
              )
              const personaId = SessionMemoryInject.personaFromEnv()
              const beliefs = yield* SessionMemoryStore.loadForInject(directory, personaId)
              // SiCode: prefer persisted graph + vector cache when warm; merge persona scope.
              const adjacency = yield* loadAdjacency(directory, beliefs)
              const { byId: projectVectors } = yield* loadVectors(directory)
              const vectors = new Map(projectVectors)
              if (personaId) {
                const personaAdj = yield* loadAdjacency(PERSONA_PROJECT_KEY, beliefs)
                for (const [id, peers] of personaAdj) {
                  const set = new Set(adjacency.get(id) ?? [])
                  for (const peer of peers) set.add(peer)
                  adjacency.set(id, set)
                }
                const { byId: personaVectors } = yield* loadVectors(PERSONA_PROJECT_KEY)
                for (const [id, vec] of personaVectors) vectors.set(id, vec)
              }
              const hits = searchBeliefs(beliefs, input.query, input.limit ?? 5, {
                adjacency,
                vectors: vectors.size > 0 ? vectors : undefined,
              })
              const facts = hits.map((hit) => ({
                kind:
                  hit.belief.kind === "file" || hit.belief.kind === "decision" || hit.belief.kind === "context"
                    ? hit.belief.kind
                    : ("context" as const),
                text: hit.belief.proposition,
                paths: [...hit.belief.paths],
                stale: hit.belief.misses > 0,
                conflicts: hit.contradicts.length > 0,
              }))

              return {
                output: facts,
                content: toModelContent(facts, beliefs.length),
                metadata: { matches: facts.length, kept: beliefs.length },
              }
            }).pipe(Effect.provideService(Database.Service, database)),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
