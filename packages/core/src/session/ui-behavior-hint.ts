export * as SessionUiBehaviorHint from "./ui-behavior-hint.js"

import { DateTime } from "effect"
import { SessionMessage } from "./message.js"

/**
 * SiCode: when a request is about UI behavior — what a control does when clicked, which shortcut
 * fires, why a panel does not update — point the model at the running thing before the source,
 * because the alternative is a grep spiral that never proves anything.
 *
 * Measured on a real session ("Ctrl+Shift+C element picker check"): 26 tool calls, 20 of them grep
 * against source, 3 reads, 3 shell, and zero browser steps. A behavior question was answered by
 * searching code for 17 rounds before the model even named the right direction. The reasoning ran
 * 5x the output tokens — thinking hard, never looking at the thing that actually behaves.
 *
 * The fix is a nudge, not a mechanism: on turns that ask how something behaves, tell the model to
 * reproduce the behavior first and treat source as a map to the reproduction, not the answer. It
 * rides the request only, like the clarify and design hints — nothing is written to the session
 * and the cached system prefix is untouched.
 */

/**
 * Words that name a behavior question rather than a styling task. Deliberately disjoint from the
 * design hint's set (font/color/spacing/...): that one fires on "what should it look like", this
 * one on "what does it do / why does it not do it". A request can carry both, and then both fire.
 */
/**
 * Only behavior verbs and failure descriptions, not UI nouns. "面板/侧栏/菜单/标签页" name a surface
 * that could be styled or behaved — the design hint owns styling, so a bare noun must not fire here;
 * it needs a behavior verb ("面板点击没反应") to count. "浏览器/网页" stay because a browser task is
 * behavior by definition, not a styling target.
 */
const BEHAVIOR_WORDS =
  /快捷键|快捷方式|热键|按键|点击|双击|右键|悬停|拖动|拖拽|选中|选取|聚焦|失焦|触发|弹出|弹窗|跳转|导航|刷新|加载|失灵|没反应|不生效|点了没|失效|交互|行为|浏览器|网页|\b(shortcut|hotkey|keybind|click|dblclick|hover|drag|drop|focus|blur|select|inspect|trigger|popup|modal|navigate|redirect|reload|refresh|respond|interact|behavior|browser|webview)\b/i

/**
 * A request can describe a behavior without using those words ("为什么 Ctrl+Shift+C 不弹"). Anchor
 * it on a concrete trigger instead: a key chord, a modifier-plus-key, or a DOM-ish verb.
 */
const BEHAVIOR_TRIGGER = /\b(ctrl|shift|alt|cmd|command|meta|win)\s*[+]|\b(?:点击|按下|hover|drag|select|触发|弹出)/i

/** Whether this request is a UI-behavior question. */
const isBehaviorRequest = (text: string) => BEHAVIOR_WORDS.test(text) || BEHAVIOR_TRIGGER.test(text)

const hintMessage = (): SessionMessage.Synthetic => ({
  id: SessionMessage.ID.create(),
  time: { created: DateTime.makeUnsafe(Date.now()) },
  type: "synthetic",
  metadata: { notice: "ui-behavior-hint" },
  description: "Request asks how something behaves in the UI",
  text: [
    "<ui-behavior-hint>",
    "This request asks how something in the UI behaves (a shortcut, a click, a panel updating), not how it looks.",
    "Reproduce the behavior first: run the app or open the page and exercise the exact control before reading source.",
    "Treat the source as a map to the reproduction, not the answer. One grep to find the handler, then confirm by triggering it — do not read file after file to reason the behavior out.",
    "When a running app or page is unavailable, say in one line what you would run to see it, then state what you can still confirm from source.",
    "</ui-behavior-hint>",
  ].join("\n"),
})

/**
 * The request that starts this turn: the last user message, before anything is produced under it.
 * Behavior is just as likely asked mid-session, but the first reading is where a wrong direction
 * (grep spiral) is chosen, so that is the only place this fires.
 */
const turnStart = (messages: ReadonlyArray<SessionMessage.Info>) => {
  const index = messages.findLastIndex((message) => message.type === "user")
  if (index < 0) return undefined
  if (messages.slice(index + 1).some((message) => message.type === "assistant" || message.type === "shell"))
    return undefined
  const message = messages[index]
  if (message?.type !== "user") return undefined
  return { index, text: message.text }
}

/**
 * Prepends the hint after a behavior question, or returns the messages unchanged.
 * `enabled: false` is the A/B switch — request-only, so turning it off costs nothing.
 */
export const inject = (input: {
  readonly messages: ReadonlyArray<SessionMessage.Info>
  readonly enabled?: boolean
}): ReadonlyArray<SessionMessage.Info> => {
  if (input.enabled === false) return input.messages
  const turn = turnStart(input.messages)
  if (!turn) return input.messages
  if (!isBehaviorRequest(turn.text)) return input.messages

  const messages = [...input.messages]
  messages.splice(turn.index + 1, 0, hintMessage())
  return messages
}
