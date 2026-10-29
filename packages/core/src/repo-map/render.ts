export * as RepoMapRender from "./render.js"

import { posix } from "path"
import type { Symbol } from "./extract.js"

/**
 * SiCode: ranks the scanned files and renders the map the model sees.
 *
 * Pure on purpose — no filesystem access — so the ranking rule and the budget trimming can be
 * tested without parsing anything.
 *
 * Ranking mirrors what Aider found useful without its PageRank machinery: how many files import
 * you is the signal, and a file under `src/` beats one at the repository root. Files nobody
 * imports still make it in, which matters for entrypoints (`main.ts`, `index.ts`) that are
 * referenced by nothing at all.
 */

export interface FileEntry {
  readonly file: string
  readonly symbols: readonly Symbol[]
  readonly imports: readonly string[]
}

export interface Ranked {
  readonly entry: FileEntry
  readonly references: number
  readonly score: number
}

export interface Options {
  /** Characters of output, not tokens. ~4 chars per token for the code-ish text of a map. */
  readonly budget?: number
  readonly symbolsPerFile?: number
  /** Hard cap per line so one symbol-rich file cannot push the rest out of view. */
  readonly lineLimit?: number
}

const DEFAULTS = { budget: 4000, symbolsPerFile: 5, lineLimit: 180 } as const

const SOURCE_DIR = /(^|\/)(src|lib|source|app)\//

/** A trailing source extension in an import specifier: `./bus.js` points at `bus.ts` on disk. */
const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?|pyi?|go|rs|java|rb|php|[ch])$/

/** Every extension the scanner can produce, in the order a spec is most likely to resolve. */
const RESOLVE_SUFFIXES = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
  ".py",
  ".pyi",
  ".go",
  ".rs",
  ".java",
  ".rb",
  ".php",
  ".c",
  ".h",
]

/**
 * Turns an import specifier into a map key. Only relative specifiers resolve: a bare `react` or a
 * go import path points outside the repository, and guessing at it would create edges that do not
 * exist.
 *
 * TypeScript writes `./bus.js` for a file that is `bus.ts` on disk, so a specifier carrying a
 * source extension is tried twice — as written, then with the extension removed.
 */
export const resolve = (files: ReadonlySet<string>, from: string, spec: string): string | undefined => {
  if (!spec.startsWith(".")) return undefined
  const directory = posix.dirname(from)
  // Python writes the module path with dots, and each extra leading dot walks one directory up.
  const python = /^\.+[A-Za-z_]/.test(spec) && !spec.includes("/")
  const base = (value: string) =>
    python
      ? posix.normalize(
          posix.join(directory, "../".repeat(value.match(/^\.+/)![0].length - 1), value.replace(/^\.+/, "").replace(/\./g, "/")),
        )
      : posix.normalize(posix.join(directory, value))

  const attempt = (value: string): string | undefined => {
    const target = base(value)
    if (files.has(target)) return target
    for (const suffix of RESOLVE_SUFFIXES) if (files.has(target + suffix)) return target + suffix
    for (const suffix of [".ts", ".tsx", ".js", ".jsx"]) if (files.has(`${target}/index${suffix}`)) return `${target}/index${suffix}`
    if (files.has(`${target}/__init__.py`)) return `${target}/__init__.py`
    if (files.has(`${target}/mod.rs`)) return `${target}/mod.rs`
    return undefined
  }

  const direct = attempt(spec)
  if (direct) return direct
  const stripped = spec.replace(SOURCE_EXTENSION, "")
  return stripped === spec ? undefined : attempt(stripped)
}

export const rank = (entries: readonly FileEntry[]): Ranked[] => {
  const files = new Set(entries.map((entry) => entry.file))
  const references = new Map<string, number>()
  for (const entry of entries) {
    const counted = new Set<string>()
    for (const spec of entry.imports) {
      const target = resolve(files, entry.file, spec)
      // One file importing another twice (a value plus a type) is still one dependency.
      if (!target || target === entry.file || counted.has(target)) continue
      counted.add(target)
      references.set(target, (references.get(target) ?? 0) + 1)
    }
  }
  return entries
    .map((entry) => {
      const count = references.get(entry.file) ?? 0
      const boost = SOURCE_DIR.test(entry.file) ? 2 : 0
      return { entry, references: count, score: count * 8 + boost }
    })
    .sort((a, b) => b.score - a.score || (a.entry.file < b.entry.file ? -1 : a.entry.file > b.entry.file ? 1 : 0))
}

const line = (entry: FileEntry, options: Required<Options>): string => {
  const picked: string[] = []
  const seen = new Set<string>()
  let text = `${entry.file}:`
  for (const symbol of entry.symbols) {
    if (picked.length >= options.symbolsPerFile) break
    if (seen.has(symbol.name)) continue
    const token = `${symbol.name}(${symbol.line})`
    if (text.length + token.length + 1 > options.lineLimit) break
    seen.add(symbol.name)
    picked.push(token)
  }
  text += " " + picked.join(" ")
  const hidden = entry.symbols.filter((symbol) => !seen.has(symbol.name)).length
  return hidden > 0 ? `${text} +${hidden}` : text
}

/**
 * Fills the budget in rank order. A file that does not fit is skipped rather than stopping the
 * loop, so a long line near the top does not blank out the rest of the map — the remaining files
 * are simply shorter. Whatever is skipped is reported in one closing line, which tells the model
 * the map is partial without spending a line per omission.
 */
export const render = (entries: readonly FileEntry[], options: Options = {}): string => {
  const settings = { ...DEFAULTS, ...options }
  const lines: string[] = []
  let used = 0
  let skipped = 0
  for (const { entry } of rank(entries)) {
    const text = line(entry, settings)
    if (used + text.length + 1 > settings.budget) {
      skipped++
      continue
    }
    lines.push(text)
    used += text.length + 1
  }
  // The footer is what keeps the map honest about being partial, so it is paid for out of the
  // same budget rather than added on top: dropping the tail lines is cheaper than a silently
  // incomplete list.
  const footer = (count: number) => `… and ${count} more file${count === 1 ? "" : "s"} with exported symbols`
  while (skipped > 0 && lines.length > 0 && used + footer(skipped).length + 1 > settings.budget) {
    used -= lines.pop()!.length + 1
    skipped++
  }
  if (skipped > 0 && lines.length > 0) lines.push(footer(skipped))
  return lines.join("\n")
}
