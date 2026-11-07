export * as SessionTopicSwitch from "./topic-switch.js"

import { DateTime } from "effect"
import { SessionMessage } from "./message.js"

/**
 * SiCode: mid-session topic switch from **structural** signals only — path/package locus of the
 * previous tool turn vs paths named or attached on the new user message.
 *
 * The hint names both loci so Flash can drop the old subject without a word-list “intent” guess.
 * No lexical Jaccard. Pathless new asks stay silent. `OPENCODE_TOPIC_SWITCH=0` off.
 */

// SiCode: include Unicode letters so CJK / Windows paths participate in topic-switch locus.
const PATH_IN_TEXT =
  /(?:^|[\s`"'(=:])((?:packages|services)\/[\p{L}\p{N}._丨@-]+(?:\/[\p{L}\p{N}._丨@-]+)*|(?:[A-Za-z]:[\/\\])?(?:[\p{L}\p{N}._丨@-]+[\/\\])+[\p{L}\p{N}._丨@-]+\.[A-Za-z0-9]{1,12})/gu

const PATH_TOOLS = new Set(["edit", "write", "patch", "read", "grep", "glob"])

const normalize = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()

export const packageRoot = (path: string): string | undefined => {
  const match = normalize(path).match(/(?:^|\/)((?:packages|services)\/[^/]+)/)
  return match?.[1]
}

export const locusOf = (paths: readonly string[]): ReadonlySet<string> => {
  const roots = new Set<string>()
  const files = new Set<string>()
  for (const raw of paths) {
    const path = normalize(raw)
    if (!path) continue
    const root = packageRoot(path)
    if (root) roots.add(root)
    else files.add(path)
  }
  return roots.size > 0 ? roots : files
}

export const pathsInText = (text: string): string[] => {
  const found: string[] = []
  for (const match of text.matchAll(PATH_IN_TEXT)) {
    const path = match[1]
    if (!path) continue
    const cleaned = path.replace(/\/+$/, "")
    // SiCode: CLI dumps quote flags like "-S/tmp/x.plist"; a leading dash is not a path.
    if (/^-/.test(cleaned)) continue
    found.push(cleaned)
  }
  return found
}

const toolPaths = (message: SessionMessage.Info): string[] => {
  if (message.type !== "assistant") return []
  const paths: string[] = []
  for (const part of message.content) {
    if (part.type !== "tool" || !PATH_TOOLS.has(part.name)) continue
    const input = part.state.input as { filePath?: unknown; path?: unknown }
    const path = String(input.filePath ?? input.path ?? "")
    if (path) paths.push(path)
  }
  return paths
}

const userFiles = (message: SessionMessage.Info): string[] => {
  if (message.type !== "user" || !message.files) return []
  const paths: string[] = []
  for (const file of message.files) {
    if (file.name) paths.push(file.name)
    if (file.mention?.text) paths.push(...pathsInText(file.mention.text))
    if (file.source.type === "uri") paths.push(...pathsInText(file.source.uri), file.source.uri)
  }
  return paths
}

export const disjointLocus = (prior: ReadonlySet<string>, next: ReadonlySet<string>): boolean => {
  if (prior.size === 0 || next.size === 0) return false
  for (const item of next) {
    for (const base of prior) {
      if (item === base || item.startsWith(base + "/") || base.startsWith(item + "/")) return false
    }
  }
  return true
}

const formatLocus = (locus: ReadonlySet<string>) => [...locus].sort().join(", ")

export const loci = (input: {
  readonly previousToolPaths: readonly string[]
  readonly previousUser?: string
  readonly nextUser: string
  readonly nextFiles?: readonly string[]
}) => {
  const prior = locusOf([...input.previousToolPaths, ...pathsInText(input.previousUser ?? "")])
  const next = locusOf([...pathsInText(input.nextUser), ...(input.nextFiles ?? [])])
  return { prior, next }
}

export const switched = (input: {
  readonly previousToolPaths: readonly string[]
  readonly previousUser?: string
  readonly nextUser: string
  readonly nextFiles?: readonly string[]
}): boolean => {
  const { prior, next } = loci(input)
  return disjointLocus(prior, next)
}

export const turnContext = (messages: ReadonlyArray<SessionMessage.Info>) => {
  const index = messages.findLastIndex((message) => message.type === "user")
  if (index < 0) return undefined
  if (messages.slice(index + 1).some((message) => message.type === "assistant" || message.type === "shell"))
    return undefined
  const current = messages[index]
  if (current?.type !== "user") return undefined

  let previousUser: string | undefined
  const previousToolPaths: string[] = []
  let sawAssistant = false
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    const message = messages[cursor]!
    if (message.type === "assistant") {
      sawAssistant = true
      previousToolPaths.push(...toolPaths(message))
      continue
    }
    if (message.type === "user") {
      previousUser = message.text
      break
    }
  }
  if (!previousUser || !sawAssistant) return undefined
  if (previousToolPaths.length === 0) return undefined

  return {
    index,
    previousUser,
    previousToolPaths,
    nextUser: current.text,
    nextFiles: userFiles(current),
  }
}

const hintMessage = (prior: ReadonlySet<string>, next: ReadonlySet<string>): SessionMessage.Synthetic => ({
  id: SessionMessage.ID.create(),
  time: { created: DateTime.makeUnsafe(Date.now()) },
  type: "synthetic",
  metadata: {
    notice: "topic-switch",
    priorLocus: [...prior].sort(),
    nextLocus: [...next].sort(),
  },
  description: `Topic moved ${formatLocus(prior)} → ${formatLocus(next)}`,
  text: [
    "<topic-switch>",
    `Structural locus moved: previous turn was under \`${formatLocus(prior)}\`; this ask targets \`${formatLocus(next)}\`.`,
    "Drop the previous approach, files, unfinished plan, and open questions from the old locus unless this message explicitly refers to them.",
    "Re-locate under the new locus with grep/read (path/include). Treat earlier tool traces as background only — do not continue editing the old files.",
    "Answer the new ask directly; do not summarize the old topic first.",
    "</topic-switch>",
  ].join("\n"),
})

