/**
 * Per-tab Chrome debugger buffers for Agent console / network tools.
 * Attaches lazily on first diagnostics request for that tab.
 */

const LEVELS = ["debug", "info", "warning", "error"]
const REDACTED = new Set(["cookie", "set-cookie", "authorization", "proxy-authorization"])

/** @type {Map<number, TabBuffer>} */
const buffers = new Map()

/**
 * @typedef {{
 *   tabId: number
 *   attached: boolean
 *   attaching?: Promise<void>
 *   messages: object[]
 *   requests: Map<string, object>
 *   droppedMessages: number
 *   droppedRequests: number
 *   sequence: number
 *   scope: string
 * }} TabBuffer
 */

function ensureBuffer(tabId) {
  let buffer = buffers.get(tabId)
  if (buffer) return buffer
  buffer = {
    tabId,
    attached: false,
    messages: [],
    requests: new Map(),
    droppedMessages: 0,
    droppedRequests: 0,
    sequence: 0,
    scope: crypto.randomUUID(),
  }
  buffers.set(tabId, buffer)
  return buffer
}

function addMessage(buffer, level, text, timestampMs, source) {
  buffer.messages.push({
    id: `${buffer.scope}:${++buffer.sequence}`,
    timestampMs,
    level,
    text: String(text).slice(0, 2_000),
    textTruncated: String(text).length > 2_000,
    ...(source ? { source } : {}),
  })
  if (buffer.messages.length > 500) {
    buffer.messages.shift()
    buffer.droppedMessages++
  }
}

function trimHeaders(headers) {
  const entries = Object.entries(headers || {})
  const kept = []
  let size = 0
  let truncated = entries.length > 100
  for (const [key, value] of entries.slice(0, 100)) {
    const name = String(key).toLowerCase().slice(0, 2_048)
    const text = REDACTED.has(name) ? "<redacted>" : String(value)
    const remaining = Math.max(0, 16_000 - size - name.length)
    if (!remaining) {
      truncated = true
      break
    }
    const bounded = text.slice(0, Math.min(2_000, remaining))
    truncated ||= bounded.length < text.length
    kept.push([name, bounded])
    size += name.length + bounded.length
  }
  return { headers: Object.fromEntries(kept), truncated }
}

function resourceType(type) {
  switch (type) {
    case "Document":
      return "document"
    case "Stylesheet":
      return "stylesheet"
    case "Image":
      return "image"
    case "Media":
      return "media"
    case "Font":
      return "font"
    case "Script":
      return "script"
    case "XHR":
      return "xhr"
    case "Fetch":
      return "fetch"
    case "EventSource":
      return "eventsource"
    case "WebSocket":
      return "websocket"
    case "Manifest":
      return "manifest"
    default:
      return "other"
  }
}

function bounded(items, limit) {
  const selected = []
  let size = 0
  for (const item of items.slice(-limit).reverse()) {
    size += JSON.stringify(item).length
    if (size > 100_000) break
    selected.push(item)
  }
  return selected.reverse()
}

