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
import { SearchRanked } from "../../search-ranked/index.js"
import { NonNegativeInt, RelativePath } from "../../schema.js"
import { ToolOutput } from "../../tool-output.js"

export const name = "grep"

/**
 * SiCode: cap the rendered text, not just the row count. A single minified bundle or fixture line can
 * dwarf a hundred normal matches, so rows alone do not bound what the model pays for.
 */
export const CHAR_BUDGET = 15_000

/**
 * SiCode: a narrow hit list is the case where the follow-up read is pure overhead — the model has
 * line numbers but not the code around them. Re-running the same search with context costs one
 * candidate sweep (the trigram prefilter already narrowed it) and saves a whole model step (~6s).
 *
 * Only a narrow page qualifies: past `AUTO_CONTEXT_MAX_MATCHES` the surrounding lines would flood
 * the page, and the model should narrow the search first instead.
 */
export const AUTO_CONTEXT_LINES = 3
export const AUTO_CONTEXT_MAX_MATCHES = 8

const MODES = ["content", "files_with_matches", "count"] as const
export type Mode = (typeof MODES)[number]

/** SiCode: cap synonym batches so one tool call cannot fan out into a repo-wide storm. */
export const MAX_GREP_PATTERNS = 8

/**
 * SiCode: Flash often batches synonyms as one regex `a|b|c` instead of `patterns[]`.
 * When every alternative is a plain token (no other regex metacharacters), expand into
 * separate patterns so each synonym gets its own literal/rg pass and metadata.patterns > 1.
 * Real regex (groups, quantifiers, escapes) is left intact.
 */
export const expandPatternAlternation = (pattern: string): readonly string[] => {
  if (!pattern.includes("|")) return [pattern]
  if (/[()[\]{}*+?\\^$]/.test(pattern)) return [pattern]
  const parts = pattern
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  return parts.length > 0 ? parts : [pattern]
}

/**
 * SiCode: `pattern` and/or `patterns` synonyms, de-duplicated, capped. Flash should pass
 * several English/identifier guesses in one call instead of serial empty greps. A plain
 * `a|b|c` pattern counts as the same batch (see `expandPatternAlternation`).
 * `patterns` alone is valid — Flash often omits `pattern` when it already listed synonyms.
 */
export const resolveGrepPatterns = (input: {
  readonly pattern?: string
  readonly patterns?: readonly string[]
}) => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of [input.pattern, ...(input.patterns ?? [])]) {
    if (raw === undefined) continue
    for (const pattern of expandPatternAlternation(raw.trim())) {
      if (pattern.length === 0 || seen.has(pattern)) continue
      seen.add(pattern)
      out.push(pattern)
      if (out.length >= MAX_GREP_PATTERNS) return out
    }
  }
  return out
}

/** SiCode: only a non-empty candidate list may narrow the sweep; [] is treated like null. */
export const usablePrefilter = (candidates: readonly string[] | null) =>
  candidates !== null && candidates.length > 0 ? candidates : null

