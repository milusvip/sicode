/**
 * SiCode: turn-intent — when to open Explore up front, when a plan file awaits approval, and when
 * to hard-cap main-chain search.
 *
 * Intent is structural only:
 *   - known → path / host / file token already named
 *   - broad → interrogative shape with no code locus (Explore once up front)
 *   - other → everything else (including design/implement — no verb word lists)
 *
 * Plan-upfront-by-phrase is gone. Approval wait is structural: a `.sicode/plans/` write this turn.
 * Search cap: after N main-chain grep/glob calls, stop tools (Cursor MAX_TOOL_CALLS shape).
 */
import type { SessionMessage } from "../message.js"

/** Main-chain grep/glob calls this turn before tools are withdrawn. */
export const SEARCH_CAP = 5

/** Tools advertised while forcing the upfront plan write. */
export const PLAN_FOCUS_TOOLS = ["write", "read", "question", "grep", "glob"] as const

export type LocateIntent = "broad" | "known" | "other"

/** User already named a path / drive / site / file — main chain should act, not Explore. */
const KNOWN_LOCUS =
  /[A-Za-z]:\\[^\s]+|(?:^|\s)(?:\.\/|~\/|\/)[\w./-]+|\b[\w-]+\.(?:com|cn|net|org|io)\b|\b[\w.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|css|scss|vue|svelte|py|go|rs|java|kt|md|json|toml|yaml|yml)\b/i

const CJK = /[\u3400-\u9fff]/
const HAS_CODE_TOKEN = /[A-Za-z]{3,}|\.[a-z]{1,5}\b|::|->/
/** Trailing / particle interrogative — shape only, not an ask-phrase vocabulary. */
const INTERROGATIVE = /[?？]\s*$/u
const CJK_PARTICLE = /[吗呢么哪]/
/** English WH at start of a short locate ask — grammar, not a synonym dump. */
const EN_WH = /^(?:where|which|how)\b/i

/** Path shape for Build-native plan files. */
const PLAN_PATH = /(?:^|[\\/])\.sicode[\\/]plans[\\/][^\\/]+\.md$/i

export function classifyUserIntent(text: string): LocateIntent {
  const trimmed = text.trim()
  if (trimmed.length === 0) return "other"
  // Short ack / continuation — length only.
  if (trimmed.length <= 8) return "other"
  if (KNOWN_LOCUS.test(trimmed)) return "known"
  // English WH locate without a named path/file.
  if (EN_WH.test(trimmed)) return "broad"
  const ask = INTERROGATIVE.test(trimmed) || (CJK.test(trimmed) && CJK_PARTICLE.test(trimmed))
  if (ask && !HAS_CODE_TOKEN.test(trimmed)) return "broad"
  return "other"
}

/** Latest non-empty user text in the turn. */
export function latestUserText(messages: ReadonlyArray<SessionMessage.Info>): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!
    if (message.type !== "user") continue
    const text = message.text.trim()
    if (text) return text
  }
  return ""
}

export function intentOfTurn(messages: ReadonlyArray<SessionMessage.Info>): LocateIntent {
  return classifyUserIntent(latestUserText(messages))
}

function toolsSinceUser(messages: ReadonlyArray<SessionMessage.Info>) {
  const tools: Extract<SessionMessage.AssistantContent, { type: "tool" }>[] = []
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!
    if (message.type === "user") break
    if (message.type !== "assistant") continue
    for (const part of message.content) {
      if (part.type === "tool") tools.push(part)
    }
  }
  return tools
}

/** Grep/glob completed this turn (main-chain search budget). */
export function searchToolCount(messages: ReadonlyArray<SessionMessage.Info>): number {
  return toolsSinceUser(messages).filter(
    (part) =>
      (part.name === "grep" || part.name === "glob") &&
      (part.state.status === "completed" || part.state.status === "error"),
  ).length
}

export function hasSubagentThisTurn(messages: ReadonlyArray<SessionMessage.Info>): boolean {
  return toolsSinceUser(messages).some((part) => part.name === "subagent")
}

/** True when the model has not yet called any tool this turn — the only safe upfront Explore window. */
export function turnIsPristine(messages: ReadonlyArray<SessionMessage.Info>): boolean {
  return toolsSinceUser(messages).length === 0
}