function onDebuggerEvent(source, method, params) {
  if (typeof source?.tabId !== "number") return
  const buffer = buffers.get(source.tabId)
  if (!buffer) return

  if (method === "Runtime.consoleAPICalled") {
    const level =
      params.type === "error" || params.type === "assert"
        ? "error"
        : params.type === "warning"
          ? "warning"
          : params.type === "debug"
            ? "debug"
            : "info"
    const text = (params.args || [])
      .map((arg) =>
        typeof arg.value === "string"
          ? arg.value
          : arg.value !== undefined
            ? JSON.stringify(arg.value)
            : (arg.description ?? arg.unserializableValue ?? arg.type),
      )
      .join(" ")
    const frame = params.stackTrace?.callFrames?.[0]
    addMessage(
      buffer,
      level,
      text,
      params.timestamp ?? Date.now(),
      frame
        ? { url: String(frame.url || "").slice(0, 8_192), line: (frame.lineNumber ?? 0) + 1, column: (frame.columnNumber ?? 0) + 1 }
        : undefined,
    )
    return
  }

  if (method === "Log.entryAdded") {
    const entry = params.entry || {}
    addMessage(
      buffer,
      entry.level === "verbose" ? "debug" : entry.level || "info",
      entry.text || "",
      entry.timestamp ?? Date.now(),
      entry.url ? { url: String(entry.url).slice(0, 8_192), line: (entry.lineNumber ?? 0) + 1, column: 1 } : undefined,
    )
    return
  }

  if (method === "Runtime.exceptionThrown") {
    const error = params.exceptionDetails || {}
    addMessage(
      buffer,
      "error",
      error.exception?.description ?? error.text ?? "exception",
      params.timestamp ?? Date.now(),
      error.url ? { url: error.url, line: (error.lineNumber ?? 0) + 1, column: (error.columnNumber ?? 0) + 1 } : undefined,
    )
    return
  }

  if (method === "Network.requestWillBeSent") {
    const id = params.requestId
    const headers = trimHeaders(params.request?.headers || {})
    const started = params.timestamp
    const info = {
      id: `${buffer.scope}:${id}`,
      url: String(params.request?.url || "").slice(0, 16_384),
      method: String(params.request?.method || "GET"),
      resourceType: resourceType(params.type || "Other"),
      timestampMs: (params.wallTime ?? Date.now() / 1000) * 1000,
      state: "pending",
    }
    buffer.requests.set(info.id, {
      info,
      nativeID: id,
      started,
      request: {
        headers: headers.headers,
        postData: params.request?.postData,
        hasPostData: !!params.request?.hasPostData,
      },
      response: undefined,
      headersTruncated: headers.truncated,
    })
    if (buffer.requests.size > 400) {
      const first = buffer.requests.keys().next().value
      buffer.requests.delete(first)
      buffer.droppedRequests++
    }
    return
  }

  if (method === "Network.responseReceived") {
    const nativeID = params.requestId
    for (const request of buffer.requests.values()) {
      if (request.nativeID !== nativeID) continue
      const headers = trimHeaders(params.response?.headers || {})
      request.response = {
        headers: headers.headers,
        mimeType: params.response?.mimeType,
      }
      request.headersTruncated ||= headers.truncated
      request.info = {
        ...request.info,
        statusCode: params.response?.status,
      }
      return
    }
    return
  }

  if (method === "Network.loadingFinished") {
    const nativeID = params.requestId
    for (const request of buffer.requests.values()) {
      if (request.nativeID !== nativeID) continue
      const durationMs = Math.max(0, ((params.timestamp ?? request.started) - (request.started ?? 0)) * 1000)
      request.info = { ...request.info, state: "completed", durationMs }
      return
    }
    return
  }

  if (method === "Network.loadingFailed") {
    const nativeID = params.requestId
    for (const request of buffer.requests.values()) {
      if (request.nativeID !== nativeID) continue
      const durationMs = Math.max(0, ((params.timestamp ?? request.started) - (request.started ?? 0)) * 1000)
      request.info = {
        ...request.info,
        state: "failed",
        durationMs,
        failure: String(params.errorText || "failed").slice(0, 512),
      }
      return
    }
  }
}

let listening = false

function ensureListener() {
  if (listening) return
  listening = true
  chrome.debugger.onEvent.addListener(onDebuggerEvent)
  chrome.debugger.onDetach.addListener((source) => {
    if (typeof source?.tabId !== "number") return
    const buffer = buffers.get(source.tabId)
    if (buffer) buffer.attached = false
  })
  chrome.tabs.onRemoved.addListener((tabId) => {
    void detach(tabId)
  })
}

async function attach(tabId) {
  const buffer = ensureBuffer(tabId)
  if (buffer.attached) return buffer
  if (buffer.attaching) {
    await buffer.attaching
    return buffer
  }
  ensureListener()
  buffer.attaching = (async () => {
    try {
      await chrome.debugger.attach({ tabId }, "1.3")
    } catch (error) {
      // Already attached by us or another tool — continue enabling domains.
      if (!String(error?.message || error).includes("Already attached")) throw error
    }
    await chrome.debugger.sendCommand({ tabId }, "Runtime.enable")
    await chrome.debugger.sendCommand({ tabId }, "Log.enable")
    await chrome.debugger.sendCommand(
      { tabId },
      "Network.enable",
      { maxTotalBufferSize: 5 * 1024 * 1024, maxResourceBufferSize: 1024 * 1024, maxPostDataSize: 20_000 },
    )
    buffer.attached = true
  })()
  try {
    await buffer.attaching
  } finally {
    buffer.attaching = undefined
  }
  return buffer
}

