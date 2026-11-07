/**
 * SiCode: passive memory injection — Flash will not reliably call `recall`, so a short budgeted
 * block of active beliefs is appended to the request system parts (same pattern as project-map).
 *
 * When the latest user text is known, project facts are ranked by BM25 against that query so a
 * cookies binge does not crowd out the beliefs that answer "权限码头". Without a query (or with
 * no hits), importance × recency still picks the set. Persona prefs always keep a reserved slice
 * of the budget — they are how the agent stays "越用越懂" across checkouts.
 *
 * Quality (not more tables): conflict peers are co-selected with concrete peer text; path misses
 * and age show on the line so Flash sees staleness without calling recall.
 */
export * as SessionMemoryInject from "./inject.js"

import type { Message } from "@opencode/ai/effect"
import { PERSONA_PROJECT_KEY, activeOnly, type Belief } from "./belief.js"
import { searchBeliefs } from "./search.js"

/** ~400–500 tokens of short bullets; keep lean so Flash is not crowded by priors (harness slim). */
export const CHAR_BUDGET = 1_600
/** Hard cap on how many beliefs one request may see. */
export const MAX_BELIEFS = 5
/**
 * SiCode: persona prefs stay in the system prompt, so their slice is separate from the project one.
 * System text sits in front of the whole conversation, which makes it the provider's cacheable
 * prefix: anything in it has to be identical between requests or every new turn pays full prefill.
 * Persona prefs are ordered by importance and recency only, never by the user's latest words, so
 * they are stable across turns and safe to keep there.
 */
export const PERSONA_BUDGET = 480
/**
 * SiCode: project facts are ranked against the latest user text, so the selection changes on every
 * new turn. Keeping that block in the system prompt rebuilt the cacheable prefix each turn and the
 * turn start missed the cache for everything after it. It now rides the messages instead, the same
 * request-only position `context-hints` and the steer notes use.
 */
export const PROJECT_BUDGET = CHAR_BUDGET - PERSONA_BUDGET
/** When the query matches nothing lexical, do not dump top-importance noise (cookies binge). */
export const NO_QUERY_PROJECT_CAP = 2

export const envDisabled = () => process.env.OPENCODE_MEMORY_INJECT === "0"

/**
 * Persona id for load/record. Default `"local"` so preferences persist without env setup;
 * `OPENCODE_PERSONA=0` / `off` disables the persona bag.
 */
export const personaFromEnv = () => {
  const value = process.env.OPENCODE_PERSONA?.trim()
  if (value === "0" || value === "off") return undefined
  if (value && value.length > 0) return value
  return "local"
}

export type RenderOptions = {
  now?: number
  budget?: number
  /** Latest user text — used to BM25-rank project beliefs for this request. */
  query?: string
}

const byImportance = (beliefs: readonly Belief[]) =>
  beliefs.slice().sort((a, b) => b.importance - a.importance || b.seenAt - a.seenAt)

/** Project beliefs for inject: query hits first; no lexical hit → silence (not importance dump). */
export function selectProject(beliefs: readonly Belief[], query: string | undefined, now: number): Belief[] {
  const project = activeOnly(beliefs, now).filter((belief) => belief.scope.projectKey !== PERSONA_PROJECT_KEY)
  if (project.length === 0) return []
  const trimmed = query?.trim()
  if (!trimmed) return byImportance(project).slice(0, NO_QUERY_PROJECT_CAP)
  const hits = searchBeliefs(project, trimmed, MAX_BELIEFS, now)
  // Inject stays lexical-first: a weak vector-only neighbor (e.g. cookies next to 权限弹窗)
  // must not crowd the budget. `recall` still sees the full RRF list.
  const lexical = hits.filter((hit) =>
    hit.why.some((channel) => channel === "path" || channel === "symbol" || channel === "content"),
  )
  // SiCode: empty lexical used to fall back to byImportance and re-inject stale high-importance
  // noise every turn. Prefer silence; the model can still `recall`.
  if (lexical.length === 0) return []
  return lexical.map((hit) => hit.belief)
}

export function selectPersona(beliefs: readonly Belief[], now: number): Belief[] {
  return byImportance(
    activeOnly(beliefs, now).filter((belief) => belief.scope.projectKey === PERSONA_PROJECT_KEY),
  )
}

/**
 * SiCode: if A is selected and contradicts B, B must ride along — a lone "[conflicts…]" tag
 * without the peer claim is invisible to Flash.
 */
export function withConflictPeers(ranked: readonly Belief[], pool: readonly Belief[]): Belief[] {
  if (ranked.length === 0) return []
  const byId = new Map(pool.map((belief) => [belief.id, belief]))
  const out: Belief[] = []
  const seen = new Set<string>()
  const push = (belief: Belief | undefined) => {
    if (!belief || seen.has(belief.id)) return
    seen.add(belief.id)
    out.push(belief)
  }
  for (const belief of ranked) {
    push(belief)
    for (const peerId of belief.contradicts) push(byId.get(peerId))
  }
  return out
}

/** Latest non-empty user text from the model-bound message list (context hook). */
export function queryFromMessages(messages: readonly Message[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (!message || message.role !== "user") continue
    const text = message.content
      .flatMap((part) => (part.type === "text" && part.text.trim() ? [part.text.trim()] : []))
      .join("\n")
      .trim()
    if (text) return text
  }
  return undefined
}

