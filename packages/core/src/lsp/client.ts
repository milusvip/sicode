export * as LspClient from "./client.js"

import { Cause, Data, Deferred, Duration, Effect, Option, Queue, Stream } from "effect"
import { ChildProcess } from "effect/process"
import type { ChildProcessHandle } from "effect/process/ChildProcessSpawner"
import { readFile } from "node:fs/promises"
import path from "path"
import { fileURLToPath, pathToFileURL } from "url"
import { Environment } from "../environment/index.js"
import { LspProtocol } from "./protocol.js"

/**
 * SiCode: a client for one language server process.
 *
 * Process handling mirrors the MCP stdio transport (`../mcp/stdio.ts`): the server is spawned
 * through the location's `Environment` so a workspace-backed location runs it where the rest of
 * its execution happens, and the process is owned by the acquiring scope, so closing that scope
 * kills the whole process group. Differences come from the wire: LSP frames with `Content-Length`
 * instead of newlines, and the handshake is `initialize` → `initialized` before any request.
 *
 * Only what the `lsp` tool needs is implemented: request/response with timeouts,
 * `publishDiagnostics` capture, `didOpen`/`didChange` for file sync, and polite stub replies to
 * the server-originated requests that would otherwise hang some servers (configuration,
 * capability registration, work progress).
 */

/** Long enough for `npx`/`bunx` to resolve and download a server on first run. */
const INITIALIZE_TIMEOUT_MS = 30_000
/** Definition/references/hover are local lookups; if they take this long the server is stuck. */
const REQUEST_TIMEOUT_MS = 15_000
const CLOSE_GRACE = Duration.seconds(2)
const FORCE_KILL_AFTER = Duration.seconds(2)
const OUTGOING_CAPACITY = 64
const STDERR_TAIL = 1_000

export class LspError extends Data.TaggedError("LspError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

/** Zero-based line/character pair, as LSP represents coordinates. */
export interface Position2 {
  readonly line: number
  readonly character: number
}

/** A position in a file, plus the file itself; LSP's native coordinates. */
export interface Position {
  readonly path: string
  readonly line: number
  readonly character: number
}

/** A resolved definition/reference target. Coordinates are zero-based LSP positions. */
export interface LocationResult {
  readonly path: string
  readonly range: { readonly start: Position2; readonly end: Position2 }
}

export interface Diagnostic {
  readonly range: { readonly start: Position2; readonly end: Position2 }
  readonly severity: number
  readonly message: string
}

export interface Options {
  /** Server name; only used to attribute logs and errors. */
  readonly server: string
  /** Command and arguments, exactly as configured, executed in `cwd`. */
  readonly command: readonly string[]
  readonly cwd: string
  readonly environment: Readonly<Record<string, string>>
  readonly initialization: Readonly<Record<string, unknown>>
}

export interface Interface {
  /** Resolve a position to the location(s) that define it, in LSP's native coordinates. */
  readonly definition: (position: Position) => Effect.Effect<Array<LocationResult>, LspError>
  /** Resolve a position to the location(s) that reference it, declaration included. */
  readonly references: (position: Position) => Effect.Effect<Array<LocationResult>, LspError>
  /** Hover information at a position, or null when the server has nothing there. */
  readonly hover: (position: Position) => Effect.Effect<unknown, LspError>
  /** Diagnostics last published for a file, or undefined when none were published yet. */
  readonly diagnostics: (file: string) => Effect.Effect<Array<Diagnostic> | undefined, LspError>
  /** Tell the server the file is open (first call) or replace its text (later calls). */
  readonly sync: (file: string, text: string) => Effect.Effect<void, LspError>
  /** Completes when the server exits, with an error when the exit was not requested. */
  readonly exited: Effect.Effect<void, LspError>
  /** Graceful shutdown, then process kill. Safe to call more than once. */
  readonly close: Effect.Effect<void, never>
}

const LANGUAGE_IDS: Readonly<Record<string, string>> = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "typescriptreact",
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "javascriptreact",
  ".json": "json",
  ".py": "python",
  ".rs": "rust",
  ".go": "go",
  ".rb": "ruby",
  ".java": "java",
  ".cs": "csharp",
  ".css": "css",
  ".html": "html",
  ".md": "markdown",
}

export const languageId = (file: string): string => {
  const dot = file.lastIndexOf(".")
  return LANGUAGE_IDS[dot < 0 ? "" : file.slice(dot).toLowerCase()] ?? "plaintext"
}

/** Stub replies for the server-originated requests this client does not implement. */
const respondToServerRequest = (method: string, params: unknown, rootUri: string): unknown => {
  if (method === "workspace/configuration") {
    const items = (params as { items?: unknown[] } | null)?.items
    return Array.isArray(items) ? items.map(() => null) : []
  }
  if (method === "workspace/applyEdit") return { applied: false }
  if (method === "workspace/workspaceFolders") return rootUri ? [rootUri] : []
  return null
}

