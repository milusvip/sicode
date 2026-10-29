export * as LspTool from "./lsp.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { ToolFailure } from "@opencode/ai/effect"
import { Deferred, Duration, Effect, Exit, Schema, Scope } from "effect"
import { readFile } from "node:fs/promises"
import path from "path"
import { FileAccess } from "../../file-access.js"
import { Environment } from "../../environment/index.js"
import { LspClient } from "../../lsp/client.js"
import { LspConfig } from "../../lsp/config.js"
import { Location } from "../../location.js"
import { Permission } from "../../permission.js"
import { Config } from "../../config.js"
import { NonNegativeInt, RelativePath } from "../../schema.js"

export const name = "lsp"

/**
 * SiCode: precise symbol navigation backed by a real language server.
 *
 * grep matches text, so `user.name`, `config.name` and `function name` are indistinguishable and
 * a "find callers" question turns into manual triage. A language server has parsed the code, so
 * definition and references are exact. Servers are configured in the `lsp` section of config,
 * spawned lazily on first use per project, and reused across calls; when one exits it is
 * respawned on the next call.
 *
 * Coordinates coming in and going out are 1-based (what the model sees when it reads a file);
 * the client converts to LSP's zero-based positions internally.
 */

/** Most locations a result will list; beyond that the model should narrow with a path. */
const MAX_LOCATIONS = 200
/** How long the diagnostics op waits for a first publish before giving up. */
const DIAGNOSTICS_WAIT_MS = 6_000
const DIAGNOSTICS_POLL = Duration.millis(250)

export const Input = Schema.Struct({
  op: Schema.Literals(["definition", "references", "hover", "diagnostics"]).annotate({
    description:
      "What to look up: \"definition\" finds where the symbol at the position is defined, \"references\" lists every place it is used, \"hover\" shows its type and documentation, \"diagnostics\" reports the server's errors and warnings for the file (line and character not needed).",
  }),
  path: RelativePath.annotate({
    description: "File to operate on, relative to the project root.",
  }),
  line: Schema.optionalKey(NonNegativeInt.check(Schema.isGreaterThanOrEqualTo(1))).annotate({
    description: "Line of the symbol, 1-based (the first line is 1). Required for definition, references and hover.",
  }),
  character: Schema.optionalKey(NonNegativeInt.check(Schema.isGreaterThanOrEqualTo(1))).annotate({
    description:
      "Column of the symbol, 1-based (the first character is 1). Required for definition, references and hover; defaults to 1.",
  }),
})

export const Output = Schema.Struct({
  items: Schema.Array(Schema.String),
})

const SEVERITY = ["", "error", "warning", "info", "hint"] as const

const renderHover = (hover: unknown): string => {
  if (hover === null || hover === undefined) return "No hover information at this position."
  const contents = (hover as { contents?: unknown }).contents
  if (typeof contents === "string") return contents
  if (Array.isArray(contents)) {
    const parts = contents
      .map((part) =>
        typeof part === "string"
          ? part
          : typeof (part as { value?: unknown })?.value === "string"
            ? (part as { value: string }).value
            : "",
      )
      .filter((part) => part.trim() !== "")
    if (parts.length > 0) return parts.join("\n\n")
  }
  if (contents && typeof contents === "object" && typeof (contents as { value?: unknown }).value === "string")
    return (contents as { value: string }).value
  return JSON.stringify(hover, null, 2)
}

/** Registry of running servers, keyed by config name. Lives in the plugin's activation scope. */
interface Entry {
  readonly done: Deferred.Deferred<LspClient.Interface, unknown>
  readonly scope: Scope.Closeable
}

