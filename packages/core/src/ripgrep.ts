export * as Ripgrep from "./ripgrep.js"

import { Context, Effect, Fiber, Layer, Schema, Stream } from "effect"
import { ChildProcess } from "effect/process"
import { Entry, Match } from "@opencode/schema/filesystem"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { collectStream, waitForAbort } from "@opencode/util/process"
import { Environment } from "./environment/index.js"
import { NonNegativeInt, PositiveInt, RelativePath } from "./schema.js"
import { RipgrepBinary } from "./ripgrep/binary.js"

/**
 * Small core-owned ripgrep execution adapter. It deliberately exposes raw
 * process-oriented rows, not model text or permission behavior. Search maps
 * these rows into filesystem results; leaf tools own
 * presentation and permission prompts.
 */

const ERROR_BYTES = 8 * 1024
const MAX_SUBMATCHES = 100

const RawMatch = Schema.Struct({
  type: Schema.Literals(["match", "context"]),
  data: Schema.Struct({
    path: Schema.Struct({ text: Schema.String }),
    lines: Schema.Struct({ text: Schema.String }),
    line_number: PositiveInt,
    absolute_offset: NonNegativeInt,
    submatches: Schema.Array(
      Schema.Struct({
        match: Schema.Struct({ text: Schema.String }),
        start: NonNegativeInt,
        end: NonNegativeInt,
      }),
    ),
  }),
})
const decodeJsonRecord = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))

type RawMatchData = (typeof RawMatch.Type)["data"]
type RawRow = { kind: "match" | "context" } & RawMatchData

