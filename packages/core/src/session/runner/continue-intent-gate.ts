/**
 * SiCode: continue-intent + question-tool wait + mixed prose-? with tools.
 *
 * Continue-intent: assistant announced the next move then `finish:stop` with zero tools — the
 * turn went idle mid-investigation. Mechanical shape only: short idle prose that ends as an
 * unfinished announce (trailing colon / ellipsis), no tools. No Chinese/English verb word lists.
 *
 * Real blocking asks go only through a running `question` tool (`turnAwaitingUser`).
 * Idle-ask (force-continue on prose `?` / fake choice menus) was removed: it false-fired on
 * finished answers and yanked the model back into prior-turn work (ses_e4d917).
 */

import type { SessionMessage } from "../message.js"

/** Soft ceiling: announced-next lines are short; real answers run longer. */
export const CONTINUE_INTENT_MAX_CHARS = 280

/** Message shape: ends as a question. Trailing `?` / `？` only — not ask-phrase vocabulary. */
export function endsAsQuestion(text: string): boolean {
  return /[?？]\s*$/u.test(text.trim())
}

/** Any prose line that ends as a question (Flash often asks mid-paragraph then keeps grepping). */
export function hasProseQuestionLine(text: string): boolean {
  return text.split(/\n/).some((line) => endsAsQuestion(line))
}

/**
 * Trailing announce punctuation — model named the next move and stopped without tools.
 * Colon / ellipsis only; no verb vocabulary.
 */
function announcesNext(text: string): boolean {
  return /[:：…]\s*$/u.test(text) || /\.\.\.\s*$/u.test(text)
}

/**
 * Latest assistant mixed a prose `?` with non-`question` tools — that ask never blocks the turn.
 * Fingerprint once so the runner can withdraw tools instead of letting the turn keep searching.
 */
export function mixedProseQuestionFingerprint(messages: ReadonlyArray<SessionMessage.Info>): string | undefined {
  const index = messages.findLastIndex((message) => message.type === "user")
  if (index < 0) return undefined

  let last: SessionMessage.Info | undefined
  for (let i = messages.length - 1; i > index; i--) {
    const message = messages[i]!
    if (message.type === "assistant") {
      last = message
      break
    }
  }
  if (!last || last.type !== "assistant") return undefined

  const tools = last.content.filter((part) => part.type === "tool")
  if (tools.length === 0) return undefined
  if (tools.some((part) => part.name === "question")) return undefined

  const text = last.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim()
  if (!text || !hasProseQuestionLine(text)) return undefined

  return `${last.id}\n${text.slice(0, 120)}`
}

export const MIXED_PROSE_QUESTION_PROMPT = `You mixed a prose question with tools. Tools are withdrawn this step.

Pick the recommended option in one line (mark "(Recommended)"), then continue with tools next step. Use the \`question\` tool alone only when a wrong pick is costly and irreversible.`

/**
 * True when auto-continue gates must idle because a real blocking ask is open.
 *
 * Only a running `question` tool counts. Idle prose ending in `?`/`？` must not count as waiting
 * (that wiped pending todos for completion-gate). Trailing `?` still skips continue-intent.
 */
export function turnAwaitingUser(messages: ReadonlyArray<SessionMessage.Info>): boolean {
  const index = messages.findLastIndex((message) => message.type === "user")
  if (index < 0) return false

  let last: SessionMessage.Info | undefined
  for (let i = messages.length - 1; i > index; i--) {
    const message = messages[i]!
    if (message.type === "assistant") {
      last = message
      break
    }
  }
  if (!last || last.type !== "assistant") return false

  return last.content.some(
    (part) => part.type === "tool" && part.name === "question" && part.state.status === "running",
  )
}

export const CONTINUE_INTENT_PROMPT = `You announced the next step and stopped with no tools. Call those tools now — do not restate the plan.`

const latestIdleAssistantText = (
  messages: ReadonlyArray<SessionMessage.Info>,
): { promptID: string; assistantID: string; text: string } | undefined => {
  if (turnAwaitingUser(messages)) return undefined

  const index = messages.findLastIndex((message) => message.type === "user")
  if (index < 0) return undefined

  const prompt = messages[index]
  if (prompt.type !== "user") return undefined

  let last: SessionMessage.Info | undefined
  for (let i = messages.length - 1; i > index; i--) {
    const message = messages[i]!
    if (message.type === "assistant") {
      last = message
      break
    }
  }
  if (!last || last.type !== "assistant") return undefined
  if (last.content.some((part) => part.type === "tool")) return undefined

  const text = last.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim()
  if (!text) return undefined
  return { promptID: prompt.id, assistantID: last.id, text }
}

/**
 * Fingerprint of a stop that announced work it never started, or undefined when the turn is a
 * real answer / already called tools / has no user prompt. Returning the key lets the runner
 * nudge once per announce instead of looping on the same idle stop.
 */
export function continueIntentFingerprint(messages: ReadonlyArray<SessionMessage.Info>): string | undefined {
  const idle = latestIdleAssistantText(messages)
  if (!idle) return undefined
  if (idle.text.length > CONTINUE_INTENT_MAX_CHARS) return undefined
  // Trailing / prose `?` is a conversational stop, not an announce-then-idle.
  if (endsAsQuestion(idle.text) || hasProseQuestionLine(idle.text)) return undefined
  if (!announcesNext(idle.text)) return undefined

  return `${idle.promptID}\n${idle.text}`
}
