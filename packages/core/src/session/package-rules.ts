export * as SessionPackageRules from "./package-rules.js"

import { readFile, stat } from "fs/promises"
import { join, relative } from "path"
import { DateTime } from "effect"
import { SessionMessage } from "./message.js"

/**
 * SiCode: inject nested `AGENTS.md` files when the turn is already working inside that package,
 * because the alternative does not happen.
 *
 * Root `AGENTS.md` is already discovered and cached in the system prefix. Package-local ones
 * (`packages/ui/AGENTS.md`, `packages/app/AGENTS.md`, `packages/core/src/tool/AGENTS.md`, …) are
 * only found when the session directory sits inside that package — sessions almost always start
 * at the repo root, so those rules never appear. Models are told to read them and do not
 * (same failure mode as DESIGN.md → design-hint).
 *
 * This is the light Cursor-style "Fetch Rules" half: request-only, path-triggered, budgeted.
 * Nothing is written to the session; the cached system prefix is untouched. `OPENCODE_PACKAGE_RULES=0`
 * turns it off for A/B.
 */

const PATH_TOOLS = new Set(["edit", "write", "patch", "read", "grep", "glob"])

/** Paths that look like they sit under a package or service of this monorepo. */
const PATH_IN_TEXT =
  /(?:^|[\s`"'(=])((?:packages|services)\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._/@-]*)?)/g

/**
 * Backticked file references outside `packages/`/`services/`, which the monorepo pattern misses.
 * Only a token with a separator or a file extension counts, so `` `useEffect` `` stays a symbol.
 */
const BACKTICK_PATH = /`([^`\n]{2,200})`/g
const looksLikePath = (token: string) =>
  !token.includes(" ") && (/[/\\]/.test(token) || /\.[A-Za-z0-9]{1,8}$/.test(token))

/** Cap one file so a long package guide cannot eat the whole budget alone. */
const PER_FILE = 1_800
/** Cap the whole injection; deeper (more specific) files win when the budget runs out. */
const DEFAULT_BUDGET = 3_000

const touched = (input: { filePath?: unknown; path?: unknown }) =>
  String(input.filePath ?? input.path ?? "").replace(/\\/g, "/")

const fromText = (text: string) => {
  const found: string[] = []
  for (const match of text.matchAll(PATH_IN_TEXT)) {
    const path = match[1]
    if (path) found.push(path.replace(/\/+$/, ""))
  }
  for (const match of text.matchAll(BACKTICK_PATH)) {
    const token = match[1]?.trim()
    if (token && looksLikePath(token)) found.push(token.replace(/\/+$/, ""))
  }
  return found
}

/**
 * Paths this turn is already acting on: the current user text, plus file arguments from the
 * assistant turn immediately before it. Same window as design-hint — one prior turn, not the
 * whole session — so an old edit under `packages/ui` does not keep re-injecting forever.
 */
export const collectPaths = (messages: ReadonlyArray<SessionMessage.Info>): string[] => {
  const index = messages.findLastIndex((message) => message.type === "user")
  if (index < 0) return []
  const paths: string[] = []
  const user = messages[index]
  if (user?.type === "user") paths.push(...fromText(user.text))

  for (let cursor = index - 1; cursor >= 0; cursor--) {
    const message = messages[cursor]!
    if (message.type === "user") break
    if (message.type !== "assistant") continue
    for (const part of message.content) {
      if (part.type !== "tool" || !PATH_TOOLS.has(part.name)) continue
      const path = touched(part.state.input as { filePath?: unknown; path?: unknown })
      if (path) paths.push(path)
    }
  }

  return [...new Set(paths.map((path) => path.replace(/\\/g, "/")).filter((path) => path.length > 0))]
}

/**
 * Ancestor directories of `path` that sit inside `root`, deepest first. Absolute paths outside
 * the root are ignored — nested rules are a project concern, not an external-directory one.
 */
export const ruleDirs = (path: string, root: string): string[] => {
  const normalizedRoot = root.replace(/\\/g, "/")
  const absolute = path.match(/^[A-Za-z]:\//) || path.startsWith("/") ? path : join(root, path).replace(/\\/g, "/")
  const rel = relative(normalizedRoot, absolute).replace(/\\/g, "/")
  // Windows `relative` across drives returns an absolute path (no `..`); reject those too.
  if (!rel || rel === "." || rel.startsWith("..") || rel.startsWith("/") || /^[A-Za-z]:/.test(rel)) return []

  const parts = rel.split("/")
  // Drop the file name when the last segment looks like one; keep directory-only paths intact.
  const dirParts = parts[parts.length - 1]!.includes(".") ? parts.slice(0, -1) : parts
  const dirs: string[] = []
  for (let i = dirParts.length; i >= 1; i--) {
    dirs.push(dirParts.slice(0, i).join("/"))
  }
  return dirs
}

const clip = (text: string, limit: number) => {
  const trimmed = text.trim()
  if (trimmed.length <= limit) return trimmed
  const cut = trimmed.slice(0, limit)
  const breakAt = Math.max(cut.lastIndexOf("\n\n"), cut.lastIndexOf("\n- "), cut.lastIndexOf("\n## "))
  const body = (breakAt > limit * 0.4 ? cut.slice(0, breakAt) : cut).trimEnd()
  return `${body}\n\n…(truncated; read the full file for the rest)`
}

type Loaded = { readonly source: string; readonly text: string; readonly depth: number }

const loadOne = async (root: string, dir: string): Promise<Loaded | undefined> => {
  // Root AGENTS.md is already in the cached instruction prefix — never re-inject it.
  if (dir === "" || dir === ".") return undefined
  const relative = `${dir}/AGENTS.md`.replace(/\\/g, "/")
  const absolute = join(root, ...dir.split("/"), "AGENTS.md")
  try {
    const info = await stat(absolute)
    if (!info.isFile()) return undefined
    const raw = await readFile(absolute, "utf8")
    if (raw.trim().length === 0) return undefined
    return { source: relative, text: clip(raw, PER_FILE), depth: dir.split("/").length }
  } catch {
    return undefined
  }
}

/** Load nested AGENTS.md for the collected paths, deepest (most specific) first, under budget. */
export const loadRules = async (input: {
  readonly directory: string
  readonly paths: readonly string[]
  readonly budget?: number
}): Promise<readonly Loaded[]> => {
  const budget = input.budget ?? DEFAULT_BUDGET
  const dirs = new Set<string>()
  for (const path of input.paths) {
    for (const dir of ruleDirs(path, input.directory)) dirs.add(dir)
  }

  const loaded: Loaded[] = []
  for (const dir of dirs) {
    const file = await loadOne(input.directory, dir)
    if (file) loaded.push(file)
  }

  // Deeper paths first so `packages/ui/AGENTS.md` beats a hypothetical `packages/AGENTS.md`.
  loaded.sort((a, b) => b.depth - a.depth || a.source.localeCompare(b.source))

  const kept: Loaded[] = []
  let used = 0
  for (const file of loaded) {
    const size = file.text.length + file.source.length + 32
    if (used + size > budget) continue
    kept.push(file)
    used += size
  }
  return kept
}

const hintMessage = (rules: readonly Loaded[]): SessionMessage.Synthetic => ({
  id: SessionMessage.ID.create(),
  time: { created: DateTime.makeUnsafe(Date.now()) },
  type: "synthetic",
  metadata: { notice: "package-rules" },
  description: `Package rules from ${rules.map((rule) => rule.source).join(", ")}`,
  text: [
    "<package-rules>",
    "Local rules for the package(s) this turn is already touching. Prefer these over inventing conventions; root AGENTS.md is already in your instructions.",
    "",
    ...rules.flatMap((rule) => [`### ${rule.source}`, rule.text, ""]),
    "</package-rules>",
  ].join("\n"),
})

/**
 * Prepends nested package AGENTS.md when the turn already names or touches those packages.
 * Never throws: a missing file is silence, not a failed turn.
 */
export const inject = async (input: {
  readonly messages: ReadonlyArray<SessionMessage.Info>
  readonly directory: string
  readonly enabled?: boolean
  readonly budget?: number
}): Promise<ReadonlyArray<SessionMessage.Info>> => {
  if (input.enabled === false) return input.messages
  const paths = collectPaths(input.messages)
  if (paths.length === 0) return input.messages

  const rules = await loadRules({
    directory: input.directory,
    paths,
    budget: input.budget,
  }).catch(() => [] as readonly Loaded[])
  if (rules.length === 0) return input.messages

  const index = input.messages.findLastIndex((message) => message.type === "user")
  if (index < 0) return input.messages

  const messages = [...input.messages]
  messages.splice(index + 1, 0, hintMessage(rules))
  return messages
}