async function detach(tabId) {
  const buffer = buffers.get(tabId)
  buffers.delete(tabId)
  if (!buffer?.attached) return
  try {
    await chrome.debugger.detach({ tabId })
  } catch {
    // ignore
  }
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}_timeout`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/**
 * Capture a tab via CDP. Bounded — heavy tabs (e.g. douyin) can hang forever on
 * Page.captureScreenshot / debugger.attach without a timeout.
 */
export async function captureScreenshot(tabId) {
  await withTimeout(attach(tabId), 5_000, "debugger.attach")
  try {
    await withTimeout(chrome.debugger.sendCommand({ tabId }, "Page.enable"), 3_000, "Page.enable")
  } catch {
    // Some targets already expose Page.*; capture still works.
  }
  const errors = []
  for (const fromSurface of [true, false]) {
    try {
      const result = await withTimeout(
        chrome.debugger.sendCommand({ tabId }, "Page.captureScreenshot", {
          format: "png",
          fromSurface,
        }),
        6_000,
        `Page.captureScreenshot(fromSurface=${fromSurface})`,
      )
      if (result?.data) return { mime: "image/png", dataBase64: result.data }
      errors.push("empty")
    } catch (error) {
      errors.push(String(error?.message || error))
    }
  }
  throw new Error(`Screenshot capture failed: ${errors.join("; ")}`)
}

export async function readConsole(tabId, input = {}) {
  const buffer = await attach(tabId)
  const min = LEVELS.indexOf(input.level || "info")
  const matching = buffer.messages.filter((entry) => LEVELS.indexOf(entry.level) >= (min < 0 ? 1 : min))
  const messages = bounded(matching, input.limit ?? 100)
  return {
    messages,
    truncated: matching.length > messages.length,
    dropped: buffer.droppedMessages,
  }
}

export async function listNetwork(tabId, input = {}) {
  const buffer = await attach(tabId)
  const matching = [...buffer.requests.values()]
    .map((request) => request.info)
    .filter(
      (request) =>
        (!input.urlContains || request.url.includes(input.urlContains)) &&
        (!input.resourceType || input.resourceType === request.resourceType),
    )
  const requests = bounded(matching, input.limit ?? 100)
  return {
    requests,
    truncated: matching.length > requests.length,
    dropped: buffer.droppedRequests,
  }
}

export async function getNetwork(tabId, input = {}) {
  const buffer = await attach(tabId)
  const request = buffer.requests.get(input.id)
  if (!request) {
    throw new Error(
      "Request is no longer retained. Call browser.network.list({tabID}) and use a current request id. Do not reload or resend it just to inspect it.",
    )
  }
  const max = input.maxBodyChars ?? 20_000
  const headerEntries = (headers) => Object.entries(headers || {}).map(([name, value]) => ({ name, value: String(value) }))

  const textBody = (value) => ({
    state: "text",
    text: value.slice(0, max),
    truncated: value.length > max,
  })

  let responseBody = { state: "notRequested" }
  if (input.includeBody) {
    if (request.info.state === "pending") responseBody = { state: "pending" }
    else if (!request.response || request.info.state === "failed")
      responseBody = { state: "unavailable", reason: "notCaptured" }
    else if (
      !/^(text\/|application\/(json|.*\+json|javascript|xml|.*\+xml|x-www-form-urlencoded))/i.test(
        request.response.mimeType || "",
      )
    ) {
      responseBody = { state: "unavailable", reason: "binary" }
    } else {
      try {
        const body = await chrome.debugger.sendCommand({ tabId }, "Network.getResponseBody", {
          requestId: request.nativeID,
        })
        const value = body.base64Encoded ? atob(body.body) : body.body
        responseBody = value?.length ? textBody(String(value)) : { state: "empty" }
      } catch {
        responseBody = { state: "unavailable", reason: "backendUnavailable" }
      }
    }
  }

  const requestBody = !input.includeBody
    ? { state: "notRequested" }
    : request.request.postData !== undefined
      ? {
          state: "text",
          text: String(request.request.postData).slice(0, max),
          truncated: String(request.request.postData).length > max,
        }
      : request.request.hasPostData
        ? { state: "unavailable", reason: "notCaptured" }
        : { state: "empty" }

  return {
    request: request.info,
    requestHeaders: headerEntries(request.request.headers),
    responseHeaders: headerEntries(request.response?.headers ?? {}),
    headersTruncated: !!request.headersTruncated,
    requestBody,
    responseBody,
  }
}

export { detach as detachDebugger }
