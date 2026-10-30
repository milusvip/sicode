import { NodeHttpClient } from "@effect/platform-node"
import { Browser } from "@opencode/plugin-browser/rpc"
import { OpenCode } from "@opencode/client/effect"
import { SessionID } from "@opencode/schema/session-id"
import { Deferred, Effect, ManagedRuntime, Queue, Schedule, Schema, Stream } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import type { ServerEndpoints } from "../../sdk/main"
import { destinationOrigin } from "../policy"
import type { PaneEvent } from "../ipc"
import { createBrowserFiles } from "../files"
import { selectAgentInventoryTabs } from "../agent-inventory"
import { canonicalizeBrowserURL, planTabsOpen } from "../tab-open-policy"
import type { ChromeBridgeHost } from "./host"
import type { BridgeTab } from "./protocol"
import { agentTabIDForChrome, chromeIdFromTabID } from "./tab-id"
import { assertSafeWebUiScript, destructiveWebUiAllowedByEnv } from "@opencode/util/destructive-web-ui"
import {
  packConsoleLog,
  packNetworkLog,
  previewConsoleEntries,
  previewNetworkEntries,
} from "@opencode/util/browser-log-file"
import { blockedDomainMessage, isUrlBlocked, matchedBlockedDomain } from "./blocked-domain"

type Target = { readonly server: string; readonly session: string }

type Mapped = {
  tabID: Browser.TabID
  chromeTabId: number
  generation: number
  url: string
  title: string
}

type Entry = {
  binding: string
  window: number
  /** Session id this binding registered for (per-session preferSystem). */
  session: string
  abort: AbortController
  registered: ReturnType<typeof Promise.withResolvers<void>>
  requests: Map<string, AbortController>
  byChrome: Map<number, Mapped>
  byTab: Map<Browser.TabID, Mapped>
  focusedTabID: Browser.TabID | null
  /**
   * Tabs the agent opened / focused / navigated this attach (Cursor browser pane working set).
   * Full Chrome stays in byTab for reuse; agent-facing tabs.list is filtered through this.
   */
  touchedTabIDs: Set<Browser.TabID>
  /** Last successful chrome.tabs.query — skip re-query for rapid tool hops. */
  inventoryAt: number
  lastState?: string
  report?: (event: PaneEvent) => void
}

/** Same-turn tool chains (open → click → screenshot) should not re-query Chrome each hop. */
const INVENTORY_FRESH_MS = 2_000

export type ChromeAttachment = ReturnType<typeof createChromeAttachment>

