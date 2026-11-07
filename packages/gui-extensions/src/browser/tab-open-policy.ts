/** Tab open / prune policy — Electron-free so Bun can unit-test it. */

export const MAX_BROWSER_TABS = 3

/** Generic in the tab id so a branded id (e.g. `Browser.TabID`) flows through unchanged. */
export type TabRef<ID extends string = string> = { readonly id: ID; readonly url: string }

export type TabOpenPlan<ID extends string = string> = {
  /** Existing tab to focus instead of creating. */
  readonly reuseTabID?: ID
  /** Close these (never includes reuseTabID). Blanks → URL dupes → overflow, oldest first. */
  readonly closeTabIDs: readonly ID[]
}

/**
 * Query keys tools use only to bust cache. They are not document identity — `?np=1` and `?np=2`
 * on the same path are one page, so open must reuse and refresh instead of stacking tabs.
 */
const CACHE_BUST_QUERY = /^(np|v|t|ts|cb|cache|_)$/i

function stripCacheBustQuery(parsed: URL) {
  if (!parsed.search) return
  const params = new URLSearchParams(parsed.search)
  let changed = false
  for (const key of [...params.keys()]) {
    if (!CACHE_BUST_QUERY.test(key)) continue
    params.delete(key)
    changed = true
  }
  if (changed) parsed.search = params.toString()
}

/** Match same document across trailing slash, default port, hash, and cache-bust query. */
export function canonicalizeBrowserURL(url: string): string {
  const raw = url.trim() || "about:blank"
  if (raw === "about:blank") return "about:blank"
  if (!URL.canParse(raw)) return raw
  const parsed = new URL(raw)

  if (parsed.protocol === "file:") {
    parsed.hash = ""
    stripCacheBustQuery(parsed)
    return parsed.href
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return raw

  parsed.hash = ""
  stripCacheBustQuery(parsed)
  parsed.hostname = parsed.hostname.toLowerCase()
  if ((parsed.protocol === "http:" && parsed.port === "80") || (parsed.protocol === "https:" && parsed.port === "443")) {
    parsed.port = ""
  }
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.slice(0, -1)
  }

  return parsed.href
}

/** True when two URLs name the same document under {@link canonicalizeBrowserURL}. */
export function sameBrowserDocument(a: string | undefined, b: string): boolean {
  if (!a) return false
  return canonicalizeBrowserURL(a) === canonicalizeBrowserURL(b)
}

/**
 * Decide whether to reuse a tab and which extras to close before/after open.
 * Callers that create a tab should treat a missing `reuseTabID` as "create one", after applying closes.
 */
export function planTabsOpen<ID extends string = string>(input: {
  readonly tabs: ReadonlyArray<TabRef<ID>>
  readonly focusedTabID: ID | null
  readonly url: string
  readonly maxTabs?: number
}): TabOpenPlan<ID> {
  const max = input.maxTabs ?? MAX_BROWSER_TABS
  const wanted = canonicalizeBrowserURL(input.url)
  const reuse = input.tabs.find((tab) => canonicalizeBrowserURL(tab.url) === wanted)
  const keepID = reuse?.id
  const creating = !reuse
  const closeTabIDs: ID[] = []
  const closed = new Set<ID>()

  const markClose = (id: ID) => {
    if (id === keepID || closed.has(id)) return
    closed.add(id)
    closeTabIDs.push(id)
  }

  // Unused blanks: keep only the reused blank (if any).
  for (const tab of input.tabs) {
    if (canonicalizeBrowserURL(tab.url) === "about:blank") markClose(tab.id)
  }

  // Duplicate documents: keep reuse → focused → first remaining.
  const byURL = new Map<string, TabRef<ID>[]>()
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
