import { candidatePorts, respondingPorts } from "./bridge-ports.js"
import { cookieQueries, mergeCookies } from "./cookie-scope.js"
import { loginStateDump } from "./login-dump.js"
import { PROTOCOL_VERSION, chromeIdFromTabID, isPackageBehind, toBridgeTab } from "./protocol.js"
import {
  captureScreenshot,
  detachDebugger,
  getNetwork,
  listNetwork,
  readConsole,
} from "./debugger-buffer.js"

/** Prod formal desktop. Extension tries these in order so push prefers the packaged prod app. */
const DISCOVERY_PORTS = [17891, 17892, 17893]
const DEFAULT_PORT = DISCOVERY_PORTS[0]
/** @type {WebSocket | undefined} */
let socket
/** @type {ReturnType<typeof setTimeout> | undefined} */
let reconnectTimer
let intentionalClose = false
let connectGeneration = 0
/** @type {Set<number>} */
const ownedTabs = new Set()

/** @type {Record<string, Record<number, ImageData>>} */
const iconCache = {}

/** Dot color for toolbar icon (top-right). */
const STATUS_DOT = {
  connected: "#2dba26",
  connecting: "#e6a700",
  pairing: "#e6a700",
  paused: "#8b8b8b",
  disconnected: "#8b8b8b",
}

/**
 * @param {number} size
 * @param {string} color
 */
async function iconWithDot(size, color) {
  const key = `${size}:${color}`
  const cached = iconCache[key]
  if (cached) return cached

  const url = chrome.runtime.getURL(`icons/icon${size}.png`)
  const response = await fetch(url)
  const bitmap = await createImageBitmap(await response.blob())
  const canvas = new OffscreenCanvas(size, size)
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("2d unavailable")
  ctx.drawImage(bitmap, 0, 0, size, size)

  // Keep the full disc + white ring inside the bitmap (toolbar clips overflow).
  const ring = Math.max(1.2, size * 0.035)
  const r = Math.max(3.2, size * 0.2)
  const margin = ring + 1
  const cx = size - margin - r
  const cy = margin + r
  ctx.beginPath()
  ctx.arc(cx, cy, r + ring, 0, Math.PI * 2)
  ctx.fillStyle = "#ffffff"
  ctx.fill()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()

  const imageData = ctx.getImageData(0, 0, size, size)
  iconCache[key] = { [size]: imageData }
  return iconCache[key]
}

/** @param {"connecting" | "connected" | "disconnected" | "paused" | "pairing"} status */
async function applyStatusIcon(status) {
  const stored = await chrome.storage.local.get(["updateRequired"])
  // Stale extension while still connected → warn yellow, not “healthy” green.
  const color =
    status === "connected" && stored.updateRequired === true
      ? STATUS_DOT.connecting
      : (STATUS_DOT[status] ?? STATUS_DOT.disconnected)
  try {
    const sizes = [16, 32, 48]
    /** @type {Record<number, ImageData>} */
    const imageData = {}
    for (const size of sizes) {
      Object.assign(imageData, await iconWithDot(size, color))
    }
    await chrome.action.setIcon({ imageData })
    await chrome.action.setBadgeText({ text: "" })
  } catch {
    // Fallback if OffscreenCanvas/icons fail: tiny colored badge, no "ON" text.
    await chrome.action.setBadgeText({ text: " " })
    await chrome.action.setBadgeBackgroundColor({ color })
  }
}

/** @param {"connecting" | "connected" | "disconnected" | "paused"} status */
async function setConnectionStatus(status) {
  await chrome.storage.local.set({ connectionStatus: status })
  await applyStatusIcon(status)
}

async function loadOwned() {
  try {
    const stored = await chrome.storage.session.get(["ownedTabs"])
    if (Array.isArray(stored.ownedTabs)) {
      ownedTabs.clear()
      for (const id of stored.ownedTabs) if (typeof id === "number") ownedTabs.add(id)
    }
  } catch {
    // session storage unavailable — memory only
  }
}

async function saveOwned() {
  try {
    await chrome.storage.session.set({ ownedTabs: [...ownedTabs] })
  } catch {
    // ignore
  }
}

function trackTab(tabId) {
  if (typeof tabId !== "number") return
  ownedTabs.add(tabId)
  void saveOwned()
}

