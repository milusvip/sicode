export * as SessionProjectMemory from "./project-memory.js"

import { Schema } from "effect"

/**
 * What a compaction summary is allowed to leave behind as project memory.
 *
 * - `decision`: a choice and why, so a later session does not re-litigate it.
 * - `file`: where a thing lives, which is the expensive part to rediscover.
 * - `context`: a fact the next agent cannot continue without and cannot easily find in the code.
 *
 * Progress (`Work State`, `Next Move`) is deliberately absent: it describes the session, not the project, and goes
 * stale the moment the session ends.
 */
export const Kind = Schema.Literals(["decision", "file", "context"])

export type Kind = typeof Kind.Type

/** One durable fact, with the paths it names and how often a check found them missing. */
export const Fact = Schema.Struct({
  kind: Kind,
  /** The fact itself, with paths left in place for reading. */
  text: Schema.String,
  /** Paths the fact depends on, as written in the summary (a `:line` suffix is allowed). */
  paths: Schema.Array(Schema.String),
  /** Checks that found a path missing; the fact is dropped at `MISS_LIMIT`. */
  misses: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  /** When a summary last confirmed it, so the oldest fall out first. */
  seen: Schema.Finite,
})

export type Fact = typeof Fact.Type

export const Facts = Schema.Array(Fact)

/** Consecutive checks that must find a path missing before the fact is dropped. */
export const MISS_LIMIT = 2

/** Facts one project keeps; the oldest confirmed fall out past this. */
const MAX_FACTS = 200

/** The longest text kept from one bullet; a summary bullet is a line, not a paragraph. */
const MAX_TEXT = 400

/** Section headings whose bullets are facts, by the heading the summary template writes. */
const SECTIONS = new Map<string, Kind>([
  ["decisions", "decision"],
  ["relevant files", "file"],
  ["important context", "context"],
])

/**
 * Reads the facts out of a compaction summary. Only the three sections above count: everything else the template asks
 * for describes the session's progress, which must not outlive it.
 */
export function parseSummary(markdown: string, now = Date.now()): Fact[] {
  const facts: Fact[] = []
  let kind: Kind | undefined

  for (const raw of markdown.split("\n")) {
    const line = raw.trim()
    const heading = /^##\s+(.+)$/.exec(line)

    if (heading) {
      kind = SECTIONS.get(heading[1]?.toLowerCase().trim() ?? "")
      continue
    }

    if (!kind) continue
    const bullet = /^(?:[-*]|\d+\.)\s+(.+)$/.exec(line)
    const text = bullet?.[1]?.trim()

    if (!text || /^\(none\)$/i.test(text)) continue
    facts.push(kind === "file" ? fileFact(text, now) : proseFact(kind, text, now))
  }

  return dedupe(facts)
}

/**
 * Folds new facts into the ones a project already keeps: the same fact confirmed again resets its miss count, and the
 * oldest fall out past `MAX_FACTS`.
 */
export function merge(current: readonly Fact[], incoming: readonly Fact[], now = Date.now()): Fact[] {
  const merged = new Map(current.map((fact) => [keyOf(fact), fact]))

  for (const fact of incoming) merged.set(keyOf(fact), { ...fact, misses: 0, seen: now })

  return [...merged.values()].sort((a, b) => b.seen - a.seen).slice(0, MAX_FACTS)
}

/**
 * Drops facts whose paths no longer resolve. A fact with no paths is prose and is kept: there is nothing to check, and
 * guessing would delete exactly the reasoning that is hardest to recover. This is the only place memory is corrected by
 * something other than a person, so it is mechanical on purpose.
 */
export function verify(
  facts: readonly Fact[],
  exists: (path: string) => boolean,
): { kept: Fact[]; dropped: Fact[] } {
  const kept: Fact[] = []
  const dropped: Fact[] = []

  for (const fact of facts) {
    const missing = fact.paths.length > 0 && fact.paths.some((path) => !exists(fileOf(path)))
    const next = missing ? { ...fact, misses: fact.misses + 1 } : { ...fact, misses: 0 }

    if (next.misses >= MISS_LIMIT) dropped.push(next)
    else kept.push(next)
  }

  return { kept, dropped }
}

/** The path a check runs on: a `:line` or `:line-line` suffix names a place inside the file, not the file. */
export function fileOf(path: string) {
  return path.replace(/:\d+(?:-\d+)?$/, "").trim()
}

/**
 * The facts that mention the query, best first. A path hit outranks a word in the text: an agent asking about a file
 * wants the fact that names it, not the one that happens to share a word. A fact whose paths recently failed to check
 * ranks below an equally relevant one that still checks out.
 */
export function search(facts: readonly Fact[], query: string, limit = 5): Fact[] {
  const terms = query
    .toLowerCase()
    .split(/[\s,;]+/)
    .map((term) => term.trim())
    .filter(Boolean)

  if (terms.length === 0) return []

  const scored = facts.flatMap((fact) => {
    const text = fact.text.toLowerCase()
    const paths = fact.paths.map((path) => path.toLowerCase())
    const score = terms.reduce((total, term) => {
      const inPath = paths.some((path) => path.includes(term))
      const inText = text.includes(term)

      return total + (inPath ? 3 : 0) + (inText ? 1 : 0)
    }, 0)

    return score > 0 ? [{ fact, score: score - (fact.misses > 0 ? 1 : 0) }] : []
  })

  return scored
    .sort((a, b) => b.score - a.score || b.fact.seen - a.fact.seen)
    .slice(0, limit)
    .map((entry) => entry.fact)
}

function fileFact(text: string, now: number): Fact {
  const match = /^`([^`]+)`\s*:?\s*(.*)$/.exec(text)
  const path = match?.[1]?.trim()

  if (!path) return { kind: "file", text: clip(text), paths: paths(text), misses: 0, seen: now }

  return { kind: "file", text: clip(match?.[2]?.trim() || path), paths: [path], misses: 0, seen: now }
}

function proseFact(kind: Kind, text: string, now: number): Fact {
  return { kind, text: clip(text), paths: paths(text), misses: 0, seen: now }
}

/** Paths a bullet names in code spans; a span is a path when it looks like one. */
function paths(text: string) {
  return Array.from(text.matchAll(/`([^`]+)`/g), (match) => match[1]?.trim() ?? "").filter(looksLikePath)
}

function looksLikePath(token: string) {
  return /[/\\]/.test(token) || /\.(?:tsx?|jsx?|mdx?|json|css|html|sql|ya?ml|toml)$/i.test(fileOf(token))
}

function clip(text: string) {
  const value = text.replace(/\s+/g, " ").trim()

  return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT - 1)}…` : value
}

function keyOf(fact: Fact) {
  return `${fact.kind}\u0000${fact.text.toLowerCase()}`
}

function dedupe(facts: readonly Fact[]) {
  const byKey = new Map(facts.map((fact) => [keyOf(fact), fact]))

  return [...byKey.values()]
}
