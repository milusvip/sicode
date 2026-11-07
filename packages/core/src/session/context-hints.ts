export * as SessionContextHints from "./context-hints.js"

import path from "path"
import { Context, DateTime, Effect, Layer } from "effect"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { FileSystemSearch } from "../filesystem/search.js"
import { Service as Search, node as searchNode } from "../filesystem/search.js"
import { Location } from "../location.js"
import { Ripgrep } from "../ripgrep.js"
import { SearchRankedConcepts } from "../search-ranked/concepts.js"
import { SearchRanked } from "../search-ranked/index.js"
import { SessionCodeChunks } from "./code-chunks.js"
import { SessionMessage } from "./message.js"
import { SessionSchema } from "./schema.js"

/**
 * SiCode: puts the likely files of a new request in front of the model, so it does not have to
 * guess which names to grep for. Cursor's advantage here is a semantic index plus automatic
 * injection; this is the cheap half of it — name lookup plus a ranked fill when the request is
 * intent in Chinese (or any wording that does not name a file), with no embeddings and no
 * resident content index.
 *
 * The hint is a message in the request only. It is built on every load, never written to the
 * session, so it cannot pollute the transcript or a later compaction, and the system prompt —
 * the cacheable prefix — is untouched.
 *
 * SiCode: after the path list, a budgeted `<code-chunks>` block (see `code-chunks.ts`) mounts
 * short excerpts for the top leads so Flash's first call already sees code. Wrong excerpts still
 * mislead, so the chunk budget is tight and `OPENCODE_CODE_CHUNKS=0` turns them off.
 */

/** A term must be long enough to be specific: shorter ones match almost every path. */
const MIN_TERM = 4
/** A prompt under this length is a short continuation / ack, not a task worth a lookup. */
const MIN_PROMPT = 12
const MAX_TERMS = 5
const MAX_FILES = 6
const FILES_PER_TERM = 3

const EXTENSIONS =
  "ts|tsx|mts|cts|js|jsx|mjs|cjs|json|css|scss|less|md|mdx|html|py|rs|go|java|kt|rb|php|cs|cpp|cc|h|hpp|sh|ps1|yml|yaml|toml|sql|vue|svelte|swift"

const BACKTICK = /`([^`\n]{3,80})`/g
/** A bare file name; one inside a path is taken by PATH below, which is more specific. */
const FILE_WITH_EXTENSION = new RegExp(`(?<![\\w/])[\\w@$.-]+\\.(?:${EXTENSIONS})\\b`, "g")
const PATH = /[\w@$.-]+(?:\/[\w@$.-]+)+/g
const IDENTIFIER = /\b[A-Za-z_][A-Za-z0-9_]{5,}\b/g

/** Words that name no particular file, so a lookup on them only returns noise. */
const NOISE = new Set([
  "another",
  "boolean",
  "because",
  "between",
  "command",
  "content",
  "context",
  "default",
  "element",
  "example",
  "export",
  "function",
  "however",
  "implement",
  "instead",
  "message",
  "nothing",
  "number",
  "options",
  "package",
  "please",
  "problem",
  "project",
  "request",
  "response",
  "return",
  "session",
  "should",
  "something",
  "string",
  "though",
  "through",
  "without",
])

/**
 * The terms worth a file lookup, most explicit first: backticked mentions, then file names,
 * paths, and identifiers that carry a case or digit signal. Plain lowercase words are skipped —
 * every other file would match them.
 */
export function hintTerms(text: string): string[] {
  const terms: string[] = []

  const push = (value: string) => {
    const term = value.trim().replace(/^\.\//, "").replace(/^["'`(]+|["'`).,;:]+$/g, "")
    if (term.length < MIN_TERM || terms.length >= MAX_TERMS) return

    const key = term.toLowerCase()
    if (NOISE.has(key)) return
    if (terms.some((item) => item.toLowerCase() === key)) return

    terms.push(term)
  }

  // A backticked token is an explicit reference, so it is taken even when it looks generic.
  for (const match of text.matchAll(BACKTICK)) push(match[1]!)
  // A path outranks a bare name: `settings/model.tsx` locates one file, `model.tsx` locates many.
  for (const match of text.matchAll(PATH)) push(match[0])
  for (const match of text.matchAll(FILE_WITH_EXTENSION)) push(match[0])
  // An identifier needs a case or digit signal: `createTimelineController` yes, `whatever` no.
  for (const match of text.matchAll(IDENTIFIER)) if (/[A-Z0-9_]/.test(match[0])) push(match[0])

  return terms
}