function untrackTab(tabId) {
  ownedTabs.delete(tabId)
  void detachDebugger(tabId)
  void saveOwned()
}

function liveSocket() {
  return !!socket && socket.readyState === WebSocket.OPEN
}

/** UI/status must follow the real socket — storage alone goes stale when the SW sleeps. */
async function syncLiveStatus() {
  if (liveSocket()) {
    await setConnectionStatus("connected")
    return "connected"
  }
  const stored = await chrome.storage.local.get(["connectionStatus"])
  if (stored.connectionStatus === "connected" || stored.connectionStatus === "connecting") {
    await setConnectionStatus("disconnected")
  }
  return "disconnected"
}

/** Whether one port's bridge is up and switched on. Bounded, so a silent port cannot stall the rest. */
async function probeBridge(port, timeoutMs) {
  const response = await fetch(`http://127.0.0.1:${port}/status`, {
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) return false
  const body = await response.json()
  return !!body?.ok && !!body?.enabled
}

/** The most one socket may take to open before the next candidate port is tried instead. */
const SOCKET_TIMEOUT_MS = 2_500

/**
 * How long an open socket may take to answer hello. The host replies as soon as it reads ours, so
 * this only bounds a wedged peer, not the normal path.
 */
const HELLO_TIMEOUT_MS = 3_000

/** True once the host answered hello on the socket that is open now. */
let paired = false
/** Callers waiting for that hello; every one of them hears the same answer. */
const helloWaiters = new Set()
/** The connect attempt in flight, shared by every caller so two of them cannot fight over the socket. */
let connecting
/** The attempt whose hello the host rejected; it stops trying further ports and waits for the retry. */
let rejected

function settleHello(ok) {
  paired = ok
  for (const waiter of helloWaiters) waiter(ok)
  helloWaiters.clear()
}

/**
 * Whether this connect attempt got its hello, as soon as that is decided.
 *
 * Decided by the message itself rather than by polling storage every 100ms as this used to: the
 * answer already arrives on the socket, so waiting to read it back from storage only adds latency.
 */
function waitHello(timeoutMs = HELLO_TIMEOUT_MS) {
  if (paired) return Promise.resolve(true)

  return new Promise((resolve) => {
    const done = (ok) => {
      clearTimeout(timer)
      helloWaiters.delete(done)
      resolve(ok)
    }
    const timer = setTimeout(() => done(false), timeoutMs)
    helloWaiters.add(done)
  })
}

function scheduleReconnect() {
  if (intentionalClose) return
  if (reconnectTimer !== undefined) clearTimeout(reconnectTimer)
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined
    void connect()
  }, 800)
  // MV3 service workers sleep and drop setTimeout — alarms keep retrying while Chrome is open.
  void chrome.alarms.create("sicode-bridge-reconnect", { delayInMinutes: 0.5, periodInMinutes: 1 })
}

/** Reconnect when the desktop bridge is up but our socket is dead (stale "已连接"). */
async function ensureConnected() {
  // An open socket is already answering; its hello settles this, so do not open a second one.
  if (liveSocket()) return (await waitHello()) ? "connected" : liveSocket() ? "connecting" : "disconnected"

  await syncLiveStatus()

  return (await connect()) ? "connected" : "disconnected"
}

/**
 * Connect, or join the attempt already running.
 *
 * The popup, the alarm, and the worker's own start can all ask for a connection at once, and each
 * used to open its own socket — closing the one the other had just opened. They now share one
 * attempt, so a cold start opens one socket instead of three.
 */
function connect() {
  connecting ??= attemptConnect().finally(() => {
    connecting = undefined
  })

  return connecting
}

/** @returns {Promise<boolean>} whether the host answered hello on the socket that opened. */
async function attemptConnect() {
  // Clear legacy pause flag from older extension builds.
  void chrome.storage.local.remove(["bridgePaused"])

  const generation = ++connectGeneration
  await loadOwned()
  const stored = await chrome.storage.local.get(["port"])
  const hint = typeof stored.port === "number" ? stored.port : DEFAULT_PORT

  closeSocket()

  const listening = await respondingPorts(candidatePorts(hint, DISCOVERY_PORTS), probeBridge)

  if (generation !== connectGeneration) return false
  if (listening.length === 0) {
    await setConnectionStatus("disconnected")
    scheduleReconnect()

    return false
  }

  await setConnectionStatus("connecting")

  // Only ports that answered, most preferred first: a dead port no longer costs one socket timeout
  // before the port that would have worked is tried.
  for (const port of listening) {
    if (generation !== connectGeneration) return false

    if (!(await openSocket(port))) continue
    if (await waitHello()) return true
    // A rejection is the host's answer, not a port to give up on: it already scheduled the retry, and
    // trying the other channels here would race that retry for the socket.
    if (rejected === generation) return false
    // Opened but never said hello; drop it so its seat is free for the next candidate.
    closeSocket()
  }

  await setConnectionStatus("disconnected")
  scheduleReconnect()

  return false
}

