/** Wire protocol v2: SiCode desktop ↔ Chrome MV3 extension (loopback WebSocket). */

export const CHROME_BRIDGE_PROTOCOL_VERSION = 3
/** Production packaged desktop — extension prefers this port first. */
export const CHROME_BRIDGE_DEFAULT_PORT = 17891
/** Beta packaged desktop. */
export const CHROME_BRIDGE_BETA_PORT = 17892
/** Dev / local / unpackaged (`bun dev`) — must not steal prod's port. */
export const CHROME_BRIDGE_DEV_PORT = 17893

/** Ports the extension probes, prod first so push lands on the formal desktop when both run. */
export const CHROME_BRIDGE_DISCOVERY_PORTS = [
  CHROME_BRIDGE_DEFAULT_PORT,
  CHROME_BRIDGE_BETA_PORT,
  CHROME_BRIDGE_DEV_PORT,
] as const

export type ChromeBridgeChannel = "local" | "dev" | "beta" | "prod"

/**
 * Loopback port for this desktop build.
 * Unpackaged always uses the dev port so local `bun dev` never takes over the prod bridge.
 */
export function chromeBridgeDefaultPort(input: {
  channel: ChromeBridgeChannel
  packaged: boolean
}) {
  if (!input.packaged) return CHROME_BRIDGE_DEV_PORT
  if (input.channel === "prod") return CHROME_BRIDGE_DEFAULT_PORT
  if (input.channel === "beta") return CHROME_BRIDGE_BETA_PORT
  return CHROME_BRIDGE_DEV_PORT
}

/**
 * Resolve the loopback port for this desktop build.
 * - Unpackaged (`bun dev`) always uses the dev port — never steal prod's 17891.
 * - Packaged channel defaults reclaim the shared legacy 17891 / sibling channel ports.
 * - Other custom ports (advanced) are kept.
 */
export function migrateChromeBridgePort(input: {
  stored: number
  channel: ChromeBridgeChannel
  packaged: boolean
}) {
  const preferred = chromeBridgeDefaultPort(input)
  if (!input.packaged) return preferred
  if (!input.stored || input.stored <= 0) return preferred
  const channelDefaults = new Set<number>(CHROME_BRIDGE_DISCOVERY_PORTS)
  if (channelDefaults.has(input.stored) && input.stored !== preferred) return preferred
  return input.stored
}

/** Machine-readable listen failure for Settings (e.g. `port_in_use:17891`). */
export function formatChromeBridgeListenError(error: unknown, port: number) {
  const code =
    error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : ""
  if (code === "EADDRINUSE") return `port_in_use:${port}`
  if (error instanceof Error && error.message) return error.message
  return String(error)
}

export type BridgeTab = {
  id: string
  chromeTabId: number
  url: string
  title: string
  active: boolean
  windowId: number
}

/** One DOM element picked in the extension (no live browser ref — Agent should snapshot). */
export type BridgeElement = {
  selector: string
  label: string
  role?: string
  name?: string
  text?: string
}

export type BridgeSnapshot = {
  content: string
  truncated: boolean
}

export type BridgeScreenshot = {
  mime: string
  dataBase64: string
}

export type BridgeClientMessage =
  | { type: "hello"; version: number }
  | { type: "pong" }
  /** Extension → desktop: push a page into the Composer (popup / context menu). */
  | { type: "offer.tab"; tab: BridgeTab }
  /** Extension → desktop: push one or more picked elements into the Composer. */
  | { type: "offer.element"; tab: BridgeTab; element: BridgeElement; elements: BridgeElement[]; comment?: string }
  | { type: "tabs.list.result"; requestID: string; tabs: BridgeTab[]; focusedTabID: string | null }
  | { type: "tabs.open.result"; requestID: string; tab: BridgeTab }
  | { type: "tabs.focus.result"; requestID: string; tab: BridgeTab }
  | { type: "tabs.close.result"; requestID: string; tabs: BridgeTab[]; focusedTabID: string | null }
  | { type: "navigate.result"; requestID: string; tab: BridgeTab }
  | { type: "reload.result"; requestID: string; tab: BridgeTab }
  | { type: "back.result"; requestID: string; tab: BridgeTab }
  | { type: "forward.result"; requestID: string; tab: BridgeTab }
  | { type: "snapshot.result"; requestID: string; snapshot: BridgeSnapshot; tab: BridgeTab }
  | { type: "evaluate.result"; requestID: string; value: unknown; tab: BridgeTab }
  | { type: "click.result"; requestID: string; tab: BridgeTab }
  | { type: "fill.result"; requestID: string; tab: BridgeTab }
  | { type: "press.result"; requestID: string; tab: BridgeTab }
  | { type: "scroll.result"; requestID: string; tab: BridgeTab }
  | { type: "screenshot.result"; requestID: string; screenshot: BridgeScreenshot; tab: BridgeTab }
  | {
      type: "console.result"
      requestID: string
      messages: unknown[]
      truncated: boolean
      dropped: number
      tab: BridgeTab
    }
  | {
      type: "network.list.result"
      requestID: string
      requests: unknown[]
      truncated: boolean
      dropped: number
      tab: BridgeTab
    }
  | {
      type: "network.get.result"
      requestID: string
      request: unknown
      requestHeaders: unknown[]
      responseHeaders: unknown[]
      headersTruncated: boolean
      requestBody: unknown
      responseBody: unknown
      tab: BridgeTab
    }
  | { type: "error"; requestID?: string; message: string }

