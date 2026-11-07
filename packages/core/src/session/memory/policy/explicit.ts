/**
 * SiCode: explicit-remember policy — user said 记住 / prefer, or Requirements bullets.
 * One of several Observation policies; inject/runner stay free of these patterns.
 */
import { normalizeAll, type Observation } from "../observation.js"

const MAX_CLAUSES = 5
const MIN_LEN = 4
const MAX_LEN = 200

const splitClauses = (text: string): string[] =>
  text
    .split(/[；;，,]|(?:\s+and\s+)/i)
    .map((part) => part.trim().replace(/[。.]+$/, ""))
    .filter((part) => part.length >= MIN_LEN && part.length <= MAX_LEN)

const dedupe = (items: readonly string[]) => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    const key = item.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

const propositionsFromUserText = (text: string): string[] => {
  const trimmed = text.trim()
  if (!trimmed) return []

  const out: string[] = []
  const whole = /^(?:请)?记住[：:\s]+(.+)$/s.exec(trimmed)
  if (whole?.[1]) return dedupe(splitClauses(whole[1])).slice(0, MAX_CLAUSES)

  for (const match of trimmed.matchAll(/(?:请)?记住[：:]\s*([^。\n]+)/g)) {
    out.push(...splitClauses(match[1] ?? ""))
  }
  for (const match of trimmed.matchAll(/我(?:的)?偏好[是为：:\s]*([^。\n]+)/g)) {
    out.push(...splitClauses(match[1] ?? ""))
  }
  for (const match of trimmed.matchAll(/\bprefer(?:ence)?[:\s]+([^.\n]+)/gi)) {
    out.push(...splitClauses(match[1] ?? ""))
  }

  return dedupe(out).slice(0, MAX_CLAUSES)
}

const PREF_HINT = /偏好|喜欢|prefer|always|never|不要|请先|简短|concise|short reply/i

const propositionsFromSummary = (markdown: string): string[] => {
  const out: string[] = []
  let inRequirements = false

  for (const raw of markdown.split("\n")) {
    const line = raw.trim()
    const heading = /^##\s+(.+)$/.exec(line)
    if (heading) {
      inRequirements = (heading[1]?.toLowerCase().trim() ?? "") === "requirements"
      continue
    }
    if (!inRequirements) continue
    const bullet = /^(?:[-*]|\d+\.)\s+(.+)$/.exec(line)
    const text = bullet?.[1]?.trim()
    if (!text || /^\(none\)$/i.test(text)) continue
    if (!PREF_HINT.test(text)) continue
    out.push(...splitClauses(text))
  }

  return dedupe(out).slice(0, 8)
}

/** User typed an explicit remember / prefer directive. */
export const fromUserText = (text: string): Observation[] =>
  normalizeAll(
    propositionsFromUserText(text).map((item) => ({
      scope: "persona" as const,
      kind: "preference" as const,
      text: item,
      strength: 0.9,
      source: { type: "user" as const },
      explicit: true,
    })),
  )

/** Compaction ## Requirements preference-like bullets. */
export const fromSummary = (markdown: string): Observation[] =>
  normalizeAll(
    propositionsFromSummary(markdown).map((item) => ({
      scope: "persona" as const,
      kind: "preference" as const,
      text: item,
      strength: 0.8,
      source: { type: "compaction" as const },
      explicit: true,
    })),
  )
