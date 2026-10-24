export * as RecallTool from "./recall.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { KV } from "../../kv.js"
import { Location } from "../../location.js"
import { Kind, search } from "../../session/project-memory.js"
import { ProjectMemoryStore } from "../../session/project-memory-store.js"

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
  }),
)

type EncodedOutput = typeof Output.Encoded

/** Line-oriented output: the model reads a fact and the path to open, nothing else. */
export const toModelContent = (facts: EncodedOutput, kept: number) => {
  if (facts.length > 0)
    return [
      `${facts.length} of ${kept} facts this project kept from earlier compactions:`,
      ...facts.flatMap((fact) => [
        `- [${fact.kind}] ${fact.text}`,
        ...(fact.paths.length > 0 ? [`  ${fact.paths.join(" ")}`] : []),
        ...(fact.stale ? ["  (a recent check could not find one of these paths; confirm before relying on it)"] : []),
      ]),
    ].join("\n")

  if (kept === 0) return "This project has no memory yet. Search the code as usual."

  return `No stored fact matches that. ${kept} facts are kept for this project; try another word, or search the code as usual.`
}

export const Plugin = {
  id: "opencode.tool.recall",
  effect: Effect.fn("RecallTool.Plugin")(function* (ctx: Context) {
    const kv = yield* KV.Service
    const location = yield* Location.Service

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description:
            "Look up what this project already learned about itself: where a thing lives, why a change was made, and which traps were hit. Facts come from earlier compactions of this project, so a hit saves searching. A miss means nothing was recorded, not that the answer does not exist.",
          input: Input,
          output: Output,
          execute: (input) =>
            Effect.gen(function* () {
              const kept = yield* ProjectMemoryStore.load(kv, location.project.directory)
              const facts = search(kept, input.query, input.limit ?? 5).map((fact) => ({
                kind: fact.kind,
                text: fact.text,
                paths: [...fact.paths],
                stale: fact.misses > 0,
              }))

              return {
                output: facts,
                content: toModelContent(facts, kept.length),
                metadata: { matches: facts.length, kept: kept.length },
              }
            }),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