/** Drop the current socket without letting its close handler schedule another reconnect. */
function closeSocket() {
  const previous = socket

  socket = undefined
  settleHello(false)
  if (!previous) return

  intentionalClose = true
  try {
    previous.close()
  } catch {
    // Already closed.
  }
  intentionalClose = false
}

/**
 * Open one socket and say hello.
 * @param {number} port
 * @returns {Promise<boolean>} whether it opened
 */
function openSocket(port) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (ok) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(ok)
    }

    let next
    try {
      next = new WebSocket(`ws://127.0.0.1:${port}`)
    } catch {
      finish(false)

      return
    }

    const timer = setTimeout(() => {
      try {
        next.close()
      } catch {
        // Already closed.
      }
      finish(false)
    }, SOCKET_TIMEOUT_MS)

    next.addEventListener("open", () => {
      socket = next
      settleHello(false)
      next.addEventListener("message", (event) => {
        void onMessage(String(event.data), port)
      })
      // Identity, not a generation number: a socket this connect has since replaced is not the one
      // whose loss matters, and the close event can arrive long after the replacement opened.
      next.addEventListener("close", () => {
        if (socket !== next) return
        socket = undefined
        settleHello(false)
        void setConnectionStatus("disconnected")
        scheduleReconnect()
      })
      next.addEventListener("error", () => next.close())
      next.send(JSON.stringify({ type: "hello", version: PROTOCOL_VERSION }))
      finish(true)
    })
    next.addEventListener("error", () => finish(false))
    next.addEventListener("close", () => finish(false))
  })
}

function send(message) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return
  socket.send(JSON.stringify(message))
}

function fail(requestID, error) {
  send({
    type: "error",
    requestID,
    message: error instanceof Error ? error.message : String(error),
  })
}

function isScriptableUrl(url) {
  if (!url) return false
  return url.startsWith("http://") || url.startsWith("https://") || url.startsWith("file://")
}

async function requireTab(tabID) {
  const chromeId = chromeIdFromTabID(tabID)
  if (chromeId === undefined) throw new Error(`Unknown tabID ${tabID}`)
  const tab = await chrome.tabs.get(chromeId)
  if (typeof tab.id !== "number") throw new Error(`Unknown tabID ${tabID}`)
  trackTab(tab.id)
  return tab
}

function waitLoaded(tabId, timeoutMs = 20_000) {
  return new Promise((resolve) => {
    let seenLoading = false
    const finish = () => {
      clearTimeout(timer)
      clearTimeout(settle)
      chrome.tabs.onUpdated.removeListener(listener)
      resolve()
    }
    const timer = setTimeout(finish, timeoutMs)
    const listener = (id, info) => {
      if (id !== tabId) return
      if (info.status === "loading") seenLoading = true
      if (info.status === "complete" && seenLoading) finish()
    }
    chrome.tabs.onUpdated.addListener(listener)
    const settle = setTimeout(() => {
      void chrome.tabs.get(tabId).then((tab) => {
        if (tab.status === "complete" && !seenLoading) finish()
      })
    }, 400)
  })
}

async function ensurePageApi(tabId) {
  const tab = await chrome.tabs.get(tabId)
  if (!isScriptableUrl(tab.url ?? "")) {
    throw new Error(
      `Cannot inject into this page (${tab.url || "unknown"}). Open an http(s) page with browser.tabs.open or browser.navigate first.`,
    )
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    files: ["page.js"],
  })
}

const normalizeRef = (ref) => (typeof ref === "string" ? ref.replace(/^@/, "") : ref)

