export * as SessionBrowserDriveHint from "./browser-drive-hint.js"

/**
 * SiCode: browser tab inventory inject (request-only).
 *
 * When click tools are available and either (a) the attachment mirrored open tabs into session
 * metadata or (b) the latest user prompt embeds a browser element/page note, put that inventory
 * (or a reconnect hint) in front of the model so it does not guess whether the side browser
 * exists. The hard refuse backstop is `runner/browser-drive-gate.ts` (zero browser tool calls →
 * force continue). `OPENCODE_BROWSER_DRIVE=0` turns this off.
 */

import { DateTime } from "effect"
import { SessionMessage } from "./message.js"
import {
  BROWSER_TABS_KEY,
  canInspectBrowser,
  hasTool,
  isBrowserLookFollowUp,
  mentionsAttachedBrowser,
  recentBrowserLocus,
  tabsOf,
  type BrowserTabsMeta,
} from "./browser-tools.js"

const turnStart = (messages: ReadonlyArray<SessionMessage.Info>) => {
  const index = messages.findLastIndex((message) => message.type === "user")
  if (index < 0) return undefined
  if (messages.slice(index + 1).some((message) => message.type === "assistant" || message.type === "shell"))
    return undefined
  const message = messages[index]
  if (message?.type !== "user") return undefined
  return { index, text: message.text }
}

export const canDrive = (tools: ReadonlyArray<string>) =>
  hasTool(tools, "browser.click", "browser_click") &&
  hasTool(tools, "browser.snapshot", "browser_snapshot", "browser.tabs.list", "browser_tabs_list")

const formatTabs = (inventory: BrowserTabsMeta) => [
  `Open tabs (${inventory.access} access):`,
  ...inventory.tabs.map((tab) => {
    const focus = inventory.focusedTabID === tab.id ? " [focused]" : ""
    return `- ${tab.id}${focus}: ${tab.title || "(untitled)"} — ${tab.url}`
  }),
]

const inventoryHint = (inventory: BrowserTabsMeta): SessionMessage.Synthetic => ({
  id: SessionMessage.ID.create(),
  time: { created: DateTime.makeUnsafe(Date.now()) },
  type: "synthetic",
  metadata: { notice: "browser-drive-hint" },
  description: "Attached browser tab inventory",
  text: [
    "<browser-tabs>",
    "The side browser (or system Chrome bridge) is attached with these open tabs. Use exact tabIDs from this list or from browser.tabs.list; do not invent IDs.",
    ...formatTabs(inventory),
    "When the user asks to publish, submit, click, fill, or debug on that page — drive it with browser tools. Do not refuse with missing browser, missing login, missing API, or \"I cannot operate / click / publish\".",
    "</browser-tabs>",
  ].join("\n"),
})

/** User already named a browser target in a note; inventory may still be reconnecting. */
const noteHint = (): SessionMessage.Synthetic => ({
  id: SessionMessage.ID.create(),
  time: { created: DateTime.makeUnsafe(Date.now()) },
  type: "synthetic",
  metadata: { notice: "browser-drive-hint" },
  description: "Attached browser note target",
  text: [
    "<browser-tabs>",
    "The user pushed or pointed at a page/element in system Chrome (or the side browser). See their comment for tabID (`chrome_tab_*` / `tab_chrome_*`) or browser ref.",
    "Call browser.tabs.list now, then snapshot/find and drive that live tab with click/fill/screenshot — same API for system Chrome and the in-app pane. Prefer the tabID from their comment.",
    'Do not open a second browser. Drive click/fill/publish when asked. Do not refuse with missing browser, missing login, missing API, or "I cannot operate / click / publish".',
    "</browser-tabs>",
  ].join("\n"),
})

/**
 * SiCode: short follow-up after an earlier page note. Forbid asking which
 * log source; the pointed page is the locus.
 */
const followUpHint = (locus: string): SessionMessage.Synthetic => {
  const url = locus.match(/https?:\/\/\S+/)?.[0]
  return {
    id: SessionMessage.ID.create(),
    time: { created: DateTime.makeUnsafe(Date.now()) },
    type: "synthetic",
    metadata: { notice: "browser-drive-hint" },
    description: "Browser look follow-up",
    text: [
      "<browser-tabs>",
      "The user already pointed at a browser page earlier in this session" +
        (url ? ` (${url})` : "") +
        ". This short look/log follow-up means that same page.",
      "Call browser.tabs.list now, then snapshot / network / console on that tab.",
      "Do not ask which log source to use. Do not open Temp/*.log as a substitute until a browser tool call has failed.",
      'Do not call the question tool to choose between "online page" and "local API log".',
      "</browser-tabs>",
    ].join("\n"),
  }
}

export const inject = (input: {
  readonly messages: ReadonlyArray<SessionMessage.Info>
  readonly tools: ReadonlyArray<string>
  readonly metadata?: Record<string, unknown>
  readonly enabled?: boolean
}): ReadonlyArray<SessionMessage.Info> => {
  if (input.enabled === false) return input.messages
  // Inspect is enough to look; click-only gate left publish/drive turns needing fill behind.
  if (!canInspectBrowser(input.tools) && !canDrive(input.tools)) return input.messages
  const turn = turnStart(input.messages)
  if (!turn) return input.messages
  const inventory = tabsOf(input.metadata)
  const hasTabs = !!inventory && inventory.tabs.length > 0
  const noteHere = mentionsAttachedBrowser(turn.text)
  const prior = recentBrowserLocus(input.messages)
  const lookFollowUp = !!prior && isBrowserLookFollowUp(turn.text)
  if (!hasTabs && !noteHere && !lookFollowUp) return input.messages
  const hint =
    hasTabs && inventory ? inventoryHint(inventory) : lookFollowUp && prior ? followUpHint(prior) : noteHint()
  const messages = [...input.messages]
  messages.splice(turn.index + 1, 0, hint)
  return messages
}

export { BROWSER_TABS_KEY }