export class Error extends Schema.TaggedError<Error>()("Ripgrep.Error", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export class InvalidPatternError extends Schema.TaggedError<InvalidPatternError>()("Ripgrep.InvalidPatternError", {
  pattern: Schema.String,
  message: Schema.String,
}) {}

export interface FindInput {
  readonly cwd: string
  readonly pattern: string
  readonly limit: number
  readonly exclude?: readonly string[]
  readonly hidden?: boolean
  readonly follow?: boolean
  readonly signal?: AbortSignal
  readonly onEntry?: (entry: Entry) => Effect.Effect<void>
}

export interface GlobInput {
  readonly cwd: string
  readonly pattern: string
  readonly limit: number
  readonly hidden?: boolean
  readonly follow?: boolean
  readonly signal?: AbortSignal
  /** SiCode: stop at this deadline and keep the paths already found. */
  readonly timeoutMs?: number
  /** SiCode: bound the walk. A one-level listing of a huge tree does not need the whole tree. */
  readonly maxDepth?: number
}

export interface GrepInput {
  readonly cwd: string
  readonly pattern: string
  readonly file?: string
  /** SiCode: explicit candidate files (relative to cwd) from the trigram prefilter; bypasses a full sweep. */
  readonly paths?: readonly string[]
  readonly include?: string
  readonly literal?: boolean
  readonly caseSensitive?: boolean
  readonly limit: number
  /** Lines of context to emit before and after each match. Content mode only. */
  readonly context?: number
  /** Row shape: per-line content (default), one row per matching file, or one row per file with its match count. */
  readonly mode?: "content" | "files" | "count"
  readonly signal?: AbortSignal
  /**
   * SiCode: stop scanning at this deadline and return the rows found so far. A scan that is cut short
   * is still an answer; before this, a slow search produced nothing at all.
   */
  readonly timeoutMs?: number
}

/** A grep output row: a match, or a context line pulled in around one. */
export interface GrepRow {
  readonly kind: "match" | "context"
  readonly match: Match
}

export interface Interface {
  readonly find: (input: FindInput) => Effect.Effect<readonly Entry[], Error>
  readonly glob: (
    input: GlobInput,
  ) => Effect.Effect<{ readonly entries: readonly Entry[]; readonly timedOut: boolean }, Error>
  readonly grep: (
    input: GrepInput,
  ) => Effect.Effect<{ readonly rows: readonly GrepRow[]; readonly timedOut: boolean }, Error | InvalidPatternError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Ripgrep") {}

const failure = (message: string, cause?: unknown) => new Error({ message, cause })

const normalizePath = (value: string) =>
  value
    .replace(/^(?:\.[\\/])+/u, "")
    .replace(/^[\\/]+/u, "")
    .replaceAll("\\", "/")

const isInvalidPattern = (stderr: string) =>
  stderr.includes("regex parse error") || stderr.includes("error parsing regex")

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const environment = yield* Environment.Service
    const binary = yield* RipgrepBinary.Service

    /** Rows observed so far and whether a deadline cut the scan short. */
    type RunResult<A> = { readonly rows: A[]; readonly timedOut: boolean }

    const run = <A>(input: {
      readonly cwd: string
      readonly args: string[]
      readonly limit: number
      readonly signal?: AbortSignal
      readonly parse: (line: string) => Effect.Effect<A | undefined, Error>
      readonly pattern?: string
      readonly onItem?: (item: A) => Effect.Effect<void>
      /** SiCode: cut the scan at a deadline but keep what it already found. */
      readonly timeoutMs?: number
    }): Effect.Effect<RunResult<A>, Error | InvalidPatternError> => {
      const program = Effect.scoped(
        Effect.gen(function* () {
          // Hosted environments will resolve rg through their driver image; the spawner is the execution seam.
          const handle = yield* environment.spawner.spawn(
            ChildProcess.make(yield* binary.filepath, input.args, { cwd: input.cwd, extendEnv: true, stdin: "ignore" }),
          )
          const stderrFiber = yield* collectStream(handle.stderr, ERROR_BYTES).pipe(
            Effect.map((output) => output.buffer.toString("utf8")),
            Effect.forkScoped,
          )
          let observed = 0
          // SiCode: a deadline interrupts the collector, and the interruption used to take every
          // decoded row with it — a 30-second search then answered nothing. The buffer outlives the
          // interruption, so running out of time degrades into a partial answer instead.
          const buffer: A[] = []
          const pump = Stream.decodeText(handle.stdout).pipe(
            Stream.splitLines,
            Stream.filter((line) => line.length > 0),
            Stream.mapEffect(input.parse),
            Stream.filter((row): row is A => row !== undefined),
            Stream.tap((row) => {
              buffer.push(row)
              if (!input.onItem || observed++ >= input.limit) return Effect.void
              return input.onItem(row)
            }),
            Stream.take(input.limit + 1),
            Stream.runCollect,
          )
          const collected = yield* (input.timeoutMs === undefined
            ? pump.pipe(Effect.map((rows): RunResult<A> => ({ rows: [...rows], timedOut: false })))
            : pump.pipe(
                Effect.timeoutOption(input.timeoutMs),
                Effect.map(
                  (done): RunResult<A> =>
                    done._tag === "Some"
                      ? { rows: [...done.value], timedOut: false }
                      : { rows: buffer.slice(0, input.limit), timedOut: true },
                ),
              ))
          if (collected.timedOut) return collected

          const rows = collected.rows
          if (rows.length > input.limit) return { rows: rows.slice(0, input.limit), timedOut: false }

          const code = yield* handle.exitCode
          const stderr = yield* Fiber.join(stderrFiber)
          if (input.pattern && code === 2 && isInvalidPattern(stderr)) {
            return yield* new InvalidPatternError({ pattern: input.pattern, message: stderr.trim() })
          }
          if (code !== 0 && code !== 1 && code !== 2) {
            return yield* failure(stderr.trim() || `ripgrep failed with code ${code}`)
          }
          return { rows: code === 1 ? [] : rows, timedOut: false }
        }),
      )
      const abortable = input.signal ? program.pipe(Effect.raceFirst(waitForAbort(input.signal))) : program
      return abortable.pipe(
        Effect.mapError((cause) =>
          cause instanceof Error || cause instanceof InvalidPatternError
            ? cause
            : failure("ripgrep execution failed", cause),
        ),
      )
    }

    return Service.of({
      glob: (input) =>
        run<string>({
          cwd: input.cwd,
          limit: input.limit,
          signal: input.signal,
          timeoutMs: input.timeoutMs,
          args: [
            "--no-config",
            "--files",
            ...(input.hidden ? ["--hidden"] : []),
            ...(input.follow ? ["--follow"] : []),
            ...(input.maxDepth === undefined ? [] : [`--max-depth=${input.maxDepth}`]),
            `--glob=${input.pattern}`,
            // Positive globs override rg's hidden-file filter; exclude before applying the result limit.
            ...(input.hidden ? [] : ["--glob=!**/.*"]),
            "--glob=!**/.git/**",
            ".",
          ],
          parse: (line) => Effect.succeed(normalizePath(line)),
        }).pipe(
          Effect.map((result) => ({
            entries: result.rows.map((relative) =>
              // SiCode: `--files` lists files only — never a directory — so every row here really is
              // one. Directory search derives parent paths from these rows (see GlobTool) instead of
              // pretending rg can report a type it never emits.
              Entry.make({
                path: RelativePath.make(relative),
                type: "file",
              }),
            ),
            timedOut: result.timedOut,
          })),
          Effect.catchTag("Ripgrep.InvalidPatternError", (cause) => Effect.fail(failure(cause.message, cause))),
        ),
      find: (input) =>
        run<Entry>({
          cwd: input.cwd,
          limit: input.limit,
          signal: input.signal,
          args: [
            "--no-config",
            "--files",
            ...(input.hidden ? ["--hidden"] : []),
            ...(input.follow ? ["--follow"] : []),
            ...(input.pattern === "*" ? [] : [`--glob=${input.pattern}`]),
            ...(input.exclude ?? []).map((pattern) => `--glob=!${pattern}`),
            "--glob=!**/.git/**",
            ".",
          ],
          parse: (line) => {
            const relative = normalizePath(line)
            return Effect.succeed(
              Entry.make({
                path: RelativePath.make(relative),
                type: "file",
              }),
            )
          },
          onItem: input.onEntry,
        }).pipe(
          Effect.map((result) => result.rows),
          Effect.catchTag("Ripgrep.InvalidPatternError", (cause) => Effect.fail(failure(cause.message, cause))),
        ),
      grep: (input) => {
        // Count mode answers "how wide is this search?" in one row per matching file, so it skips
        // JSON events entirely and parses rg's plain `path:count` lines.
        if (input.mode === "count")
          return run<string>({
            cwd: input.cwd,
            limit: input.limit,
            signal: input.signal,
            pattern: input.pattern,
            timeoutMs: input.timeoutMs,
            args: [
              "--no-config",
              "--count-matches",
              "--hidden",
              "--no-messages",
              ...(input.literal ? ["--fixed-strings"] : []),
              ...(input.caseSensitive === false ? ["--ignore-case"] : []),
              ...(input.include ? [`--glob=${input.include}`] : []),
              "--glob=!**/.git/**",
              "--",
              input.pattern,
              ...(input.paths && input.paths.length > 0 ? input.paths : [input.file ?? "."]),
            ],
            parse: (line) => {
              const index = line.lastIndexOf(":")
              const count = index === -1 ? Number.NaN : Number.parseInt(line.slice(index + 1), 10)
              if (!Number.isSafeInteger(count) || count <= 0) return Effect.succeed(undefined)
              return Effect.succeed(`${normalizePath(line.slice(0, index))}:${count}`)
            },
          }).pipe(
            Effect.map((result) => ({
              rows: result.rows.map((row) => {
                const index = row.lastIndexOf(":")
                return {
                  kind: "match" as const,
                  match: Match.make({
                    entry: Entry.make({ path: RelativePath.make(row.slice(0, index)), type: "file" }),
                    line: Number.parseInt(row.slice(index + 1), 10),
                    offset: 0,
                    text: "",
                    submatches: [],
                  }),
                }
              }),
              timedOut: result.timedOut,
            })),
          )
        // Files mode emits at most one match per file, so rows map one-to-one onto unique paths.
        const bounded =
          input.mode === "files"
            ? input.limit
            : // Context rows travel in the same stdout stream as matches, so the stream bound
              // has to grow to still observe `limit` matches. The caller trims back to `limit`.
              input.context
              ? input.limit * (input.context * 2 + 1) + 1
              : input.limit
        return run<RawRow>({
          cwd: input.cwd,
          limit: bounded,
          signal: input.signal,
          pattern: input.pattern,
          timeoutMs: input.timeoutMs,
          args: [
            "--no-config",
            "--json",
            "--hidden",
            "--no-messages",
            ...(input.literal ? ["--fixed-strings"] : []),
            ...(input.caseSensitive === false ? ["--ignore-case"] : []),
            ...(input.mode === "files" ? ["--max-count=1"] : []),
            ...(input.context && (input.mode ?? "content") === "content" ? [`--context=${input.context}`] : []),
            ...(input.include ? [`--glob=${input.include}`] : []),
            "--glob=!**/.git/**",
            "--",
            input.pattern,
            ...(input.paths && input.paths.length > 0 ? input.paths : [input.file ?? "."]),
          ],
          parse: (line) =>
            decodeJsonRecord(line).pipe(
              Effect.mapError((cause) => failure("Invalid ripgrep JSON output", cause)),
              Effect.flatMap((json) => {
                if (!json || typeof json !== "object" || !("type" in json)) return Effect.undefined
                if (json.type !== "match" && json.type !== "context") return Effect.undefined
                return Schema.decodeUnknownEffect(RawMatch)(json).pipe(
                  Effect.map((raw) => ({
                    kind: raw.type,
                    ...raw.data,
                    path: { text: normalizePath(raw.data.path.text) },
                    submatches: raw.data.submatches.slice(0, MAX_SUBMATCHES),
                  })),
                  Effect.mapError((cause) => failure("Invalid ripgrep match output", cause)),
                )
              }),
            ),
        }).pipe(
          Effect.map((result) => ({
            rows: result.rows.map((row) => ({
              kind: row.kind,
              match: Match.make({
                entry: Entry.make({
                  path: RelativePath.make(row.path.text),
                  type: "file",
                }),
                line: row.line_number,
                offset: row.absolute_offset,
                text: row.lines.text.length > 2_000 ? row.lines.text.slice(0, 2_000) + "..." : row.lines.text,
                submatches: row.submatches.map((submatch) => ({
                  text: submatch.match.text,
                  start: submatch.start,
                  end: submatch.end,
                })),
              }),
            })),
            timedOut: result.timedOut,
          })),
        )
      },
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Environment.node, RipgrepBinary.node] })
