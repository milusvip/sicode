/**
 * SiCode: consecutive empty greps/globs — the deterministic trigger for "stop serial-guessing keywords".
 *
 * Flash (and similar) often burns a turn on one English keyword at a time. Prompt rules ask it to
 * expand synonyms, but the model counts "I tried something new" itself. Empty search results are
 * objective: the runner can count them and inject one short reminder to batch synonyms in
 * `patterns` or change the angle, instead of hoping the tool description is read again.
 *
 * Chinese / CJK empty greps nudge on the first miss (`early`): Flash will often switch angle after
 * one empty without ever hitting the default streak of 2, so the reminder never fired in real
 * dual-track sessions. English still waits for `SEARCH_MISS_FIRST` consecutive empties.
 *
 * Only `grep` and `glob` count. A hit (matches > 0, or glob paths) resets the trailing streak.
 * Errors and aborted calls are ignored — those are not "wrong keyword" signals.
 */
import type { SessionMessage } from "../message.js"

/** Consecutive empty search tools before the first expansion nudge (non-CJK). */
export const SEARCH_MISS_FIRST = 2
/** Whole-turn empty searches that must accumulate again between nudges (non-CJK). */
export const SEARCH_MISS_EVERY = 2

/**
 * Soft once: batch synonyms. Soft alone was ignored (narrate then keep grepping). A second empty
 * streak after this soft becomes SEARCH_MISS_STOP.
 */
export const SEARCH_MISS_PROMPT = `Recent searches returned no matches.

Do not guess one English keyword at a time. Before the next search:

1. List 3–8 synonyms / camelCase splits / visible UI strings, and pass them in grep \`patterns\` (preferred) or as one plain \`a|b|c\` pattern — one call.
2. If the user wrote Chinese or the artifact is a Chinese product: batch Chinese UI/feature strings AND English synonyms in the same \`patterns\` call. Do not search English-only when the dump/UI is CJK. If the query was a Chinese concept over source code, also map it to identifiers the repo uses (or change angle via glob / repo map).
3. Say in one line what terms you are trying next. Do not ask the user in prose and keep searching.`

/** Soft synonym nudge was ignored / still empty — withdraw tools (same shape as search cap). */
export const SEARCH_MISS_STOP_PROMPT = `Searches are still empty after the synonym-batch reminder.

Stop searching. Answer with what you have now:

1. What you tried (patterns / angles).
2. That you did not find it.
3. The one concrete next ask for the user (the code name, path, or symbol) — in the reply only. Do not call tools this step. Do not open an explore subagent.`

const SEARCH_TOOLS = new Set(["grep", "glob"])
/** Han ideographs — enough to spot a Chinese concept query Flash typed into grep. */
const CJK = /[\u3400-\u9fff]/

type ToolPart = Extract<SessionMessage.AssistantContent, { type: "tool" }>

function isSearchTool(part: ToolPart) {
  return SEARCH_TOOLS.has(part.name)
}

/** Completed search with zero hits. Errors/aborts do not count as misses. */
function isEmptySearch(part: ToolPart): boolean {
  if (part.state.status !== "completed") return false
  if (!isSearchTool(part)) return false
  const metadata = part.state.metadata
  if (!metadata || typeof metadata !== "object") return false
  if (part.name === "grep") {
    const matches = (metadata as { matches?: unknown }).matches
    return typeof matches === "number" && matches === 0
  }
  // glob reports `count` in metadata (see glob.ts).
  const count = (metadata as { count?: unknown }).count
  return typeof count === "number" && count === 0
}

function isSuccessfulSearch(part: ToolPart) {
  if (part.state.status !== "completed") return false
  if (!isSearchTool(part)) return false
  return !isEmptySearch(part)
}

/** Empty grep whose pattern still carries CJK — Flash searched the UI phrase, not an identifier. */
export function isCjkEmptyGrep(part: ToolPart): boolean {
  if (part.name !== "grep" || !isEmptySearch(part)) return false
  const input = part.state.input
  if (!input || typeof input !== "object") return false
  const pattern = (input as { pattern?: unknown }).pattern
  return typeof pattern === "string" && CJK.test(pattern)
}