/** RPC attach loop for system Chrome bridge (tabs + page actions). */
export function createChromeAttachment(input: {
  readonly serverEndpoints: ServerEndpoints
  readonly host: ChromeBridgeHost
  readonly blockedDomains: () => readonly string[]
  readonly emit: (window: number, value: { readonly binding: string; readonly event: PaneEvent }) => void
}) {
  const entries = new Map<string, Entry>()
  const runtime = ManagedRuntime.make(NodeHttpClient.layerNodeHttp)
  const files = createBrowserFiles(() => [])
  let disposed = false

  const asTab = (mapped: Mapped, bridge?: BridgeTab): Browser.Tab => ({
    id: mapped.tabID,
    url: (bridge?.url ?? mapped.url).slice(0, 16_384),
    title: (bridge?.title ?? mapped.title).slice(0, 2_048),
    loading: false,
    canGoBack: false,
    canGoForward: false,
    generation: mapped.generation,
  })

  const requireMapped = (entry: Entry, tabID: Browser.TabID) => {
    // Accept stable tab_chrome_<id>, push chips chrome_tab_<id>, and any still-mapped legacy tab_<uuid>.
    const mapped =
      entry.byTab.get(tabID) ??
      (() => {
        const chromeId = chromeIdFromTabID(tabID)
        return chromeId !== undefined && Number.isFinite(chromeId) ? entry.byChrome.get(chromeId) : undefined
      })()
    if (!mapped) {
      return {
        type: "failure" as const,
        code: "operation_failed",
        message: `Unknown tabID ${tabID}. Call browser.tabs.list first.`,
      }
    }
    // Resolving a tabID for a page op = Cursor lock onto that pane tab.
    entry.touchedTabIDs.add(mapped.tabID)
    return mapped
  }

  const publish = (entry: Entry, event: PaneEvent) => {
    if (!entries.has(entry.binding)) return
    input.emit(entry.window, { binding: entry.binding, event })
  }

  const inventory = (entry: Entry): Browser.State => ({
    tabs: Array.from(entry.byTab.values(), (mapped) => ({
      id: mapped.tabID,
      url: mapped.url.slice(0, 16_384),
      title: mapped.title.slice(0, 2_048),
      loading: false,
      canGoBack: false,
      canGoForward: false,
      generation: mapped.generation,
    })),
    focusedTabID: entry.focusedTabID,
  })

  const touch = (entry: Entry, tabID: Browser.TabID | null | undefined) => {
    if (tabID) entry.touchedTabIDs.add(tabID)
  }

  /** Cursor browser_tabs parity — agent list is session pane, not full Chrome. UI still gets `inventory`. */
  const agentInventory = (entry: Entry): Browser.State => {
    const full = inventory(entry)
    const tabs = selectAgentInventoryTabs({
      tabs: full.tabs,
      focusedTabID: entry.focusedTabID,
      touchedTabIDs: entry.touchedTabIDs,
    })
    const focusedTabID =
      entry.focusedTabID && tabs.some((tab) => tab.id === entry.focusedTabID)
        ? entry.focusedTabID
        : (tabs[0]?.id ?? null)
    return { tabs, focusedTabID }
  }

  const publishState = (entry: Entry, error?: string) => {
    const state = inventory(entry)
    const event: PaneEvent =
      error === undefined ? { type: "state", state } : { type: "state", state, error }
    const next = JSON.stringify(event)
    if (entry.lastState === next) return
    entry.lastState = next
    if (entry.report) entry.report(event)
    else publish(entry, event)
  }

  const applyBridge = (entry: Entry, bridge: BridgeTab, bump = false) => {
    let mapped = entry.byChrome.get(bridge.chromeTabId)
    if (!mapped) {
      mapped = {
        tabID: Browser.TabID.make(agentTabIDForChrome(bridge.chromeTabId)),
        chromeTabId: bridge.chromeTabId,
        generation: 0,
        url: bridge.url,
        title: bridge.title,
      }
      entry.byChrome.set(bridge.chromeTabId, mapped)
      entry.byTab.set(mapped.tabID, mapped)
    } else {
      mapped.url = bridge.url
      mapped.title = bridge.title
      if (bump) mapped.generation += 1
    }
    return mapped
  }

  const syncInventory = async (entry: Entry) => {
    const listed = await input.host.listTabs()
    const seen = new Set<number>()

    for (const bridge of listed.tabs) {
      seen.add(bridge.chromeTabId)
      applyBridge(entry, bridge)
    }

    for (const [chromeTabId, mapped] of [...entry.byChrome]) {
      if (seen.has(chromeTabId)) continue
      entry.byChrome.delete(chromeTabId)
      entry.byTab.delete(mapped.tabID)
      if (entry.focusedTabID === mapped.tabID) entry.focusedTabID = null
    }

    if (listed.focusedTabID) {
      const chromeId = chromeIdFromTabID(listed.focusedTabID)
      const focused = chromeId !== undefined && Number.isFinite(chromeId) ? entry.byChrome.get(chromeId) : undefined
      entry.focusedTabID = focused?.tabID ?? null
    }

    entry.inventoryAt = Date.now()
    return listed
  }

  /** Reuse a recent inventory unless the caller needs a hard refresh (tabs.list / close). */
  const ensureInventory = async (entry: Entry, force = false) => {
    if (!force && entry.inventoryAt > 0 && Date.now() - entry.inventoryAt < INVENTORY_FRESH_MS) return
    await syncInventory(entry)
  }

  const unsupported = (action: Browser.Action): Extract<Browser.Outcome, { type: "failure" }> => ({
    type: "failure",
    code: "unsupported",
    message:
      `browser.${action.type} is not supported on the system Chrome bridge yet. ` +
      "Supported: tabs.* (all http(s)/file tabs), navigate, reload, back, forward, snapshot, find, evaluate, click, fill, press, scroll, screenshot, console, network.list, network.get. " +
      "Disconnect the system browser bridge (Settings → Browser) for the in-app pane for the rest.",
  })

  const denyBlocked = (url: string): Extract<Browser.Outcome, { type: "failure" }> | undefined => {
    const list = input.blockedDomains()
    if (!isUrlBlocked(url, list)) return
    const domain = matchedBlockedDomain(url, list) ?? url
    return { type: "failure", code: "operation_failed", message: blockedDomainMessage(domain) }
  }

  const execute = async (entry: Entry, command: Browser.Command, signal: AbortSignal): Promise<Browser.Outcome> => {
    if (signal.aborted) {
      return {
        type: "failure",
        code: "operation_failed",
        message: "Browser request was cancelled.",
      }
    }

    const action = command.action

    try {
      if (action.type === "tabs.list") {
        await ensureInventory(entry, true)
        publishState(entry)
        // Agent sees Cursor-shaped pane (touched ∪ focused), not ambient Chrome.
        return { type: "success", result: { value: agentInventory(entry), files: [] } }
      }

      if (action.type === "tabs.open") {
        const url = action.url?.trim() || "about:blank"
        const blocked = denyBlocked(url)
        if (blocked) return blocked
        // Fresh cache is enough for same-URL reuse; avoid a query before every open.
        await ensureInventory(entry)
        const state = inventory(entry)
        // Same-document reuse as in-app pane — never prune the user's real Chrome tabs (maxTabs high).
        const plan = planTabsOpen({
          tabs: state.tabs.map((tab) => ({ id: tab.id, url: tab.url })),
          focusedTabID: entry.focusedTabID,
          url,
          maxTabs: 10_000,
        })
        // Blank / omitted URL + an already focused page → use that tab (user opened the site themselves).
        const reuseID =
          plan.reuseTabID ??
          (canonicalizeBrowserURL(url) === "about:blank" ? entry.focusedTabID : null)

        if (reuseID) {
          const mapped = entry.byTab.get(reuseID as Browser.TabID)
          if (mapped) {
            const bridge = await input.host.focusTab(mapped.chromeTabId)
            applyBridge(entry, bridge, true)
            entry.focusedTabID = mapped.tabID
            touch(entry, mapped.tabID)
            // Requested a concrete URL that differs from the focused tab — navigate in place.
            if (
              canonicalizeBrowserURL(url) !== "about:blank" &&
              canonicalizeBrowserURL(bridge.url) !== canonicalizeBrowserURL(url)
            ) {
              const navigated = await input.host.navigateTab(mapped.chromeTabId, url)
              applyBridge(entry, navigated, true)
              publishState(entry)
              if (action.focus !== false) publish(entry, { type: "focus", tabID: mapped.tabID })
              return { type: "success", result: { value: asTab(mapped, navigated), files: [] } }
            }
            publishState(entry)
            if (action.focus !== false) publish(entry, { type: "focus", tabID: mapped.tabID })
            return { type: "success", result: { value: asTab(mapped, bridge), files: [] } }
          }
        }

        const bridge = await input.host.openTab(url)
        const mapped = applyBridge(entry, bridge, true)
        entry.focusedTabID = mapped.tabID
        touch(entry, mapped.tabID)
        publishState(entry)
        if (action.focus !== false) publish(entry, { type: "focus", tabID: mapped.tabID })
        return { type: "success", result: { value: asTab(mapped, bridge), files: [] } }
      }

      if (action.type === "tabs.focus") {
        const mapped = requireMapped(entry, action.tabID)
        if ("type" in mapped) return mapped
        const blocked = denyBlocked(mapped.url)
        if (blocked) return blocked
        const bridge = await input.host.focusTab(mapped.chromeTabId)
        applyBridge(entry, bridge, true)
        entry.focusedTabID = mapped.tabID
        touch(entry, mapped.tabID)
        publishState(entry)
        publish(entry, { type: "focus", tabID: mapped.tabID })
        return { type: "success", result: { value: asTab(mapped, bridge), files: [] } }
      }

      if (action.type === "tabs.close") {
        const mapped = requireMapped(entry, action.tabID)
        if ("type" in mapped) return mapped
        const blocked = denyBlocked(mapped.url)
        if (blocked) return blocked
        await input.host.closeTab(mapped.chromeTabId)
        entry.touchedTabIDs.delete(mapped.tabID)
        await syncInventory(entry)
        publishState(entry)
        return { type: "success", result: { value: agentInventory(entry), files: [] } }
      }

      if (action.type === "navigate") {
        const mapped = requireMapped(entry, action.tabID)
        if ("type" in mapped) return mapped
        const blockedTab = denyBlocked(mapped.url)
        if (blockedTab) return blockedTab
        const blockedTarget = denyBlocked(action.url)
        if (blockedTarget) return blockedTarget
        const bridge = await input.host.navigateTab(mapped.chromeTabId, action.url)
        applyBridge(entry, bridge, true)
        touch(entry, mapped.tabID)
        publishState(entry)
        return { type: "success", result: { value: asTab(mapped, bridge), files: [] } }
      }

      if (action.type === "reload") {
        const mapped = requireMapped(entry, action.tabID)
        if ("type" in mapped) return mapped
        const blocked = denyBlocked(mapped.url)
        if (blocked) return blocked
        // SiCode: the new-repo reload action carries no ignoreCache flag; bridge treats it as a plain reload.
        const bridge = await input.host.reloadTab(mapped.chromeTabId)
        applyBridge(entry, bridge, true)
        publishState(entry)
        return { type: "success", result: { value: asTab(mapped, bridge), files: [] } }
      }

      if (action.type === "back" || action.type === "forward") {
        const mapped = requireMapped(entry, action.tabID)
        if ("type" in mapped) return mapped
        const blocked = denyBlocked(mapped.url)
        if (blocked) return blocked
        const bridge =
          action.type === "back"
            ? await input.host.backTab(mapped.chromeTabId)
            : await input.host.forwardTab(mapped.chromeTabId)
        applyBridge(entry, bridge, true)
        publishState(entry)
        return { type: "success", result: { value: asTab(mapped, bridge), files: [] } }
      }

      if (action.type === "snapshot" || action.type === "find") {
        const mapped = requireMapped(entry, action.tabID)
        if ("type" in mapped) return mapped
        const blocked = denyBlocked(mapped.url)
        if (blocked) return blocked
        const depth = action.type === "snapshot" ? action.depth : 8
        const { snapshot, tab } = await input.host.snapshotTab(mapped.chromeTabId, depth)
        applyBridge(entry, tab)
        let content = snapshot.content
        let truncated = snapshot.truncated
        if (action.type === "find") {
          const needle = action.text.toLowerCase()
          const lines = content.split("\n").filter((line) => line.toLowerCase().includes(needle))
          content = lines.join("\n")
          truncated = truncated || lines.length >= 500
        }
        publishState(entry)
        return {
          type: "success",
          result: {
            value: { tab: asTab(mapped, tab), content, truncated },
            files: [],
          },
        }
      }

      if (action.type === "evaluate") {
        const mapped = requireMapped(entry, action.tabID)
        if ("type" in mapped) return mapped
        const blocked = denyBlocked(mapped.url)
        if (blocked) return blocked
        const allowDestructive = destructiveWebUiAllowedByEnv()
        try {
          assertSafeWebUiScript(action.script)
        } catch (error) {
          return {
            type: "failure" as const,
            code: "operation_failed",
            message: error instanceof Error ? error.message : String(error),
          }
        }
        const { value, tab } = await input.host.evaluateTab(
          mapped.chromeTabId,
          action.script,
          action.ref,
          allowDestructive,
        )
        applyBridge(entry, tab)
        publishState(entry)
        let json: string | number | boolean | null | { readonly [key: string]: unknown } | readonly unknown[]
        try {
          json = JSON.parse(JSON.stringify(value ?? null))
        } catch {
          json = String(value)
        }
        return {
          type: "success",
          result: {
            value: { tab: asTab(mapped, tab), value: json as never },
            files: [],
          },
        }
      }

      if (action.type === "click") {
        const mapped = requireMapped(entry, action.tabID)
        if ("type" in mapped) return mapped
        const blocked = denyBlocked(mapped.url)
        if (blocked) return blocked
        const bridge = await input.host.clickTab(
          mapped.chromeTabId,
          action.ref,
          action.button,
          action.count === 2 ? 2 : 1,
          destructiveWebUiAllowedByEnv(),
        )
        applyBridge(entry, bridge, true)
        publishState(entry)
        return { type: "success", result: { value: asTab(mapped, bridge), files: [] } }
      }

      if (action.type === "fill") {
        const mapped = requireMapped(entry, action.tabID)
        if ("type" in mapped) return mapped
        const blocked = denyBlocked(mapped.url)
        if (blocked) return blocked
        const bridge = await input.host.fillTab(mapped.chromeTabId, action.ref, action.text)
        applyBridge(entry, bridge, true)
        publishState(entry)
        return { type: "success", result: { value: asTab(mapped, bridge), files: [] } }
      }

      if (action.type === "press") {
        const mapped = requireMapped(entry, action.tabID)
        if ("type" in mapped) return mapped
        const blocked = denyBlocked(mapped.url)
        if (blocked) return blocked
        const bridge = await input.host.pressTab(mapped.chromeTabId, action.key)
        applyBridge(entry, bridge)
        publishState(entry)
        return { type: "success", result: { value: asTab(mapped, bridge), files: [] } }
      }

      if (action.type === "scroll") {
        const mapped = requireMapped(entry, action.tabID)
        if ("type" in mapped) return mapped
        const blocked = denyBlocked(mapped.url)
        if (blocked) return blocked
        const bridge = await input.host.scrollTab(mapped.chromeTabId, action.deltaY, action.deltaX)
        applyBridge(entry, bridge)
        publishState(entry)
        return { type: "success", result: { value: asTab(mapped, bridge), files: [] } }
      }

      if (action.type === "screenshot") {
        const mapped = requireMapped(entry, action.tabID)
        if ("type" in mapped) return mapped
        const blocked = denyBlocked(mapped.url)
        if (blocked) return blocked
        if (action.ref || action.fullPage) {
          return {
            type: "failure",
            code: "unsupported",
            message:
              "System Chrome screenshot currently supports the visible viewport only (no ref/fullPage). Focus the tab and retry without those options.",
          }
        }
        const { screenshot, tab } = await input.host.screenshotTab(mapped.chromeTabId)
        applyBridge(entry, tab)
        const bytes = Buffer.from(screenshot.dataBase64, "base64")
        const id = await files.save("screenshot.png", screenshot.mime || "image/png", bytes)
        const file = await files.transfer(id)
        publishState(entry)
        return {
          type: "success",
          result: {
            value: {
              tab: asTab(mapped, tab),
              files: [
                {
                  id: file.id,
                  name: file.name,
                  mime: file.mime,
                  bytes: file.data.byteLength,
                  path: files.get(file.id).path,
                },
              ],
            },
            files: [file],
          },
        }
      }

      if (action.type === "console" || action.type === "network.list" || action.type === "network.get") {
        const mapped = requireMapped(entry, action.tabID)
        if ("type" in mapped) return mapped
        const blocked = denyBlocked(mapped.url)
        if (blocked) return blocked
        if (action.type === "console") {
          const { messages, truncated, dropped, tab } = await input.host.consoleTab(mapped.chromeTabId, {
            level: action.level,
            limit: action.limit,
          })
          applyBridge(entry, tab)
          publishState(entry)
          const pack = packConsoleLog(messages as never)
          const preview = previewConsoleEntries(messages as never)
          // Cursor: when long, full log → file; JSON keeps a short error-first preview.
          if (!pack.offload || !pack.body) {
            return {
              type: "success",
              result: {
                value: {
                  tab: asTab(mapped, tab),
                  messages: preview,
                  truncated: truncated || pack.lineCount > preview.length,
                  dropped,
                } as never,
                files: [],
              },
            }
          }
          const id = await files.save("console.log", "text/plain", Buffer.from(pack.body, "utf8"))
          const file = await files.transfer(id)
          return {
            type: "success",
            result: {
              value: {
                tab: asTab(mapped, tab),
                messages: preview,
                truncated: true,
                dropped,
              } as never,
              files: [file],
            },
          }
        }
        if (action.type === "network.list") {
          const { requests, truncated, dropped, tab } = await input.host.networkListTab(mapped.chromeTabId, {
            urlContains: action.urlContains,
            resourceType: action.resourceType,
            limit: action.limit,
          })
          applyBridge(entry, tab)
          publishState(entry)
          const pack = packNetworkLog(requests as never)
          const preview = previewNetworkEntries(requests as never)
          if (!pack.offload || !pack.body) {
            return {
              type: "success",
              result: {
                value: {
                  tab: asTab(mapped, tab),
                  requests: preview,
                  truncated: truncated || pack.lineCount > preview.length,
                  dropped,
                } as never,
                files: [],
              },
            }
          }
          const id = await files.save("network.log", "text/plain", Buffer.from(pack.body, "utf8"))
          const file = await files.transfer(id)
          return {
            type: "success",
            result: {
              value: {
                tab: asTab(mapped, tab),
                requests: preview,
                truncated: true,
                dropped,
              } as never,
              files: [file],
            },
          }
        }
        const detail = await input.host.networkGetTab(mapped.chromeTabId, {
          id: action.id,
          includeBody: action.includeBody,
          maxBodyChars: action.maxBodyChars,
        })
        applyBridge(entry, detail.tab)
        publishState(entry)
        return {
          type: "success",
          result: {
            value: {
              tab: asTab(mapped, detail.tab),
              request: detail.request,
              requestHeaders: detail.requestHeaders,
              responseHeaders: detail.responseHeaders,
              headersTruncated: detail.headersTruncated,
              requestBody: detail.requestBody,
              responseBody: detail.responseBody,
            } as never,
            files: [],
          },
        }
      }

      return unsupported(action)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      const needsSnapshot =
        /stale|unknown or stale|no longer available|absent from|detached/i.test(detail) &&
        !/browser\.snapshot/i.test(detail)
      return {
        type: "failure",
        code: "operation_failed",
        message: needsSnapshot
          ? `${detail} Call browser.snapshot({tabID}) and use a ref from that tab's newest snapshot. Do not reuse the failed @eN.`
          : detail,
      }
    }
  }

  const close = (entry: Entry, reason = "browser.pane.registration.closed") => {
    if (entries.get(entry.binding) !== entry) return
    entry.report = undefined
    for (const abort of entry.requests.values()) abort.abort()
    entry.requests.clear()
    const suspended = reason === "browser.pane.suspended"
    if (suspended) publishState(entry, reason)
    entry.byChrome.clear()
    entry.byTab.clear()
    entry.touchedTabIDs.clear()
    entry.focusedTabID = null
    if (!suspended) publishState(entry, reason)
    entries.delete(entry.binding)
    entry.registered.reject(new Error("browser.pane.registration.closed"))
    entry.abort.abort()
  }

  return {
    async register(window: number, binding: string, target: Target) {
      const server = input.serverEndpoints.get(target.server)

      if (disposed || !server || !destinationOrigin(server.url)) throw new Error("browser.pane.registration.invalid")
      if (server.username && !server.password) throw new Error("browser.pane.endpoint.invalid")
      if (!input.host.status().connected) throw new Error("chrome.bridge.not_connected")
      if (entries.has(binding)) throw new Error("browser.pane.owner.invalid")

      const sessionID = SessionID.make(target.session)
      const entry: Entry = {
        binding,
        window,
        session: target.session,
        abort: new AbortController(),
        registered: Promise.withResolvers(),
        requests: new Map(),
        byChrome: new Map(),
        byTab: new Map(),
        focusedTabID: null,
        touchedTabIDs: new Set(),
        inventoryAt: 0,
      }

      let reason: "browser.pane.unsupported" | "browser.pane.replaced" | "browser.pane.suspended" | undefined
      let attached = false
      const stop = () => close(entry, reason)

      entries.set(binding, entry)
      void runtime
        .runPromise(
          Effect.gen(function* () {
            const http = yield* HttpClient.HttpClient
            const client = yield* OpenCode.make({ baseUrl: server.url }).pipe(
              Effect.provideService(
                HttpClient.HttpClient,
                Object.keys(server.headers).length
                  ? HttpClient.mapRequest(http, HttpClientRequest.setHeaders(server.headers))
                  : http,
              ),
            )

            const session = yield* client.session.get({ sessionID })
            const options = {
              location: { directory: session.location.directory, workspace: session.location.workspaceID },
            }

            const attachment = { sessionID, connectionID: crypto.randomUUID() }
            const rpc = client.rpc(Browser.Definition)
            const connected = yield* Deferred.make<void>()
            const outbound = yield* Queue.unbounded<Effect.Effect<void>>()

            const send = (effect: Effect.Effect<unknown, unknown>) =>
              Queue.offerUnsafe(
                outbound,
                effect.pipe(Effect.catchCause((cause) => Effect.logWarning("Chrome browser send failed", cause))),
              )

            const reply = (requestID: string, outcome: Browser.Outcome) =>
              send(
                rpc.result({ ...attachment, requestID, outcome: Schema.encodeSync(Browser.Outcome)(outcome) }, options),
              )

            entry.report = (event) => {
              const local = Effect.sync(() => publish(entry, event))
              if (event.type !== "state") return send(local)
              send(
                rpc.state({ ...attachment, state: event.state ?? { tabs: [], focusedTabID: null } }, options).pipe(
                  Effect.retry({
                    while: (error) => !("type" in error && error.type === "unavailable"),
                    schedule: Schedule.min([Schedule.exponential("250 millis"), Schedule.spaced("10 seconds")]),
                  }),
                  Effect.ensuring(local),
                ),
              )
            }

            const receive = client.event.subscribe().pipe(
              Stream.runForEach((event) =>
                Effect.gen(function* () {
                  if (event.type === "server.connected") {
                    yield* Deferred.succeed(connected, undefined)
                    return
                  }

                  if (
                    event.type !== "rpc.experimental.browser.control" ||
                    event.data.connectionID !== attachment.connectionID
                  )
                    return

                  const message = yield* Schema.decodeUnknownEffect(Browser.Control)(event.data).pipe(
                    Effect.tapError(() =>
                      Effect.sync(() => {
                        reason = "browser.pane.unsupported"
                      }),
                    ),
                  )

                  if (message.type === "attached") {
                    attached = true
                    return entry.registered.resolve()
                  }

                  if (message.type === "cancel") return entry.requests.get(message.requestID)?.abort()

                  const abort = new AbortController()
                  entry.requests.set(message.requestID, abort)
                  yield* rpc.command({ ...attachment, requestID: message.requestID }, options).pipe(
                    Effect.flatMap((command) =>
                      Effect.promise(async () => {
                        reply(message.requestID, await execute(entry, command, abort.signal))
                      }),
                    ),
                    Effect.ensuring(Effect.sync(() => entry.requests.delete(message.requestID))),
                    Effect.tapError((error) =>
                      Effect.sync(() => {
                        if (!Schema.isSchemaError(error)) return
                        reply(message.requestID, {
                          type: "failure",
                          code: "unsupported",
                          message:
                            "This desktop app does not support the requested browser operation. Ask the user to update the desktop app, or use another operation.",
                        })
                      }),
                    ),
                    Effect.catchCause((cause) =>
                      abort.signal.aborted ? Effect.void : Effect.logWarning("Chrome browser command failed", cause),
                    ),
                    Effect.forkScoped,
                  )
                }),
              ),
            )

            yield* Effect.raceAllFirst([
              receive,
              Stream.fromQueue(outbound).pipe(Stream.runForEach((send) => send)),
              Deferred.await(connected).pipe(
                Effect.andThen(rpc.attach({ ...attachment, version: 4 }, options)),
                Effect.tap((result) =>
                  Effect.sync(() => {
                    if (result === "replaced") reason = "browser.pane.replaced"
                  }),
                ),
              ),
            ])
          }).pipe(
            Effect.scoped,
            Effect.tapError((error) =>
              Effect.sync(() => {
                const type = error instanceof Object && "type" in error ? error.type : undefined
                if (type === "rpc.unavailable" && attached) {
                  reason = "browser.pane.suspended"
                  return
                }
                if (type === "rpc.unavailable" || type === "rpc.method_not_found" || type === "rpc.invalid_input")
                  reason = "browser.pane.unsupported"
              }),
            ),
            Effect.ensuring(Effect.sync(stop)),
          ),
          { signal: entry.abort.signal },
        )
        .catch(stop)

      const timeout = setTimeout(stop, 15_000)
      await entry.registered.promise.finally(() => clearTimeout(timeout))
      if (entries.get(binding) !== entry) throw new Error("browser.pane.registration.closed")
      await syncInventory(entry)
      publishState(entry)
    },

    close(binding: string) {
      const entry = entries.get(binding)
      if (entry) close(entry)
    },

    dropAll(reason: "browser.pane.suspended" | "browser.pane.registration.closed" = "browser.pane.suspended") {
      for (const entry of [...entries.values()]) close(entry, reason)
    },

    /** Drop Chrome attachments for one session only (capsule X / clear prefer). */
    dropSession(
      session: string,
      reason: "browser.pane.suspended" | "browser.pane.registration.closed" = "browser.pane.suspended",
    ) {
      for (const entry of [...entries.values()]) {
        if (entry.session === session) close(entry, reason)
      }
    },

    async dispose() {
      disposed = true
      this.dropAll("browser.pane.registration.closed")
      await runtime.dispose()
    },
  }
}
