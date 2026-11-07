export * as SessionWorkingPin from "./working-pin.js"

/**
 * SiCode: long-context-use P1 — pin this turn's goal, frozen paths, and recent file anchors
 * immediately after the latest user message so Flash does not lose them in the middle of a long
 * tool transcript. Request-only; `OPENCODE_WORKING_PIN=0` disables.
 */

import { DateTime } from "effect"
import { SessionMessage } from "./message.js"
import { SessionTopicSwitch } from "./topic-switch.js"

/** Soft budget for the whole pin block (tags included). Leaner after harness slim. */
export const MAX_CHARS = 800

const GOAL_CHARS = 200
const ANCHOR_TOOLS = new Set(["edit", "write", "patch", "read"])
const MAX_ANCHORS = 3

const normalize = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()

const turnStart = (messages: ReadonlyArray<SessionMessage.Info>) => {
  const index = messages.findLastIndex((message) => message.type === "user")
  if (index < 0) return undefined
  if (messages.slice(index + 1).some((message) => message.type === "assistant" || message.type === "shell"))
    return undefined
  const message = messages[index]
  if (message?.type !== "user") return undefined
  return { index, message }
}

const toolPath = (part: Extract<SessionMessage.AssistantContent, { type: "tool" }>): string | undefined => {
  if (!ANCHOR_TOOLS.has(part.name)) return undefined
  if (part.state.status !== "completed") return undefined
  const input = part.state.input as { path?: unknown; filePath?: unknown } | undefined
  const path = input?.path ?? input?.filePath
  return typeof path === "string" && path.trim() ? normalize(path.trim()) : undefined
}

/** Paths touched by the previous assistant turn (between the prior user and the current one). */
const recentAnchors = (messages: ReadonlyArray<SessionMessage.Info>, userIndex: number): string[] => {
  const found: string[] = []
  const seen = new Set<string>()
  for (let cursor = userIndex - 1; cursor >= 0; cursor--) {
    const message = messages[cursor]!
    if (message.type === "user") break
    if (message.type !== "assistant") continue
    for (const part of message.content) {
      if (part.type !== "tool") continue
      const path = toolPath(part)
      if (!path || seen.has(path)) continue
      seen.add(path)
      found.push(path)
      if (found.length >= MAX_ANCHORS) return found
    }
  }
  return found
}

const namedInUser = (message: SessionMessage.User): string[] => {
  const found = [...SessionTopicSwitch.pathsInText(message.text)]
  for (const file of message.files ?? []) {
    if (file.name) found.push(file.name)
  }
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of found) {
    const path = normalize(raw)
    if (!path || seen.has(path)) continue
    seen.add(path)
    out.push(path)
  }
  return out
}

const clip = (text: string, max: number) => {
  const trimmed = text.trim().replace(/\s+/g, " ")
  if (trimmed.length <= max) return trimmed
  return trimmed.slice(0, max - 1) + "…"
}

/**
 * Pure fold: build the pin body, or undefined when there is nothing useful to pin.
 */
export const fold = (
  messages: ReadonlyArray<SessionMessage.Info>,
  frozen: ReadonlyArray<string> = [],
  scope: ReadonlyArray<string> = [],
): string | undefined => {
  const turn = turnStart(messages)
  if (!turn) return undefined

  const goal = clip(turn.message.text, GOAL_CHARS)
  const frozenPaths = frozen.map(normalize).filter(Boolean).slice(0, MAX_ANCHORS)
  const scopePaths = scope.map(normalize).filter(Boolean).slice(0, MAX_ANCHORS)
  const anchors = [...new Set([...recentAnchors(messages, turn.index), ...namedInUser(turn.message)])].slice(
    0,
    MAX_ANCHORS,
  )

  if (!goal && frozenPaths.length === 0 && scopePaths.length === 0 && anchors.length === 0) return undefined

  const lines = ["<working-pin>", "Facts for this turn only — prefer these over older tool noise:"]
  if (goal) lines.push(`goal: ${goal}`)
  if (frozenPaths.length) lines.push(`frozen: ${frozenPaths.map((path) => `\`${path}\``).join(", ")}`)
  if (scopePaths.length) lines.push(`scope: ${scopePaths.map((path) => `\`${path}\``).join(", ")}`)
  if (anchors.length) lines.push(`anchors: ${anchors.map((path) => `\`${path}\``).join(", ")}`)
  lines.push("</working-pin>")

  let text = lines.join("\n")
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS - 1) + "…"
  return text
}

const hintMessage = (text: string): SessionMessage.Synthetic => ({
  id: SessionMessage.ID.create(),
  time: { created: DateTime.makeUnsafe(Date.now()) },
  type: "synthetic",
  metadata: { notice: "working-pin" },
  description: "Working pin for this turn",
  text,
})

export const inject = (input: {
  readonly messages: ReadonlyArray<SessionMessage.Info>
  readonly frozen?: ReadonlyArray<string>
  readonly scope?: ReadonlyArray<string>
  readonly enabled?: boolean
}): ReadonlyArray<SessionMessage.Info> => {
  if (input.enabled === false) return input.messages
  const turn = turnStart(input.messages)
  if (!turn) return input.messages
  const text = fold(input.messages, input.frozen ?? [], input.scope ?? [])
  if (!text) return input.messages
  const messages = [...input.messages]
  messages.splice(turn.index + 1, 0, hintMessage(text))
  return messages
}
