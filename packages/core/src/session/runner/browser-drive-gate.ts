/**
 * SiCode: browser-drive hard gate (no free-form phrase list for *publish*).
 *
 * Soft prompts were ignored (ses_e5b3ddeb): Flash refused with browser tools granted and zero
 * browser.* calls. Trigger is mechanical: inspect tools available, and either open tabs, a
 * browser note on this prompt, or a short look/log follow-up after an earlier browser note
 * (short follow-up after an attached page note — model asked which logs instead of driving).
 * Once per user-prompt id. `OPENCODE_BROWSER_DRIVE=0` disables.
 */

import type { SessionMessage } from "../message.js"
import {
  canInspectBrowser,
  isBrowserLookFollowUp,
  isBrowserTool,
  mentionsAttachedBrowser,
  recentBrowserLocus,
  tabsOf,
} from "../browser-tools.js"

export const BROWSER_DRIVE_GATE_PROMPT = `You stopped without using any browser tools, but this session has an attached browser target (open tabs, a page/element note, or a short look/log follow-up after one) and browser inspect tools available.

Drive it now: call browser.tabs.list (or browser_tabs_list), then snapshot / click / fill on the pointed page. Publish, submit, and form fills are in scope when the user asked — do not refuse with "I cannot click/publish/operate the page".

Do not ask which log source to use. Do not end the turn until you have made at least one browser tool call.`

/**
 * Fingerprint of a turn that idled with a browser target and zero browser tools,
 * or undefined when the model already used the browser / tools or no browser target exists.
 */
export function browserDriveIdleFingerprint(
  messages: ReadonlyArray<SessionMessage.Info>,
  tools: ReadonlyArray<string>,
  metadata?: Record<string, unknown>,
): string | undefined {
  // Look/log needs snapshot+tabs; click is optional (ses_e52717184 was a look, not a fill).
  if (!canInspectBrowser(tools)) return undefined

  const index = messages.findLastIndex((message) => message.type === "user")
  if (index < 0) return undefined
  const prompt = messages[index]
  if (prompt.type !== "user") return undefined

  const inventory = tabsOf(metadata)
  const hasTabs = !!inventory && inventory.tabs.length > 0
  const noteHere = mentionsAttachedBrowser(prompt.text)
  const prior = recentBrowserLocus(messages)
  const lookFollowUp = !!prior && isBrowserLookFollowUp(prompt.text)
  if (!hasTabs && !noteHere && !lookFollowUp) return undefined

  const turn = messages.slice(index + 1)
  if (!turn.some((message) => message.type === "assistant")) return undefined

  const usedBrowser = turn.some(
    (message) =>
      message.type === "assistant" &&
      message.content.some((part) => part.type === "tool" && isBrowserTool(part.name)),
  )
  if (usedBrowser) return undefined

  return prompt.id
}
