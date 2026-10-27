/**
 * Model-facing file-write leaf. Relative paths resolve within the active
 * Location. Absolute paths inside that Location are accepted, while explicit
 * absolute external paths retain mutation capability through a separate
 * external_directory approval before edit approval.
 */
export * as WriteTool from "./write.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { ToolFailure } from "@opencode/ai/effect"
import { Effect, Schema } from "effect"
import { FileDiff } from "@opencode/schema/file-diff"
import { Bom } from "@opencode/util/bom"
import { Environment } from "../../environment/index.js"
import { FileMutation } from "../../file-mutation.js"
import { Formatter } from "../../formatter.js"
import { FileAccess } from "../../file-access.js"
import { Location } from "../../location.js"
import { Permission } from "../../permission.js"
import { fileDiff } from "./file-diff.js"

export const name = "write"

// TODO: Revisit whether model-facing mutation schemas should prefer absolute `filePath` naming for trained-in compatibility after evaluating model behavior.
export const Input = Schema.Struct({
  path: Schema.String.annotate({
    description: "Path to the file to write to",
  }),
  content: Schema.String.annotate({ description: "Content to write to the file" }),
})

export const Output = Schema.Struct({
  operation: Schema.Literal("write"),
  target: Schema.String,
  resource: Schema.String,
  existed: Schema.Boolean,
  // SiCode: the write card and the end-of-turn file list read this. Without it both had to rebuild a
  // patch from `input.content`, which cannot tell an overwrite from a create. Optional so writes
  // recorded before this field still decode.
  files: Schema.optionalKey(Schema.Array(FileDiff.Info)),
})
export type Output = typeof Output.Type

export const toModelContent = (output: Output) =>
  `${output.existed ? "Wrote" : "Created"} file successfully: ${output.resource}`

/** Deferred write UX integrations remain visible at the model-facing seam. */
// TODO: Publish watcher/file-edit events after watcher integration exists.
// TODO: Add snapshots / undo after design exists.
// TODO: Add LSP notification and diagnostics after LSP runtime exists.

export const Plugin = {
  id: "opencode.tool.write",
  effect: Effect.fn("WriteTool.Plugin")(function* (ctx: Context) {
    const access = yield* FileAccess.Service
    const fileMutation = yield* FileMutation.Service
    const environment = yield* Environment.Service
    const formatter = yield* Formatter.Service
    const location = yield* Location.Service
    const permission = yield* Permission.Service

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false, permission: "edit" },
          // SiCode: this description is the only guidance the model sees at the moment it decides
          // to create a file. Naming the search-first step there stops it from adding a
          // near-duplicate of something the repo already has; in a tree this large the model only
          // ever sees a slice of it, and "prefer editing" alone does not make it look.
          description:
            "Writes a file to the local filesystem, overwriting if one exists.\n\nMissing parent directories are created automatically.\n\nUse this tool to create new files or overwrite existing files. For partial changes, use the edit tool instead.\n\nBefore creating a file, check that nothing already covers the same job: search with `grep` or `glob`, and extend what you find. A near-duplicate file is the most expensive mistake this tool makes possible.\n\nSiCode: an HTML page written for a human to view (demo, visualization, mock-up) is shown to the user automatically in a side preview panel next to the conversation. Such pages must be responsive: fluid layout, relative units, no fixed widths wider than ~600px, content centered and legible at that size.",
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              const source = {
                type: "tool" as const,
                messageID: context.messageID,
                id: context.id,
              }
              const target = yield* access.resolve({ path: input.path, kind: "file" })
              yield* access.authorizeExternal([target], context)
              const current = yield* FileMutation.readText(environment.files, target.absolute).pipe(
                Effect.catchTag("Environment.NotFound", () => Effect.undefined),
              )
              const next = Bom.split(input.content)
              const preview = fileDiff(target.resource, current?.text ?? "", next.text, current ? "modified" : "added")
              yield* permission.assert({
                action: "edit",
                resources: [target.resource],
                save: ["*"],
                metadata: { files: [preview] },
                sessionID: context.sessionID,
                agent: context.agent,
                source,
              })
              const result = yield* fileMutation.writeTextPreservingBom({ target, content: input.content })
              const bom = (yield* FileMutation.readText(environment.files, target.absolute)).bom
              const formatted = (yield* formatter.file(target.absolute))
                ? yield* FileMutation.syncTextBom(environment.files, target.absolute, bom)
                : (yield* FileMutation.readText(environment.files, target.absolute)).text
              // SiCode: report the diff the way `edit` does — against the formatted result, so the
              // card and the turn's file list show the file's final content and an overwrite reads as
              // `modified` instead of `added`. `preview` above stays the approval-time diff.
              return {
                ...result,
                files: [fileDiff(target.resource, current?.text ?? "", formatted, current ? "modified" : "added")],
              } satisfies Output
            }).pipe(
              // SiCode: hold the same per-path transaction lock edit and patch take. Without it a
              // write can land between an edit's read and its write, and the edit then commits a
              // result computed from the stale content, silently dropping this write.
              fileMutation.withLock([FileAccess.resolvePath(location.directory, input.path)]),
              Effect.map((output) => ({
                output,
                content: toModelContent(output),
                metadata: { files: output.files },
              })),
              Effect.mapError((error) => new ToolFailure({ message: `Unable to write ${input.path}`, error })),
            ),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