export const Input = Schema.Struct({
  // SiCode: optional when `patterns` carries the batch — ses_e6ce Flash passed only `patterns` twice
  // and burned steps on "Missing key: pattern". At least one of pattern/patterns must be non-empty.
  pattern: Schema.optionalKey(
    FileSystem.GrepInput.fields.pattern
      .check(Schema.isMinLength(1, { message: "Pattern must not be empty" }))
      .annotate({
        description:
          "Regular expression or literal text to match in file contents. Optional when `patterns` already lists terms. For a plain-language intent, put the best guess here and put synonyms in `patterns` so one call covers them.",
      }),
  ),
  patterns: Schema.optionalKey(
    Schema.Array(Schema.String.check(Schema.isMinLength(1, { message: "Pattern must not be empty" }))).check(
      Schema.isMaxLength(MAX_GREP_PATTERNS, { message: `At most ${MAX_GREP_PATTERNS} patterns` }),
    ),
  ).annotate({
    description: `Literals or regexes to search in the same call (synonyms / camelCase splits / UI strings). May be used alone without \`pattern\`. Combined with \`pattern\` when both are set, de-duplicated, capped at ${MAX_GREP_PATTERNS}. Prefer this over serial greps that each return no matches.`,
  }),
  path: Schema.optionalKey(Schema.String).annotate({
    description:
      "File or directory to search, relative to the workspace or absolute. Defaults to the current working directory. An absolute path outside the workspace asks the user for approval first.",
  }),
  include: FileSystem.GrepInput.fields.include.annotate({
    description: 'Glob pattern to filter files (for example, "*.js" or "*.{ts,tsx}")',
  }),
  literal: FileSystem.GrepInput.fields.literal.annotate({
    description: "Treat each pattern as exact text instead of a regular expression (default: false).",
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
      `Lines of context to show before and after each match, so you can read the surrounding code without a follow-up read. Content mode only; output grows by roughly 2*context+1 lines per match (max: 50). When omitted, a narrow result (at most ${AUTO_CONTEXT_MAX_MATCHES} matches) already includes ${AUTO_CONTEXT_LINES} lines around each hit, so no follow-up read is needed; pass 0 to suppress that.`,
  }),
  mode: Schema.optionalKey(Schema.Literals(MODES)).annotate({
    description:
      'Output mode: "content" shows matching lines (default, supports "context"), "files_with_matches" shows one line per matching file, "count" shows how many matches each file has. When a search might be broad, start with "count" or "files_with_matches" to see its size, then re-run with "content" on a narrowed path.',
  }),
}).check(
  Schema.makeFilter(
    (input) => {
      const hasPattern = typeof input.pattern === "string" && input.pattern.trim().length > 0
      const hasPatterns =
        Array.isArray(input.patterns) && input.patterns.some((part) => typeof part === "string" && part.trim().length > 0)
      return hasPattern || hasPatterns
    },
    { message: 'Provide "pattern" and/or non-empty "patterns"' },
  ),
)

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

/**
 * SiCode: does this matched line *define* the searched term rather than merely mention it?
 *
 * The measured gap it targets: on a 20-query baseline the right file reached top5 65% of the time but
 * rank 1 only 35%, because a hit-count sort lets a file that mentions a symbol eight times outrank the
 * file that declares it once. A declaration is the cheapest available proxy for "the definition lives
 * here", and it needs no index: the line text is already in hand.
 *
 * Scope, measured, so nobody over-reads this: it helps when the declaration is in the hit set and the
 * query names what it declares — `retry` reaching `export function retry`, `switchTopic` reaching its
 * declaration. It does NOT close the harder half of that 35%: a query like `compress` targets
 * `session/compaction.ts`, whose filename and declaration both lack the word (`compaction`, not
 * `compress`), and `emit`/`validate` match interface members and third-party calls that have no
 * declaration line at all. Those need concept mapping (`search-ranked/concepts.ts`), not ordering.
 *
 * Deliberately generic across languages — this scans TypeScript, Go, Rust, Python and config alike —
 * so it stays a weak prior, not a parser. `sortRowsByDefinition` only reorders within one file, so a
 * false positive costs a line swap, never a wrong file.
 */
const DEFINITION_LINE =
  /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:public\s+|private\s+|protected\s+|readonly\s+|static\s+|abstract\s+|async\s+)*(?:function|class|interface|type|enum|namespace|module|struct|trait|impl|def|fn|const|let|var|func)\b/
