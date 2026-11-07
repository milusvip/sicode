export * as ConfigProjectMemoryPlugin from "./project-memory.js"

import { define } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Effect, Stream } from "effect"
import { Database } from "../../database/database.js"
import { KV } from "../../kv.js"
import { Location } from "../../location.js"
import { parseSummary } from "../../session/project-memory.js"
import { ProjectMemoryStore } from "../../session/project-memory-store.js"
import { SessionMemoryConsolidate } from "../../session/memory/consolidate.js"
import { SessionMemoryInject } from "../../session/memory/inject.js"
import { SessionMemoryStore } from "../../session/memory/store.js"
import * as CollectPolicy from "../../session/memory/policy/collect.js"

/**
 * SiCode: project facts from compaction + Observation→Consolidate for habits/conventions.
 * Structure lives in session/memory/{observation,policy,consolidate}; this plugin only admits.
 */
export const Plugin = define({
  id: "opencode.config.project-memory",
  effect: Effect.fn(function* (ctx) {
    const kv = yield* KV.Service
    const location = yield* Location.Service
    const database = yield* Database.Service
    /** Recent user texts per session — feeds repeated-constraint policy without hardcoding in inject. */
    const recentUserTexts = new Map<string, string[]>()

    const admit = (observations: Parameters<typeof SessionMemoryConsolidate.admitCatching>[0]["observations"]) =>
      SessionMemoryConsolidate.admitCatching({
        observations,
        projectKey: location.project.directory,
        personaId: SessionMemoryInject.personaFromEnv(),
        database,
      })

    yield* ctx.session.hook("prompt", (event: SessionHooks["prompt"]) => {
      const text = event.prompt.text ?? ""
      const prior = recentUserTexts.get(event.sessionID) ?? []
      const observations = CollectPolicy.fromPromptTurn({ text, recentUserTexts: prior })
      const next = [...prior, text].slice(-20)
      recentUserTexts.set(event.sessionID, next)
      return admit(observations)
    })

    yield* ctx.event.subscribe().pipe(
      Stream.filter((event) => event.type === "session.compaction.ended"),
      Stream.runForEach((event) => {
        const facts = parseSummary(event.data.text)
        const directory = location.project.directory
        const observations = CollectPolicy.fromCompactionSummary(event.data.text)
        return SessionMemoryStore.migrateFromKv(kv, directory).pipe(
          Effect.flatMap(() => SessionMemoryStore.recordFacts(directory, facts)),
          Effect.tap(() => ProjectMemoryStore.record(kv, directory, facts)),
          Effect.tap(() => admit(observations)),
          Effect.provideService(Database.Service, database),
          Effect.catchCause((cause) => Effect.logWarning("project memory not recorded", cause)),
        )
      }),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
})
