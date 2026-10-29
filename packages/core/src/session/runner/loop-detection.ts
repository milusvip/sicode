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
// SiCode: "todo" was a stale name — the tool is registered as "todowrite" (tool/plugin/todo.ts).
const NEVER_NUDGE = new Set<string>(["todowrite"])

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

function fingerprint(kind: string, unit: ReadonlyArray<string>): string {
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

// --- repeated probing of one file ---------------------------------------------------------------

/** Probes of one file, with no change to it in between, before the turn is told to move on. */
export const PROBE_MIN_PROBES = 3
/** How far back a probe is still counted as "just now". Older steps have their own context. */
const PROBE_WINDOW_STEPS = 16
/** Tools that change a file, so reading that file again afterwards is a check, not a repeat. */
const MUTATING = new Set<string>(["edit", "write", "apply_patch", "multiedit", "patch"])
/** Input fields that name a path in structured tool calls. */
const PATH_FIELDS = ["path", "filePath", "file", "dir", "directory"]
/** A path-shaped token, so a shell command that names a file is counted like a `read` of it. */
const PATH_TOKEN = /[\w.\-/\\]+\.[A-Za-z0-9]{1,8}/g
/**
 * Extensions worth counting. Without this a dotted call in a script — `json.load`, `os.path`,
 * `console.log` — reads as a file, and a model that parses one JSON file three ways gets told it
 * looked at three files.
 */
const FILE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "jsonc", "css", "scss", "html", "svg", "md", "mdx",
  "py", "rb", "go", "rs", "java", "sh", "ps1", "yml", "yaml", "toml", "lock", "txt", "sql", "env",
])

function looksLikePath(token: string) {
  if (token.includes("/") || token.includes("\\")) return true
  const dot = token.lastIndexOf(".")
  return dot > 0 && FILE_EXTENSIONS.has(token.slice(dot + 1).toLowerCase())
}

export interface ProbeHit {
  /** Stable per file, so the caller nudges once per file and not once per probe. */
  readonly fingerprint: string
  readonly path: string
  readonly probes: number
}

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase()
}

/** Absolute and relative spellings of one file are the same file. */
function samePath(left: string, right: string) {
  return left === right || left.endsWith("/" + right) || right.endsWith("/" + left)
}

/** Every file a call reached for, whether it named it in a field or inside a command. */
function touchedPaths(part: Extract<SessionMessage.AssistantContent, { type: "tool" }>): string[] {
  const input = part.state.input as unknown
  const paths = new Set<string>()
  if (input !== null && typeof input === "object") {
    for (const field of PATH_FIELDS) {
      const value = (input as Record<string, unknown>)[field]
      if (typeof value === "string" && value !== "") paths.add(normalizePath(value))
    }
  }
  const text = typeof input === "string" ? input : canonical(input)
  for (const match of text.matchAll(PATH_TOKEN)) {
    if (looksLikePath(match[0])) paths.add(normalizePath(match[0]))
  }
  return [...paths]
}

export function probeNudgePrompt(path: string) {
  return [
    `You have already inspected \`${path}\` ${PROBE_MIN_PROBES} times in this turn without changing it.`,
    "Asking again with a different tool or a different argument returns the same content.",
    "Use what the earlier calls already returned, or say what you still need and why this file did not answer it.",
  ].join("\n\n")
}

/**
 * SiCode: the file a model keeps coming back to without ever changing it.
 *
 * `detectLoop` needs the same arguments *and* the same result, so a model that re-reads one file
 * with a new pattern, a new command, or a new parser each time slips past it — the calls differ, so
 * nothing is "repeating", yet the turn is standing still. This counts probes per file instead and
 * forgets them as soon as the file is written, so reading a file back after an edit is never counted.
 *
 * Deliberately fuzzy, so it only ever nudges. Unlike a loop it never ends the turn: a re-read can be
 * legitimate (a large file read in slices), and stopping on a guess costs more than one suggestion.
 */
export function detectRepeatedProbe(messages: ReadonlyArray<SessionMessage.Info>): ProbeHit | null {
  const steps: Array<{ mutations: string[]; probes: string[] }> = []
  for (let index = messages.length - 1; index >= 0 && steps.length < PROBE_WINDOW_STEPS; index--) {
    const message = messages[index]!
    if (message.type === "user") break
    if (message.type !== "assistant") continue
    const tools = message.content.filter((part) => part.type === "tool")
    // A step without tools means the model already stopped to answer; the run of probes is over.
    if (tools.length === 0) break
    const mutations: string[] = []
    const probes: string[] = []
    for (const part of tools) {
      // A todo list names files constantly; rewriting it is bookkeeping, not inspection.
      if (NEVER_NUDGE.has(part.name)) continue
      const paths = touchedPaths(part)
      if (MUTATING.has(part.name)) mutations.push(...paths)
      else probes.push(...paths)
    }
    steps.unshift({ mutations, probes })
  }

  const counts = new Map<string, number>()
  const keyFor = (path: string) => [...counts.keys()].find((existing) => samePath(existing, path)) ?? path
  for (const entry of steps) {
    // A write clears what was learned about that file: reading it back afterwards is a check.
    for (const path of new Set(entry.mutations)) counts.delete(keyFor(path))
    // One step counts a file once. A field and a command in the same call are still one look.
    const probed = new Set(entry.probes.map(keyFor))
    for (const key of probed) counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  let worst: { path: string; probes: number } | undefined
  for (const [path, probes] of counts) {
    if (probes < PROBE_MIN_PROBES) continue
    if (worst === undefined || probes > worst.probes) worst = { path, probes }
  }
  if (worst === undefined) return null
  return { fingerprint: fingerprint("same_file_probed", [worst.path]), path: worst.path, probes: worst.probes }
}
