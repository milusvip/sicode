/**
 * SiCode: syntax errors come back with the tool result that wrote the file.
 *
 * The problem: the model writes a file, never re-reads it, and learns it was malformed several
 * turns later — or never. Measured on this machine over 687 editor calls, 57% touch a file an
 * earlier call had already touched, and 23% of those adjacent pairs revise text the earlier call
 * had introduced. That is the model correcting itself one round trip too late.
 *
 * Why one plugin rather than editing `edit`/`write`/`patch`: `execute.after` fires for every tool
 * and its event is mutable, so the feature stays in one file instead of three copies that drift.
 *
 * Why the result's `content` is rewritten and not only its `metadata`: `to-llm-message.ts` builds
 * the provider message from `state.content` alone. Metadata-only would light up the UI
 * (`tool-renderer.tsx` renders `metadata.diagnostics`) while leaving the model blind, which is the
 * half of the loop that matters.
 */
export * as SyntaxCheckPlugin from "./syntax-check.js"

import { define } from "@opencode/plugin/effect/plugin"
import type { Tool } from "@opencode/schema/tool"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { AppProcess } from "@opencode/util/process"
import { Effect } from "effect"
import { FileAccess } from "../file-access.js"
import { Location } from "../location.js"
import { SyntaxCheckRunner } from "../syntax-check/runner.js"
import type { Diagnostic } from "../syntax-check.js"

/** Tools whose input names a file that was just written. */
const WRITERS = new Set(["edit", "write"])

/** The editor cards render at most three; the extra two exist for the model. */
const MAX_REPORTED = 5

/**
 * `OPENCODE_SYNTAX_CHECK=0` turns the check off. Default on: measured at ~0.3s for the JS family,
 * paid once per written file, to avoid a wasted round trip that costs many seconds of model time.
 */
export const enabled = (environment: NodeJS.ProcessEnv = process.env) => {
  const value = environment.OPENCODE_SYNTAX_CHECK
  if (value === undefined) return true
  return !["0", "false", "no", "off"].includes(value.trim().toLowerCase())
}

export const Plugin = define({
  id: "opencode.syntax.check",
  effect: Effect.fn("SyntaxCheckPlugin")(function* (ctx) {
    if (!enabled()) return

    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const location = yield* Location.Service
    const processes = yield* AppProcess.Service

    yield* ctx.tool.hook("execute.after", (event) =>
      Effect.gen(function* () {
        if (event.status !== "completed") return
        if (!WRITERS.has(event.tool)) return

        const relative = writtenPath(event.input)
        if (relative === undefined) return
        const file = FileAccess.resolvePath(location.directory, relative)

        // Only files this session can see. A path outside the project is the model's business.
        const result = yield* SyntaxCheckRunner.run({
          file,
          processes,
          fs,
          directory: location.directory,
          bin: global.bin,
        }).pipe(Effect.orElseSucceed(() => ({ status: "skipped", reason: "checker failed" }) as const))

        if (result.status !== "errors") return
        event.result = {
          ...event.result,
          content: append(event.result.content, describe(relative, result.diagnostics)),
          metadata: { ...event.result.metadata, diagnostics: wire(relative, result.diagnostics) },
        }
      }),
    )
  }),
})

/** `Tool.Result.content` is a string or a part array; the appended note has to be a part. */
const append = (
  content: Tool.Result["content"],
  text: string,
): ReadonlyArray<Tool.Content> => [
  ...(typeof content === "string" ? [{ type: "text" as const, text: content }] : (content ?? [])),
  { type: "text" as const, text },
]

/** `edit` and `write` both take `path`; `patch` writes many files and is left alone. */
function writtenPath(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined
  const value = (input as { path?: unknown }).path
  return typeof value === "string" && value !== "" ? value : undefined
}

/** Model-facing block, appended to the tool's own result text. */
export const describe = (file: string, diagnostics: readonly Diagnostic[]) =>
  [
    "",
    `${diagnostics.length} syntax error${diagnostics.length === 1 ? "" : "s"} in ${file}:`,
    ...diagnostics
      .slice(0, MAX_REPORTED)
      .map((diagnostic) => `  ${diagnostic.line}:${diagnostic.character} ${diagnostic.message}`),
  ].join("\n")

/** The `metadata.diagnostics` payload, keyed by path, that the editor cards already render. */
export const wire = (file: string, diagnostics: readonly Diagnostic[]) => ({
  [file]: diagnostics.slice(0, MAX_REPORTED).map((diagnostic) => ({
    range: { start: { line: diagnostic.line - 1, character: diagnostic.character - 1 } },
    message: diagnostic.message,
    severity: 1,
  })),
})