async function callPage(tabId, method, args = []) {
  await ensurePageApi(tabId)
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (name, values) => {
      const api = globalThis.__sicodeBridgeAPI
      if (!api || typeof api[name] !== "function") throw new Error("SiCode page bridge missing")
      return api[name](...values)
    },
    args: [method, args],
  })
  const first = results[0]
  if (!first) throw new Error("Script injection returned no result")
  return first.result
}

async function listMapped() {
  // Prune closed ids from the session cache (used when Agent opens/focuses tabs).
  for (const id of [...ownedTabs]) {
    try {
      await chrome.tabs.get(id)
    } catch {
      ownedTabs.delete(id)
    }
  }
  await saveOwned()

  // List the real browser inventory — not only tabs SiCode opened — so Agent matches what the user sees.
  const tabs = await chrome.tabs.query({})
  const mapped = tabs
    .filter((tab) => typeof tab.id === "number")
    .filter((tab) => {
      const url = tab.url ?? ""
      // Loading tabs often have an empty url briefly — keep them visible.
      if (!url) return true
      // chrome:// / edge:// / extension pages are not injectable; still show http(s)/file/about.
      return isScriptableUrl(url) || url === "about:blank" || url.startsWith("about:")
    })
    .map(toBridgeTab)
  const focused = mapped.find((tab) => tab.active)?.id ?? mapped[0]?.id ?? null
  return { tabs: mapped, focusedTabID: focused }
}