export const make = Effect.fnUntraced(function* (options: Options) {
  const environment = yield* Environment.Service
  const rootUri = pathToFileURL(options.cwd).href
  const outgoing = yield* Queue.bounded<string, Cause.Done>(OUTGOING_CAPACITY)
  const pending = new Map<number | string, Deferred.Deferred<unknown, LspError>>()
  const opened = new Set<string>()
  const versions = new Map<string, number>()
  const published = new Map<string, Array<Diagnostic>>()
  const exited = yield* Deferred.make<void, LspError>()
  let nextId = 1
  let closed = false

  const send = (message: LspProtocol.Message) =>
    Queue.offer(outgoing, Buffer.from(LspProtocol.encodeMessage(message)).toString("utf8")).pipe(
      Effect.flatMap((offered) =>
        offered ? Effect.void : Effect.fail(new LspError({ message: "Language server is not connected" })),
      ),
    )

  const notify = (method: string, params: unknown) => Effect.ignore(send({ jsonrpc: "2.0", method, params }))

  const request = (method: string, params: unknown, timeoutMillis: number) =>
    Effect.gen(function* () {
      const id = nextId++
      const done = yield* Deferred.make<unknown, LspError>()
      pending.set(id, done)
      yield* send({ jsonrpc: "2.0", id, method, params }).pipe(
        Effect.catch((error) => Effect.sync(() => void Deferred.fail(done, error))),
      )
      const outcome = yield* Deferred.await(done).pipe(Effect.timeoutOption(Duration.millis(timeoutMillis)))
      pending.delete(id)
      if (Option.isNone(outcome))
        return yield* new LspError({
          message: `Language server did not answer ${method} within ${timeoutMillis / 1_000}s`,
        })
      return outcome.value
    })

  const uriOf = (file: string) => pathToFileURL(path.resolve(options.cwd, file)).href
  const pathOf = (uri: string) => {
    try {
      return fileURLToPath(uri)
    } catch {
      return uri
    }
  }

  const deliver = (message: LspProtocol.Message) =>
    Effect.gen(function* () {
      // A request from the server: answer with the stub so it does not block waiting for us.
      if (message.id !== undefined && message.id !== null && typeof message.method === "string") {
        yield* Effect.ignore(
          send({
            jsonrpc: "2.0",
            id: message.id,
            result: respondToServerRequest(message.method, message.params, rootUri),
          }),
        )
        return
      }
      if (message.id !== undefined && message.id !== null && ("result" in message || "error" in message)) {
        const done = pending.get(message.id as number | string)
        if (!done) return
        pending.delete(message.id as number | string)
        if ("error" in message) {
          const error = message.error as { message?: string } | undefined
          yield* Deferred.fail(done, new LspError({ message: error?.message ?? "Language server rejected the request" }))
          return
        }
        yield* Deferred.succeed(done, message.result)
        return
      }
      if (message.method === "textDocument/publishDiagnostics") {
        const params = message.params as { uri?: string; diagnostics?: Array<Diagnostic> } | null
        if (typeof params?.uri === "string")
          published.set(params.uri, Array.isArray(params.diagnostics) ? params.diagnostics : [])
      }
    })

  const stop = (target: ChildProcessHandle) =>
    Effect.gen(function* () {
      yield* Effect.timeoutOption(target.exitCode, CLOSE_GRACE).pipe(Effect.ignore)
      const terminated = yield* Effect.timeoutOption(target.kill({ killSignal: "SIGTERM" }), FORCE_KILL_AFTER)
      if (terminated._tag === "None") yield* target.kill({ killSignal: "SIGKILL" })
    }).pipe(Effect.ignore)

  let handle: ChildProcessHandle | undefined
  const state: { exited: boolean } = { exited: false }
  const signalExit = (unexpected: boolean) =>
    Effect.gen(function* () {
      state.exited = true
      for (const done of pending.values()) yield* Deferred.fail(done, new LspError({ message: "Language server exited" }))
      pending.clear()
      if (unexpected && !closed)
        yield* Deferred.fail(exited, new LspError({ message: "Language server exited unexpectedly" }))
      else yield* Deferred.succeed(exited, undefined)
    })

  // Spawn, wire the streams, and run the initialize handshake. A failure here fails `make`, and
  // fails `exited` too so the registry that already awaits it learns the server is gone.
  yield* Effect.gen(function* () {
    handle = yield* environment.spawner.spawn(
      ChildProcess.make(options.command[0]!, options.command.slice(1), {
        cwd: options.cwd,
        env: options.environment,
        extendEnv: true,
        stdin: { stream: Stream.encodeText(Stream.fromQueue(outgoing)), endOnDone: true },
        stdout: "pipe",
        stderr: "pipe",
        forceKillAfter: FORCE_KILL_AFTER,
      }),
    )
    let stderr = ""
    yield* Effect.forkScoped(
      handle.stderr.pipe(
        Stream.decodeText(),
        Stream.tap((output) => Effect.sync(() => (stderr = (stderr + output).slice(-STDERR_TAIL)))),
        Stream.runForEach((output) =>
          output.trim() === "" ? Effect.void : Effect.logDebug("lsp server stderr", { server: options.server, output }),
        ),
        Effect.ignore,
      ),
    )
    const decoder = new LspProtocol.FrameDecoder()
    yield* Effect.forkScoped(
      handle.stdout.pipe(
        Stream.runForEach((chunk) =>
          Effect.gen(function* () {
            let frames: Array<LspProtocol.Message>
            try {
              frames = decoder.push(chunk)
            } catch (cause) {
              // A malformed frame means byte-level desync: the connection cannot be trusted after it.
              const error = cause instanceof Error ? cause : new Error(String(cause))
              yield* Effect.logError("lsp server protocol error", { server: options.server, error: error.message })
              yield* signalExit(true)
              return
            }
            yield* Effect.forEach(frames, deliver, { discard: true })
          }),
        ),
        Effect.ignore,
        Effect.ensuring(signalExit(!closed)),
      ),
    )

    yield* request(
      "initialize",
      {
        processId: null,
        rootUri,
        capabilities: {},
        ...(Object.keys(options.initialization).length > 0 ? { initializationOptions: options.initialization } : {}),
      },
      INITIALIZE_TIMEOUT_MS,
    ).pipe(
      Effect.catch((error) =>
        Effect.gen(function* () {
          yield* Effect.logError("lsp server failed to initialize", {
            server: options.server,
            error: error.message,
            stderr: stderr.trim(),
          })
          return yield* Effect.fail(error)
        }),
      ),
    )
    yield* notify("initialized", {})
  }).pipe(
    Effect.tapError((error) =>
      Deferred.fail(exited, new LspError({ message: "Failed to start language server", cause: error })),
    ),
  )

  const assertAlive = Effect.suspend(() =>
    state.exited ? Effect.fail(new LspError({ message: "Language server is not running" })) : Effect.void,
  )

  const sync = (file: string, text: string) =>
    Effect.gen(function* () {
      yield* assertAlive
      const uri = uriOf(file)
      if (opened.has(uri)) {
        const version = (versions.get(uri) ?? 1) + 1
        versions.set(uri, version)
        yield* notify("textDocument/didChange", {
          textDocument: { uri, version },
          // A single whole-document change is valid for both full and incremental sync servers.
          contentChanges: [{ text }],
        })
        return
      }
      opened.add(uri)
      versions.set(uri, 1)
      yield* notify("textDocument/didOpen", {
        textDocument: { uri, languageId: languageId(file), version: 1, text },
      })
    }).pipe(
      Effect.catch((error) =>
        error instanceof LspError ? Effect.fail(error) : Effect.fail(new LspError({ message: "Failed to sync file", cause: error })),
      ),
    )

  const ensureOpen = (position: Position) =>
    Effect.gen(function* () {
      const file = path.resolve(options.cwd, position.path)
      const text = yield* Effect.tryPromise({
        try: () => readFile(file, "utf8"),
        catch: (cause) => new LspError({ message: `Could not read ${position.path}`, cause }),
      })
      yield* sync(position.path, text)
    })

  const locations = (result: unknown): Array<LocationResult> => {
    const single = result as { uri?: string; range?: unknown } | null
    const raw = Array.isArray(result) ? result : single && typeof single.uri === "string" ? [result] : []
    const found: Array<LocationResult> = []
    for (const item of raw) {
      const entry = item as { uri?: string; range?: { start?: Position2; end?: Position2 } } | null
      if (typeof entry?.uri !== "string" || !entry.range?.start) continue
      found.push({
        path: pathOf(entry.uri),
        range: { start: entry.range.start, end: entry.range.end ?? entry.range.start },
      })
    }
    return found
  }

  const lookup = (method: string, position: Position, extra?: Record<string, unknown>) =>
    Effect.gen(function* () {
      yield* assertAlive
      yield* ensureOpen(position)
      return yield* request(
        method,
        {
          textDocument: { uri: uriOf(position.path) },
          position: { line: position.line, character: position.character },
          ...extra,
        },
        REQUEST_TIMEOUT_MS,
      )
    })

  return {
    definition: (position) => lookup("textDocument/definition", position).pipe(Effect.map(locations)),
    references: (position) =>
      lookup("textDocument/references", position, { context: { includeDeclaration: true } }).pipe(Effect.map(locations)),
    hover: (position) => lookup("textDocument/hover", position),
    diagnostics: (file) =>
      Effect.gen(function* () {
        yield* assertAlive
        return published.get(uriOf(file))
      }),
    sync,
    exited: Deferred.await(exited),
    close: Effect.gen(function* () {
      if (closed) return
      closed = true
      if (!state.exited && handle) {
        // Best effort: some servers ignore `shutdown`, so never wait longer than the grace period.
        yield* Effect.ignore(request("shutdown", null, Duration.toMillis(CLOSE_GRACE)))
        yield* Effect.ignore(notify("exit", null))
      }
      Queue.endUnsafe(outgoing)
      if (handle) yield* stop(handle)
    }).pipe(Effect.ignore),
  } satisfies Interface
})
