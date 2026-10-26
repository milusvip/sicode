export * as GrepTool from "./grep.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { ToolFailure } from "@opencode/ai/effect"
import { Effect, Schema } from "effect"
import path from "path"
import { Environment } from "../../environment/index.js"
import { FileSystem } from "../../filesystem.js"
import { literalQuery, chunkPaths, scopedCandidates, TrigramSearch } from "../../filesystem/trigram-search.js"
import { Location } from "../../location.js"
import { FileAccess } from "../../file-access.js"
import { Permission } from "../../permission.js"
import { Ripgrep } from "../../ripgrep.js"
import { NonNegativeInt, RelativePath } from "../../schema.js"
import { ToolOutput } from "../../tool-output.js"

export const name = "grep"

/**
 * SiCode: cap the rendered text, not just the row count. A single minified bundle or fixture line can
 * dwarf a hundred normal matches, so rows alone do not bound what the model pays for.
 */
export const CHAR_BUDGET = 15_000

const MODES = ["content", "files_with_matches", "count"] as const
export type Mode = (typeof MODES)[number]

export const Input = Schema.Struct({
  pattern: FileSystem.GrepInput.fields.pattern
    .check(Schema.isMinLength(1, { message: "Pattern must not be empty" }))
    .annotate({
      description: "Regular expression or literal text to match in file contents.",
    }),
  path: Schema.optionalKey(RelativePath).annotate({
    description: "File or directory to search. Defaults to the current working directory.",
  }),
  include: FileSystem.GrepInput.fields.include.annotate({
    description: 'Glob pattern to filter files (for example, "*.js" or "*.{ts,tsx}")',
  }),
  literal: FileSystem.GrepInput.fields.literal.annotate({
    description: "Treat `pattern` as exact text instead of a regular expression (default: false).",
  }),
  caseSensitive: FileSystem.GrepInput.fields.caseSensitive.annotate({
    description: "Use case-sensitive matching (default: true).",
  }),
  limit: FileSystem.GrepInput.fields.limit.annotate({
    description: `Maximum number of results in the returned page (default: ${FileSystem.DEFAULT_SEARCH_LIMIT})`,
  }),
  offset: Schema.optionalKey(NonNegativeInt).annotate({
    description:
      "Number of results to skip before the returned page. Use it to walk a large result set instead of re-running a wider search (default: 0).",
  }),
  context: Schema.optionalKey(NonNegativeInt.check(Schema.isLessThanOrEqualTo(50))).annotate({
    description:
      "Lines of context to show before and after each match, so you can read the surrounding code without a follow-up read. Content mode only; output grows by roughly 2*context+1 lines per match (default: 0, max: 50).",
  }),
  mode: Schema.optionalKey(Schema.Literals(MODES)).annotate({
    description:
      'Output mode: "content" shows matching lines (default, supports "context"), "files_with_matches" shows one line per matching file, "count" shows how many matches each file has. When a search might be broad, start with "count" or "files_with_matches" to see its size, then re-run with "content" on a narrowed path.',
  }),
})

export const Output = Schema.Array(FileSystem.Match)
type EncodedOutput = typeof Output.Encoded
/** Row as produced by the search layer: branded paths, before the model-facing text resolves them. */
type Row = { readonly kind: "match" | "context"; readonly match: typeof FileSystem.Match.Type }
/** Row as the formatter reads it: paths already resolved to absolute strings. */
type ContentRow = { readonly kind: "match" | "context"; readonly match: EncodedOutput[number] }

const truncatedNote = (offset: number, shown: number) =>
  `(Results are truncated: showing ${offset + 1}-${offset + shown} of at least ${offset + shown + 1}. Use "offset" to page through the rest, or narrow the search with "path" or "include".)`

/**
 * The truncated text and the count of lines the budget hid. `fullText` is the untouched rendering
 * so the caller can spill it to disk when the hidden lines have no other way back: `offset` pages
 * by match, not by line, so it cannot recover lines dropped from the middle of an already-selected
 * page. A spilled file is the only read-back path for those.
 */
const cap = (text: string): { text: string; hidden: number; fullText: string } => {
  if (text.length <= CHAR_BUDGET) return { text, hidden: 0, fullText: text }
  const lines = text.split("\n")
  const kept: string[] = []
  let used = 0
  for (const line of lines) {
    if (used + line.length + 1 > CHAR_BUDGET) break
    kept.push(line)
    used += line.length + 1
  }
  const hidden = lines.length - kept.length
  return {
    text: [
      ...kept,
      "",
      `(Output capped at ${CHAR_BUDGET} characters; ${hidden} lines hidden. Narrow the search, or page with "offset".)`,
    ].join("\n"),
    hidden,
    fullText: text,
  }
}