async function onMessage(raw, port) {
  let message
  try {
    message = JSON.parse(raw)
  } catch {
    return
  }

  if (!message || typeof message !== "object" || typeof message.type !== "string") return

  if (message.type === "hello.ok") {
    const nextPort = typeof message.port === "number" && message.port > 0 ? message.port : port
    const expected = typeof message.packageVersion === "string" ? message.packageVersion : ""
    const channel =
      message.channel === "prod" ||
      message.channel === "beta" ||
      message.channel === "dev" ||
      message.channel === "local"
        ? message.channel
        : ""
    const installed = chrome.runtime.getManifest().version
    const updateRequired = expected ? isPackageBehind(installed, expected) : false
    await chrome.storage.local.set({
      port: nextPort,
      channel,
      updateRequired,
      expectedPackageVersion: expected,
      installedPackageVersion: installed,
    })
    await setConnectionStatus("connected")
    settleHello(true)
    void chrome.alarms.clear("sicode-bridge-reconnect")
    return
  }

  if (message.type === "hello.reject") {
    rejected = connectGeneration
    await setConnectionStatus("disconnected")
    settleHello(false)
    intentionalClose = true
    socket?.close()
    intentionalClose = false
    scheduleReconnect()
    return
  }

  if (message.type === "ping") {
    send({ type: "pong" })
    return
  }

  const requestID = message.requestID
  if (typeof requestID !== "string") return

  try {
    if (message.type === "tabs.list") {
      send({ type: "tabs.list.result", requestID, ...(await listMapped()) })
      return
    }

    if (message.type === "tabs.open") {
      const tab = await chrome.tabs.create({ url: message.url || "about:blank", active: true })
      if (typeof tab.id === "number") trackTab(tab.id)
      send({ type: "tabs.open.result", requestID, tab: toBridgeTab(tab) })
      return
    }

    if (message.type === "tabs.focus") {
      const tab = await requireTab(message.tabID)
      const updated = await chrome.tabs.update(tab.id, { active: true })
      if (updated.windowId !== undefined) await chrome.windows.update(updated.windowId, { focused: true })
      send({ type: "tabs.focus.result", requestID, tab: toBridgeTab(updated) })
      return
    }

    if (message.type === "tabs.close") {
      const tab = await requireTab(message.tabID)
      untrackTab(tab.id)
      await chrome.tabs.remove(tab.id)
      send({ type: "tabs.close.result", requestID, ...(await listMapped()) })
      return
    }

    if (message.type === "navigate") {
      const tab = await requireTab(message.tabID)
      await chrome.tabs.update(tab.id, { url: message.url })
      await waitLoaded(tab.id)
      send({ type: "navigate.result", requestID, tab: toBridgeTab(await chrome.tabs.get(tab.id)) })
      return
    }

    if (message.type === "reload") {
      const tab = await requireTab(message.tabID)
      await chrome.tabs.reload(tab.id, { bypassCache: !!message.ignoreCache })
      await waitLoaded(tab.id)
      send({ type: "reload.result", requestID, tab: toBridgeTab(await chrome.tabs.get(tab.id)) })
      return
    }

    if (message.type === "back" || message.type === "forward") {
      const tab = await requireTab(message.tabID)
      if (message.type === "back") await chrome.tabs.goBack(tab.id)
      else await chrome.tabs.goForward(tab.id)
      await waitLoaded(tab.id)
      send({
        type: message.type === "back" ? "back.result" : "forward.result",
        requestID,
        tab: toBridgeTab(await chrome.tabs.get(tab.id)),
      })
      return
    }

    if (message.type === "snapshot") {
      const tab = await requireTab(message.tabID)
      const snapshot = await callPage(tab.id, "snapshot", [message.depth ?? 8])
      send({
        type: "snapshot.result",
        requestID,
        snapshot,
        tab: toBridgeTab(await chrome.tabs.get(tab.id)),
      })
      return
    }

    if (message.type === "evaluate") {
      const tab = await requireTab(message.tabID)
      const value = await callPage(tab.id, "evaluate", [
        message.script,
        message.ref ? normalizeRef(message.ref) : null,
        message.allowDestructive === true,
      ])
      send({
        type: "evaluate.result",
        requestID,
        value,
        tab: toBridgeTab(await chrome.tabs.get(tab.id)),
      })
      return
    }

    if (message.type === "click") {
      const tab = await requireTab(message.tabID)
      await callPage(tab.id, "click", [
        normalizeRef(message.ref),
        message.button ?? "left",
        message.count ?? 1,
        message.allowDestructive === true,
      ])
      send({ type: "click.result", requestID, tab: toBridgeTab(await chrome.tabs.get(tab.id)) })
      return
    }

    if (message.type === "fill") {
      const tab = await requireTab(message.tabID)
      await callPage(tab.id, "fill", [normalizeRef(message.ref), message.text])
      send({ type: "fill.result", requestID, tab: toBridgeTab(await chrome.tabs.get(tab.id)) })
      return
    }

    if (message.type === "press") {
      const tab = await requireTab(message.tabID)
      await callPage(tab.id, "press", [message.key])
      send({ type: "press.result", requestID, tab: toBridgeTab(await chrome.tabs.get(tab.id)) })
      return
    }

    if (message.type === "scroll") {
      const tab = await requireTab(message.tabID)
      await callPage(tab.id, "scroll", [message.deltaX ?? 0, message.deltaY])
      send({ type: "scroll.result", requestID, tab: toBridgeTab(await chrome.tabs.get(tab.id)) })
      return
    }

    if (message.type === "screenshot") {
      const tab = await requireTab(message.tabID)
      const errors = []
      let screenshot

      // Visible-tab first: fast when `<all_urls>`/`activeTab` are present. CDP can hang on heavy pages.
      try {
        await chrome.tabs.update(tab.id, { active: true })
        if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true })
        await new Promise((resolve) => setTimeout(resolve, 80))
        const dataUrl = await Promise.race([
          chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }),
          new Promise((_, reject) => setTimeout(() => reject(new Error("captureVisibleTab_timeout")), 8_000)),
        ])
        const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl)
        if (!match) throw new Error("Screenshot capture failed")
        screenshot = { mime: match[1], dataBase64: match[2] }
      } catch (error) {
        errors.push(String(error?.message || error))
      }

      if (!screenshot) {
        try {
          screenshot = await captureScreenshot(tab.id)
        } catch (error) {
          errors.push(String(error?.message || error))
        }
      }

      if (!screenshot) throw new Error(`Screenshot failed: ${errors.join("; ")}`)

      send({
        type: "screenshot.result",
        requestID,
        screenshot,
        tab: toBridgeTab(await chrome.tabs.get(tab.id)),
      })
      return
    }

    if (message.type === "console") {
      const tab = await requireTab(message.tabID)
      const result = await readConsole(tab.id, { level: message.level, limit: message.limit })
      send({
        type: "console.result",
        requestID,
        ...result,
        tab: toBridgeTab(await chrome.tabs.get(tab.id)),
      })
      return
    }

    if (message.type === "network.list") {
      const tab = await requireTab(message.tabID)
      const result = await listNetwork(tab.id, {
        urlContains: message.urlContains,
        resourceType: message.resourceType,
        limit: message.limit,
      })
      send({
        type: "network.list.result",
        requestID,
        ...result,
        tab: toBridgeTab(await chrome.tabs.get(tab.id)),
      })
      return
    }

    if (message.type === "network.get") {
      const tab = await requireTab(message.tabID)
      const result = await getNetwork(tab.id, {
        id: message.id,
        includeBody: message.includeBody,
        maxBodyChars: message.maxBodyChars,
      })
      send({
        type: "network.get.result",
        requestID,
        ...result,
        tab: toBridgeTab(await chrome.tabs.get(tab.id)),
      })
    }
  } catch (error) {
    fail(requestID, error)
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  if (ownedTabs.has(tabId)) untrackTab(tabId)
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "sicode-bridge-reconnect") return
  void ensureConnected()
})

