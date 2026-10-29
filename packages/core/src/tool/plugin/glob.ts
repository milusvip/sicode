export * as GlobTool from "./glob.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Glob } from "@opencode/util/glob"
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

/**
 * SiCode: a trailing slash in the pattern asks for directories. ripgrep's `--files` never lists a
 * directory, so a directory pattern used to answer "No files found" no matter how real the
 * directory was — the model could not find a project by folder name at all. Directories are now
 * derived from the file paths rg lists (so .gitignore still applies) and matched with the same glob
 * semantics. A bounded pattern bounds the walk too (see `patternDepth`), so asking for one level
 * does not read the whole tree.
 *
 * Two consequences worth knowing: an empty directory has no files to derive from and stays
 * invisible, and a directory rg itself ignores (node_modules, build output) stays invisible too —
 * the same set of paths every other search already sees.
 */
export const DIRECTORY_SCAN_LIMIT = 50_000

const isDirectoryPattern = (pattern: string) => pattern.trimEnd().endsWith("/")

/**
 * How deep a directory pattern looks, or undefined when `**` makes it unbounded.
 *
 * SiCode: a bounded pattern does not need the whole tree. Listing one level of a 57-site web root
 * cost 15.7 s and 620k paths because rg walked everything before any parent could be named; the
 * same answer with `--max-depth` was 0.6 s. A parent at depth D is derivable from any file at
 * depth D+1, so D+2 is used — the margin covers a folder whose own files sit one level down. Only a
 * folder whose every file is three levels deeper stays invisible, which is a rare shape and the
 * price of not reading half a million paths to answer a one-level question.
 */
export const patternDepth = (pattern: string): number | undefined => {
  const segments = pattern.split("/").filter((segment) => segment !== "")
  if (segments.length === 0) return undefined
  if (segments.some((segment) => segment.includes("**"))) return undefined
  return segments.length
}

/** Every parent directory of the listed files, as search-root-relative paths with a trailing slash. */
export const parentDirectories = (paths: readonly string[]): string[] => {
  const found = new Set<string>()
  for (const file of paths) {
    const parts = file.split("/")
    for (let depth = 1; depth < parts.length; depth++) found.add(`${parts.slice(0, depth).join("/")}/`)
  }
  // Lexical order puts a parent before its children and makes the page stable across scans.
  return [...found].sort()
}

export const Input = Schema.Struct({
  pattern: FileSystem.GlobInput.fields.pattern.annotate({
    description:
      'Glob pattern to match paths against. End it with "/" to search for directories instead of files (for example "**/src/").',
  }),
  path: Schema.optionalKey(Schema.String).annotate({
    description:
      "Directory to search, relative to the workspace or absolute. Defaults to the current working directory. An absolute path outside the workspace asks the user for approval first.",
  }),
  hidden: FileSystem.GlobInput.fields.hidden.annotate({
    description: "Include hidden files and directories (default: false).",
  }),
  limit: FileSystem.GlobInput.fields.limit.annotate({
    description: `Maximum number of matching paths to return (default: ${FileSystem.DEFAULT_SEARCH_LIMIT})`,
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
            'Search paths using a glob pattern (examples: "**/*.ts", "src/**/*.tsx").' +
            // SiCode: an empty match usually means the guessed name was wrong, not that no file exists.
            // A folder has the same problem twice over: it is not a file at all, so the pattern has to
            // say so with a trailing slash or the search can never match it.
            (process.env.OPENCODE_QEXPAND === "0"
              ? ""
              : ' No match usually means the guessed name was wrong: try another wording, or end the pattern with "/" to look for a directory (for example "**/src/").'),
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
              // Trim only for the directory decision: a pattern may legitimately end in a space.
              const pattern = input.pattern.trim()
              const limit = input.limit ?? FileSystem.DEFAULT_SEARCH_LIMIT
              const directories = isDirectoryPattern(pattern)
              const depth = directories ? patternDepth(pattern) : undefined
              // An external root has no meaningful relative form: `../../..` round-trips, but it is
              // unreadable in a transcript and useless as an argument to the next tool.
              const rebase = (relative: string, folder = false) => {
                const absolute = path.resolve(root, relative)
                const moved = path.relative(location.directory, absolute)
                const inside = moved.split(path.sep)[0] !== ".." && !path.isAbsolute(moved)
                const shown = inside ? moved : absolute
                return RelativePath.make(folder ? shown + path.sep : shown)
              }
              const scan = (maxDepth: number | undefined) =>
                ripgrep
                  .glob({
                    cwd: root,
                    // A directory pattern cannot be handed to rg: it filters file paths, and a file
                    // path never ends in a separator. List everything and match the derived parents.
                    pattern: directories ? "*" : input.pattern,
                    hidden: input.hidden,
                    limit: directories ? DIRECTORY_SCAN_LIMIT : limit + 1,
                    maxDepth,
                    // SiCode: a name search over an unindexed tree is the one that most often runs
                    // long, so it degrades to a partial list instead of failing outright.
                    timeoutMs: FileSystem.DEFAULT_SEARCH_TIMEOUT_MS,
                  })
                  .pipe(
                    Effect.map((result) => ({
                      entries: directories
                        ? parentDirectories(result.entries.map((entry) => entry.path))
                            .filter((directory) => Glob.match(pattern, directory))
                            .map((directory) =>
                              FileSystem.Entry.make({ path: rebase(directory, true), type: "directory" }),
                            )
                        : result.entries.map((entry) => FileSystem.Entry.make({ ...entry, path: rebase(entry.path) })),
                      // A capped scan saw only part of the tree, so the directory list may be missing
                      // parents even when the page itself is short.
                      capped: directories && result.entries.length >= DIRECTORY_SCAN_LIMIT,
                      timedOut: result.timedOut,
                    })),
                  )
              // A folder can be named from a file one level inside it, so a bounded pattern does not
              // need the bottom of the tree — but a folder whose every file sits deeper than that
              // would vanish, and "nothing here" is the answer the model acts on most wrongly. The
              // bound is therefore only kept when it found something; an empty page re-runs whole.
              const bounded = yield* scan(directories && depth !== undefined ? depth + 2 : undefined)
              const swept =
                bounded.entries.length === 0 && directories && depth !== undefined
                  ? yield* scan(undefined)
                  : bounded
              return {
                entries: swept.entries.slice(0, limit),
                truncated: swept.entries.length > limit || swept.capped,
                timedOut: swept.timedOut,
              }
            }).pipe(
              Effect.map((result) => ({
                output: result.entries,
                content: toModelContent(
                  result.entries.map((entry) => ({
                    ...entry,
                    path:
                      path.resolve(location.directory, entry.path) + (entry.type === "directory" ? path.sep : ""),
                  })),
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
