export * as TrigramSearch from "./trigram-search.js"

// SiCode: two-stage search, stage one. Maintains a persistent trigram index over the
// location's text files and answers "which files could contain this literal?" — a small
// superset that ripgrep then re-checks (stage two lives in the grep tool). Measured on
// this repo (8232 files / 56MB): 10s build, 15MB on disk, 5-85ms per query, versus a
// 3.5-4.4s full rg sweep. The index is a cache: every failure mode resolves to "null",
// meaning "no candidates, search everything".
import { makeLocationNode } from "@opencode/util/effect/app-node"
import crypto from "node:crypto"
import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "path"
import { Context, Deferred, Effect, Exit, Layer, Scope, Stream } from "effect"
import { Match } from "@opencode/schema/filesystem"
import { RelativePath } from "../schema.js"
import { SCHEMA_VERSION, TrigramIndex, NOT_INDEXED, type Fingerprint } from "#trigram"
import { Global } from "@opencode/util/global"
import { Location } from "../location.js"
import { Ripgrep } from "../ripgrep.js"
import { Protected } from "./protected.js"
import { Watcher } from "./watcher.js"

export interface Interface {
  /**
   * Candidate file paths (relative to the location directory) whose indexed text contains
   * every trigram of the query — a superset of the files containing it as a literal.
   * Returns null when prefiltering is unavailable: unsupported platform, no VCS, still
   * building, query shorter than three characters, or more than MAX_CANDIDATES files.
   */
  readonly candidates: (query: string) => Effect.Effect<readonly string[] | null>
  /** Force the initial build to completion. Tests and diagnostics; callers normally rely on the eager background build. */
  readonly buildNow: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/TrigramSearch") {}

/**
 * Above this many candidates a full rg sweep is comparable anyway — skip the prefilter.
 * Measured on this repo: 901 candidates → two-stage 5.6x faster, 2470 → 2.0x, 3377 → 1.3x;
 * the crossover is soft because the grep tool stops at one page (default limit 100), so a
 * broad literal rarely scans all candidates. 3000 keeps the prefilter in the clear win zone
 * while capping the worst-case chunked-rg cost.
 */
export const MAX_CANDIDATES = 3_000
const BUILD_CONCURRENCY = 64
const WATCH_DEBOUNCE_MS = 500

/**
 * The tool passes regex patterns; trigram candidates are only sound for literal text.
 * A pattern with no regex metacharacters matches exactly the literal string, so it is
 * safe to prefilter. Everything else returns null.
 */
const REGEX_META = /[\\^$.|?*+()[\]{}]/
export const literalQuery = (pattern: string, literal?: boolean): string | null =>
  literal || !REGEX_META.test(pattern) ? pattern : null

/**
 * Rebase candidates from the location root to the grep's working directory. Files outside
 * `cwd` are dropped (they cannot match); if `cwd` is not under the root the whole prefilter
 * is abandoned (null) rather than silently widening the search.
 */
export const scopedCandidates = (
  candidates: readonly string[],
  cwd: string,
  root: string,
): readonly string[] | null => {
  if (path.resolve(cwd) === path.resolve(root)) return candidates
  const relative = path.relative(path.resolve(root), path.resolve(cwd))
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null
  const prefix = relative.replaceAll(path.sep, "/") + "/"
  const result = candidates.flatMap((candidate) =>
    candidate.startsWith(prefix) ? [candidate.slice(prefix.length)] : [],
  )
  return result
}

/**
 * Split candidate paths into rg command lines that stay under the OS argument budget.
 * The budget is the Windows CreateProcess command line (32767 UTF-16 chars); chunking at
 * 32000 leaves headroom for the rg flags and pattern. Measured: chunking at ~500 paths is
 * 40-50% faster than ~200 (rg process start/stop dominates the per-chunk cost), so we want
 * as few chunks as the OS will allow.
 */
export const chunkPaths = (paths: readonly string[], maxChars = 32_000): string[][] => {
  const chunks: string[][] = []
  let current: string[] = []
  let used = 0
  for (const item of paths) {
    if (current.length > 0 && used + item.length + 1 > maxChars) {
      chunks.push(current)
      current = []
      used = 0
    }
    current.push(item)
    used += item.length + 1
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

const normalize = (value: string) => value.replaceAll("\\", "/")

/**
 * Above this many candidate files, spawning one ripgrep process is comparable to (or
 * cheaper than) reading and scanning each file in-process, so stage two falls back to rg.
 * Measured on this repo: reading + indexOf over N files costs ~0.3ms/file (85 files ≈ 27ms),
 * while an rg spawn is a flat ~150-160ms on Windows — so the in-process path wins clearly
 * until the candidate set is large enough that rg's native scan outruns the reads.
 */
export const IN_MEMORY_MATCH_MAX_FILES = 120

/**
 * Stage two, fast path: match a literal against a small set of candidate files in-process,
 * avoiding the ~150ms ripgrep process startup on Windows. Sound only for literal text (no
 * regex metacharacters, no context lines, no count aggregation) — the caller guarantees the
 * pattern is a literal and the mode is "content" or "files". Produces the same row shape as
 * ripgrep so downstream formatting is unchanged. Binary or unreadable files are skipped, as
 * rg would.
 */
export const matchLiteralInMemory = (
  cwd: string,
  paths: readonly string[],
  pattern: string,
  options: { readonly caseSensitive?: boolean; readonly mode?: "content" | "files"; readonly limit: number },
): Effect.Effect<readonly Ripgrep.GrepRow[], Ripgrep.Error> =>
  Effect.gen(function* () {
    const needle = options.caseSensitive === false ? pattern.toLowerCase() : pattern
    const limit = options.limit
    const rows: Ripgrep.GrepRow[] = []
    const matchesPerFile = options.mode === "files" ? 1 : Number.POSITIVE_INFINITY

    for (const rawPath of paths) {
      if (rows.length >= limit) break
      const absolute = path.resolve(cwd, rawPath)
      let content: string
      try {
        content = yield* Effect.promise(() => fsp.readFile(absolute, "utf8"))
      } catch {
        continue // unreadable / binary / deleted mid-search: rg would skip it too
      }
      if (content.includes("\0")) continue

      const lines = content.split("\n")
      let matched = 0
      for (let i = 0; i < lines.length && matched < matchesPerFile; i++) {
        const line = lines[i]!
        const haystack = options.caseSensitive === false ? line.toLowerCase() : line
        let from = 0
        let index = haystack.indexOf(needle, from)
        if (index === -1) continue
        const submatches: Array<{ text: string; start: number; end: number }> = []
        while (index !== -1) {
          submatches.push({ text: line.slice(index, index + pattern.length), start: index, end: index + pattern.length })
          from = index + pattern.length
          index = haystack.indexOf(needle, from)
        }
        rows.push({
          kind: "match",
          match: Match.make({
            entry: { path: RelativePath.make(normalize(rawPath)), type: "file" },
            line: i + 1,
            offset: 0,
            text: line.length > 2_000 ? line.slice(0, 2_000) + "..." : line,
            submatches,
          }),
        })
        matched++
        if (rows.length >= limit) break
      }
    }
    return rows
  }).pipe(Effect.orDie)

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const location = yield* Location.Service
    const ripgrep = yield* Ripgrep.Service
    const watcher = yield* Watcher.Service
    const global = yield* Global.Service
    const scope = yield* Scope.Scope

    // Same guards as the fff index: workspace-backed locations resolve in a remote
    // sandbox (the local index would cover the wrong tree), and non-VCS or home
    // directories can be arbitrarily large.
    const enabled =
      !location.workspaceID && !!location.vcs && !Protected.isHome(location.directory)
    if (!enabled)
      return Service.of({ candidates: () => Effect.succeed(null), buildNow: Effect.void })

    const key = crypto.createHash("sha1").update(location.directory).digest("hex")
    const directory = path.join(global.cache, "trigram")
    fs.mkdirSync(directory, { recursive: true })
    const file = path.join(directory, `${key}.db`)

    let index: TrigramIndex | undefined
    let building: Deferred.Deferred<void> | undefined
    let built = false

    const read = (relative: string) =>
      Effect.tryPromise({
        try: () => fsp.readFile(path.join(location.directory, relative), "utf8"),
        catch: () => null,
      }).pipe(Effect.orElseSucceed(() => null))

    const build = Effect.gen(function* () {
      const db = (index ??= TrigramIndex.open({ file }))
      // Enumerate the current file set first: reuse is only sound if the index covers
      // exactly these files. A previous run may have exited before its watcher flushed
      // (crash, kill), so trusting root+version+size alone can silently miss files that
      // changed in that gap — the prefilter would then drop them from candidates and the
      // search would return wrong results. The enumeration is also the rebuild input, so a
      // stale index pays for it once, not twice.
      const entries = yield* ripgrep.find({
        cwd: location.directory,
        pattern: "*",
        // hidden: the grep sweep searches hidden files too (rg adds --hidden), so the
        // index must cover the same set or prefiltered searches would silently miss them.
        hidden: true,
        limit: Number.MAX_SAFE_INTEGER,
      })

      // SiCode: a file edited while no watcher was running keeps its path, so comparing path sets
      // alone reuses trigrams that no longer match the content — and a prefilter running on stale
      // trigrams drops files from candidates, which is a wrong answer, not a slow one. Fingerprint
      // every file instead: stat is ~40ms across 8k files here, against a ~10s rebuild.
      const stats = yield* Effect.forEach(
        entries,
        (entry) =>
          Effect.promise(async (): Promise<readonly [string, Fingerprint] | null> => {
            try {
              const stat = await fsp.stat(path.join(location.directory, entry.path))
              return [normalize(entry.path), { mtimeMs: Math.floor(stat.mtimeMs), size: stat.size }] as const
            } catch {
              return null // vanished between enumeration and stat; treat as absent
            }
          }),
        { concurrency: BUILD_CONCURRENCY, discard: false },
      )
      const current = new Map<string, Fingerprint>()
      for (const item of stats) if (item) current.set(item[0], item[1])

      if (
        db.getMeta("root") === location.directory &&
        db.getMeta("version") === String(SCHEMA_VERSION) &&
        current.size > 0
      ) {
        const stored = db.fingerprints()
        const same =
          stored.size === current.size &&
          [...current].every(([entryPath, now]) => {
            const before = stored.get(entryPath)
            if (!before) return false
            // Enumerated but deliberately not indexed: its bytes can never produce a candidate.
            if (before.mtimeMs === NOT_INDEXED) return true
            // 0 means the row predates fingerprints, so there is nothing to compare against.
            return before.mtimeMs !== 0 && before.mtimeMs === now.mtimeMs && before.size === now.size
          })
        if (same) return
      }

      const contents = yield* Effect.forEach(entries, (entry) => read(entry.path), {
        concurrency: BUILD_CONCURRENCY,
        discard: false,
      })
      const files: Array<readonly [path: string, content: string, fingerprint: Fingerprint]> = []
      for (let i = 0; i < entries.length; i++) {
        const content = contents[i]
        const fingerprint = current.get(normalize(entries[i]!.path))
        if (content === null || !fingerprint) continue
        files.push([entries[i]!.path, content, fingerprint])
      }
      db.replaceAll(files)
      db.setMeta("root", location.directory)
    }).pipe(Effect.orDie)

    /** Start the build if none is running; resolve when one completes. */
    const start = Effect.gen(function* () {
      if (built) return
      if (!building) {
        building = Deferred.makeUnsafe<void>()
        yield build.pipe(
          Effect.onExit((exit) =>
            Effect.sync(() => {
              const success = Exit.isSuccess(exit)
              // Mark built BEFORE completing the deferred: doneUnsafe resumes awaiters
              // synchronously, and they must observe the ready index.
              if (success) built = true
              const pending = building
              building = undefined
              // effect v4: doneUnsafe completes from an Effect, not an Exit.
              if (pending) Deferred.doneUnsafe(pending, success ? Effect.void : Effect.die(exit.cause))
            }),
          ),
          Effect.forkIn(scope),
        )
      }
      yield Deferred.await(building!)
    })

    // Warm the index in the background so a session that starts with greps does not
    // pay the build inside its first tool call. Until it lands, candidates() is null
    // and searches fall back to a full sweep.
    yield* start.pipe(Effect.ignore, Effect.forkIn(scope))

    const flushDirty = (dirty: Set<string>) =>
      Effect.gen(function* () {
        const db = index
        if (!db || dirty.size === 0) return
        const batch = [...dirty]
        dirty.clear()
        for (const raw of batch) {
          const absolute = path.resolve(raw)
          const relative = path.relative(location.directory, absolute)
          if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) continue
          let stats: fs.Stats | undefined
          try {
            stats = fs.statSync(absolute)
          } catch {
            stats = undefined
          }
          if (stats && !stats.isFile()) continue
          if (!stats) {
            db.upsert(normalize(relative), null)
            continue
          }
          const content = yield* read(normalize(relative))
          if (content === null) continue
          // SiCode: record the fingerprint the stat just produced. Writing 0 here would read as
          // "unknown" on the next start and force a full rebuild after any edit.
          db.upsert(normalize(relative), content, { mtimeMs: Math.floor(stats.mtimeMs), size: stats.size })
        }
      }).pipe(Effect.orDie)

    // SiCode: incremental updates from the watcher. Events accumulate in a set and a
    // debounced flush applies them in one pass, so an editor burst costs one upsert
    // round per file instead of one per event.
    const stream = yield* watcher.subscribe({ path: location.directory, type: "directory" })
    const dirty = new Set<string>()
    yield* stream.pipe(
      Stream.tap((event) => Effect.sync(() => dirty.add(event.path))),
      Stream.debounce(WATCH_DEBOUNCE_MS),
      Stream.mapEffect(() => flushDirty(dirty)),
      Stream.runDrain,
      Effect.forkIn(scope),
    )

    return Service.of({
      candidates: (query) =>
        Effect.sync(() => {
          const db = index
          if (!built || !db) return null
          const list = db.candidates(query)
          if (list === null || list.length > MAX_CANDIDATES) return null
          return list
        }),
      buildNow: start,
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Location.node, Ripgrep.node, Watcher.node, Global.node],
})