/**
 * Push a page into SiCode Composer (popup / context menu).
 * @param {{ id?: number; url?: string; title?: string; active?: boolean; windowId?: number }} tab
 * @param {{ url?: string; title?: string }} [override]
 */
async function offerTab(tab, override = {}) {
  const status = await ensureConnected()
  if (status !== "connected") {
    return { ok: false, message: "not_connected" }
  }

  const url = (override.url || tab?.url || "").trim()
  if (!isScriptableUrl(url)) {
    return { ok: false, message: "bad_url" }
  }

  if (typeof tab?.id === "number") trackTab(tab.id)

  const payload =
    typeof tab?.id === "number"
      ? {
          ...toBridgeTab(tab),
          url,
          title: (override.title || tab.title || url).slice(0, 512),
        }
      : {
          id: "chrome_tab_0",
          chromeTabId: 0,
          url,
          title: (override.title || url).slice(0, 512),
          active: true,
          windowId: 0,
        }

  send({ type: "offer.tab", tab: payload })
  return { ok: true, url: payload.url, title: payload.title }
}

async function offerActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return offerTab(tab ?? {})
}

/**
 * Normalize picker result: array of elements, or legacy single object.
 * @param {unknown} raw
 * @returns {Array<{ selector: string; label: string; role?: string; name?: string; text?: string }>}
 */
function normalizePickedElements(raw) {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : []
  /** @type {Array<{ selector: string; label: string; role?: string; name?: string; text?: string }>} */
  const out = []
  for (const item of list) {
    if (!item || typeof item !== "object") continue
    const selector = typeof item.selector === "string" ? item.selector.trim() : ""
    const label = typeof item.label === "string" ? item.label.trim() : ""
    if (!selector || !label) continue
    out.push({
      selector: selector.slice(0, 2_048),
      label: label.slice(0, 512),
      ...(typeof item.role === "string" ? { role: item.role.slice(0, 128) } : {}),
      ...(typeof item.name === "string" ? { name: item.name.slice(0, 512) } : {}),
      ...(typeof item.text === "string" ? { text: item.text.slice(0, 512) } : {}),
    })
    if (out.length >= 40) break
  }
  return out
}

/**
 * Inject the page picker, wait for click / drag-box (or Esc), then push offer.element.
 * @param {{ id?: number; url?: string; title?: string; active?: boolean; windowId?: number }} [tab]
 */
async function offerElementFromTab(tab) {
  const status = await ensureConnected()
  if (status !== "connected") {
    return { ok: false, message: "not_connected" }
  }

  const resolved =
    tab && typeof tab.id === "number"
      ? tab
      : (await chrome.tabs.query({ active: true, currentWindow: true }))[0] ?? {}
  const url = (resolved.url || "").trim()
  if (!isScriptableUrl(url) || typeof resolved.id !== "number") {
    return { ok: false, message: "bad_url" }
  }

  trackTab(resolved.id)

  try {
    await chrome.tabs.update(resolved.id, { active: true })
    if (typeof resolved.windowId === "number") {
      await chrome.windows.update(resolved.windowId, { focused: true })
    }
  } catch {
    // Best-effort focus before picking.
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: resolved.id },
      files: ["pick-element.js"],
    })
  } catch {
    return { ok: false, message: "inject_failed" }
  }

  let results
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: resolved.id },
      func: () => globalThis.__sicodePickElement?.(),
    })
  } catch {
    return { ok: false, message: "pick_failed" }
  }

  const elements = normalizePickedElements(results?.[0]?.result)
  if (!elements.length) {
    return { ok: false, message: "cancelled" }
  }

  const payload = {
    ...toBridgeTab(resolved),
    url,
    title: (resolved.title || url).slice(0, 512),
  }

  send({
    type: "offer.element",
    tab: payload,
    // First element kept for older hosts; `elements` is the full multi-select set.
    element: elements[0],
    elements,
  })

  const label =
    elements.length > 1 ? `${elements[0].label} +${elements.length - 1}` : elements[0].label
  return { ok: true, url: payload.url, title: payload.title, label, count: elements.length }
}

