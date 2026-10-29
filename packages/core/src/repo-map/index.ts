export * as RepoMap from "./index.js"

import { readFile, readdir, stat } from "fs/promises"
import { join } from "path"
import { Global } from "@opencode/util/global"
import { RepoMapCache } from "./cache.js"
import type { Symbol } from "./extract.js"
import { RepoMapLanguages } from "./languages.js"
import { RepoMapParse } from "./parse.js"
import { RepoMapRender, type FileEntry, type Options as RenderOptions } from "./render.js"

/**
 * SiCode: builds the repo map that `config/plugin/project-map.ts` injects on every request.
 *
 * A hand-written `.sicode/structure.md` is still preferred when present — it carries knowledge a
 * parser cannot derive. This module exists for every other repository, where the choice used to be
 * "no map at all".
 *
 * Shape of the work:
 *   scan (prune directories) → stat → parse only what changed → cache → rank → render
 *
 * The first build of a large repository takes seconds, so it runs in the background and the first
 * request goes without a map. Every later process start finds the disk cache and only pays for the
 * files that changed, which is sub-second.
 */

export interface Options extends RenderOptions {
  /** Directory holding the cache files. Defaults to `<global cache>/repo-map`. */
  readonly cache?: string
  /** Wait for a cold build instead of returning nothing. Used by tests and one-shot commands. */
  readonly wait?: boolean
}

const TTL = 5 * 60_000
const MAX_FILES = 20_000
const MAX_BYTES = 512 * 1024
const MAX_DEPTH = 12

/** Build outputs and dependency trees: never worth a symbol in the map, expensive to walk. */
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  "out",
  "target",
  "vendor",
  "coverage",
  ".next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".venv",
  "venv",
  "env",
  "__pycache__",
  ".turbo",
  ".cache",
  ".gradle",
  "Pods",
  "obj",
  "bin",
  "tmp",
  "temp",
])

/** Test files and generated sources: they add lines to the map without adding orientation. */
const IGNORED_FILES = [
  /\.d\.[a-z]+$/,
  /\.min\./,
  /\.(test|spec)\.[^/]+$/,
  /(^|\/)(test|tests|__tests__|__mocks__|fixtures)\//,
  /_test\.(go|rs|py|c|cc|cpp)$/,
  /(^|\/)test_[^/]+\.py$/,
]

const memory = new Map<string, { text: string; at: number }>()
const inflight = new Map<string, Promise<string | undefined>>()

/** The rendered text depends on the budget, so a cached map is only valid for the options it was built with. */
const key = (directory: string, options: Options) =>
  `${directory}|${options.budget ?? ""}|${options.symbolsPerFile ?? ""}`

const defaultCache = () => join(Global.Path.cache, "repo-map")

/**
 * Walks the project once. Directories are pruned rather than filtered afterwards: skipping
 * `node_modules` before descending is the difference between a 50ms scan and a multi-second one.
 */
const scan = async (root: string): Promise<string[]> => {
  const found: string[] = []
  const pending: string[] = [""]
  while (pending.length > 0) {
    const relative = pending.pop()!
    let entries
    try {
      entries = await readdir(join(root, relative), { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const next = relative === "" ? entry.name : `${relative}/${entry.name}`
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name) || next.split("/").length > MAX_DEPTH) continue
        pending.push(next)
        continue
      }
      if (!entry.isFile()) continue
      if (!RepoMapLanguages.ofPath(next)) continue
      if (IGNORED_FILES.some((pattern) => pattern.test(next))) continue
      found.push(next)
      if (found.length >= MAX_FILES) return found
    }
  }
  return found
}

const refresh = async (directory: string, options: Options, file: string): Promise<string | undefined> => {
  const previous = await RepoMapCache.read(file)
  const files = await scan(directory)
  const entries: FileEntry[] = []
  const stored: Record<string, RepoMapCache.Stored> = {}

  for (const relative of files) {
    const absolute = join(directory, relative)
    let info
    try {
      info = await stat(absolute)
    } catch {
      continue
    }
    if (info.size > MAX_BYTES) continue
    const language = RepoMapLanguages.ofPath(relative)
    if (!language) continue

    const cached = previous?.files[relative]
    if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size && cached.language === language) {
      stored[relative] = cached
      if (cached.symbols.length > 0) entries.push({ file: relative, symbols: cached.symbols, imports: cached.imports })
      continue
    }

    let source: string
    try {
      source = await readFile(absolute, "utf8")
    } catch {
      continue
    }
    const result = await RepoMapParse.parse(source, language)
    if (!result) continue
    const record: RepoMapCache.Stored = {
      mtimeMs: info.mtimeMs,
      size: info.size,
      language,
      symbols: result.symbols as Symbol[],
      imports: result.imports,
    }
    stored[relative] = record
    if (result.symbols.length > 0) entries.push({ file: relative, symbols: result.symbols, imports: result.imports })
  }

  await RepoMapCache.write(file, { version: 1, root: directory, files: stored })
  const text = RepoMapRender.render(entries, options)
  return text === "" ? undefined : text
}

export const get = async (directory: string, options: Options = {}): Promise<string | undefined> => {
  const id = key(directory, options)
  const hit = memory.get(id)
  if (hit && Date.now() - hit.at < TTL) return hit.text
  const running = inflight.get(id)
  if (running) return hit?.text ?? running

  const file = RepoMapCache.path(directory, options.cache ?? defaultCache())
  const warm = hit !== undefined || (await RepoMapCache.exists(file))
  const task = refresh(directory, options, file)
    .then((text) => {
      if (text !== undefined) memory.set(id, { text, at: Date.now() })
      return text
    })
    .catch(() => undefined)
    .finally(() => inflight.delete(id))
  inflight.set(id, task)

  if (!warm && options.wait !== true) {
    // Cold build: do not hold the request open for several seconds. The map lands in memory and
    // on disk, so the next turn of the same session already has it.
    void task
    return undefined
  }
  // A stale map is better than a stall: serve it and let the refresh settle in the background.
  return hit && options.wait !== true ? hit.text : task
}

/** Drops the in-memory copy. The disk cache is left alone — callers pass a fresh `cache` to bypass it. */
export const invalidate = (directory?: string): void => {
  if (directory === undefined) {
    memory.clear()
    return
  }
  for (const id of memory.keys()) if (id.startsWith(`${directory}|`)) memory.delete(id)
}

export const scanFiles = scan
