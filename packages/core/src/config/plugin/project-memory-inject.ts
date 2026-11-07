export * as ConfigProjectMemoryInjectPlugin from "./project-memory-inject.js"

import { Message } from "@opencode/ai/effect"
import { define } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Effect } from "effect"
import { existsSync } from "fs"
import path from "path"
import { Database } from "../../database/database.js"
import { KV } from "../../kv.js"
import { Location } from "../../location.js"
import { fileOf } from "../../session/project-memory.js"
import { SessionMemoryInject } from "../../session/memory/inject.js"
import { SessionMemoryStore } from "../../session/memory/store.js"

/**
 * SiCode: budgeted project/persona beliefs on every request (Flash will not reliably call recall).
 *
 * The two halves go to different places, because only one of them is stable between turns:
 *
 * - Persona prefs are ordered by importance and recency, so they render identically every request.
 *   They stay in the system prompt, which is the provider's cacheable prefix.
 * - Project facts are BM25-ranked against the latest user text, so their selection changes on every
 *   new turn. Kept in the system prompt they rebuilt the prefix each turn and the turn start missed
 *   the cache for the whole conversation behind it — measured at 39% of turn starts below 50% hit.
 *   They ride the messages instead, the same request-only position `context-hints` and the steer
 *   notes use, where only this block's own tokens are uncached.
 *
 * `OPENCODE_MEMORY_INJECT=0` turns both off for A/B. Persona bag defaults to id `local`
 * (`OPENCODE_PERSONA=0` disables).
 */
export const Plugin = define({
  id: "opencode.config.project-memory-inject",
  effect: Effect.fn(function* (ctx) {
    const kv = yield* KV.Service
    const location = yield* Location.Service
    const database = yield* Database.Service

    yield* ctx.session.hook("context", (event: SessionHooks["context"]) =>
      Effect.gen(function* () {
        if (SessionMemoryInject.envDisabled()) return
        const template = event.system[0]
        if (!template) return

        const directory = location.project.directory
        const personaId = SessionMemoryInject.personaFromEnv()
        yield* SessionMemoryStore.migrateFromKv(kv, directory)
        // SiCode: path freshness used to run only on recall — Flash rarely calls it, so inject
        // kept showing dead paths. Same existsSync check as recall, before the budgeted render.
        yield* SessionMemoryStore.verifyPaths(directory, (relative) =>
          existsSync(path.isAbsolute(relative) ? relative : path.join(directory, fileOf(relative))),
        )
        const beliefs = yield* SessionMemoryStore.loadForInject(directory, personaId)

        const persona = SessionMemoryInject.renderPersona(beliefs)
        if (persona !== "") event.system.push({ ...template, text: persona })

        const project = SessionMemoryInject.renderProject(beliefs, {
          query: SessionMemoryInject.queryFromMessages(event.messages),
        })
        if (project !== "") event.messages.push(Message.system(project))
      }).pipe(
        Effect.provideService(Database.Service, database),
        Effect.catch(() => Effect.void),
      ),
    )
  }),
})
