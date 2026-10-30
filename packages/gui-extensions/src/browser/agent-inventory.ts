/**
 * Cursor `browser_tabs` parity: the agent sees a session pane, not the whole OS browser.
 * Full Chrome inventory stays internal for same-URL reuse / navigate; only the agent-facing
 * `tabs.list` result is filtered.
 */

export const MAX_AGENT_INVENTORY_TABS = 5

export type AgentInventoryTab = {
  readonly id: string
}

/**
 * Select tabs the model may treat as the working set.
 * Always prefers agent-touched IDs; includes focused when present; never dumps ambient Chrome.
 */
export function selectAgentInventoryTabs<T extends AgentInventoryTab>(input: {
  readonly tabs: ReadonlyArray<T>
  readonly focusedTabID: string | null
  readonly touchedTabIDs: ReadonlySet<string>
  readonly max?: number
}): T[] {
  const max = input.max ?? MAX_AGENT_INVENTORY_TABS
  if (max <= 0 || input.tabs.length === 0) return []

  const keep = new Set<string>()
  for (const id of input.touchedTabIDs) keep.add(id)
  if (input.focusedTabID) keep.add(input.focusedTabID)

  if (keep.size === 0) return []

  const byID = new Map(input.tabs.map((tab) => [tab.id, tab]))
  const out: T[] = []
  const seen = new Set<string>()

  const push = (id: string | null | undefined) => {
    if (!id || seen.has(id) || out.length >= max) return
    const tab = byID.get(id)
    if (!tab) return
    seen.add(id)
    out.push(tab)
  }

  // Touched first (Cursor last-interacted / navigate targets), then focused filler.
  for (const id of input.touchedTabIDs) push(id)
  push(input.focusedTabID)

  return out
}