export type BridgeHostMessage =
  /** `packageVersion` is the desktop-bundled CRX version — extension compares and prompts reinstall when behind. */
  | {
      type: "hello.ok"
      version: number
      port: number
      packageVersion?: string
      /** Which desktop build owns this bridge — extension prefers prod when several are up. */
      channel?: ChromeBridgeChannel
    }
  | { type: "hello.reject"; reason: string }
  | { type: "ping" }
  | { type: "tabs.list"; requestID: string }
  | { type: "tabs.open"; requestID: string; url: string }
  | { type: "tabs.focus"; requestID: string; tabID: string }
  | { type: "tabs.close"; requestID: string; tabID: string }
  | { type: "navigate"; requestID: string; tabID: string; url: string }
  | { type: "reload"; requestID: string; tabID: string; ignoreCache?: boolean }
  | { type: "back"; requestID: string; tabID: string }
  | { type: "forward"; requestID: string; tabID: string }
  | { type: "snapshot"; requestID: string; tabID: string; depth?: number }
  | {
      type: "evaluate"
      requestID: string
      tabID: string
      script: string
      ref?: string
      /** Desktop OPENCODE_ALLOW_DESTRUCTIVE_WEB_UI=1 — page.js skips delete guards. */
      allowDestructive?: boolean
    }
  | {
      type: "click"
      requestID: string
      tabID: string
      ref: string
      button?: "left" | "right" | "middle"
      count?: 1 | 2
      allowDestructive?: boolean
    }
  | { type: "fill"; requestID: string; tabID: string; ref: string; text: string }
  | { type: "press"; requestID: string; tabID: string; key: string }
  | { type: "scroll"; requestID: string; tabID: string; deltaX?: number; deltaY: number }
  | { type: "screenshot"; requestID: string; tabID: string }
  | { type: "console"; requestID: string; tabID: string; level?: string; limit?: number }
  | {
      type: "network.list"
      requestID: string
      tabID: string
      urlContains?: string
      resourceType?: string
      limit?: number
    }
  | {
      type: "network.get"
      requestID: string
      tabID: string
      id: string
      includeBody?: boolean
      maxBodyChars?: number
    }

export function parseBridgeClientMessage(raw: string): BridgeClientMessage | undefined {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return
  }

  if (!value || typeof value !== "object") return
  const type = "type" in value && typeof value.type === "string" ? value.type : undefined
  if (!type) return

  if (type === "hello") {
    const version = "version" in value && typeof value.version === "number" ? value.version : 0
    return { type: "hello", version }
  }

  if (type === "pong") return { type: "pong" }

  if (type === "offer.tab" || type === "offer.element") {
    const tab = "tab" in value ? value.tab : undefined
    if (!tab || typeof tab !== "object") return
    const id = "id" in tab && typeof tab.id === "string" ? tab.id : undefined
    const url = "url" in tab && typeof tab.url === "string" ? tab.url : undefined
    if (!id || !url) return
    const bridgeTab: BridgeTab = {
      id,
      chromeTabId: "chromeTabId" in tab && typeof tab.chromeTabId === "number" ? tab.chromeTabId : 0,
      url,
      title: "title" in tab && typeof tab.title === "string" ? tab.title : url,
      active: "active" in tab ? !!tab.active : true,
      windowId: "windowId" in tab && typeof tab.windowId === "number" ? tab.windowId : 0,
    }
    if (type === "offer.tab") return { type: "offer.tab", tab: bridgeTab }

    const rawList =
      "elements" in value && Array.isArray(value.elements)
        ? value.elements
        : "element" in value && value.element
          ? [value.element]
          : []
    const elements: BridgeElement[] = []
    for (const item of rawList) {
      if (!item || typeof item !== "object") continue
      const selector = "selector" in item && typeof item.selector === "string" ? item.selector.trim() : ""
      const label = "label" in item && typeof item.label === "string" ? item.label.trim() : ""
      if (!selector || !label) continue
      elements.push({
        selector: selector.slice(0, 2_048),
        label: label.slice(0, 512),
        ...("role" in item && typeof item.role === "string" ? { role: item.role.slice(0, 128) } : {}),
        ...("name" in item && typeof item.name === "string" ? { name: item.name.slice(0, 512) } : {}),
        ...("text" in item && typeof item.text === "string" ? { text: item.text.slice(0, 512) } : {}),
      })
      if (elements.length >= 40) break
    }
    if (!elements.length) return
    return {
      type: "offer.element",
      tab: bridgeTab,
      element: elements[0]!,
      elements,
      ...("comment" in value && typeof value.comment === "string" ? { comment: value.comment.slice(0, 2_048) } : {}),
    }
  }

  if (type === "error") {
    const requestID = "requestID" in value && typeof value.requestID === "string" ? value.requestID : undefined
    const message = "message" in value && typeof value.message === "string" ? value.message : "bridge error"
    return { type: "error", requestID, message }
  }

  // Keep the allow-list local — gui-extensions forbid module-level Sets/Maps.
  const resultTypes = new Set([
    "tabs.list.result",
    "tabs.open.result",
    "tabs.focus.result",
    "tabs.close.result",
    "navigate.result",
    "reload.result",
    "back.result",
    "forward.result",
    "snapshot.result",
    "evaluate.result",
    "click.result",
    "fill.result",
    "press.result",
    "scroll.result",
    "screenshot.result",
    "console.result",
    "network.list.result",
    "network.get.result",
  ])
  if (!resultTypes.has(type)) return
  return value as BridgeClientMessage
}
