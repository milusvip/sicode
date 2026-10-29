export * as CallGraphTool from "./callgraph.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import { Location } from "../../location.js"
import { RepoMap } from "../../repo-map/index.js"

export const name = "callgraph"

const KINDS = ["callers", "callees", "impact"] as const

export const Input = Schema.Struct({
  kind: Schema.Literals(KINDS).annotate({
    description:
      '"callers" lists files that call a symbol; "callees" lists what a file calls; "impact" lists every file a change to a symbol reaches (its callers, then their callers, transitively).',
  }),
  name: Schema.String.annotate({
    description:
      'A symbol name (for "callers" or "impact"), or a file path (for "callees").',
  }),
})

export const Output = Schema.String

/**
 * SiCode: structure queries over the repo map's call graph. The model gets the same "who calls
 * this / what does this call / what breaks if I change it" answers a type-aware IDE gives, but
 * derived from tree-sitter names — cheap and available with no language server. It is an
 * approximation by design: overloads and dynamic dispatch resolve by name, so treat the answer as
 * a lead, not a proof, and confirm with a read before editing.
 */
export const Plugin = {
  id: "opencode.tool.callgraph",
  effect: Effect.fn("CallGraphTool.Plugin")(function* (ctx: Context) {
    const location = yield* Location.Service

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description:
            "Ask who calls a symbol (callers), what a file calls (callees), or what changing a symbol reaches (impact). Matches by name from the parsed sources, so it is instant but approximate: confirm with a read before relying on it. Use it to trace a call chain or judge the blast radius of a change instead of grepping and reading file by file.",
          input: Input,
          output: Output,
          execute: (input) =>
            Effect.gen(function* () {
              const answer = yield* Effect.tryPromise(() =>
                RepoMap.query(location.directory, { kind: input.kind, name: input.name }),
              ).pipe(Effect.catch(() => Effect.succeed(undefined)))
              if (answer === undefined)
                return {
                  output: answer ?? "",
                  content: "The call graph is still building; search with grep and read in the meantime.",
                  metadata: { kind: input.kind, name: input.name },
                }
              return {
                output: answer,
                content: answer,
                metadata: { kind: input.kind, name: input.name },
              }
            }),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
