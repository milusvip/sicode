export * as SessionClarifyHint from "./clarify-hint.js"

import { DateTime } from "effect"
import { SessionMessage } from "./message.js"

/**
 * SiCode: when the opening request of a session is too thin to act on, say exactly what is
 * missing and ask for it — instead of letting the model guess.
 *
 * The data behind the shape of this: across 302 real prompts, 16% are short and carry an action
 * verb but name no file, symbol, path, or number ("写个demo", "你帮我修复好"). Reading them is
 * never the problem — the model parses broken punctuation and typos fine. The cost is that it
 * picks a target and a deliverable on its own, and a wrong pick burns a whole turn.
 *
 * Two deliberate restraints keep it from becoming noise:
 * - Only the request that starts a turn. Once work is running under it, the model has its own
 *   context and a question would interrupt rather than help.
 * - Nothing that licenses guessing, and nothing that is a question. "随便写个demo" hands the
 *   choice over, and "这次改动能感觉到什么" wants an answer — asking in either place would be
 *   exactly the wrong move.
 *
 * This rides the request only, like the context hints: nothing is written to the session, so it
 * cannot pollute the transcript or a later compaction, and the cached system prefix is untouched.
 */

/** Longer requests carry their own scope; the ones that cost a round are the short ones. */
const MAX_LENGTH = 24

const ACTION =
  /写|做|搞|改|加|删|实现|生成|优化|弄|修复|查|搜|看看|来一|整一|搭一|\b(write|build|make|create|add|fix|change|implement|refactor|generate|search|look)\b/i

/** Creates something new, as opposed to changing something that already exists. */
const CREATES = /写|做|搞|生成|来一|整一|搭一|\b(write|build|make|create|generate)\b/i

/** Anything that names a concrete thing: a path, a file, a symbol, a number, a URL, a quote. */
const ANCHOR = /[/\\`"'“”]|\b[\w.-]+\.[a-z]{1,4}\b|\b[A-Za-z_][A-Za-z0-9_]{4,}\b|\d|:\/\//

/** The user handing the choice over. Asking here would contradict the request itself. */
const LENIENT = /随便|随意|都行|你定|看你|自由发挥|whatever|anything|surprise/i

/** A question is answered, not acted on: "这次改动能感觉到什么" is not an under-specified task. */
const QUESTION = /吗|呢|啥|什么|怎么|为什么|哪|如何|多少|是不是|[?？]/

const CONTINUATION = ["继续", "好", "嗯", "可以", "行", "对", "是", "ok", "okay", "yes", "yep", "go", "continue", "next"]

const isContinuation = (text: string) => {
  const bare = text.toLowerCase().replace(/[\s。，、！？!?.,~]/g, "")
  return CONTINUATION.includes(bare)
}

/**
 * What the request leaves open, as short phrases. Empty means the request is actionable as-is.
 * Pure: no IO, no state, so the rule can be tested against real prompts without a session.
 */
export const assess = (text: string): readonly string[] => {
  const trimmed = text.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_LENGTH) return []
  if (LENIENT.test(trimmed) || isContinuation(trimmed) || QUESTION.test(trimmed)) return []
  if (!ACTION.test(trimmed) || ANCHOR.test(trimmed)) return []

  return [
    "which file, module, or symbol it refers to",
    CREATES.test(trimmed) ? "what form the result should take" : "what counts as done",
  ]
}

const hintMessage = (missing: readonly string[]): SessionMessage.Synthetic => ({
  id: SessionMessage.ID.create(),
  time: { created: DateTime.makeUnsafe(Date.now()) },
  type: "synthetic",
  metadata: { notice: "clarify-hint" },
  description: "Request is under-specified",
  text: [
    "<clarify-hint>",
    `This request does not say ${missing.join(", or ")}.`,
    "Open your reply with one line naming the reading you are taking, then work from it.",
    "Say so and ask with the question tool only when two readings are both plausible and would lead to different work — one question, offering the readings as the options.",
    "Never ask for something the request, the conversation, or the repository already answers.",
    "</clarify-hint>",
  ].join("\n"),
})

/**
 * The request that starts this turn: the last user message, while nothing has been produced under
 * it yet. Checked per turn rather than per session because an under-specified request is just as
 * likely to open the fifth turn as the first — and the cost of a wrong guess is the same.
 */
const turnStart = (messages: ReadonlyArray<SessionMessage.Info>) => {
  const index = messages.findLastIndex((message) => message.type === "user")
  if (index < 0) return undefined
  // Work already started under this request carries its own context now.
  if (messages.slice(index + 1).some((message) => message.type === "assistant" || message.type === "shell"))
    return undefined
  const message = messages[index]
  if (message?.type !== "user") return undefined
  return { index, text: message.text }
}

/**
 * Prepends a hint after an under-specified opening request, or returns the messages unchanged.
 * `enabled: false` is the A/B switch — the hint is request-only, so turning it off costs nothing.
 */
export const inject = (input: {
  readonly messages: ReadonlyArray<SessionMessage.Info>
  readonly enabled?: boolean
}): ReadonlyArray<SessionMessage.Info> => {
  if (input.enabled === false) return input.messages
  const turn = turnStart(input.messages)
  if (!turn) return input.messages

  const missing = assess(turn.text)
  if (missing.length === 0) return input.messages

  const messages = [...input.messages]
  // After the prompt it belongs to: the user's words come first, then the hint.
  messages.splice(turn.index + 1, 0, hintMessage(missing))
  return messages
}
