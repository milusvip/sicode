/** Tab open / prune policy — Electron-free so Bun can unit-test it. */

export const MAX_BROWSER_TABS = 3

export type TabRef = { readonly id: string; readonly url: string }

export type TabOpenPlan = {
  /** Existing tab to focus instead of creating. */
  readonly reuseTabID?: string
  /** Close these (never includes reuseTabID). Blanks → URL dupes → overflow, oldest first. */
  readonly closeTabIDs: readonly string[]
}

/** Match same document across trailing slash, default port, and hash differences. */
export function canonicalizeBrowserURL(url: string): string {
  const raw = url.trim() || "about:blank"
  if (raw === "about:blank") return "about:blank"
  if (!URL.canParse(raw)) return raw
  const parsed = new URL(raw)

  if (parsed.protocol === "file:") {
    parsed.hash = ""
    return parsed.href
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return raw

  parsed.hash = ""
  parsed.hostname = parsed.hostname.toLowerCase()
  if ((parsed.protocol === "http:" && parsed.port === "80") || (parsed.protocol === "https:" && parsed.port === "443")) {
    parsed.port = ""
  }
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.slice(0, -1)
  }

  return parsed.href
}

/**
 * Decide whether to reuse a tab and which extras to close before/after open.
 * Callers that create a tab should treat a missing `reuseTabID` as "create one", after applying closes.
 */
export function planTabsOpen(input: {
  readonly tabs: ReadonlyArray<TabRef>
  readonly focusedTabID: string | null
  readonly url: string
  readonly maxTabs?: number
}): TabOpenPlan {
  const max = input.maxTabs ?? MAX_BROWSER_TABS
  const wanted = canonicalizeBrowserURL(input.url)
  const reuse = input.tabs.find((tab) => canonicalizeBrowserURL(tab.url) === wanted)
  const keepID = reuse?.id
  const creating = !reuse
  const closeTabIDs: string[] = []
  const closed = new Set<string>()

  const markClose = (id: string) => {
    if (id === keepID || closed.has(id)) return
    closed.add(id)
    closeTabIDs.push(id)
  }

  // Unused blanks: keep only the reused blank (if any).
  for (const tab of input.tabs) {
    if (canonicalizeBrowserURL(tab.url) === "about:blank") markClose(tab.id)
  }

  // Duplicate documents: keep reuse → focused → first remaining.
  const byURL = new Map<string, TabRef[]>()
  for (const tab of input.tabs) {
    if (closed.has(tab.id)) continue
    const key = canonicalizeBrowserURL(tab.url)
    const group = byURL.get(key)
    if (group) group.push(tab)
    else byURL.set(key, [tab])
  }
  for (const group of byURL.values()) {
    if (group.length <= 1) continue
    const keeper =
      group.find((tab) => tab.id === keepID) ??
      group.find((tab) => tab.id === input.focusedTabID) ??
      group[0]
    for (const tab of group) {
      if (tab.id !== keeper.id) markClose(tab.id)
    }
  }

  // Cap: after closes, survivors + optional new tab must fit under max.
  const survivors = input.tabs.filter((tab) => !closed.has(tab.id))
  let count = survivors.length + (creating ? 1 : 0)
  if (count > max) {
    const candidates = survivors.filter((tab) => tab.id !== keepID)
    const ordered = [
      ...candidates.filter((tab) => tab.id !== input.focusedTabID),
      ...candidates.filter((tab) => tab.id === input.focusedTabID),
    ]
    for (const tab of ordered) {
      if (count <= max) break
      markClose(tab.id)
      count -= 1
    }
  }

  return keepID ? { reuseTabID: keepID, closeTabIDs } : { closeTabIDs }
}