/**
 * Broad locate + pristine turn + no Explore yet → force one Explore before main-chain greps.
 * Opt-in: OPENCODE_EXPLORE_UPFRONT=1 (harness-slim default off — let the model hunt unless forced).
 */
export function shouldUpfrontExplore(messages: ReadonlyArray<SessionMessage.Info>): boolean {
  if (process.env.OPENCODE_EXPLORE_UPFRONT !== "1") return false
  if (intentOfTurn(messages) !== "broad") return false
  if (!turnIsPristine(messages)) return false
  if (hasSubagentThisTurn(messages)) return false
  return true
}

function toolPath(part: Extract<SessionMessage.AssistantContent, { type: "tool" }>): string {
  const input = part.state.input
  if (!input || typeof input !== "object") return ""
  const path = (input as { path?: unknown }).path
  return typeof path === "string" ? path.replace(/\\/g, "/") : ""
}

/** A completed/running write (or edit) landed under `.sicode/plans/` this turn. */
export function hasPlanWriteThisTurn(messages: ReadonlyArray<SessionMessage.Info>): boolean {
  return toolsSinceUser(messages).some((part) => {
    if (part.name !== "write" && part.name !== "edit") return false
    if (part.state.status !== "completed" && part.state.status !== "running") return false
    return PLAN_PATH.test(toolPath(part))
  })
}

/**
 * Plan-upfront by design-phrase vocabulary is removed. Kept as a no-op so callers/tests compile;
 * kill switch still honored. Prefer writing `.sicode/plans/` when the model chooses, then await.
 */
export function shouldUpfrontPlan(messages: ReadonlyArray<SessionMessage.Info>): boolean {
  if (process.env.OPENCODE_PLAN_UPFRONT !== "1") return false
  void messages
  return false
}

/**
 * A plan file landed this turn — stop tools and wait for user approval before todowrite/edit.
 * Opt-in with OPENCODE_PLAN_UPFRONT=1. Structural: path under `.sicode/plans/`.
 */
export function shouldAwaitPlanApproval(messages: ReadonlyArray<SessionMessage.Info>): boolean {
  if (process.env.OPENCODE_PLAN_UPFRONT !== "1") return false
  return hasPlanWriteThisTurn(messages)
}

/** No phrase-based design suppress — completion-gate owns open todos. */
export function shouldSuppressTodoForDesign(messages: ReadonlyArray<SessionMessage.Info>): boolean {
  void messages
  return false
}

/** Main-chain search budget exhausted — stop; do not open Explore as a second hunt. */
export function shouldStopSearchCap(messages: ReadonlyArray<SessionMessage.Info>): boolean {
  return searchToolCount(messages) >= SEARCH_CAP
}

export const EXPLORE_UPFRONT_PROMPT = `This turn is a broad locate (where / how something is wired), not an edit of a known path.

This step forces one \`subagent\` call (agent "explore"). Put the user's locate goal, any synonyms, and what "done" looks like into the prompt. It returns file:line pointers (+ short excerpts); your context stays small.

Do not grep/glob on the main chain this step. After pointers return, read only those files and act.

This step forces \`subagent\` (toolChoice); do not call anything else.`

export const PLAN_UPFRONT_PROMPT = `This turn is a design / architecture / trade-off ask — not an implement of a known path.

Write one plan file now with \`write\` to \`.sicode/plans/<short-topic>.md\` (kebab-case topic, English or pinyin slug). Include:

1. Goal
2. Non-goals
3. Approach (concrete files/modules when known)
4. Risks / open questions
5. Suggested next steps after approval

Do not call \`todowrite\` and do not edit product code this step. After the file lands, stop and wait for the user to approve before implementing.

This step forces \`write\` (toolChoice); do not call anything else.`

export const PLAN_AWAIT_PROMPT = `The plan file under \`.sicode/plans/\` is written for this design turn.

Stop tools. Reply with a short summary (goal + approach + open questions) and wait for the user to approve before \`todowrite\` or product edits. Do not implement in this step.`

export const SEARCH_CAP_PROMPT = `You have already made ${SEARCH_CAP} grep/glob searches this turn on the main chain.

Stop searching. Answer with what you have now:

1. What you found (paths, file:line) — or that you did not find it.
2. What terms you tried.
3. The next concrete action for the user (name the symbol/path, or the edit you would make).

Do not call tools this step. Do not open an explore subagent to search again — that doubles the cost of a hunt that already missed.`