/**
 * Where a new task starts: the last user message, unless the turn has already produced work.
 * Returns undefined while the model is mid-turn (assistant or shell output follows the prompt),
 * which keeps the hint to one injection per task instead of one per tool step.
 */
export function taskStart(messages: ReadonlyArray<SessionMessage.Info>) {
  const index = messages.findLastIndex((message) => message.type === "user")
  if (index < 0) return undefined

  const user = messages[index]
  if (user.type !== "user") return undefined
  if (user.text.length < MIN_PROMPT) return undefined
  // Work already done under this prompt (a tool loop in progress) carries its own context now.
  if (messages.slice(index + 1).some((message) => message.type === "assistant" || message.type === "shell"))
    return undefined

  return { index, message: user }
}

function hintMessage(label: string, paths: readonly string[], chunks?: string): SessionMessage.Synthetic {
  return {
    id: SessionMessage.ID.create(),
    time: { created: DateTime.makeUnsafe(Date.now()) },
    type: "synthetic",
    metadata: { notice: "context-hints" },
    description: `Context hints: ${paths.length} files`,
    text: [
      "<context-hints>",
      `Workspace files that may match this request (${label}):`,
      ...paths.map((path) => `- ${path}`),
      "These are leads by name, symbol, and content. Prefer the excerpts below when present; otherwise open the ones that matter instead of guessing at paths, and ignore the rest.",
      "</context-hints>",
      ...(chunks ? [chunks] : []),
    ].join("\n"),
  }
}

