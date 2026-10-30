/** Wire protocol v2 between SiCode desktop bridge and this extension (loopback WebSocket). */

export const PROTOCOL_VERSION = 3

/** @typedef {{ type: "hello"; version: number }} Hello */
/** @typedef {{ type: "hello.ok"; version: number; port?: number; packageVersion?: string; channel?: "local" | "dev" | "beta" | "prod" }} HelloOk */

/** Prod → beta → dev. Keep in sync with gui-extensions chrome protocol. */
export const DISCOVERY_PORTS = [17891, 17892, 17893]
/** @typedef {{ type: "hello.reject"; reason: string }} HelloReject */

/**
 * True when installed dotted version is strictly behind expected (desktop-bundled CRX).
 * @param {string} installed
 * @param {string} expected
 */
export function isPackageBehind(installed, expected) {
  if (!installed || !expected || installed === expected) return false
  const left = installed.split(".").map((part) => Number(part) || 0)
  const right = expected.split(".").map((part) => Number(part) || 0)
  const length = Math.max(left.length, right.length)
  for (let i = 0; i < length; i++) {
    const a = left[i] ?? 0
    const b = right[i] ?? 0
    if (a < b) return true
    if (a > b) return false
  }
  return false
}
/** @typedef {{ type: "ping" }} Ping */
/** @typedef {{ type: "pong" }} Pong */
/** @typedef {{ type: "offer.tab"; tab: BridgeTab }} OfferTab */
/** @typedef {{ selector: string; label: string; role?: string; name?: string; text?: string }} BridgeElement */
/** @typedef {{ type: "offer.element"; tab: BridgeTab; element: BridgeElement; elements?: BridgeElement[]; comment?: string }} OfferElement */
/** @typedef {{ type: "tabs.list"; requestID: string }} TabsList */
/** @typedef {{ id: string; chromeTabId: number; url: string; title: string; active: boolean; windowId: number }} BridgeTab */
/** @typedef {{ type: "tabs.list.result"; requestID: string; tabs: BridgeTab[]; focusedTabID: string | null }} TabsListResult */
/** @typedef {{ type: "tabs.open"; requestID: string; url: string }} TabsOpen */
/** @typedef {{ type: "tabs.open.result"; requestID: string; tab: BridgeTab }} TabsOpenResult */
/** @typedef {{ type: "tabs.focus"; requestID: string; tabID: string }} TabsFocus */
/** @typedef {{ type: "tabs.focus.result"; requestID: string; tab: BridgeTab }} TabsFocusResult */
/** @typedef {{ type: "error"; requestID?: string; message: string }} BridgeError */

export function tabIDFromChrome(id) {
  return `chrome_tab_${id}`
}

export function chromeIdFromTabID(tabID) {
  const match = /^chrome_tab_(\d+)$/.exec(tabID)
  if (!match) return undefined
  return Number(match[1])
}

export function toBridgeTab(tab) {
  return {
    id: tabIDFromChrome(tab.id),
    chromeTabId: tab.id,
    url: tab.url ?? "",
    title: tab.title ?? "",
    active: !!tab.active,
    windowId: tab.windowId,
  }
}
