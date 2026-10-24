export * as ProjectMemoryStore from "./project-memory-store.js"

import { Effect, Option, Schema } from "effect"
import type { KV } from "../kv.js"
import { Facts, merge, verify } from "./project-memory.js"
import type { Fact } from "./project-memory.js"

/** One project's memory: the directory a session works in, so two checkouts of the same repository stay apart. */
export const key = (directory: string) => `project-memory:${directory}`

/**
 * The facts a project keeps. Empty when nothing is stored yet, or when the stored value no longer decodes: a memory
 * this build cannot read is worth less than starting over, and it must never fail the caller's work.
 */
export const load = Effect.fn("ProjectMemory.load")(function* (kv: KV.Interface, directory: string) {
  const stored = yield* kv.get(key(directory))

  return Option.getOrElse(Schema.decodeUnknownOption(Facts)(stored), () => [] as Fact[])
})

/** Folds a summary's facts into the project's memory and returns what it now keeps. */
export const record = Effect.fn("ProjectMemory.record")(function* (
  kv: KV.Interface,
  directory: string,
  facts: readonly Fact[],
) {
  if (facts.length === 0) return yield* load(kv, directory)
  const current = yield* load(kv, directory)
  const next = merge(current, facts)

  yield* kv.set(key(directory), next)

  return next
})

/**
 * Runs a path check over the project's memory and drops what it proves gone. Only writes when something changed, so a
 * project whose files still exist is not rewritten on every check — but a rising miss count is a change: without it a
 * fact could never reach the limit that drops it.
 */
export const check = Effect.fn("ProjectMemory.check")(function* (
  kv: KV.Interface,
  directory: string,
  exists: (path: string) => boolean,
) {
  const current = yield* load(kv, directory)
  const { kept, dropped } = verify(current, exists)
  const misses = (facts: readonly Fact[]) => facts.reduce((total, fact) => total + fact.misses, 0)

  if (dropped.length > 0 || misses(kept) !== misses(current)) yield* kv.set(key(directory), kept)

  return { kept, dropped }
})

/** Forgets everything the project learned. */
export const clear = Effect.fn("ProjectMemory.clear")(function* (kv: KV.Interface, directory: string) {
  yield* kv.remove(key(directory))
})