/** A rendered page, with the spill the character budget dropped so the caller can save it. */
export type Rendered = { readonly text: string; readonly spill: string | undefined; readonly hidden: number }

/** Format grep rows into model content. Context rows carry a `|` marker instead of `:`. */
export const render = (
  rows: readonly ContentRow[],
  options: { readonly mode: Mode; readonly truncated: boolean; readonly offset: number; readonly pattern: string },
): Rendered => {
  const shown = rows.filter((row) => row.kind === "match").length
  if (rows.length === 0)
    return { text: options.offset === 0 ? "No matches found" : `No results past offset ${options.offset}.`, spill: undefined, hidden: 0 }
  const atLeast = options.truncated ? "at least " : ""

  if (options.mode === "count") {
    const total = rows.reduce((sum, row) => sum + row.match.line, 0)
    // Highest count first: the point of this mode is the distribution, and rg order carries no meaning.
    const ordered = [...rows].sort((a, b) => b.match.line - a.match.line)
    const lines = [`Found ${atLeast}${total} matches in ${rows.length} files`]
    for (const row of ordered) lines.push(`  ${row.match.entry.path}: ${row.match.line}`)
    if (options.truncated) lines.push("", truncatedNote(options.offset, rows.length))
    const capped = cap(lines.join("\n"))
    return { text: capped.text, spill: capped.hidden > 0 ? capped.fullText : undefined, hidden: capped.hidden }
  }

  if (options.mode === "files_with_matches") {
    const lines = [`Found ${atLeast}${rows.length} files with matches`]
    for (const row of rows) {
      const text = row.match.text.trimEnd()
      lines.push(
        `  ${row.match.entry.path}:${row.match.line}: ${text.length > 300 ? text.slice(0, 300) + "..." : text}`,
      )
    }
    if (options.truncated) lines.push("", truncatedNote(options.offset, rows.length))
    const capped = cap(lines.join("\n"))
    return { text: capped.text, spill: capped.hidden > 0 ? capped.fullText : undefined, hidden: capped.hidden }
  }

  // SiCode: group by file and lead with the hit distribution. A flat line list makes the model read
  // files one by one to find out which of them actually matter; the distribution answers that up front.
  const groups = new Map<string, ContentRow[]>()
  for (const row of rows) {
    const file = row.match.entry.path
    const list = groups.get(file)
    if (list) list.push(row)
    else groups.set(file, [row])
  }

  // SiCode: rank files by relevance, not just hit count. A bare hit-count sort lets noise dominate
  // the page: searching `retry` floods with files that mention "retry" five times (config, an OpenAI
  // API param) while `retry.ts` — the thing you actually want — sits at one hit and sinks. Two signals
  // fix that: a filename match outranks any body-only hit, and test/spec/fixture files are demoted so
  // an implementation file beats a `retry.test.ts` that matches on every other line.
  const isTestPath = (file: string) => /(^|\/)(__tests__|test|tests|spec|__mocks__|__fixtures__)(\/|\.|$)/.test(file) || /\.(test|spec)\./.test(file)
  const nameStem = (file: string) => {
    const base = file.slice(file.lastIndexOf("/") + 1)
    return base.replace(/\.(test|spec)\.[^.]+$/, "").replace(/\.[^.]+$/, "")
  }
  // A filename hit is meaningful only for a literal-ish pattern: "retry" matches retry.ts, but a
  // regex like "export const" never names a file, so its stem is empty and the signal is skipped.
  const patternStem = /[\\^$.|?*+()[\]{}]/.test(options.pattern) ? "" : nameStem(options.pattern)
  const ordered = [...groups]
    .map(([file, list]) => ({
      file,
      list,
      count: list.filter((row) => row.kind === "match").length,
      // Rank before count, so a noisy file never buries the implementation that names the pattern.
      // Test/fixture files are demoted hardest: they match on every line and prove nothing about
      // where the behavior lives. 0 = implementation whose filename names the pattern, 1 = any
      // other implementation file, 2 = test/spec/fixture file.
      rank: isTestPath(file)
        ? 2
        : nameStem(file).toLowerCase().includes(patternStem.toLowerCase()) && patternStem.length > 0
          ? 0
          : 1,
    }))
    .sort((a, b) => a.rank - b.rank || b.count - a.count)

  const lines = [`Found ${atLeast}${shown} matches in ${ordered.length} files`]
  // Only worth printing when the hits are concentrated: a flat scatter of one hit per file says nothing.
  if (ordered.length > 1 && (ordered[0]?.count ?? 0) >= 2) {
    const preview = ordered
      .slice(0, 8)
      .map((group) => `${group.file} (${group.count})`)
      .join(", ")
    lines.push(`Files by relevance: ${preview}${ordered.length > 8 ? `, +${ordered.length - 8} more` : ""}`)
  }
  for (const group of ordered) {
    lines.push("", `${group.file}:`)
    for (const row of group.list)
      lines.push(
        row.kind === "match"
          ? `  Line ${row.match.line}: ${row.match.text}`
          : `  Line ${row.match.line} | ${row.match.text}`,
      )
  }
  if (options.truncated) lines.push("", truncatedNote(options.offset, shown))
  const capped = cap(lines.join("\n"))
  return { text: capped.text, spill: capped.hidden > 0 ? capped.fullText : undefined, hidden: capped.hidden }
}

