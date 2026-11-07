/**
 * SiCode: browser tool names are advertised as `browser_click` (namespace_name) but several
 * SiCode checks historically used dotted `browser.click`. Match both so gates and system-prompt
 * guidance actually fire when the side browser is attached.
 */

export const toolKey = (name: string) => name.replaceAll(".", "_")

export const hasTool = (tools: ReadonlyArray<string>, ...want: string[]) => {
  const set = new Set(tools.map(toolKey))
  return want.some((name) => set.has(toolKey(name)))
}

/** Any browser.* / browser_* tool call in a transcript part name. */
export const isBrowserTool = (name: string) => toolKey(name).startsWith("browser_")

/** Session metadata key holding the last attached tab inventory (compact). */
export const BROWSER_TABS_KEY = "sicode.browserTabs"

export type BrowserTabSummary = {
  readonly id: string
  readonly title: string
  readonly url: string
}

export type BrowserTabsMeta = {
  readonly access: "full" | "read"
  readonly focusedTabID: string | null
  readonly tabs: ReadonlyArray<BrowserTabSummary>
}

export const tabsOf = (metadata: Record<string, unknown> | undefined): BrowserTabsMeta | undefined => {
  const raw = metadata?.[BROWSER_TABS_KEY]
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined
  const record = raw as Record<string, unknown>
  if (!Array.isArray(record.tabs)) return undefined
  const tabs = record.tabs.flatMap((item): BrowserTabSummary[] => {
    if (!item || typeof item !== "object") return []
    const tab = item as Record<string, unknown>
    if (typeof tab.id !== "string" || typeof tab.url !== "string") return []
    return [{ id: tab.id, title: typeof tab.title === "string" ? tab.title : "", url: tab.url }]
  })
  return {
    access: record.access === "read" ? "read" : "full",
    focusedTabID: typeof record.focusedTabID === "string" ? record.focusedTabID : null,
    tabs,
  }
}

/**
 * SiCode: true when the user prompt embeds a side-browser / system-Chrome note (element pick,
 * page comment, or extension push). Matched on the fixed subjects `comment.ts` emits — not a
 * free-form Chinese phrase list — so a picked element still drives the browser when tab inventory
 * has not been mirrored yet.
 */
export const mentionsAttachedBrowser = (text: string) =>
  /browser tab |browser ref @|browser page at |on the browser page at |usable as ref in any browser tool/i.test(
    text,
  )

/**
 * Short follow-up after an attached browser locus — look at what was already pointed at.
 * Length-only (and embedded browser notes); no look/log Chinese phrase list.
 */
export const isBrowserLookFollowUp = (text: string) => {
  const trimmed = text.trim()
  if (trimmed.length === 0 || trimmed.length > 48) return false
  if (mentionsAttachedBrowser(trimmed)) return true
  // Caller already requires a prior browser locus; any short follow-up is "look at that".
  return true
}

/** Latest user message in this session that embeds a browser page/element note, if any. */
export const recentBrowserLocus = (
  messages: ReadonlyArray<{ readonly type: string; readonly text?: string }>,
): string | undefined => {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!
    if (message.type !== "user") continue
    const text = typeof message.text === "string" ? message.text : ""
    if (mentionsAttachedBrowser(text)) return text
  }
  return undefined
}

/** Snapshot/list is enough to *look*; click is only required to drive forms. */
export const canInspectBrowser = (tools: ReadonlyArray<string>) =>
  hasTool(tools, "browser.snapshot", "browser_snapshot") &&
  hasTool(tools, "browser.tabs.list", "browser_tabs_list")
