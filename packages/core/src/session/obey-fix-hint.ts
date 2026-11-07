export * as SessionObeyFixHint from "./obey-fix-hint.js"

import { DateTime } from "effect"
import { SessionMessage } from "./message.js"

/**
 * SiCode: when the user is ordering a fix ("是 bug 那你改啊"), stop the model from answering with
 * "intentional design / not a bug" and doing nothing. Request-only; `OPENCODE_OBEY_FIX=0` off.
 */

const ORDER =
  /是\s*bug|那你改|你改啊|改啊|修啊|你修|那修|fix\s+it|then\s+fix|so\s+fix\s+it|change\s+it\s*then/i

const turnStart = (messages: ReadonlyArray<SessionMessage.Info>) => {
  const index = messages.findLastIndex((message) => message.type === "user")
  if (index < 0) return undefined
  if (messages.slice(index + 1).some((message) => message.type === "assistant" || message.type === "shell"))
    return undefined
  const message = messages[index]
  if (message?.type !== "user") return undefined
  return { index, text: message.text }
}

export const needed = (text: string) => ORDER.test(text)

const hintMessage = (): SessionMessage.Synthetic => ({
  id: SessionMessage.ID.create(),
  time: { created: DateTime.makeUnsafe(Date.now()) },
  type: "synthetic",
  metadata: { notice: "obey-fix-hint" },
  description: "User ordered a fix",
  text: [
    "<obey-fix-hint>",
    "The user is ordering a concrete change, not asking whether the current design is intentional.",
    "Do not answer with \"intentional design\" / \"not a bug\" and stop. Either edit the named target, or ask one specific parameter with the question tool (for example the duration they want).",
    "If a path was previously frozen, the user is unlocking it by this order — change that path.",
    "</obey-fix-hint>",
  ].join("\n"),
})

export const inject = (input: {
  readonly messages: ReadonlyArray<SessionMessage.Info>
  readonly enabled?: boolean
}): ReadonlyArray<SessionMessage.Info> => {
  if (input.enabled === false) return input.messages
  const turn = turnStart(input.messages)
  if (!turn || !needed(turn.text)) return input.messages
  const messages = [...input.messages]
  messages.splice(turn.index + 1, 0, hintMessage())
  return messages
}
