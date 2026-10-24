/**
 * SiCode: multi-message loop detection.
 *
 * `silentSteps` covers a model that says nothing, and `explore-budget` covers one that only reads.
 * Neither covers the remaining shape: a model that keeps calling the *same* tool with the *same*
 * arguments, step after step, producing the same result — editing a file that no longer matches,
 * re-reading a path it already knows, waiting on something that will never change. Nothing is
 * silent and nothing is read-only, so the turn runs until the step limit.
 *
 * Detection is deliberately conservative: it looks for a repeating period in the trailing assistant
 * steps of this turn and only fires when the repeated unit is *identical*, results included. A
 * repeating tool whose output keeps changing is progress (polling, a growing file), not a loop, and
 * a model that rewords its text while calling the same tool is caught by the second pass, which
 * compares tool calls alone.
 *
 * A hit injects one nudge. The caller remembers the fingerprint: seeing it again means the nudge did
 * not help, and the turn is stopped instead of nudged twice.
 */
import { createHash } from "crypto"
import type { SessionMessage } from "../message.js"

/** Complete repeats of one period before the turn is considered stuck. */
export const LOOP_MIN_REPETITIONS = 3
/** Longest repeating unit worth checking; longer cycles are too weak a signal to act on. */
export const LOOP_MAX_PERIOD = 4
/** Tool results are compared by a prefix, so a huge diff does not dominate the fingerprint. */
const RESULT_PREFIX = 512

export const LOOP_NUDGE_PROMPT = `You appear to be repeating the same tool call with the same arguments, and getting the same result each time.

Step back before your next call. If the last attempt did not change anything, calling it again will not either:
- If a file no longer matches what you expected, read it again before editing.
- If you are waiting on something, say what you are waiting for instead of re-running the check.
- If you already have what you need, act on it or answer.

Do not repeat a call that already failed in exactly the same way.`

export const LOOP_STOP_PROMPT = `CRITICAL - REPEATED TOOL CALLS

You repeated the same tool call with the same arguments, and it produced the same result each time. Answering without it:

1. What you were trying to accomplish with that call.
2. What actually happened.
3. What you need in order to make progress — a different approach, or a question for the user.

Do not call any more tools in this turn.`

/** Tools whose repetition is normal and must never be nudged, with how repeated they may get. */
const NEVER_NUDGE = new Set<string>(["todo"])

export interface LoopHit {
  /** Stable across steps, so a repeat of the same loop is recognized as "already nudged". */
  readonly fingerprint: string
  readonly repeats: number
  readonly period: number
  readonly kind: "same_calls_and_results" | "same_calls_only"
}

/** Order-independent JSON so the same arguments never produce two different keys. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`
  return JSON.stringify(value ?? null)
}

/** The arguments a tool was called with, whether it finished or not. */
function toolInput(part: Extract<SessionMessage.AssistantContent, { type: "tool" }>): string {
  if (part.state.status === "streaming") return part.state.input.trim()
  return canonical(part.state.input)
}

/** A short, stable view of what the call produced, so "same result" can be checked. */
function toolResult(part: Extract<SessionMessage.AssistantContent, { type: "tool" }>): string {
  if (part.state.status === "error") return `error:${part.state.error.type}`
  if (part.state.status !== "completed") return part.state.status
  const text = part.state.content
    .map((entry) => ("text" in entry && typeof entry.text === "string" ? entry.text : entry.type))
    .join("\n")
  return text.length > RESULT_PREFIX ? text.slice(0, RESULT_PREFIX) : text
}

/**
 * One step's identity. `calls` drops the prose but keeps the results, so a model that rewords its
 * text each step is still caught — while a call whose answer keeps changing stays "progress" in
 * both modes rather than only the stricter one.
 */
function stepKey(message: Assistant, mode: "full" | "calls"): string | null {
  const tools = message.content.filter((part) => part.type === "tool")
  if (tools.length === 0) return null
  if (tools.some((part) => NEVER_NUDGE.has(part.name))) return null

  const calls = [...tools.map((part) => `${part.name}:${toolInput(part)}`)].sort().join("|")
  const results = [...tools.map(toolResult)].join("|")
  if (mode === "calls") return `${calls}<<<RESULTS>>>${results}`

  const text = message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim()
  return `${text}<<<TOOLS>>>${calls}<<<RESULTS>>>${results}`
}

type Assistant = Extract<SessionMessage.Info, { type: "assistant" }>

/** Trailing assistant steps of this turn, oldest first. */
function trailingSteps(messages: ReadonlyArray<SessionMessage.Info>, mode: "full" | "calls"): string[] {
  const keys: string[] = []
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!
    if (message.type === "user") break
    if (message.type !== "assistant") continue
    const key = stepKey(message, mode)
    // A step without tools means the model already stopped to answer: nothing is repeating.
    if (key === null) break
    keys.unshift(key)
  }
  return keys
}

/** Longest run of complete `period`-sized repeats ending at the last step. */
function detectPeriod(keys: ReadonlyArray<string>): { period: number; repeats: number } | null {
  const total = keys.length
  for (let period = 1; period <= Math.min(LOOP_MAX_PERIOD, Math.floor(total / LOOP_MIN_REPETITIONS)); period++) {
    let repeats = 1
    for (let start = total - period; start - period >= 0; start -= period) {
      let same = true
      for (let offset = 0; offset < period; offset++) {
        if (keys[start - period + offset] !== keys[start + offset]) {
          same = false
          break
        }
      }
      if (!same) break
      repeats += 1
    }
    if (repeats >= LOOP_MIN_REPETITIONS) return { period, repeats }
  }
  return null
}

function fingerprint(kind: LoopHit["kind"], unit: ReadonlyArray<string>): string {
  return createHash("sha256")
    .update("sicode-loop-evidence-v1")
    .update(":")
    .update(kind)
    .update(":")
    .update(unit.join("\n"))
    .digest("hex")
}

/**
 * The loop this turn is stuck in, or `null`. The period unit is hashed, not the whole run, so the
 * same loop keeps one fingerprint as it repeats.
 */
export function detectLoop(messages: ReadonlyArray<SessionMessage.Info>): LoopHit | null {
  for (const mode of ["full", "calls"] as const) {
    const keys = trailingSteps(messages, mode)
    const hit = detectPeriod(keys)
    if (!hit) continue
    const unit = keys.slice(keys.length - hit.period)
    return {
      fingerprint: fingerprint(mode === "full" ? "same_calls_and_results" : "same_calls_only", unit),
      repeats: hit.repeats,
      period: hit.period,
      kind: mode === "full" ? "same_calls_and_results" : "same_calls_only",
    }
  }
  return null
}