export const isDefinitionLine = (text: string): boolean => {
  const line = text.trimStart()
  if (line.length === 0 || line.startsWith("//") || line.startsWith("*") || line.startsWith("#")) return false
  if (DEFINITION_LINE.test(line)) return true
  // Named export/import forms that introduce the symbol (`export { retry }`, `import { retry } from`),
  // and the SQL/DDL shape (`CREATE TABLE`, `CREATE INDEX`).
  return /^\s*(?:export|import)\s*\{/.test(text) === false && /^\s*CREATE\s+(?:TABLE|INDEX|VIEW|FUNCTION|PROCEDURE)\b/i.test(text)
}

/**
 * SiCode: within one file, put declaration hits before mention hits. A file often both declares the
 * symbol and uses it forty times; the declaration is the line that answers "where is this defined",
 * so it must not be buried under the usage list. Order is otherwise preserved (file line order), and
 * the result is stable for equal keys via the original index.
 */
const sortRowsByDefinition = (rows: readonly ContentRow[]): ContentRow[] =>
  rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const score = (entry: { row: ContentRow }) =>
        entry.row.kind === "match" && isDefinitionLine(entry.row.match.text) ? 0 : 1
      return score(a) - score(b) || a.index - b.index
    })
    .map((entry) => entry.row)

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
  // API param) while `retry.ts` — the thing you actually want — sits at one hit and sinks. Three
  // signals fix that: a file that *defines* the term outranks one that merely mentions it, a filename
  // match outranks any body-only hit, and test/spec/fixture files are demoted so an implementation
  // file beats a `retry.test.ts` that matches on every other line.
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
      list: sortRowsByDefinition(list),
      count: list.filter((row) => row.kind === "match").length,
      // Rank before count, so a noisy file never buries the implementation that names the pattern.
      // Test/fixture files are demoted hardest: they match on every line and prove nothing about
      // where the behavior lives. 0 = implementation defining the term, 1 = implementation naming it
      // in the filename, 2 = any other implementation file, 3 = test/spec/fixture file.
      rank: isTestPath(file)
        ? 3
        : list.some((row) => row.kind === "match" && isDefinitionLine(row.match.text))
          ? 0
          : nameStem(file).toLowerCase().includes(patternStem.toLowerCase()) && patternStem.length > 0
            ? 1
            : 2,
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
      // SiCode: rg keeps the trailing newline in `lines.text`, which rendered a blank line between
      // a match and the context row under it. Trim it here; the machine output keeps the original.
      lines.push(
        row.kind === "match"
          ? `  Line ${row.match.line}: ${row.match.text.trimEnd()}`
          : `  Line ${row.match.line} | ${row.match.text.trimEnd()}`,
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
      // SiCode: ripgrep emits per file, so context rows belong to the file that produced them. A
      // trailing block from one file must not be printed under the next file's first hit.
      units.push([...pending.filter((lead) => lead.match.entry.path === row.match.entry.path), row])
      pending = []
      continue
    }
    const last = units[units.length - 1]
    if (last && last[0]!.match.entry.path === row.match.entry.path) last.push(row)
    else pending.push(row)
  }
  return units
}

/**
 * SiCode: an empty result is the most common way a search fails — the model guessed one English
 * keyword for a plain-language intent and stops when it misses. Say so in the tool itself, next to
 * the failure it explains. `OPENCODE_QEXPAND=0` drops it for A/B.
 */
const QUERY_EXPANSION_NOTE =
  " Empty results usually mean the term was wrong: batch 3–8 synonyms in `patterns` (preferred) or as one plain `a|b|c` pattern — both count as one call. Split camelCase or use the visible UI string; do not serial-guess one English keyword at a time. Broad or short patterns: start with mode \"files_with_matches\" or \"count\", then re-run \"content\" on a narrowed path — never dump the whole tree into context."

