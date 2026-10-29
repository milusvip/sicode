export * as GlobTool from "./glob.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Schema } from "effect"
import path from "path"
import { Environment } from "../../environment/index.js"
import { FileSystem } from "../../filesystem.js"
import { Location } from "../../location.js"
import { FileAccess } from "../../file-access.js"
import { Ripgrep } from "../../ripgrep.js"
import { RelativePath } from "../../schema.js"
import { Permission } from "../../permission.js"

export const name = "glob"

export const Input = Schema.Struct({
  pattern: FileSystem.GlobInput.fields.pattern.annotate({ description: "Glob pattern to match files against" }),
  path: Schema.optionalKey(RelativePath).annotate({
    description: "Directory to search. Defaults to the current working directory.",
  }),
  hidden: FileSystem.GlobInput.fields.hidden.annotate({
    description: "Include hidden files and directories (default: false).",
  }),
  limit: FileSystem.GlobInput.fields.limit.annotate({
    description: `Maximum number of matching files to return (default: ${FileSystem.DEFAULT_SEARCH_LIMIT})`,
  }),
})

export const Output = Schema.Array(FileSystem.Entry)
type EncodedOutput = typeof Output.Encoded

/** Format raw search results into the concise line-oriented output models expect. */
export const toModelContent = (entries: EncodedOutput, truncated = false, timedOut?: string) => {
  const lines = entries.length === 0 ? ["No files found"] : entries.map((item) => item.path)
  if (truncated)
    lines.push(
      "",
      `(Results are truncated: showing first ${entries.length} results. Consider using a more specific path or pattern.)`,
    )
  // SiCode: distinguish "this tree has no match" from "the scan never finished". The first means
  // try another name; the second means narrow the root, and the model cannot tell them apart
  // from an empty list.
  if (timedOut !== undefined) lines.push("", `(${timedOut})`)
  return lines.join("\n")
}

/** Glob leaf that defaults its filesystem root to the active Location. */
export const Plugin = {
  id: "opencode.tool.glob",
  effect: Effect.fn("GlobTool.Plugin")(function* (ctx: Context) {
    const environment = yield* Environment.Service
    const ripgrep = yield* Ripgrep.Service
    const location = yield* Location.Service
    const access = yield* FileAccess.Service
    const permission = yield* Permission.Service

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description:
            'Search file paths using a glob pattern (examples: "**/*.ts", "src/**/*.tsx").' +
            // SiCode: an empty match usually means the guessed name was wrong, not that no file exists.
            (process.env.OPENCODE_QEXPAND === "0"
              ? ""
              : " No match usually means the guessed name was wrong: try another wording."),
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              const searchPath = input.path === "undefined" || input.path === "null" ? undefined : input.path
              const source = { type: "tool" as const, messageID: context.messageID, id: context.id }
              const target = yield* access.resolve({ path: searchPath ?? ".", kind: "directory" })
              yield* access.authorizeExternal([target], context)
              yield* permission.assert({
                action: name,
                resources: [input.pattern],
                save: ["*"],
                metadata: {
                  root: searchPath ?? ".",
                  path: searchPath,
                  hidden: input.hidden,
                  limit: input.limit,
                },
                sessionID: context.sessionID,
                agent: context.agent,
                source,
              })
              const type = yield* Environment.typeFollowing(environment.files, target.absolute).pipe(
                Effect.catchTag("Environment.NotFound", () =>
                  Effect.fail(new ToolFailure({ message: `Search path does not exist: ${searchPath ?? "."}` })),
                ),
              )
              if (type !== "directory")
                return yield* Effect.fail(
                  new ToolFailure({ message: `Search path is not a directory: ${searchPath ?? "."}` }),
                )
              const root = target.absolute
              const limit = input.limit ?? FileSystem.DEFAULT_SEARCH_LIMIT
              const swept = yield* ripgrep
                .glob({
                  cwd: root,
                  pattern: input.pattern,
                  hidden: input.hidden,
                  limit: limit + 1,
                  // SiCode: a name search over an unindexed tree is the one that most often runs
                  // long, so it degrades to a partial list instead of failing outright.
                  timeoutMs: FileSystem.DEFAULT_SEARCH_TIMEOUT_MS,
                })
                .pipe(
                  Effect.map((result) => ({
                    entries: result.entries.map((entry) =>
                      FileSystem.Entry.make({
                        ...entry,
                        path: RelativePath.make(path.relative(location.directory, path.resolve(root, entry.path))),
                      }),
                    ),
                    timedOut: result.timedOut,
                  })),
                )
              return {
                entries: swept.entries.slice(0, limit),
                truncated: swept.entries.length > limit,
                timedOut: swept.timedOut,
              }
            }).pipe(
              Effect.map((result) => ({
                output: result.entries,
                content: toModelContent(
                  result.entries.map((entry) => ({ ...entry, path: path.resolve(location.directory, entry.path) })),
                  result.truncated,
                  result.timedOut
                    ? `Search stopped at the ${FileSystem.DEFAULT_SEARCH_TIMEOUT_MS / 1_000}s budget after ` +
                      `${result.entries.length} path${result.entries.length === 1 ? "" : "s"}; this tree is too large to scan whole. ` +
                      `Narrow it with \`path\`, or search the contents instead with \`grep\` and an \`include\` filter.`
                    : undefined,
                ),
                metadata: { count: result.entries.length, truncated: result.truncated, timedOut: result.timedOut },
              })),
              Effect.mapError((error) =>
                error instanceof ToolFailure
                  ? error
                  : new ToolFailure({ message: `Unable to find files matching ${input.pattern}`, error }),
              ),
            ),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