async function offerActiveElement() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return offerElementFromTab(tab ?? {})
}

const LOGIN_DUMP_COOKIE_MAX = 100
const LOGIN_DUMP_STORAGE_MAX = 100

/**
 * Read cookies (incl. HttpOnly) + page localStorage for the active/scriptable tab.
 * Does not require bridge connection — dump is for pasting into the in-app browser import dialog.
 * @param {{ id?: number; url?: string }} [tab]
 */
async function dumpLoginState(tab) {
  const resolved =
    tab && typeof tab.id === "number"
      ? tab
      : (await chrome.tabs.query({ active: true, currentWindow: true }))[0] ?? {}
  const url = (resolved.url || "").trim()
  if (!isScriptableUrl(url) || url.startsWith("file://")) {
    return { ok: false, message: "bad_url" }
  }
  if (typeof resolved.id !== "number") {
    return { ok: false, message: "no_tab" }
  }

  /** @type {Array<object>} */
  let cookies = []
  try {
    // Chrome's own cookie objects carry domain, path, expiry and SameSite; the pane writes them as they are.
    const host = new URL(url).hostname
    const lists = await Promise.all(
      cookieQueries(url).map((query) => chrome.cookies.getAll(query).catch(() => [])),
    )
    cookies = mergeCookies(lists, host).slice(0, LOGIN_DUMP_COOKIE_MAX)
  } catch {
    return { ok: false, message: "cookies_failed" }
  }

  /** @type {Array<{ key: string; value: string }>} */
  let storage = []
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: resolved.id },
      func: () => {
        /** @type {Array<{ key: string; value: string }>} */
        const rows = []
        for (let index = 0; index < localStorage.length; index++) {
          const key = localStorage.key(index)
          if (key == null) continue
          rows.push({ key, value: localStorage.getItem(key) ?? "" })
        }
        return rows
      },
    })
    const first = results?.[0]?.result
    if (Array.isArray(first)) {
      storage = first
        .filter(
          (row) =>
            row &&
            typeof row === "object" &&
            typeof row.key === "string" &&
            typeof row.value === "string",
        )
        .slice(0, LOGIN_DUMP_STORAGE_MAX)
    }
  } catch {
    // Restricted pages may block storage access; cookies alone are still useful.
  }

  if (cookies.length === 0 && storage.length === 0) {
    return { ok: false, message: "empty" }
  }

  // SiCode: a site can carry a hundred cookies and as many storage keys, most of them measurement,
  // consent and app state. The paste keeps the ones that carry the login so it stays short enough to
  // hand over; `skipped` is how many were left behind, which the popup reports.
  const dump = loginStateDump(url, cookies, storage)

  if (dump.cookies === 0 && dump.storage === 0) {
    return { ok: false, message: "empty" }
  }

  return { ok: true, text: dump.text, url, cookies: dump.cookies, storage: dump.storage, skipped: dump.skipped }
}

/**
 * Write dump text to the clipboard from the page context (works from SW / context menu).
 * @param {number} tabId
 * @param {string} text
 */
async function copyTextInTab(tabId, text) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    args: [text],
    func: async (value) => {
      try {
        await navigator.clipboard.writeText(value)
        return true
      } catch {
        const area = document.createElement("textarea")
        area.value = value
        area.style.position = "fixed"
        area.style.left = "-9999px"
        document.body.appendChild(area)
        area.select()
        const ok = document.execCommand("copy")
        area.remove()
        return ok
      }
    },
  })
  return results?.[0]?.result === true
}

async function copyLoginStateForTab(tab) {
  const dump = await dumpLoginState(tab)
  if (!dump.ok) return dump

  const tabId =
    typeof tab?.id === "number"
      ? tab.id
      : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id
  if (typeof tabId !== "number") return { ...dump, copied: false }

  try {
    const copied = await copyTextInTab(tabId, dump.text)
    return { ...dump, copied }
  } catch {
    return { ...dump, copied: false }
  }
}

function installContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "sicode-send-page",
      title: chrome.i18n.getMessage("contextSendPage") || "Send page to SiCode",
      contexts: ["page", "frame", "selection", "editable", "image", "video", "audio"],
    })
    chrome.contextMenus.create({
      id: "sicode-send-element",
      title: chrome.i18n.getMessage("contextSendElement") || "Pick element for SiCode",
      contexts: ["page", "frame", "selection", "editable", "image", "video", "audio"],
    })
    chrome.contextMenus.create({
      id: "sicode-send-link",
      title: chrome.i18n.getMessage("contextSendLink") || "Send link to SiCode",
      contexts: ["link"],
    })
    chrome.contextMenus.create({
      id: "sicode-copy-login",
      title: chrome.i18n.getMessage("contextCopyLogin") || "Copy login state for SiCode",
      contexts: ["page", "frame"],
    })
  })
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  void (async () => {
    if (info.menuItemId === "sicode-send-link" && info.linkUrl) {
      await offerTab(tab ?? {}, { url: info.linkUrl, title: info.linkUrl })
      return
    }
    if (info.menuItemId === "sicode-send-page") {
      await offerTab(tab ?? {}, { url: info.pageUrl || tab?.url })
      return
    }
    if (info.menuItemId === "sicode-send-element") {
      await offerElementFromTab(tab ?? {})
      return
    }
    if (info.menuItemId === "sicode-copy-login") {
      await copyLoginStateForTab(tab ?? {})
    }
  })()
})

/**
 * SiCode: push the active tab's login cookies AND localStorage through the bridge, so the in-app
 * browser can open the site already signed in. Reuses dumpLoginState's read + smart selection, so
 * the in-app pane gets the same credential-first, tracker-stripped login the「复制登录态」path does.
 * Requires a live bridge connection: the desktop pane writes what arrives.
 */
async function syncLoginState() {
  if ((await ensureConnected()) !== "connected") return { ok: false, message: "not_connected" }

  const dump = await dumpLoginState(undefined)
  if (!dump.ok) return dump

  try {
    // dump.text is the { url, cookies, localStorage } wrapper the pane's parseLoginPaste already
    // understands, so the localStorage-based sessions (most SPA sites) come across too.
    send({ type: "cookies.sync", url: dump.url, text: dump.text })
  } catch {
    return { ok: false, message: "not_connected" }
  }
  return { ok: true, url: dump.url, cookies: dump.cookies, storage: dump.storage }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== "string") return

  if (message.type === "sicode.status") {
    void (async () => {
      const status = await ensureConnected()
      const stored = await chrome.storage.local.get([
        "updateRequired",
        "expectedPackageVersion",
        "installedPackageVersion",
        "channel",
      ])
      sendResponse({
        status,
        live: liveSocket(),
        channel: typeof stored.channel === "string" ? stored.channel : "",
        updateRequired: stored.updateRequired === true,
        expectedPackageVersion: typeof stored.expectedPackageVersion === "string" ? stored.expectedPackageVersion : "",
        installedPackageVersion:
          typeof stored.installedPackageVersion === "string"
            ? stored.installedPackageVersion
            : chrome.runtime.getManifest().version,
      })
    })()
    return true
  }

  if (message.type === "sicode.offerTab") {
    void (async () => {
      sendResponse(await offerActiveTab())
    })()
    return true
  }

  if (message.type === "sicode.offerElement") {
    void (async () => {
      sendResponse(await offerActiveElement())
    })()
    return true
  }

  if (message.type === "sicode.syncLoginState") {
    void (async () => {
      sendResponse(await syncLoginState())
    })()
    return true
  }

  if (message.type === "sicode.copyLoginState") {
    void (async () => {
      // Popup writes the clipboard; SW only gathers the dump (no bridge required).
      sendResponse(await dumpLoginState())
    })()
    return true
  }
})

chrome.runtime.onInstalled.addListener(() => {
  installContextMenus()
  void ensureConnected()
})

chrome.runtime.onStartup.addListener(() => {
  void ensureConnected()
})

installContextMenus()
void chrome.alarms.create("sicode-bridge-reconnect", { delayInMinutes: 0.5, periodInMinutes: 1 })
void ensureConnected()