/**
 * Grep leaf that defaults its filesystem root to the active Location.
 */
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

    /**
     * SiCode: the ranked shortlist reads the repository through the same two primitives the tools
     * use, so it sees exactly what a search would see. Built per call rather than held: it is only
     * used after an empty result.
     */
    const source = (): SearchRanked.Source => ({
      files: () =>
        Effect.runPromise(
          ripgrep.find({ cwd: location.directory, pattern: "*", limit: SearchRanked.MAX_FILES }).pipe(
            Effect.map((entries) => entries.map((entry) => entry.path)),
            Effect.catch(() => Effect.succeed([] as readonly string[])),
          ),
        ),
      read: (relative) =>
        Effect.runPromise(
          environment.files.read(path.join(location.directory, relative)).pipe(
            Effect.map((result) => new TextDecoder().decode(result.bytes)),
            Effect.catch(() => Effect.succeed(undefined)),
          ),
        ),
    })

    /**
     * SiCode: splice the lines around each hit so a narrow search answers the question by itself.
     *
     * Only the matched files are read — never the whole tree — so this stays valid for regex
     * patterns, where the prefilter does not apply. Rows keep the file's own order, and a line
     * shared by two nearby hits is emitted once.
     */
    const withContext = (rows: readonly Ripgrep.GrepRow[], lines: number) =>
      Effect.gen(function* () {
        const files = new Map<string, readonly string[] | undefined>()
        const load = (relative: string) =>
          Effect.gen(function* () {
            if (files.has(relative)) return files.get(relative)
            const absolute = path.isAbsolute(relative) ? relative : path.join(location.directory, relative)
            const content = yield* environment.files.read(absolute).pipe(
              Effect.map((result) => new TextDecoder().decode(result.bytes)),
              Effect.catch(() => Effect.succeed(undefined)),
            )
            const split = content === undefined ? undefined : content.split(/\r?\n/)
            files.set(relative, split)
            return split
          })

        const grouped = new Map<string, Ripgrep.GrepRow[]>()
        for (const row of rows) {
          const key = row.match.entry.path
          const list = grouped.get(key)
          if (list) list.push(row)
          else grouped.set(key, [row])
        }

        const out: Ripgrep.GrepRow[] = []
        for (const [file, hits] of grouped) {
          const content = yield* load(file)
          const matches = hits.filter((row) => row.kind === "match").sort((a, b) => a.match.line - b.match.line)
          if (!content) {
            out.push(...matches)
            continue
          }
          const emitted = new Set<number>()
          for (const row of matches) {
            const start = Math.max(1, row.match.line - lines)
            const end = Math.min(content.length, row.match.line + lines)
            for (let line = start; line <= end; line++) {
              if (emitted.has(line)) continue
              emitted.add(line)
              if (line === row.match.line) {
                out.push(row)
                continue
              }
              out.push({
                kind: "context",
                match: FileSystem.Match.make({
                  entry: row.match.entry,
                  line,
                  offset: 0,
                  text: (content[line - 1] ?? "").slice(0, 2_000),
                  submatches: [],
                }),
              })
            }
          }
        }
        return out
      })

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description:
            'Search file contents using ripgrep\'s regular expression syntax or literal text matching. Narrow with `path` or `include`. Output modes: "content" (default, supports `context`), "files_with_matches", "count". Flood rule: if the pattern is short, common, or you are exploring, call "files_with_matches" or "count" first — only then "content" on the files that matter. Use `patterns` for synonyms in one call. Independent greps (and reads) that do not depend on each other belong in the same step, not serial single-tool steps.' +
              (process.env.OPENCODE_QEXPAND === "0" ? "" : QUERY_EXPANSION_NOTE),
          input: Input,
          output: Output,
          execute: (input, context) => {
            // SiCode: resolve outside the Effect.gen so `.pipe` flatMap/mapError can still name the query
            // when `pattern` is omitted and only `patterns` carries the batch.
            const patterns = resolveGrepPatterns(input)
            const label = input.pattern?.trim() || patterns[0] || ""
            return Effect.gen(function* () {
              const source = { type: "tool" as const, messageID: context.messageID, id: context.id }
              const target = yield* access.resolve({ path: input.path ?? "." })
              yield* access.authorizeExternal([target], context)
              yield* permission.assert({
                action: name,
                resources: patterns,
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
              // Rebase a cwd-relative path onto the location root, as every source of rows must.
              // An external root has no meaningful relative form, so it keeps the absolute path.
              const rebase = (entryPath: string) => {
                const absolute = path.resolve(cwd, entryPath)
                const moved = path.relative(location.directory, absolute)
                const inside = moved.split(path.sep)[0] !== ".." && !path.isAbsolute(moved)
                return RelativePath.make(inside ? moved : absolute)
              }
              const mapRows = (rows: readonly Ripgrep.GrepRow[]): Ripgrep.GrepRow[] =>
                rows.map((row) => ({
                  kind: row.kind,
                  match: FileSystem.Match.make({
                    ...row.match,
                    entry: FileSystem.Entry.make({
                      ...row.match.entry,
                      path: rebase(row.match.entry.path),
                    }),
                  }),
                }))
              /**
               * SiCode: one pattern through the two-stage path. Stage one asks the trigram index
               * which files could contain the pattern as literal text; stage two runs rg over just
               * those files. Empty candidate lists fall back to a full sweep — stale indexes must
               * never report a silent miss. Regex / building / oversized sets also fall back, so
               * the fast path only changes speed, never results.
               */
              const searchOne = (pattern: string) =>
                Effect.gen(function* () {
                  const literal = type === "directory" ? literalQuery(pattern, input.literal) : null
                  const global = literal ? yield* trigram.candidates(literal) : null
                  const scoped = global ? scopedCandidates(global, cwd, location.directory) : null
                  const prefilter = usablePrefilter(scoped)
                  const chunks = prefilter ? chunkPaths(prefilter) : undefined
                  const sweep = (paths?: readonly string[]) =>
                    ripgrep
                      .grep({
                        cwd,
                        pattern,
                        file: type === "file" ? path.basename(root) : undefined,
                        paths,
                        include: input.include,
                        literal: input.literal,
                        caseSensitive: input.caseSensitive,
                        context: mode === "content" ? input.context : undefined,
                        mode: mode === "files_with_matches" ? "files" : mode,
                        limit: wanted + 1,
                        timeoutMs: FileSystem.DEFAULT_SEARCH_TIMEOUT_MS,
                      })
                      .pipe(Effect.map((result) => ({ rows: mapRows(result.rows), timedOut: result.timedOut })))
                  let rows: Ripgrep.GrepRow[] = []
                  let timedOut = false
                  // SiCode: in-process literal match skips ~150ms rg startup on small candidate sets.
                  const useInMemory =
                    literal !== null &&
                    prefilter !== null &&
                    prefilter.length <= TrigramSearch.IN_MEMORY_MATCH_MAX_FILES &&
                    (mode === "content" || mode === "files_with_matches") &&
                    !input.context &&
                    !input.include
                  if (useInMemory) {
                    rows = yield* TrigramSearch.matchLiteralInMemory(cwd, prefilter, literal, {
                      caseSensitive: input.caseSensitive,
                      mode: mode === "files_with_matches" ? "files" : "content",
                      limit: wanted + 1,
                    }).pipe(Effect.map((result) => mapRows(result)))
                  } else if (chunks) {
                    for (const chunk of chunks) {
                      const swept = yield* sweep(chunk)
                      rows.push(...swept.rows)
                      timedOut ||= swept.timedOut
                      const counted = mode === "content" ? groupByMatch(rows).length : rows.length
                      if (counted > wanted) break
                    }
                  } else {
                    const swept = yield* sweep()
                    rows = [...swept.rows]
                    timedOut ||= swept.timedOut
                  }
                  return { rows, timedOut, prefiltered: prefilter !== null }
                })
              // SiCode: synonym batch — search each pattern and merge. Dedup by path+line+text so
              // overlapping synonyms do not inflate the page or the match count.
              let rows: Ripgrep.GrepRow[] = []
              let timedOut = false
              let anyPrefiltered = false
              const seen = new Set<string>()
              for (const pattern of patterns) {
                const found = yield* searchOne(pattern)
                timedOut ||= found.timedOut
                anyPrefiltered ||= found.prefiltered
                for (const row of found.rows) {
                  const key =
                    row.kind === "match"
                      ? `m:${row.match.entry.path}:${row.match.line}:${row.match.text}`
                      : `c:${row.match.entry.path}:${row.match.line}:${row.match.text}`
                  if (seen.has(key)) continue
                  seen.add(key)
                  rows.push(row)
                }
                const counted = mode === "content" ? groupByMatch(rows).length : rows.length
                if (counted > wanted) break
              }
              // Content pages break on matches; the other modes are already one row per file.
              const units = mode === "content" ? groupByMatch(rows) : rows.map((row) => [row])
              const page = units.slice(offset, wanted).flat()
              // SiCode: a narrow hit list is where the follow-up read is pure overhead — the model
              // has line numbers but not the code around them, so it spends a whole step (~6s)
              // opening a file the search already found. Splice the surrounding lines in here.
              // Only the matched files are read, so this works for regex patterns too (an
              // unfiltered sweep must never be repeated just to get context).
              const narrow =
                mode === "content" &&
                input.context === undefined &&
                offset === 0 &&
                units.length <= wanted &&
                page.filter((row) => row.kind === "match").length <= AUTO_CONTEXT_MAX_MATCHES
              const paged = narrow ? yield* withContext(page, AUTO_CONTEXT_LINES) : page
              const matches = paged.flatMap((row) => (row.kind === "match" ? [row.match] : []))
              return {
                rows: paged,
                matches,
                // Count rows carry a per-file total, so the page represents more matches than it has rows.
                total: mode === "count" ? paged.reduce((sum, row) => sum + row.match.line, 0) : matches.length,
                truncated: units.length > wanted,
                // True only when every pattern actually used a non-empty prefilter.
                prefiltered: anyPrefiltered && patterns.length === 1,
                patterns: patterns.length,
                // A single-file grep that hit nothing has nowhere better to point the model.
                scoped: type === "file",
                timedOut,
                autoContext: narrow && matches.length > 0 ? AUTO_CONTEXT_LINES : 0,
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
                    {
                      mode: input.mode ?? "content",
                      truncated: result.truncated,
                      offset: input.offset ?? 0,
                      pattern: result.patterns > 1 ? `${label} (+${result.patterns - 1} synonyms)` : label,
                    },
                  )
                  // SiCode: a character-cap is the one truncation `offset` cannot page back — offset
                  // steps by match, not line, so lines dropped from the middle of a selected page are
                  // gone for good. Spill the full rendering to a retained file and point the model at
                  // it, so a re-run is not the only way to recover them.
                  let content = rendered.text
                  // SiCode: say why the surrounding lines are there. Without this the model treats
                  // context rows as incidental and opens the file anyway, which is the step the
                  // automatic context exists to remove.
                  if (result.autoContext > 0)
                    content += `\n\n[${result.autoContext} context lines included around each hit — no follow-up read needed unless the change spans more.]`
                  if (rendered.spill !== undefined) {
                    const file = yield* toolOutput.save(Buffer.from(rendered.spill, "utf8"), ".txt")
                    content += `\n\n[Full results saved to ${file}; read it to see the ${rendered.hidden} hidden lines]`
                  }
                  // SiCode: a deadline is not a failure. Say plainly that the tree was too large, how
                  // much was reached, and the one parameter that would make the next attempt cheap —
                  // otherwise the model reads a short result as "nothing here" and widens the search.
                  if (result.timedOut)
                    content +=
                      `\n\n[Search stopped at the ${FileSystem.DEFAULT_SEARCH_TIMEOUT_MS / 1_000}s budget` +
                      `${result.total > 0 ? ` after ${result.total} match${result.total === 1 ? "" : "es"}` : " without a match"}` +
                      `; this tree is too large to scan whole. Narrow it with \`path\` (a subdirectory) or` +
                      ` \`include\` (a file type such as "*.conf"), or search for the file name with \`glob\`.]`
                  // SiCode: an empty result is the moment the model is about to guess again, so it
                  // gets a ranked shortlist instead of another turn spent guessing. Triggered by
                  // the code rather than by a hint the model has to remember to ask for, and only
                  // when the search really covered the repository — a single-file grep that missed
                  // has nowhere better to point. `OPENCODE_RANKED=0` off.
                  if (result.total === 0 && !result.scoped && process.env.OPENCODE_RANKED !== "0") {
                    const suggestions = yield* Effect.tryPromise(() =>
                      SearchRanked.suggest(source(), label),
                    ).pipe(Effect.catch(() => Effect.succeed([] as readonly SearchRanked.Suggestion[])))
                    const ranked = SearchRanked.render(label, suggestions)
                    if (ranked !== "") content += `\n\n${ranked}`
                  }
                  return {
                    output: result.matches,
                    content,
                    metadata: {
                      matches: result.total,
                      truncated: result.truncated,
                      timedOut: result.timedOut,
                      mode: input.mode ?? "content",
                      prefiltered: result.prefiltered,
                      ...(result.patterns > 1 ? { patterns: result.patterns } : {}),
                    },
                  }
                }),
              ),
              Effect.mapError((error) =>
                error instanceof ToolFailure
                  ? error
                  : error instanceof Ripgrep.InvalidPatternError
                    ? new ToolFailure({ message: `Invalid regex pattern: ${error.message}` })
                    : new ToolFailure({ message: `Unable to grep for ${label}`, error }),
              ),
            )
          },
        }),
      )
      .pipe(Effect.orDie)
  }),
}
