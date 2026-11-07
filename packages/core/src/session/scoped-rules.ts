export * as SessionScopedRules from "./scoped-rules.js"

import { readdir, readFile } from "fs/promises"
import { join, relative } from "path"
import { DateTime } from "effect"
import { Glob } from "@opencode/util/glob"
import { ConfigMarkdown } from "../config/markdown.js"
import { SessionMessage } from "./message.js"
import { collectPaths } from "./package-rules.js"

/**
 * SiCode: path-scoped rules, the `.cursor/rules` half that `AGENTS.md` cannot express.
 *
 * `AGENTS.md` is discovered by directory and injected whole: the root file applies to every turn,
 * so "read DESIGN.md before changing CSS" sits in context 100% of the time and gets followed 1% of
 * it. A rule that names its own globs only enters the turn that is already touching those files.
 *
 * Files live in `.sicode/rules/*.md`:
 *
 * ```md
 * ---
 * description: UI values live in packages/ui/DESIGN.md
 * globs: packages/{ui,session-ui,app}/**\/*.{css,tsx}
 * ---
 * - Read packages/ui/DESIGN.md before changing spacing, radius or type.
 * ```
 *
 * `always: true` injects on every turn regardless of paths — use it sparingly, it is a worse
 * `AGENTS.md`. A rule with neither `globs` nor `always` is never injected; it stays documentation.
 *
 * Request-only, like package-rules: nothing is written to the session and the cached system prefix
 * is untouched. `OPENCODE_SCOPED_RULES=0` turns it off.
 */

/** Cap one rule so a long one cannot eat the budget alone. */
const PER_FILE = 1_800
/** Cap the whole injection; rules are applied in file-name order until the budget runs out. */
const DEFAULT_BUDGET = 3_000

const RULES_DIRECTORY = join(".sicode", "rules")

type Rule = {
  readonly source: string
  readonly text: string
  readonly globs: readonly string[]
  readonly always: boolean
  readonly description: string | undefined
}

/**
 * Splits on commas that are not inside `{...}`. A glob uses commas itself
 * (`packages/{ui,app}/**`), so a plain `split(",")` shreds a valid pattern.
 */
const splitTopLevel = (value: string) => {
  const parts: string[] = []
  let depth = 0
  let current = ""
  for (const char of value) {
    if (char === "{") depth++
    if (char === "}") depth = Math.max(0, depth - 1)
    if (char === "," && depth === 0) {
      parts.push(current)
      current = ""
      continue
    }
    current += char
  }
  parts.push(current)
  return parts
}

const stringList = (value: unknown): string[] => {
  if (typeof value === "string") return splitTopLevel(value).map((item) => item.trim()).filter(Boolean)
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
}

const boolean = (value: unknown) => {
  if (typeof value === "boolean") return value
  if (typeof value !== "string") return false
  return ["true", "yes", "on", "1"].includes(value.trim().toLowerCase())
}

/** Project-relative form of a tool path, or `undefined` when it sits outside the project. */
const relativeTo = (root: string, path: string) => {
  const normalizedRoot = root.replace(/\\/g, "/").replace(/\/+$/, "")
  const normalized = path.replace(/\\/g, "/")
  const absolute =
    /^[A-Za-z]:\//.test(normalized) || normalized.startsWith("/")
      ? normalized
      : `${normalizedRoot}/${normalized.replace(/^\.\//, "")}`
  // Windows `relative` across drives returns an absolute path rather than `..`, so reject those too.
  const result = relative(normalizedRoot, absolute).replace(/\\/g, "/")
  if (!result || result === "." || result.startsWith("..") || /^[A-Za-z]:/.test(result)) return undefined
  return result
}

/** Reads one rule file; a file without frontmatter or without a body is silence. */
export const parse = (source: string, content: string): Rule | undefined => {
  const markdown = ConfigMarkdown.parseOption(content)
  if (!markdown) return undefined
  const body = markdown.content.trim()
  if (body.length === 0) return undefined
  const data: Record<string, unknown> = markdown.data
  const description = typeof data.description === "string" ? data.description.trim() : undefined
  return {
    source,
    text: body,
    globs: stringList(data.globs),
    always: boolean(data.always),
    description: description || undefined,
  }
}

export const applies = (rule: Rule, paths: readonly string[]) =>
  rule.always || paths.some((path) => rule.globs.some((glob) => Glob.match(glob, path)))

/** Rules that apply to this turn, in file-name order, under budget. */
export const loadRules = async (input: {
  readonly directory: string
  readonly paths: readonly string[]
  readonly budget?: number
}): Promise<readonly Rule[]> => {
  const budget = input.budget ?? DEFAULT_BUDGET
  const paths = input.paths.flatMap((path) => {
    const result = relativeTo(input.directory, path)
    return result === undefined ? [] : [result]
  })

  const entries = await readdir(join(input.directory, RULES_DIRECTORY)).catch(() => [] as string[])
  const files = entries.filter((entry) => entry.endsWith(".md")).toSorted()

  const kept: Rule[] = []
  let used = 0
  for (const file of files) {
    const source = `${RULES_DIRECTORY.replace(/\\/g, "/")}/${file}`
    const content = await readFile(join(input.directory, RULES_DIRECTORY, file), "utf8").catch(() => undefined)
    if (content === undefined) continue
    const rule = parse(source, content)
    if (!rule || !applies(rule, paths)) continue
    const text = clip(rule.text, PER_FILE)
    const size = text.length + source.length + 32
    if (used + size > budget) continue
    kept.push({ ...rule, text })
    used += size
  }
  return kept
}

const clip = (text: string, limit: number) => {
  if (text.length <= limit) return text
  const cut = text.slice(0, limit)
  const breakAt = Math.max(cut.lastIndexOf("\n\n"), cut.lastIndexOf("\n- "), cut.lastIndexOf("\n## "))
  const body = (breakAt > limit * 0.4 ? cut.slice(0, breakAt) : cut).trimEnd()
  return `${body}\n\n…(truncated; read the full file for the rest)`
}

const hintMessage = (rules: readonly Rule[]): SessionMessage.Synthetic => ({
  id: SessionMessage.ID.create(),
  time: { created: DateTime.makeUnsafe(Date.now()) },
  type: "synthetic",
  metadata: { notice: "scoped-rules" },
  description: `Project rules for the files this turn is touching: ${rules.map((rule) => rule.source).join(", ")}`,
  text: [
    "<scoped-rules>",
    "Rules that apply to the files this turn is already working on. Follow them; they narrow the project-wide instructions.",
    "",
    ...rules.flatMap((rule) => [
      `### ${rule.source}${rule.description ? ` — ${rule.description}` : ""}`,
      rule.text,
      "",
    ]),
    "</scoped-rules>",
  ].join("\n"),
})

/**
 * Prepends `.sicode/rules` entries whose globs match a path this turn already names or touches.
 * Never throws: an unreadable rules directory is silence, not a failed turn.
 */
export const inject = async (input: {
  readonly messages: ReadonlyArray<SessionMessage.Info>
  readonly directory: string
  readonly enabled?: boolean
  readonly budget?: number
}): Promise<ReadonlyArray<SessionMessage.Info>> => {
  if (input.enabled === false) return input.messages
  const index = input.messages.findLastIndex((message) => message.type === "user")
  if (index < 0) return input.messages

  const rules = await loadRules({
    directory: input.directory,
    paths: collectPaths(input.messages),
    budget: input.budget,
  }).catch(() => [] as readonly Rule[])
  if (rules.length === 0) return input.messages

  const messages = [...input.messages]
  messages.splice(index + 1, 0, hintMessage(rules))
  return messages
}