export interface Interface {
  /** Prepends a hint message to a new task's prompt, or returns the messages unchanged. */
  readonly inject: (input: {
    readonly sessionID: SessionSchema.ID
    readonly messages: ReadonlyArray<SessionMessage.Info>
  }) => Effect.Effect<ReadonlyArray<SessionMessage.Info>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionContextHints") {}

export type RankedSuggest = (query: string) => Effect.Effect<readonly string[]>
/** SiCode: optional file reader for budgeted code-chunk mounts. */
export type ReadFile = (relative: string) => Effect.Effect<string | undefined>

function build(
  search: FileSystemSearch.Interface,
  rankedSuggest: RankedSuggest,
  readFile?: ReadFile,
): Interface {
  // Prompts already hinted in this process. A restart may hint one task twice; the cost is a
  // few hundred tokens, while persisting the ledger would put state in the session it never had.
  const hinted = new Set<string>()

  const lookup = Effect.fn("SessionContextHints.lookup")(function* (terms: readonly string[]) {
    const found = yield* Effect.forEach(
      terms,
      (term) =>
        search
          .find({ query: term, type: "file", limit: FILES_PER_TERM })
          // A hint is a lead, never a requirement: no index, no ripgrep binary, no permission to
          // read the tree — all of them mean "say nothing", not "fail the turn". `catchCause`
          // rather than `orElseSucceed` because ripgrep reports a missing binary by yielding an
          // Error, which lands in the defect channel and would otherwise escape this pipe.
          .pipe(Effect.catchCause(() => Effect.succeed([] as const))),
      { concurrency: "unbounded" },
    )
    const seen = new Set<string>()
    const paths: string[] = []

    for (const entries of found) {
      for (const entry of entries) {
        const path = String(entry.path)
        if (seen.has(path)) continue
        seen.add(path)
        paths.push(path)
        if (paths.length >= MAX_FILES) return paths
      }
    }

    return paths
  })

  const merge = (named: readonly string[], ranked: readonly string[]) => {
    const seen = new Set(named)
    const paths = [...named]
    for (const path of ranked) {
      if (seen.has(path)) continue
      seen.add(path)
      paths.push(path)
      if (paths.length >= MAX_FILES) break
    }
    return paths.slice(0, MAX_FILES)
  }

  const inject = Effect.fn("SessionContextHints.inject")(function* (input: Parameters<Interface["inject"]>[0]) {
    const task = taskStart(input.messages)
    if (!task || hinted.has(task.message.id)) return input.messages

    const terms = hintTerms(task.message.text)
    const named = terms.length > 0 ? yield* lookup(terms) : []
    // SiCode: intent-only (usually Chinese) prompts extract no ASCII terms. Bare BM25F on those
    // lands in i18n/zh.ts character overlap — worse than silence — so ranked fill runs only when
    // the concept table produced English extras. Named prompts stay on fuzzysort alone.
    const wantRanked =
      process.env.OPENCODE_RANKED !== "0" &&
      terms.length === 0 &&
      SearchRankedConcepts.extrasOf(task.message.text).length > 0
    const ranked = wantRanked
      ? yield* rankedSuggest(task.message.text).pipe(Effect.catchCause(() => Effect.succeed([] as const)))
      : []
    const paths = merge(named, ranked)
    // Nothing found: stay silent rather than tell the model it has context it does not.
    if (paths.length === 0) return input.messages

    const label =
      terms.length > 0 ? terms.join(", ") : ranked.length > 0 ? "ranked by request text" : "name lookup"

    // SiCode: budgeted excerpts for the top leads. Failures stay silent — a missing chunk is fine.
    const needles = [
      ...terms,
      ...SearchRankedConcepts.extrasOf(task.message.text),
      ...SearchRankedConcepts.expand(task.message.text).split(/\s+/).filter((word) => word.length >= 3),
    ]
    let chunks: string | undefined
    if (readFile && !SessionCodeChunks.envDisabled()) {
      const sources = yield* Effect.forEach(
        paths.slice(0, SessionCodeChunks.MAX_FILES),
        (relative) =>
          readFile(relative).pipe(
            Effect.map((text) => (text ? { path: relative, text, needles } : undefined)),
            Effect.catchCause(() => Effect.succeed(undefined)),
          ),
        { concurrency: "unbounded" },
      )
      chunks = SessionCodeChunks.render(sources.flatMap((source) => (source ? [source] : [])))
    }

    hinted.add(task.message.id)
    const messages = [...input.messages]
    // After the prompt it belongs to: the user's words come first, then the leads.
    messages.splice(task.index + 1, 0, hintMessage(label, paths, chunks))

    return messages
  })

  return { inject }
}

/**
 * SiCode: optional `ranked` lets tests stub BM25F without standing up Location/Ripgrep. Production
 * builds the suggestor from the same two-pass SearchRanked path grep uses on empty results —
 * path shortlist, then read at most a few dozen candidates. `OPENCODE_RANKED=0` turns the fill off.
 */
export function makeLayer(options: {
  ranked: RankedSuggest
  readFile?: ReadFile
}): Layer.Layer<Service, never, Search>
export function makeLayer(): Layer.Layer<Service, never, Search | Location.Service | Ripgrep.Service>
export function makeLayer(options?: { ranked?: RankedSuggest; readFile?: ReadFile }) {
  if (options?.ranked) {
    return Layer.effect(
      Service,
      Effect.gen(function* () {
        return Service.of(build(yield* Search, options.ranked!, options.readFile))
      }),
    )
  }

  return Layer.effect(
    Service,
    Effect.gen(function* () {
      const search = yield* Search
      const location = yield* Location.Service
      const ripgrep = yield* Ripgrep.Service
      const readRelative = async (relative: string) => {
        try {
          return await Bun.file(path.join(location.directory, relative)).text()
        } catch {
          return undefined
        }
      }
      const rankedSuggest: RankedSuggest = (query) =>
        Effect.tryPromise(() =>
          SearchRanked.suggest(
            {
              files: () =>
                Effect.runPromise(
                  ripgrep.find({ cwd: location.directory, pattern: "*", limit: SearchRanked.MAX_FILES }).pipe(
                    Effect.map((entries) => entries.map((entry) => entry.path)),
                    Effect.catch(() => Effect.succeed([] as readonly string[])),
                  ),
                ),
              read: readRelative,
            },
            query,
            { limit: MAX_FILES },
          ),
        ).pipe(
          Effect.map((hits) => hits.map((hit) => hit.path)),
          Effect.catchCause(() => Effect.succeed([] as const)),
        )
      const readFile: ReadFile = (relative) => Effect.tryPromise(() => readRelative(relative)).pipe(
        Effect.catchCause(() => Effect.succeed(undefined)),
      )
      return Service.of(build(search, rankedSuggest, readFile))
    }),
  )
}

// Exported so a test can supply its own Search: the failure modes worth pinning (no index, a
// ripgrep binary that cannot be resolved) are all about what the hint does when the lookup dies.
export const layer = makeLayer()

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [searchNode, Location.node, Ripgrep.node],
})