/** Pure string form of `render`, kept for callers that only need the text. */
export const toModelContent = (
  rows: readonly ContentRow[],
  options: { readonly mode: Mode; readonly truncated: boolean; readonly offset: number; readonly pattern: string },
) => render(rows, options).text

/**
 * Content rows interleave context with matches, so a page has to break on match boundaries: a context
 * row always belongs to the match it surrounds, never to a page that happens to start mid-block.
 */
const groupByMatch = (rows: readonly Row[]) => {
  const units: Row[][] = []
  let pending: Row[] = []
  for (const row of rows) {
    if (row.kind === "match") {
      units.push([...pending, row])
      pending = []
    } else if (units.length > 0) {
      units[units.length - 1]!.push(row)
    } else {
      pending.push(row)
    }
  }
  return units
}

/** Grep leaf that defaults its filesystem root to the active Location. */
export const Plugin = {
  id: "opencode.tool.grep",
  effect: Effect.fn("GrepTool.Plugin")(function* (ctx: Context) {
    const environment = yield* Environment.Service
    const ripgrep = yield* Ripgrep.Service
    const trigram = yield* TrigramSearch.Service
    const location = yield* Location.Service
    const access = yield* FileAccess.Service
    const permission = yield* Permission.Service
    const toolOutput = yield* ToolOutput.Service

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description:
            'Search file contents using ripgrep\'s regular expression syntax or literal text matching. Use it to locate specific code, symbols, or text patterns, and narrow searches with `path` or `include`. Output modes: "content" shows matching lines (default, supports `context`), "files_with_matches" shows one line per matching file, "count" shows how many matches each file has. Prefer "count" or "files_with_matches" first when a search might be broad, then re-run with "content" on the files that matter.',
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              const source = { type: "tool" as const, messageID: context.messageID, id: context.id }
              const target = yield* access.resolve({ path: input.path ?? "." })
              yield* access.authorizeExternal([target], context)
              yield* permission.assert({
                action: name,
                resources: [input.pattern],
                save: ["*"],
                metadata: {
                  root: ".",
                  path: input.path,
                  include: input.include,
                  literal: input.literal,
                  caseSensitive: input.caseSensitive,
                  limit: input.limit,
                  offset: input.offset,
                  mode: input.mode,
                },
                sessionID: context.sessionID,
                agent: context.agent,
                source,
              })
              const root = target.absolute
              const type = yield* Environment.typeFollowing(environment.files, root).pipe(
                Effect.catchTag("Environment.NotFound", () =>
                  Effect.fail(new ToolFailure({ message: `Search path does not exist: ${input.path ?? "."}` })),
                ),
              )
              const cwd = type === "directory" ? root : path.dirname(root)
              const mode = input.mode ?? "content"
              const limit = input.limit ?? FileSystem.DEFAULT_SEARCH_LIMIT
              const offset = input.offset ?? 0
              const wanted = offset + limit
              // SiCode: two-stage search. Stage one asks the trigram index which files could
              // contain the pattern as literal text; stage two runs rg over just those files.
              // Any doubt — regex pattern, index still building, huge candidate set, search
              // outside the indexed root — falls back to a full sweep, so the fast path only
              // changes speed, never results.
              const literal = type === "directory" ? literalQuery(input.pattern, input.literal) : null
              const global = literal ? yield* trigram.candidates(literal) : null
              const candidates = global ? scopedCandidates(global, cwd, location.directory) : null
              const chunks = candidates ? chunkPaths(candidates) : undefined
              // Rebase a cwd-relative path onto the location root, as every source of rows must.
              const rebase = (entryPath: string) =>
                RelativePath.make(path.relative(location.directory, path.resolve(cwd, entryPath)))
              const sweep = (paths?: readonly string[]) =>
                ripgrep
                  .grep({
                    cwd,
                    pattern: input.pattern,
                    file: type === "file" ? path.basename(root) : undefined,
                    paths,
                    include: input.include,
                    literal: input.literal,
                    caseSensitive: input.caseSensitive,
                    context: mode === "content" ? input.context : undefined,
                    mode: mode === "files_with_matches" ? "files" : mode,
                    // One row past the page is what tells us whether anything remains.
                    limit: wanted + 1,
                  })
                  .pipe(
                    Effect.timeoutOrElse({
                      duration: FileSystem.DEFAULT_SEARCH_TIMEOUT_MS,
                      orElse: () =>
                        Effect.fail(
                          new ToolFailure({
                            message: `Search timed out after ${FileSystem.DEFAULT_SEARCH_TIMEOUT_MS / 1_000} seconds. Consider using a more specific path or pattern.`,
                          }),
                        ),
                    }),
                    Effect.map((result) =>
                      result.map((row) => ({
                        kind: row.kind,
                        match: FileSystem.Match.make({
                          ...row.match,
                          entry: FileSystem.Entry.make({
                            ...row.match.entry,
                            path: rebase(row.match.entry.path),
                          }),
                        }),
                      })),
                    ),
                  )
              let rows: Ripgrep.GrepRow[] = []
              // SiCode: in-process literal match. For a small candidate set of literal content
              // (or files) searches without context, reading the candidates and scanning in
              // memory skips the ~150ms ripgrep process startup, cutting a rare-symbol search
              // from ~200ms to ~30ms. Regex, count mode, context, and oversized candidate sets
              // keep the rg path — same results, only faster.
              const useInMemory =
                literal !== null &&
                chunks !== undefined &&
                candidates !== null &&
                candidates.length > 0 &&
                candidates.length <= TrigramSearch.IN_MEMORY_MATCH_MAX_FILES &&
                (mode === "content" || mode === "files_with_matches") &&
                !input.context &&
                !input.include
              if (useInMemory) {
                rows = [
                  ...(yield* TrigramSearch.matchLiteralInMemory(cwd, candidates, literal, {
                    caseSensitive: input.caseSensitive,
                    mode: mode === "files_with_matches" ? "files" : "content",
                    limit: wanted + 1,
                  }).pipe(
                    Effect.map((result) =>
                      result.map((row) => ({
                        kind: row.kind,
                        match: FileSystem.Match.make({
                          ...row.match,
                          entry: FileSystem.Entry.make({ ...row.match.entry, path: rebase(row.match.entry.path) }),
                        }),
                      })),
                    ),
                  )),
                ]
              } else if (chunks) {
                for (const chunk of chunks) {
                  rows.push(...(yield* sweep(chunk)))
                  const counted = mode === "content" ? groupByMatch(rows).length : rows.length
                  if (counted > wanted) break
                }
              } else {
                rows = [...(yield* sweep())]
              }
              // Content pages break on matches; the other modes are already one row per file.
              const units = mode === "content" ? groupByMatch(rows) : rows.map((row) => [row])
              const page = units.slice(offset, wanted).flat()
              const matches = page.flatMap((row) => (row.kind === "match" ? [row.match] : []))
              return {
                rows: page,
                matches,
                // Count rows carry a per-file total, so the page represents more matches than it has rows.
                total: mode === "count" ? page.reduce((sum, row) => sum + row.match.line, 0) : matches.length,
                truncated: units.length > wanted,
                prefiltered: chunks !== undefined,
              }
            }).pipe(
              Effect.flatMap((result) =>
                Effect.gen(function* () {
                  const rendered = render(
                    result.rows.map((row) => ({
                      kind: row.kind,
                      match: {
                        ...row.match,
                        entry: { ...row.match.entry, path: path.resolve(location.directory, row.match.entry.path) },
                      },
                    })),
                    { mode: input.mode ?? "content", truncated: result.truncated, offset: input.offset ?? 0, pattern: input.pattern },
                  )
                  // SiCode: a character-cap is the one truncation `offset` cannot page back — offset
                  // steps by match, not line, so lines dropped from the middle of a selected page are
                  // gone for good. Spill the full rendering to a retained file and point the model at
                  // it, so a re-run is not the only way to recover them.
                  let content = rendered.text
                  if (rendered.spill !== undefined) {
                    const file = yield* toolOutput.save(Buffer.from(rendered.spill, "utf8"), ".txt")
                    content += `\n\n[Full results saved to ${file}; read it to see the ${rendered.hidden} hidden lines]`
                  }
                  return {
                    output: result.matches,
                    content,
                    metadata: {
                      matches: result.total,
                      truncated: result.truncated,
                      mode: input.mode ?? "content",
                      prefiltered: result.prefiltered,
                    },
                  }
                }),
              ),
              Effect.mapError((error) =>
                error instanceof ToolFailure
                  ? error
                  : error instanceof Ripgrep.InvalidPatternError
                    ? new ToolFailure({ message: `Invalid regex pattern: ${error.message}` })
                    : new ToolFailure({ message: `Unable to grep for ${input.pattern}`, error }),
              ),
            ),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