/** Settled tool calls of this turn, oldest first; a user message ends the turn. */
function trailingToolCalls(messages: ReadonlyArray<SessionMessage.Info>): ToolPart[] {
  const calls: ToolPart[] = []
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!
    if (message.type === "user") break
    if (message.type !== "assistant") continue
    for (const part of message.content) {
      if (part.type !== "tool") continue
      if (part.state.status === "streaming" || part.state.status === "running") continue
      calls.unshift(part)
    }
  }
  return calls
}

export interface SearchMissStreak {
  /** Empty searches at the end of the turn (broken by any successful search). */
  readonly streak: number
  /** Empty searches in the whole turn — monotonic, so the caller can pace re-nudges. */
  readonly total: number
  /**
   * Trailing streak includes a CJK empty grep — nudge on the first miss so Flash does not
   * skip the reminder by recovering after exactly one empty Chinese search.
   */
  readonly early: boolean
}

/** Latest user text in this turn carries Han ideographs. */
export function userMessageHasCjk(messages: ReadonlyArray<SessionMessage.Info>): boolean {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!
    if (message.type !== "user") continue
    return CJK.test(message.text)
  }
  return false
}

/** Empty grep whose pattern is ASCII-only (no CJK). */
function isAsciiEmptyGrep(part: ToolPart): boolean {
  if (part.name !== "grep" || !isEmptySearch(part)) return false
  const input = part.state.input
  if (!input || typeof input !== "object") return false
  const pattern = (input as { pattern?: unknown }).pattern
  const patterns = (input as { patterns?: unknown }).patterns
  const texts: string[] = []
  if (typeof pattern === "string") texts.push(pattern)
  if (Array.isArray(patterns)) {
    for (const item of patterns) {
      if (typeof item === "string") texts.push(item)
    }
  }
  if (texts.length === 0) return false
  return texts.every((text) => !CJK.test(text))
}

/**
 * How many empty greps/globs trail the turn. A successful search resets `streak` but not `total`.
 * Returns null when the turn has no settled search tools yet.
 *
 * `early` also fires when the user wrote Chinese but trailing empty greps stayed English-only —
 * Flash otherwise burns two ASCII misses before the bilingual reminder (ses_e508 tipa dumps).
 */
export function detectSearchMissStreak(messages: ReadonlyArray<SessionMessage.Info>): SearchMissStreak | null {
  const calls = trailingToolCalls(messages).filter(isSearchTool)
  if (calls.length === 0) return null

  const total = calls.filter(isEmptySearch).length
  let streak = 0
  let early = false
  let asciiMisses = 0
  for (let index = calls.length - 1; index >= 0; index--) {
    const part = calls[index]!
    if (isSuccessfulSearch(part)) break
    if (!isEmptySearch(part)) continue
    streak++
    if (isCjkEmptyGrep(part)) early = true
    if (isAsciiEmptyGrep(part)) asciiMisses++
  }
  if (!early && asciiMisses > 0 && userMessageHasCjk(messages)) early = true
  return { streak, total, early }
}

/** Whether the runner should inject SEARCH_MISS_PROMPT given the last paced total. */
export function shouldNudgeSearchMiss(hit: SearchMissStreak, pacedAt: number): boolean {
  const first = hit.early ? 1 : SEARCH_MISS_FIRST
  const every = hit.early ? 1 : SEARCH_MISS_EVERY
  return hit.streak >= first && hit.total - pacedAt >= every
}

/**
 * Soft already fired this turn and another empty streak is due → hard stop.
 * Structural: one synonym chance, then withdraw tools.
 */
export function shouldStopSearchMiss(hit: SearchMissStreak, pacedAt: number, softAlready: boolean): boolean {
  if (!softAlready) return false
  return shouldNudgeSearchMiss(hit, pacedAt)
}
