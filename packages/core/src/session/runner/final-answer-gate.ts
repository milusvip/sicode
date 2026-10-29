/**
 * SiCode: final answer gate.
 *
 * `narrate` asks for a sentence while work is still running, and `explore-budget` stops a turn that
 * only reads. Neither checks the end of a turn: a model that called nothing but tools can stop with
 * no text at all — the transcript shows activity, the user gets nothing to read, and the question
 * that started the turn is left unanswered.
 *
 * The signal is mechanical: the turn touched files and never wrote a line of text. It says nothing
 * about what the user meant, so it cannot misfire on a question the model chose to answer by
 * editing — it fires on the case where the user is left with changes and no explanation.
 *
 * Reading without a word is left alone: a read-only turn that reports nothing is `explore-budget`'s
 * job, and nudging every silent turn would add a round trip to work that never needed one.
 */
import type { SessionMessage } from "../message.js"

/** Tools that leave the workspace different from how the user left it. */
const MUTATING_TOOLS = new Set(["write", "edit", "patch"])

export const FINAL_ANSWER_PROMPT = `You are ending this turn without having written anything to the user.

Say it now, in a few lines: what you found or changed, and anything still open. The user saw tool calls, not your reasoning — an activity log is not an answer.

Do not call any more tools in this turn.`

/**
 * The prompt this turn changed files for and never explained, or undefined when it explained itself,
 * touched nothing, or was never asked anything. Returning the id lets the caller nudge once per
 * prompt instead of once per turn: a later steering message is a new question with its own check.
 */
export function unansweredPrompt(messages: ReadonlyArray<SessionMessage.Info>): string | undefined {
  const index = messages.findLastIndex((message) => message.type === "user")
  if (index < 0) return undefined

  const prompt = messages[index]
  if (prompt.type !== "user") return undefined

  const turn = messages.slice(index + 1)
  const parts = turn.flatMap((message) => (message.type === "assistant" ? message.content : []))

  if (parts.some((part) => part.type === "text" && part.text.trim().length > 0)) return undefined

  // Only a write that succeeded left the workspace different; a denied or failed one changed nothing.
  const changed = parts.some(
    (part) => part.type === "tool" && MUTATING_TOOLS.has(part.name) && part.state.status === "completed",
  )
  if (!changed) return undefined

  return prompt.id
}
