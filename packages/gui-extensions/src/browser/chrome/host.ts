import { createHash, randomBytes } from "node:crypto"
import fs from "node:fs"
import { createServer, type Server as HttpServer, type IncomingMessage } from "node:http"
import path from "node:path"
import type { Duplex } from "node:stream"
import {
  bundledExtensionSource,
  extensionCrxPath,
  extensionInstallDir,
  readExtensionPackageVersion,
} from "./bundle"
import {
  CHROME_BRIDGE_DEFAULT_PORT,
  CHROME_BRIDGE_PROTOCOL_VERSION,
  formatChromeBridgeListenError,
  parseBridgeClientMessage,
  type BridgeElement,
  type BridgeHostMessage,
  type BridgeScreenshot,
  type BridgeSnapshot,
  type BridgeTab,
} from "./protocol"

export type BridgeElementOffer = {
  tab: BridgeTab
  /** First element (same as `elements[0]`) for call-site convenience. */
  element: BridgeElement
  elements: BridgeElement[]
  comment?: string
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export type ChromeBridgeHostStatus = {
  enabled: boolean
  running: boolean
  port: number
  token: string
  connected: boolean
  extensionPath: string
  packageVersion: string
  /** Empty when listening; `port_in_use:<n>` or a short error when bind failed. */
  listenError: string
}

export type ChromeBridgeHost = {
  status: () => ChromeBridgeHostStatus
  setEnabled: (enabled: boolean) => Promise<ChromeBridgeHostStatus>
  rotateToken: () => Promise<ChromeBridgeHostStatus>
  setPort: (port: number) => Promise<ChromeBridgeHostStatus>
  listTabs: () => Promise<{ tabs: BridgeTab[]; focusedTabID: string | null }>
  openTab: (url: string) => Promise<BridgeTab>
  focusTab: (chromeTabId: number) => Promise<BridgeTab>
  closeTab: (chromeTabId: number) => Promise<{ tabs: BridgeTab[]; focusedTabID: string | null }>
  navigateTab: (chromeTabId: number, url: string) => Promise<BridgeTab>
  reloadTab: (chromeTabId: number, ignoreCache?: boolean) => Promise<BridgeTab>
  backTab: (chromeTabId: number) => Promise<BridgeTab>
  forwardTab: (chromeTabId: number) => Promise<BridgeTab>
  snapshotTab: (chromeTabId: number, depth?: number) => Promise<{ snapshot: BridgeSnapshot; tab: BridgeTab }>
  evaluateTab: (
    chromeTabId: number,
    script: string,
    ref?: string,
    allowDestructive?: boolean,
  ) => Promise<{ value: unknown; tab: BridgeTab }>
  clickTab: (
    chromeTabId: number,
    ref: string,
    button?: "left" | "right" | "middle",
    count?: 1 | 2,
    allowDestructive?: boolean,
  ) => Promise<BridgeTab>
  fillTab: (chromeTabId: number, ref: string, text: string) => Promise<BridgeTab>
  pressTab: (chromeTabId: number, key: string) => Promise<BridgeTab>
  scrollTab: (chromeTabId: number, deltaY: number, deltaX?: number) => Promise<BridgeTab>
  screenshotTab: (chromeTabId: number) => Promise<{ screenshot: BridgeScreenshot; tab: BridgeTab }>
  consoleTab: (
    chromeTabId: number,
    input?: { level?: string; limit?: number },
  ) => Promise<{ messages: unknown[]; truncated: boolean; dropped: number; tab: BridgeTab }>
  networkListTab: (
    chromeTabId: number,
    input?: { urlContains?: string; resourceType?: string; limit?: number },
  ) => Promise<{ requests: unknown[]; truncated: boolean; dropped: number; tab: BridgeTab }>
  networkGetTab: (
    chromeTabId: number,
    input: { id: string; includeBody?: boolean; maxBodyChars?: number },
  ) => Promise<{
    request: unknown
    requestHeaders: unknown[]
    responseHeaders: unknown[]
    headersTruncated: boolean
    requestBody: unknown
    responseBody: unknown
    tab: BridgeTab
  }>
  onConnectionChange: (listener: (connected: boolean) => void) => () => void
  /** Extension pushed a page (popup / context menu) for the Composer. */
  onTabOffer: (listener: (tab: BridgeTab) => void) => () => void
  onElementOffer: (listener: (offer: BridgeElementOffer) => void) => () => void
  /** SiCode: the extension pushed the site's login cookies for the in-app pane. */
  onCookieSync: (listener: (event: { url: string; text: string }) => void) => () => void
  dispose: () => Promise<void>
}

type Stores = {
  enabled: { value: boolean; set: (value: boolean) => void }
  token: { value: string; set: (value: string) => void }
  port: { value: number; set: (value: number) => void }
}

type HostOptions = {
  channel: "local" | "dev" | "beta" | "prod"
}

/** Prefer the packed .crx in userData; else bundled .crx; else install dir / source. */
const extensionPath = () => {
  const crx = extensionCrxPath()
  if (fs.existsSync(crx)) return crx
  const source = bundledExtensionSource()
  if (source) {
    const bundled = path.join(source, "SiCode-Browser-Bridge.crx")
    if (fs.existsSync(bundled)) return bundled
  }
  return extensionInstallDir()
}

const mintToken = () => randomBytes(24).toString("base64url")

export function createChromeBridgeHost(stores: Stores, options: HostOptions): ChromeBridgeHost {
  let http: HttpServer | undefined
  /** @type {import("node:http").ServerResponse | undefined} — kept only for typing widen; sockets tracked below */
  const sockets = new Set<Duplex>()
  let accepted: Duplex | undefined
  /** True only after a successful hello.ok — WS upgrade alone is not enough. */
  let paired = false
  const pending = new Map<string, Pending>()
  let starting: Promise<void> | undefined
  const connectionListeners = new Set<(connected: boolean) => void>()
  const tabOfferListeners = new Set<(tab: BridgeTab) => void>()
  const elementOfferListeners = new Set<(offer: BridgeElementOffer) => void>()
  const cookieSyncListeners = new Set<(event: { url: string; text: string }) => void>()
  let lastConnected = false
  let keepalive: ReturnType<typeof setInterval> | undefined
  let lastPong = 0
  let listenError = ""

  const stopKeepalive = () => {
    if (keepalive !== undefined) clearInterval(keepalive)
    keepalive = undefined
  }

  const startKeepalive = () => {
    stopKeepalive()
    lastPong = Date.now()
    keepalive = setInterval(() => {
      if (!accepted || accepted.destroyed || !paired) {
        stopKeepalive()
        return
      }
      if (Date.now() - lastPong > 15_000) {
        accepted.destroy()
        return
      }
      try {
        send(accepted, { type: "ping" })
      } catch {
        accepted.destroy()
      }
    }, 5_000)
  }

  const status = (): ChromeBridgeHostStatus => ({
    enabled: stores.enabled.value,
    running: !!http?.listening,
    port: stores.port.value || CHROME_BRIDGE_DEFAULT_PORT,
    token: stores.token.value,
    connected: paired && !!accepted && !accepted.destroyed,
    extensionPath: extensionPath(),
    packageVersion: readExtensionPackageVersion(bundledExtensionSource()) || readExtensionPackageVersion(),
    listenError,
  })

  const notifyConnection = () => {
    const connected = paired && !!accepted && !accepted.destroyed
    if (connected === lastConnected) return
    lastConnected = connected
    for (const listener of connectionListeners) listener(connected)
  }

  const send = (socket: Duplex, message: BridgeHostMessage) => {
    const body = Buffer.from(JSON.stringify(message))
    // Minimal WS text frame (no mask, server→client).
    if (body.length < 126) {
      const frame = Buffer.alloc(2 + body.length)
      frame[0] = 0x81
      frame[1] = body.length
      body.copy(frame, 2)
      socket.write(frame)
      return
    }
    if (body.length <= 0xffff) {
      const frame = Buffer.alloc(4 + body.length)
      frame[0] = 0x81
      frame[1] = 126
      frame.writeUInt16BE(body.length, 2)
      body.copy(frame, 4)
      socket.write(frame)
      return
    }
    if (body.length > 8_000_000) throw new Error("chrome.bridge.frame_too_large")
    const frame = Buffer.alloc(10 + body.length)
    frame[0] = 0x81
    frame[1] = 127
    frame.writeUInt32BE(0, 2)
    frame.writeUInt32BE(body.length, 6)
    body.copy(frame, 10)
    socket.write(frame)
  }

  const chromeTabID = (chromeTabId: number) => `chrome_tab_${chromeTabId}`

  const rejectPending = (error: Error) => {
    for (const item of pending.values()) {
      clearTimeout(item.timer)
      item.reject(error)
    }
    pending.clear()
  }

  const requestID = () => randomBytes(8).toString("hex")

  const request = <T>(message: BridgeHostMessage & { requestID: string }, timeoutMs = 20_000) =>
    new Promise<T>((resolve, reject) => {
      // Upgrade alone is not enough — wait for hello.ok (paired).
      if (!accepted || accepted.destroyed || !paired) {
        reject(new Error("chrome.bridge.not_connected"))
        return
      }

      const timer = setTimeout(() => {
        pending.delete(message.requestID)
        reject(new Error("chrome.bridge.timeout"))
      }, timeoutMs)

      pending.set(message.requestID, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      })

      try {
        send(accepted, message)
      } catch (error) {
        pending.delete(message.requestID)
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })

  /** Drop the current socket before a replace/stop so close cannot skip paired/pending cleanup. */
  const releaseAccepted = (error: Error) => {
    const previous = accepted
    if (!previous && !paired) {
      rejectPending(error)
      return
    }
    accepted = undefined
    paired = false
    stopKeepalive()
    rejectPending(error)
    notifyConnection()
    if (previous && !previous.destroyed) previous.destroy()
  }

  const onClientPayload = (socket: Duplex, raw: string) => {
    // Ignore frames from a socket that was already replaced.
    if (accepted !== socket) return

    const message = parseBridgeClientMessage(raw)
    if (!message) return

    if (message.type === "hello") {
      if (message.version !== CHROME_BRIDGE_PROTOCOL_VERSION) {
        send(socket, { type: "hello.reject", reason: "version" })
        socket.destroy()
        return
      }
      // Foolproof localhost trust: if the bridge switch is on, accept the extension.
      if (!stores.enabled.value) {
        send(socket, { type: "hello.reject", reason: "bridge_disabled" })
        socket.destroy()
        return
      }
      if (!stores.token.value) stores.token.set(mintToken())
      send(socket, {
        type: "hello.ok",
        version: CHROME_BRIDGE_PROTOCOL_VERSION,
        port: stores.port.value || CHROME_BRIDGE_DEFAULT_PORT,
        channel: options.channel,
        // Extension popup compares this to chrome.runtime.getManifest().version and prompts remove+reinstall.
        packageVersion: status().packageVersion || undefined,
      })
      paired = true
      startKeepalive()
      notifyConnection()
      return
    }

    if (!paired) return

    if (message.type === "pong") {
      lastPong = Date.now()
      return
    }

    if (message.type === "offer.tab") {
      for (const listener of tabOfferListeners) listener(message.tab)
      return
    }

    // SiCode: login cookies travel without a tab — the pane writes them by domain, then opens the site.
    if (message.type === "cookies.sync") {
      for (const listener of cookieSyncListeners) listener({ url: message.url, text: message.text })
      return
    }

    if (message.type === "offer.element") {
      for (const listener of elementOfferListeners)
        listener({
          tab: message.tab,
          element: message.element,
          elements: message.elements,
          ...(message.comment ? { comment: message.comment } : {}),
        })
      return
    }

    if (message.type === "error") {
      const item = message.requestID ? pending.get(message.requestID) : undefined
      if (!item) return
      clearTimeout(item.timer)
      pending.delete(message.requestID!)
      item.reject(new Error(message.message))
      return
    }

    if (!("requestID" in message) || typeof message.requestID !== "string") return
    const item = pending.get(message.requestID)
    if (!item) return
    clearTimeout(item.timer)
    pending.delete(message.requestID)

    if (message.type === "tabs.list.result" || message.type === "tabs.close.result") {
      item.resolve({ tabs: message.tabs, focusedTabID: message.focusedTabID })
      return
    }
    if (
      message.type === "tabs.open.result" ||
      message.type === "tabs.focus.result" ||
      message.type === "navigate.result" ||
      message.type === "reload.result" ||
      message.type === "back.result" ||
      message.type === "forward.result" ||
      message.type === "click.result" ||
      message.type === "fill.result" ||
      message.type === "press.result" ||
      message.type === "scroll.result"
    ) {
      item.resolve(message.tab)
      return
    }
    if (message.type === "snapshot.result") {
      item.resolve({ snapshot: message.snapshot, tab: message.tab })
      return
    }
    if (message.type === "evaluate.result") {
      item.resolve({ value: message.value, tab: message.tab })
      return
    }
    if (message.type === "screenshot.result") {
      item.resolve({ screenshot: message.screenshot, tab: message.tab })
      return
    }
    if (message.type === "console.result") {
      item.resolve({
        messages: message.messages,
        truncated: message.truncated,
        dropped: message.dropped,
        tab: message.tab,
      })
      return
    }
    if (message.type === "network.list.result") {
      item.resolve({
        requests: message.requests,
        truncated: message.truncated,
        dropped: message.dropped,
        tab: message.tab,
      })
      return
    }
    if (message.type === "network.get.result") {
      item.resolve({
        request: message.request,
        requestHeaders: message.requestHeaders,
        responseHeaders: message.responseHeaders,
        headersTruncated: message.headersTruncated,
        requestBody: message.requestBody,
        responseBody: message.responseBody,
        tab: message.tab,
      })
    }
  }

  const attachSocket = (socket: Duplex) => {
    sockets.add(socket)
    let buffer = Buffer.alloc(0)

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      while (buffer.length >= 2) {
        const finOpcode = buffer[0]
        const opcode = finOpcode & 0x0f
        const masked = (buffer[1] & 0x80) !== 0
        let len = buffer[1] & 0x7f
        let offset = 2
        if (len === 126) {
          if (buffer.length < 4) return
          len = buffer.readUInt16BE(2)
          offset = 4
        } else if (len === 127) {
          if (buffer.length < 10) return
          const high = buffer.readUInt32BE(2)
          const low = buffer.readUInt32BE(6)
          if (high !== 0 || low > 8_000_000) {
            socket.destroy()
            return
          }
          len = low
          offset = 10
        }
        const maskOffset = offset
        const dataOffset = offset + (masked ? 4 : 0)
        if (buffer.length < dataOffset + len) return
        let payload = buffer.subarray(dataOffset, dataOffset + len)
        if (masked) {
          const mask = buffer.subarray(maskOffset, maskOffset + 4)
          payload = Buffer.from(payload)
          for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4]
        }
        buffer = buffer.subarray(dataOffset + len)
        if (opcode === 0x8) {
          socket.destroy()
          return
        }
        if (opcode === 0x1) onClientPayload(socket, payload.toString("utf8"))
      }
    })

    socket.on("close", () => {
      sockets.delete(socket)
      if (accepted === socket) {
        accepted = undefined
        paired = false
        stopKeepalive()
        rejectPending(new Error("chrome.bridge.disconnected"))
        notifyConnection()
      }
    })
  }

  const acceptUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const key = req.headers["sec-websocket-key"]
    if (typeof key !== "string" || req.headers.upgrade?.toLowerCase() !== "websocket") {
      socket.destroy()
      return
    }

    // One extension at a time: clear paired/pending before the new socket attaches,
    // otherwise the old close handler sees accepted !== itself and skips cleanup.
    releaseAccepted(new Error("chrome.bridge.replaced"))

    const accept = createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64")
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " +
        accept +
        "\r\n\r\n",
    )
    if (head.length) socket.unshift(head)
    accepted = socket
    paired = false
    attachSocket(socket)
  }

  const stop = async () => {
    releaseAccepted(new Error("chrome.bridge.stopped"))
    for (const socket of sockets) socket.destroy()
    sockets.clear()
    const server = http
    http = undefined
    starting = undefined
    if (!server) return
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  const start = async () => {
    if (http?.listening) {
      listenError = ""
      return
    }
    if (starting) return starting

    if (!stores.token.value) stores.token.set(mintToken())
    const port = stores.port.value || CHROME_BRIDGE_DEFAULT_PORT

    starting = new Promise<void>((resolve, reject) => {
      const server = createServer((req, res) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1")
        const headers = {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
        }

        if (req.method === "GET" && url.pathname === "/status") {
          res.writeHead(200, headers)
          res.end(
            JSON.stringify({
              ok: true,
              enabled: stores.enabled.value,
              connected: paired && !!accepted && !accepted.destroyed,
              port: stores.port.value || CHROME_BRIDGE_DEFAULT_PORT,
            }),
          )
          return
        }

        res.writeHead(404, headers)
        res.end(JSON.stringify({ ok: false, error: "not_found" }))
      })
      server.on("upgrade", acceptUpgrade)
      server.once("error", (error) => {
        http = undefined
        starting = undefined
        listenError = formatChromeBridgeListenError(error, port)
        reject(error)
      })
      server.listen(port, "127.0.0.1", () => {
        http = server
        starting = undefined
        listenError = ""
        resolve()
      })
    })

    await starting
  }

  const setEnabled = async (enabled: boolean) => {
    stores.enabled.set(enabled)
    if (enabled) {
      try {
        await start()
      } catch {
        // listenError already set — keep enabled so the user can fix (close the other app) and retry.
      }
    } else {
      listenError = ""
      await stop()
    }
    return status()
  }

  const rotateToken = async () => {
    stores.token.set(mintToken())
    releaseAccepted(new Error("chrome.bridge.rotated"))
    return status()
  }

  const setPort = async (port: number) => {
    const next = Number.isFinite(port) && port > 0 && port < 65536 ? Math.floor(port) : CHROME_BRIDGE_DEFAULT_PORT
    const was = stores.enabled.value && !!http?.listening
    stores.port.set(next)
    if (was) {
      await stop()
      await start()
    }
    return status()
  }

  // Resume host when the store says enabled (desktop restart). Surface bind failures in status.listenError.
  if (stores.enabled.value) {
    void start().catch(() => undefined)
  }

  return {
    status,
    setEnabled,
    rotateToken,
    setPort,
    listTabs: () => request({ type: "tabs.list", requestID: requestID() }),
    openTab: (url) => request({ type: "tabs.open", requestID: requestID(), url }),
    focusTab: (chromeTabId) =>
      request({ type: "tabs.focus", requestID: requestID(), tabID: chromeTabID(chromeTabId) }),
    closeTab: (chromeTabId) =>
      request({ type: "tabs.close", requestID: requestID(), tabID: chromeTabID(chromeTabId) }),
    navigateTab: (chromeTabId, url) =>
      request({ type: "navigate", requestID: requestID(), tabID: chromeTabID(chromeTabId), url }, 30_000),
    reloadTab: (chromeTabId, ignoreCache) =>
      request({
        type: "reload",
        requestID: requestID(),
        tabID: chromeTabID(chromeTabId),
        ignoreCache,
      }),
    backTab: (chromeTabId) => request({ type: "back", requestID: requestID(), tabID: chromeTabID(chromeTabId) }),
    forwardTab: (chromeTabId) =>
      request({ type: "forward", requestID: requestID(), tabID: chromeTabID(chromeTabId) }),
    snapshotTab: (chromeTabId, depth) =>
      request({ type: "snapshot", requestID: requestID(), tabID: chromeTabID(chromeTabId), depth }),
    evaluateTab: (chromeTabId, script, ref, allowDestructive) =>
      request({
        type: "evaluate",
        requestID: requestID(),
        tabID: chromeTabID(chromeTabId),
        script,
        ref,
        ...(allowDestructive ? { allowDestructive: true } : {}),
      }),
    clickTab: (chromeTabId, ref, button, count, allowDestructive) =>
      request({
        type: "click",
        requestID: requestID(),
        tabID: chromeTabID(chromeTabId),
        ref,
        button,
        count,
        ...(allowDestructive ? { allowDestructive: true } : {}),
      }),
    fillTab: (chromeTabId, ref, text) =>
      request({ type: "fill", requestID: requestID(), tabID: chromeTabID(chromeTabId), ref, text }),
    pressTab: (chromeTabId, key) =>
      request({ type: "press", requestID: requestID(), tabID: chromeTabID(chromeTabId), key }),
    scrollTab: (chromeTabId, deltaY, deltaX) =>
      request({
        type: "scroll",
        requestID: requestID(),
        tabID: chromeTabID(chromeTabId),
        deltaY,
        deltaX,
      }),
    screenshotTab: (chromeTabId) =>
      // Extension bounds CDP/visible capture (~8–16s); keep host slightly above that for a real error.
      request({ type: "screenshot", requestID: requestID(), tabID: chromeTabID(chromeTabId) }, 45_000),
    consoleTab: (chromeTabId, input) =>
      request({
        type: "console",
        requestID: requestID(),
        tabID: chromeTabID(chromeTabId),
        level: input?.level,
        limit: input?.limit,
      }),
    networkListTab: (chromeTabId, input) =>
      request({
        type: "network.list",
        requestID: requestID(),
        tabID: chromeTabID(chromeTabId),
        urlContains: input?.urlContains,
        resourceType: input?.resourceType,
        limit: input?.limit,
      }),
    networkGetTab: (chromeTabId, input) =>
      request({
        type: "network.get",
        requestID: requestID(),
        tabID: chromeTabID(chromeTabId),
        id: input.id,
        includeBody: input.includeBody,
        maxBodyChars: input.maxBodyChars,
      }),
    onConnectionChange: (listener) => {
      connectionListeners.add(listener)
      return () => {
        connectionListeners.delete(listener)
      }
    },
    onTabOffer: (listener) => {
      tabOfferListeners.add(listener)
      return () => {
        tabOfferListeners.delete(listener)
      }
    },
    onCookieSync: (listener) => {
      cookieSyncListeners.add(listener)
      return () => {
        cookieSyncListeners.delete(listener)
      }
    },
    onElementOffer: (listener) => {
      elementOfferListeners.add(listener)
      return () => {
        elementOfferListeners.delete(listener)
      }
    },
    dispose: stop,
  }
}