export const Plugin = {
  id: "opencode.tool.lsp",
  effect: Effect.fn("LspTool.Plugin")(function* (ctx: Context) {
    const config = yield* Config.Service
    const location = yield* Location.Service
    const access = yield* FileAccess.Service
    const permission = yield* Permission.Service
    const environment = yield* Environment.Service
    const activation = yield* Effect.scope
    const registry = new Map<string, Entry>()

    const start = Effect.fn("LspTool.start")(function* (
      server: LspConfig.Server,
      done: Deferred.Deferred<LspClient.Interface, unknown>,
      child: Scope.Closeable,
    ) {
      const exit = yield* LspClient.make({
        server: server.name,
        command: server.command,
        cwd: location.directory,
        environment: server.env,
        initialization: server.initialization,
      })
        .pipe(Effect.provideService(Environment.Service, environment), Scope.provide(child), Effect.exit)
      if (Exit.isFailure(exit)) {
        registry.delete(server.name)
        yield* Scope.close(child, Exit.void)
      } else {
        // A dead server removes itself from the registry, so the next call spawns a fresh one.
        // Forked into the activation scope: the request that started this may end before the
        // server dies, and the watcher must outlive it.
        yield* exit.value.exited.pipe(
          Effect.ignore,
          Effect.tap(() => Effect.sync(() => registry.delete(server.name))),
          Effect.flatMap(() => Scope.close(child, Exit.void)),
          Effect.ignore,
          Effect.forkIn(activation),
        )
      }
      yield* Deferred.done(done, exit)
    })

    /** The running server for this config entry, spawning it on first use. */
    const get = Effect.fn("LspTool.get")(function* (server: LspConfig.Server) {
      let entry = registry.get(server.name)
      if (!entry) {
        // Synchronous claim: two concurrent calls must not both spawn.
        const done = Deferred.makeUnsafe<LspClient.Interface, unknown>()
        const child = Scope.makeUnsafe()
        entry = { done, scope: child }
        registry.set(server.name, entry)
        yield* start(server, done, child).pipe(Effect.forkIn(activation))
      }
      return yield* Deferred.await(entry.done)
    })

    const display = (absolute: string) => {
      const relative = path.relative(location.directory, absolute)
      return relative === "" || relative.startsWith("..") ? absolute : relative
    }

    const renderLocations = (noun: string, found: ReadonlyArray<LspClient.LocationResult>) => {
      if (found.length === 0) return [`No ${noun} found.`]
      const lines = [`Found ${found.length} ${noun}${found.length === 1 ? "" : "s"}:`]
      for (const item of found.slice(0, MAX_LOCATIONS)) {
        lines.push(`  ${display(item.path)}:${item.range.start.line + 1}:${item.range.start.character + 1}`)
      }
      if (found.length > MAX_LOCATIONS)
        lines.push(`  (+${found.length - MAX_LOCATIONS} more; narrow the search or read the file instead)`)
      return lines
    }

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description: [
            "Precise symbol navigation using the configured language server, which parses code and understands types.",
            'Operations: "definition" finds where the symbol at a position is defined, "references" lists every place it is used, "hover" shows its type and documentation, "diagnostics" reports the server\'s errors and warnings for a file.',
            "Line and character are 1-based. Unlike grep, results never include same-named symbols from unrelated scopes.",
            'Requires a language server in the config "lsp" section, for example:\n"lsp": { "typescript": { "command": ["typescript-language-server", "--stdio"], "extensions": [".ts", ".tsx"] } }',
          ].join(" "),
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              const target = yield* access.resolve({ path: input.path })
              yield* access.authorizeExternal([target], context)
              yield* permission.assert({
                action: "read",
                resources: [target.absolute],
                save: ["*"],
                metadata: { op: input.op, path: input.path, line: input.line, character: input.character },
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool" as const, messageID: context.messageID, id: context.id },
              })

              const lspConfig = Config.latest(yield* config.entries(), "lsp")
              const selected = lspConfig === undefined ? ("unconfigured" as const) : LspConfig.select(lspConfig, target.absolute)
              if (selected === "disabled")
                return {
                  output: { items: [] },
                  content: 'LSP is disabled in config ("lsp": false). Use grep instead.',
                  metadata: { op: input.op, server: "", count: 0 },
                }
              if (selected === "unconfigured")
                return {
                  output: { items: [] },
                  content: `No language server is configured for ${path.extname(target.absolute) || "this file"}. Configure one in the config "lsp" section, for example: "lsp": { "typescript": { "command": ["typescript-language-server", "--stdio"], "extensions": [".ts", ".tsx"] } }. Use grep instead meanwhile.`,
                  metadata: { op: input.op, server: "", count: 0 },
                }

              if (input.op !== "diagnostics" && (input.line === undefined || input.line < 1))
                return yield* new ToolFailure({
                  message: `The "${input.op}" operation needs a 1-based "line" (and "character") pointing at the symbol.`,
                })
              const position = {
                path: input.path,
                line: (input.line ?? 1) - 1,
                character: (input.character ?? 1) - 1,
              }

              const client = yield* get(selected)
              if (input.op === "hover") {
                const text = renderHover(yield* client.hover(position))
                return { output: { items: [text] }, content: text, metadata: { op: input.op, server: selected.name, count: 1 } }
              }
              if (input.op === "diagnostics") {
                yield* client.sync(input.path, yield* Effect.promise(() => readFile(target.absolute, "utf8")))
                let found: LspClient.Diagnostic[] | undefined = undefined
                for (let attempt = 0; attempt < DIAGNOSTICS_WAIT_MS / 250; attempt++) {
                  const current = yield* client.diagnostics(input.path)
                  if (current !== undefined) {
                    found = current
                    break
                  }
                  yield* Effect.sleep(DIAGNOSTICS_POLL)
                }
                const items = (found ?? []).map(
                  (diagnostic) =>
                    `  ${SEVERITY[diagnostic.severity] ?? "diagnostic"}: ${diagnostic.message} (${input.path}:${diagnostic.range.start.line + 1}:${diagnostic.range.start.character + 1})`,
                )
                const content =
                  found === undefined
                    ? `The server did not report diagnostics for ${input.path} within ${DIAGNOSTICS_WAIT_MS / 1_000}s.`
                    : items.length === 0
                      ? `No diagnostics for ${input.path}: the server reports no errors or warnings.`
                      : `Found ${items.length} diagnostic${items.length === 1 ? "" : "s"}:\n${items.join("\n")}`
                return { output: { items }, content, metadata: { op: input.op, server: selected.name, count: items.length } }
              }

              const found =
                input.op === "definition" ? yield* client.definition(position) : yield* client.references(position)
              const items = renderLocations(input.op === "definition" ? "definition" : "reference", found)
              return {
                output: { items },
                content: items.join("\n"),
                metadata: { op: input.op, server: selected.name, count: found.length },
              }
            }).pipe(
              Effect.mapError((error) =>
                error instanceof ToolFailure
                  ? error
                  : error instanceof LspClient.LspError
                    ? new ToolFailure({ message: error.message })
                    : new ToolFailure({ message: "The lsp tool failed", error }),
              ),
            ),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
