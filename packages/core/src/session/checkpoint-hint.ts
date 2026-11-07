import type { SessionMessage } from "./message.js"

// SiCode: every K tool-bearing assistant steps, nudge once so the model re-states goal before drifting
export const CHECKPOINT_STEPS = 6

export const CHECKPOINT_PROMPT =
  "Before continuing: restate the user's current goal in one sentence, list open decisions still unsettled, and name the next concrete action. Do not invent new requirements."

export function checkpointFingerprint(messages: ReadonlyArray<SessionMessage.Info>): string | undefined {
  // SiCode: default off — opt in with OPENCODE_CHECKPOINT=1 (harness slim).
  if (process.env.OPENCODE_CHECKPOINT !== "1") return undefined
  let lastUser: SessionMessage.User | undefined
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message?.type === "user") {
      lastUser = message
      break
    }
  }
  if (!lastUser) return undefined
  const start = messages.lastIndexOf(lastUser)
  const turn = messages.slice(start + 1)
  const assistants = turn.filter((message) => message.type === "assistant")
  if (assistants.length < CHECKPOINT_STEPS) return undefined
  const usedTools = assistants.some(
    (message) => message.type === "assistant" && message.content.some((part) => part.type === "tool"),
  )
  if (!usedTools) return undefined
  return lastUser.id
}
