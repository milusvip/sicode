import type { SessionMessage } from "../message.js"

// SiCode: edit → read same path → edit again is a self-correction spiral loop/probe miss. Soft once,
// then hard-stop like exploreHardLocate. Kill switch: OPENCODE_EDIT_SPIRAL=0.

/** Trailing assistant steps scanned for mutate/read alternation. */
export const EDIT_SPIRAL_WINDOW = 8
/** Alternating mutate↔read transitions on one path before the spiral fires. */
export const EDIT_SPIRAL_MIN_TRANSITIONS = 3

export const EDIT_SPIRAL_NUDGE_PROMPT = `You are oscillating between editing a file and re-reading it. Stop the edit→read→edit loop.

Before another tool call:
1. State what is still wrong in one sentence.
2. Either apply one decisive fix, or stop and ask the user — do not re-read the same path to "confirm" mid-loop.`

export const EDIT_SPIRAL_STOP_PROMPT = `CRITICAL - EDIT/READ SPIRAL

You kept alternating edit/patch/write with read on the same path. Hand back without more tools:

1. What you were trying to change.
2. What still looks wrong (or that you are unsure).
3. The single next action you recommend — or a question for the user.

Do not call any more tools in this turn.`

const MUTATE = new Set(["edit", "patch", "write"])

export interface EditSpiralHit {
  readonly fingerprint: string
  readonly path: string
  readonly transitions: number
}

function toolPath(part: Extract<SessionMessage.AssistantContent, { type: "tool" }>) {
  if (part.state.status === "streaming") return undefined
  const input = part.state.input
  if (!input || typeof input !== "object") return undefined
  const path = (input as { path?: unknown }).path
  if (typeof path === "string" && path.length > 0) return path
  if (Array.isArray(path) && typeof path[0] === "string") return path[0]
  return undefined
}

function kindFor(name: string): "mutate" | "read" | undefined {
  const key = name.replaceAll(".", "_").toLowerCase()
  if (MUTATE.has(key)) return "mutate"
  if (key === "read") return "read"
  return undefined
}

/** Detect edit↔read oscillation on one path in the current turn. */
export function detectEditSpiral(messages: ReadonlyArray<SessionMessage.Info>): EditSpiralHit | null {
  if (process.env.OPENCODE_EDIT_SPIRAL === "0") return null

  const steps: SessionMessage.Assistant[] = []
  for (let index = messages.length - 1; index >= 0 && steps.length < EDIT_SPIRAL_WINDOW; index--) {
    const message = messages[index]!
    if (message.type === "user") break
    if (message.type !== "assistant") continue
    steps.push(message)
  }
  steps.reverse()

  const byPath = new Map<string, Array<"mutate" | "read">>()
  for (const message of steps) {
    for (const part of message.content) {
      if (part.type !== "tool") continue
      const kind = kindFor(part.name)
      if (!kind) continue
      const path = toolPath(part)
      if (!path) continue
      const sequence = byPath.get(path) ?? []
      // Collapse consecutive same-kind events so edit+edit then read counts as one transition.
      if (sequence[sequence.length - 1] === kind) continue
      sequence.push(kind)
      byPath.set(path, sequence)
    }
  }

  let best: EditSpiralHit | null = null
  for (const [path, sequence] of byPath) {
    if (sequence.length < 2) continue
    const transitions = sequence.length - 1
    if (transitions < EDIT_SPIRAL_MIN_TRANSITIONS) continue
    const hasMutate = sequence.includes("mutate")
    const hasRead = sequence.includes("read")
    if (!hasMutate || !hasRead) continue
    const fingerprint = `edit-spiral:${path}`
    if (!best || transitions > best.transitions) {
      best = { fingerprint, path, transitions }
    }
  }
  return best
}