const DAY_MS = 86_400_000

const ageOf = (belief: Belief, now: number) => {
  const age = now - belief.seenAt
  if (age < DAY_MS) return ""
  const days = Math.floor(age / DAY_MS)
  return ` [seen ~${days}d ago]`
}

/** One inject line: kind + proposition + paths + concrete conflict/stale/age marks. */
export const lineOf = (belief: Belief, peers?: ReadonlyMap<string, Belief>, now = Date.now()) => {
  const paths = belief.paths.length > 0 ? ` (${belief.paths.slice(0, 3).join(", ")})` : ""
  const peerTexts = belief.contradicts
    .map((id) => peers?.get(id)?.proposition)
    .filter((text): text is string => !!text)
    .slice(0, 2)
  const conflict =
    peerTexts.length > 0
      ? ` [conflicts: ${peerTexts.map((text) => `"${text}"`).join("; ")} — verify]`
      : belief.contradicts.length > 0
        ? " [conflicts with another memory — verify]"
        : ""
  const stale = belief.misses > 0 ? " [stale: path miss — verify in code]" : ""
  return `- [${belief.kind}] ${belief.proposition}${paths}${conflict}${stale}${ageOf(belief, now)}`
}

const take = (
  ranked: readonly Belief[],
  budget: number,
  used: number,
  slotsLeft: number,
  peers: ReadonlyMap<string, Belief>,
  now: number,
) => {
  const picked: Belief[] = []
  let next = used
  for (const belief of ranked) {
    if (picked.length >= slotsLeft) break
    const line = lineOf(belief, peers, now)
    if (next + line.length + 1 > budget) break
    picked.push(belief)
    next += line.length + 1
  }
  return { picked, used: next }
}

const PERSONA_HEADER = [
  "# Persona preferences",
  "",
  "How this user prefers to work across projects. Follow when it does not conflict with the current task.",
  "",
].join("\n")

const PROJECT_HEADER = [
  "# Project memory",
  "",
  "Facts this project already kept from earlier sessions. Treat them as a prior, not as evidence — verify in the code before relying on a path.",
  "",
].join("\n")

const peersOf = (beliefs: readonly Belief[]) => new Map(beliefs.map((belief) => [belief.id, belief]))

/**
 * SiCode: render the persona block for the system prompt, or "" when there is nothing to show.
 *
 * Only persona prefs go here: they are ordered by importance and recency, never by the user's
 * latest words, so the text is identical from one turn to the next and the provider's cached
 * prefix survives. Project facts are query-ranked and belong in `renderProject`.
 */
export function renderPersona(beliefs: readonly Belief[], nowOrOptions: number | RenderOptions = {}): string {
  if (envDisabled()) return ""

  const options: RenderOptions = typeof nowOrOptions === "number" ? { now: nowOrOptions } : nowOrOptions
  const now = options.now ?? Date.now()
  const peers = peersOf(beliefs)
  const ranked = withConflictPeers(selectPersona(beliefs, now), beliefs)
  const selected = take(ranked, PERSONA_BUDGET, 0, MAX_BELIEFS, peers, now).picked
  if (selected.length === 0) return ""

  return [PERSONA_HEADER, ...selected.map((belief) => lineOf(belief, peers, now))].join("\n")
}

/**
 * SiCode: render the project-facts block for the request messages, or "".
 *
 * This block changes with the latest user text, so it must not sit in the system prompt: the
 * selection differs every turn, and a system part that differs every turn is a cache miss for the
 * entire conversation behind it. Appended as a chronological message instead, the prefix stays
 * intact and only this block's own tokens are uncached.
 */
export function renderProject(
  beliefs: readonly Belief[],
  nowOrOptions: number | RenderOptions = {},
  budgetArg?: number,
): string {
  if (envDisabled()) return ""

  const options: RenderOptions =
    typeof nowOrOptions === "number" ? { now: nowOrOptions, budget: budgetArg } : nowOrOptions
  const budget = options.budget ?? PROJECT_BUDGET
  const now = options.now ?? Date.now()
  const peers = peersOf(beliefs)
  const ranked = withConflictPeers(selectProject(beliefs, options.query, now), beliefs)
  const selected = take(ranked, budget, 0, MAX_BELIEFS, peers, now).picked
  if (selected.length === 0) return ""

  return [
    PROJECT_HEADER,
    ...selected.map((belief) => lineOf(belief, peers, now)),
    "",
    "Do not call recall just to re-read these; search the code when a fact may be stale.",
  ].join("\n")
}

/**
 * Both blocks joined, for callers that keep them in one place (tests, `recall` summaries).
 * Production splits them: persona into the system prompt, project facts into the messages.
 */
export function render(
  beliefs: readonly Belief[],
  nowOrOptions: number | RenderOptions = {},
  budgetArg?: number,
): string {
  const persona = renderPersona(beliefs, nowOrOptions)
  const project = renderProject(beliefs, nowOrOptions, budgetArg)
  if (persona === "" && project === "") return ""
  if (project === "") return persona
  if (persona === "") return project
  return `${persona}\n\n${project}`
}