export const inject = (input: {
  readonly messages: ReadonlyArray<SessionMessage.Info>
  readonly enabled?: boolean
}): ReadonlyArray<SessionMessage.Info> => {
  if (input.enabled === false) return input.messages
  const turn = turnContext(input.messages)
  if (!turn) return input.messages
  const { prior, next } = loci(turn)
  if (!disjointLocus(prior, next)) return input.messages

  const messages = [...input.messages]
  messages.splice(turn.index + 1, 0, hintMessage(prior, next))
  return messages
}

/**
 * True when this request already carries a topic-switch hint at turn start (inject ran).
 * Used by the runner to decide whether to force a soft compact before the model runs.
 */
export const pending = (messages: ReadonlyArray<SessionMessage.Info>): boolean => {
  const index = messages.findLastIndex((message) => message.type === "user")
  if (index < 0) return false
  if (messages.slice(index + 1).some((message) => message.type === "assistant" || message.type === "shell"))
    return false
  const next = messages[index + 1]
  return next?.type === "synthetic" && next.metadata?.notice === "topic-switch"
}

/**
 * Soft-compact is only worth the summarize cost when the dropped prefix is large enough.
 * Below this, the locus hint alone is enough.
 */
export const COMPACT_MIN_ESTIMATE = 12_000

/** Whether a topic-switch request should force compaction (bypass the normal ceiling). */
export const shouldCompact = (input: {
  readonly messages: ReadonlyArray<SessionMessage.Info>
  readonly estimate: number
}): boolean => {
  if (process.env.OPENCODE_TOPIC_SWITCH === "0") return false
  if (process.env.OPENCODE_TOPIC_COMPACT === "0") return false
  if (!pending(input.messages)) return false
  return input.estimate >= COMPACT_MIN_ESTIMATE
}
