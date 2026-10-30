import { NodeHttpClient } from "@effect/platform-node"
import { Browser } from "@opencode/plugin-browser/rpc"
import { OpenCode } from "@opencode/client/effect"
import { SessionID } from "@opencode/schema/session-id"
import electron, { type BrowserWindow } from "electron"
import { Deferred, Effect, ManagedRuntime, Queue, Schedule, Schema, Stream } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import type { Embeds, Persisted, ServerEndpoints, Storage, Windows } from "../sdk/main"
import { createBrowserPage, type BrowserPage, type Shared } from "./chromium"
import { cookiesForDomain, parseLoginPaste } from "./cookies"
import { browserFailure } from "./errors"
import { createBrowserNetwork, type BrowserNetwork } from "./network"
import { destinationOrigin, fileURLWithin, refusal } from "./policy"
import { createRefs } from "./refs"
import type { PaneEvent } from "./ipc"
import { createBrowserRestoreStore } from "./restore"
import { createLocalStorageStore, storageOrigin, writeScript } from "./local-storage"
import { createSessionJar } from "./session-jar"

type Target = { readonly server: string; readonly session: string; readonly restore?: Browser.State }

type Entry = {
  binding: string
  window: number
  win: BrowserWindow
  abort: AbortController
  registered: ReturnType<typeof Promise.withResolvers<void>>
  requests: Map<string, { abort: AbortController; tabID?: Browser.TabID }>
  report?: (event: PaneEvent) => void
  cleanup?: () => void
  pages: Map<Browser.TabID, BrowserPage>
  tabs: Map<Browser.TabID, Browser.Tab>
  focusedTabID: Browser.TabID | null
  partition: string
  lastState?: string
  network?: BrowserNetwork
  storageKey: string
  /** Agent browser permission for this attachment. Default read; not a global setting. */
  access: Browser.AgentAccess
  /** Config-file denies; write locked → panel switch disabled. */
  locked: { read: boolean; write: boolean }
  /** Push access to the server without tearing down the attachment. Set once RPC is ready. */
  setServerAccess?: (access: Browser.AgentAccess) => Promise<{ access: Browser.AgentAccess; locked: Entry["locked"] }>
  /**
   * Workspace directories whose files may load as file:// documents. Set only for the desktop's
   * own sidecar: a forwarded or explicit loopback server does not share this machine's disk.
   */
  fileRoots: string[]
  /** The workspace this attachment keeps its login state under, known once the session is fetched. */
  jarKey?: string
  /**
   * SiCode: a synced login's localStorage, waiting for the first document of its origin to load and overwrite what the
   * partition had left behind. A tab opened after the sync is a new page, so only a script handed to that page reaches
   * its first document; the pane is where it waits, because the page does not exist yet.
   */
  pendingStorage?: { origin: string; entries: Readonly<Record<string, string>>; source: string }
  /**
   * Whether the connected server runs on this machine. Decides who resolves the network: a local server shares this
   * machine's OS proxy, so the pane may use it directly; a remote one must keep the attachment's tunnel, whose whole
   * purpose is that pages load through the server's network.
   */
  local: boolean
}

export type Pane = ReturnType<typeof createBrowserPane>

export function createBrowserPane(input: {
  readonly windows: Windows
  readonly serverEndpoints: ServerEndpoints
  readonly storage: Storage
  /** The declared store of reserved element refs. */
  readonly refs: Persisted<number, number>
  readonly embeds: Embeds
  readonly emit: (window: number, value: { readonly binding: string; readonly event: PaneEvent }) => void
}) {
  const entries = new Map<string, Entry>()
  const restore = createBrowserRestoreStore(input.storage)
  const jar = createSessionJar(input.storage)
  const originStorage = createLocalStorageStore(input.storage)
  const shared: Shared = { ref: createRefs(input.refs) }
  // Page disposals in flight. Finishing a trace or CPU profile can hold a page open, and the pane's own disposal waits
  // for them so a replacement never starts beside old pages still recording.
  const releasing = new Set<Promise<void>>()
  // Keep long-lived RPC requests off Chromium's shared HTTP connection pool.
  const runtime = ManagedRuntime.make(NodeHttpClient.layerNodeHttp)
  let disposed = false

  return {
    async register(
      window: number,
      binding: string,
      target: Target & { access?: Browser.AgentAccess },
    ) {
      const server = input.serverEndpoints.get(target.server)

      if (disposed || !server || !destinationOrigin(server.url)) throw new Error("browser.pane.registration.invalid")

      if (server.username && !server.password) throw new Error("browser.pane.endpoint.invalid")
      const win = input.windows.get(window)

      if (!win || entries.has(binding)) throw new Error("browser.pane.owner.invalid")

      if (win.isDestroyed() || win.webContents.isDestroyed()) throw new Error("browser.pane.owner.unavailable")
      const sessionID = SessionID.make(target.session)
      const storageKey = `${target.server}\n${sessionID}`
      const saved = restore.load(storageKey)

      const previous = target.restore ?? {
        tabs: saved.tabs.map((tab) => ({
          ...tab,
          title: "",
          generation: 0,
        })),
        focusedTabID: saved.focusedTabID,
      }

      const entry: Entry = {
        binding,
        window,
        win,
        abort: new AbortController(),
        registered: Promise.withResolvers(),
        requests: new Map(),
        pages: new Map(),
        tabs: new Map(
          previous.tabs.map((tab) => [
            tab.id,
            {
              ...tab,
              loading: false,
              canGoBack: false,
              canGoForward: false,
              generation: tab.generation + 1,
            },
          ]),
        ),
        focusedTabID: previous.focusedTabID,
        partition: `opencode-browser-${crypto.randomUUID()}`,
        storageKey,
        // Panel default: read-only until the user allows writes for this attachment.
        access: target.access ?? "read",
        locked: { read: false, write: false },
        fileRoots: [],
        local: server.local === true,
      }

      // Navigation guards cover documents; subresources (img, script, fetch) also must not read
      // file: URLs outside the roots. One listener per partition covers every page in this attachment.
      electron.session
        .fromPartition(entry.partition)
        .webRequest.onBeforeRequest({ urls: ["file://*/*"] }, (details, callback) =>
          callback({ cancel: !fileURLWithin(details.url, entry.fileRoots) }),
        )
      // "unsupported" means the server has no browser plugin; the renderer stops retrying.
      let reason: "browser.pane.unsupported" | "browser.pane.replaced" | "browser.pane.suspended" | undefined
      let attached = false
      const stop = () => close(entry, reason)

      const navigate = (event: Electron.Event<{ isMainFrame: boolean; isSameDocument: boolean }>) => {
        if (event.isMainFrame && !event.isSameDocument) stop()
      }

      win.webContents.once("destroyed", stop)
      win.webContents.on("did-start-navigation", navigate)
      entry.cleanup = () => {
        if (win.isDestroyed()) return
        win.webContents.off("destroyed", stop)
        win.webContents.off("did-start-navigation", navigate)
      }

      entries.set(binding, entry)
      void runtime
        .runPromise(
          Effect.gen(function* () {
            const http = yield* HttpClient.HttpClient

            // The renderer never holds the managed sidecar's password; Node requests bypass
            // the webRequest header injection, so the host resolves the credential here in main.
            const client = yield* OpenCode.make({ baseUrl: server.url }).pipe(
              Effect.provideService(
                HttpClient.HttpClient,
                Object.keys(server.headers).length
                  ? HttpClient.mapRequest(http, HttpClientRequest.setHeaders(server.headers))
                  : http,
              ),
            )

            const session = yield* client.session.get({ sessionID })

            // Login state outlives this attachment: the workspace's jar lands in the fresh partition before any page
            // can load, so a page that sets its session on arrival sees the cookies already there. A cookie the site
            // rejects restores nothing rather than keeping the pane from opening.
            const jarKey = session.location.directory
            entry.jarKey = jarKey
            yield* Effect.tryPromise(() => jar.restore(entry.partition, jarKey)).pipe(Effect.ignore)

            // The agent can already read this workspace, so showing its files adds no access.
            if (server.local) entry.fileRoots = [session.location.directory]

            const options = {
              location: { directory: session.location.directory, workspace: session.location.workspaceID },
            }

            const attachment = { sessionID, connectionID: crypto.randomUUID() }
            const rpc = client.rpc(Browser.Definition)
            entry.setServerAccess = (access) =>
              runtime.runPromise(
                rpc.access({ ...attachment, access }, options).pipe(
                  Effect.tap((status) =>
                    Effect.sync(() => {
                      entry.access = status.access
                      entry.locked = status.locked
                    }),
                  ),
                ),
              )
            entry.network = yield* createBrowserNetwork({
              rpc,
              attachment,
              location: options.location,
              partition: entry.partition,
            })
            const connected = yield* Deferred.make<void>()
            const outbound = yield* Queue.unbounded<Effect.Effect<void>>()

            // A send that fails because the server already replaced or closed this attachment must
            // not decide the close reason; only the attach call's outcome does.
            const send = (effect: Effect.Effect<unknown, unknown>) =>
              Queue.offerUnsafe(
                outbound,
                effect.pipe(Effect.catchCause((cause) => Effect.logWarning("Browser send failed", cause))),
              )

            const reply = (requestID: string, outcome: Browser.Outcome) =>
              send(
                rpc.result({ ...attachment, requestID, outcome: Schema.encodeSync(Browser.Outcome)(outcome) }, options),
              )

            // Report state before publishing it locally or completing a command. The server's copy of
            // the inventory resolves every tab ID, so a state is retried until it arrives or the
            // attachment ends; the results queued behind it then never name a tab the server lacks.
            // "unavailable" means the server already dropped this attachment, which attach reports.
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
                    // Pull locked from the server so the panel can disable a config-denied write switch.
                    yield* rpc.access({ ...attachment, access: entry.access }, options).pipe(
                      Effect.tap((status) =>
                        Effect.sync(() => {
                          entry.access = status.access
                          entry.locked = status.locked
                        }),
                      ),
                      Effect.ignore,
                    )

                    return entry.registered.resolve()
                  }

                  if (message.type === "cancel") return entry.requests.get(message.requestID)?.abort.abort()
                  const abort = new AbortController()
                  entry.requests.set(message.requestID, { abort })
                  yield* rpc.command({ ...attachment, requestID: message.requestID }, options).pipe(
                    Effect.flatMap((command) =>
                      Effect.promise(async () => {
                        entry.requests.set(
                          message.requestID,
                          "tabID" in command.action ? { abort, tabID: command.action.tabID } : { abort },
                        )
                        reply(
                          message.requestID,
                          await execute(entry, command, abort.signal).then(
                            (result) => ({ type: "success" as const, result }),
                            (cause: unknown) => browserFailure(command.action, cause),
                          ),
                        )
                      }),
                    ),
                    Effect.ensuring(Effect.sync(() => entry.requests.delete(message.requestID))),
                    // An operation this desktop cannot decode comes from a newer plugin; answer it so
                    // the agent does not wait out the server's timeout.
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
                    // A request that vanished (cancelled before retrieval) fails only that request.
                    // Transport loss surfaces through the event stream and attach call instead.
                    Effect.catchCause((cause) =>
                      abort.signal.aborted ? Effect.void : Effect.logWarning("Browser command failed", cause),
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
                Effect.andThen(rpc.attach({ ...attachment, version: 4, access: entry.access }, options)),
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
      publishState(entry)
    },
    load(window: number, binding: string, tabID: Browser.TabID) {
      load(owned(window, binding), tabID)
    },
    async inspect(window: number, binding: string, tabID: Browser.TabID, enabled: boolean) {
      await owned(window, binding).pages.get(tabID)?.inspect(enabled)
    },
    async highlight(window: number, binding: string, tabID: Browser.TabID, ref?: Browser.Ref) {
      await owned(window, binding).pages.get(tabID)?.highlight(ref)
    },
    zoom(window: number, binding: string, tabID: Browser.TabID, direction: "in" | "out" | "reset") {
      owned(window, binding).pages.get(tabID)?.zoom(direction)
    },
    async site(window: number, binding: string, tabID: Browser.TabID) {
      return (await owned(window, binding).pages.get(tabID)?.site()) ?? { cookies: 0 }
    },
    async clearSite(window: number, binding: string, tabID: Browser.TabID) {
      await owned(window, binding).pages.get(tabID)?.clearSite()
    },
    access(window: number, binding: string) {
      const entry = owned(window, binding)

      return { access: entry.access, locked: entry.locked }
    },
    async setAccess(window: number, binding: string, access: Browser.AgentAccess) {
      const entry = owned(window, binding)
      entry.access = access
      const status = await entry.setServerAccess?.(access)

      if (status) {
        entry.access = status.access
        entry.locked = status.locked
      }

      return { access: entry.access, locked: entry.locked }
    },
    async setCookies(window: number, binding: string, tabID: Browser.TabID, text: string) {
      const page = owned(window, binding).pages.get(tabID)

      if (!page) throw new Error("This tab has no page to write cookies to. Reload it and try again.")

      return page.setCookies(text)
    },
    /**
     * Writes a paste into the attachment's own cookie store, each cookie at the domain it names. Needs no tab: the
     * store belongs to the partition, so an extension can hand over a login before the pane opens the site.
     *
     * A paste copied from the extension may carry the site's localStorage too — a site that keeps its session there is
     * not signed in by cookies alone. That half is saved under the paste's own page, and put into any page of that
     * origin already open, so the reload the pane does next reads it instead of waiting for a navigation of its own.
     */
    async setDomainCookies(window: number, binding: string, text: string) {
      const entry = owned(window, binding)
      const session = electron.session.fromPartition(entry.partition)
      const pasted = parseLoginPaste(text)
      // A login that lives entirely in localStorage has no cookies to write; skipping the cookie
      // loop keeps cookiesForDomain's empty-array throw from dropping the storage half.
      const cookies = pasted.cookies.length > 0 ? cookiesForDomain(pasted.cookies, pasted.url) : []
      let written = 0
      let rejection: string | undefined

      for (const cookie of cookies) {
        try {
          await session.cookies.set(cookie)
          written++
        } catch (cause) {
          // One cookie the site rejects (an expired paste, an insecure SameSite=None) must not drop the others.
          rejection ??= `Cookie "${cookie.name}" was rejected: ${cause instanceof Error ? cause.message : String(cause)}`
        }
      }

      const stored = writeStorage(entry, pasted)

      // SiCode: a tab already on the site is signed in by this write, not by the pane's next navigation. The page takes
      // the entries now and replays them over what the site had left behind. A page that is elsewhere keeps its own.
      if (stored) {
        const applied = await Promise.all(
          Array.from(entry.pages.values(), (page) =>
            page.applyStorage(stored.origin, stored.entries).catch(() => false),
          ),
        )

        // One of them took it directly, so no later tab should replay the same snapshot over what the site writes next.
        if (applied.some(Boolean)) entry.pendingStorage = undefined
      }

      // A storage-only paste is a login too: the site reads its session from there and has no cookie to write.
      if (!written && !stored) throw new Error(rejection ?? "No cookie or localStorage entry was written.")

      return { cookies: written, storage: stored ? Object.keys(stored.entries).length : 0 }
    },
    async command(window: number, binding: string, command: Browser.Action) {
      const entry = owned(window, binding)
      const url = command.type === "navigate" || command.type === "tabs.open" ? command.url : undefined
      // The window explains a refused address by its code; the agent's commands get main's own message instead.
      const reason = url === undefined ? undefined : refusal(url, { fileRoots: entry.fileRoots })

      if (reason) throw new Error(reason)
      await execute(entry, { action: command, files: [] }, new AbortController().signal)
    },
    async close(window: number, binding: string) {
      const entry = owned(window, binding)
      restore.remove(entry.storageKey)
      close(entry)
    },
    /**
     * The extension is going away (reload, disable, or quit). Windows keep each pane's tabs as a
     * suspended attachment, like an idle server eviction, and register again once the pane is back.
     */
    async dispose() {
      disposed = true
      entries.forEach((entry) => close(entry, "browser.pane.suspended"))
      await Promise.all(releasing)
      await runtime.dispose()
    },
  }

  function owned(window: number, binding: string) {
    const entry = entries.get(binding)

    if (!entry || entry.window !== window) throw new Error("browser.pane.unavailable")

    return entry
  }

  /**
   * Saves a paste's localStorage half under the page it came from, merged into what the workspace already keeps, and
   * reports where it went so it can be replayed. Nothing to save — no storage in the paste, no page it names, or no
   * workspace key yet — reports nothing rather than an empty set.
   */
  function writeStorage(entry: Entry, pasted: ReturnType<typeof parseLoginPaste>) {
    const origin = pasted.url ? storageOrigin(pasted.url) : undefined
    const jarKey = entry.jarKey

    if (!pasted.storage || !origin || !jarKey) return
    // Merged, because the store replaces an origin's whole set and a paste carries the login keys, not every key.
    const merged = { ...originStorage.load(jarKey, origin), ...pasted.storage }

    originStorage.save(jarKey, origin, merged)
    // SiCode: waiting for whichever document of this origin loads next, whether that is this attachment's open tab or a
    // tab the sync is about to open. The paste is the login the user asked for, so it overwrites rather than fills gaps.
    entry.pendingStorage = { origin, entries: merged, source: writeScript(origin, merged) }

    return { origin, entries: pasted.storage }
  }

  /** Whether two entry sets hold the same keys and values, the test for "nothing was written since". */
  function sameEntries(a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>) {
    const keys = Object.keys(a)

    return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key])
  }

  function publish(entry: Entry, event: PaneEvent) {
    if (!entries.has(entry.binding) || entry.win.isDestroyed() || entry.win.webContents.isDestroyed()) return
    input.emit(entry.window, { binding: entry.binding, event })
  }

  function close(entry: Entry, reason = "browser.pane.registration.closed") {
    if (entries.get(entry.binding) !== entry) return
    entry.report = undefined

    // The partition dies with this attachment; copy what the user signed in with, so the next pane of this
    // workspace opens signed in. Covers a suspension (extension reload) as well as closing the pane.
    if (entry.jarKey) void jar.capture(entry.partition, entry.jarKey).catch(() => undefined)

    entry.requests.forEach((request) => request.abort.abort())
    entry.requests.clear()
    const suspended = reason === "browser.pane.suspended"

    if (suspended) publishState(entry, reason)
    entry.pages.forEach((page) => void release(page).catch(() => undefined))
    entry.pages.clear()
    entry.tabs.clear()
    entry.focusedTabID = null

    if (!suspended) publishState(entry, reason)
    entries.delete(entry.binding)
    entry.registered.reject(new Error("browser.pane.registration.closed"))
    entry.cleanup?.()
    entry.abort.abort()
  }

  async function closePage(entry: Entry, tabID: Browser.TabID, error?: string) {
    const page = entry.pages.get(tabID)

    if (!entry.tabs.has(tabID))
      throw new Error(
        "This tab is no longer available. Call browser.tabs.list({}) and use an existing tabID from this session.",
      )
    const focused = entry.focusedTabID === tabID
    entry.requests.forEach((request) => {
      if (request.tabID === tabID) request.abort.abort()
    })
    entry.pages.delete(tabID)
    entry.tabs.delete(tabID)

    if (focused) entry.focusedTabID = entry.tabs.keys().next().value ?? null

    if (page) await release(page)
    publishState(entry, error)
  }

  function release(page: BrowserPage) {
    const done = page.dispose()
    const settled = done.catch(() => undefined)
    releasing.add(settled)
    void settled.finally(() => releasing.delete(settled))

    return done
  }

  function publishState(entry: Entry, error?: string) {
    const current = { type: "state" as const, state: inventory(entry) }
    const event = error === undefined ? current : { ...current, error }

    // Teardown publishes an empty inventory to the renderer, but the saved URLs survive app exit.
    if (entry.report)
      restore.save(entry.storageKey, {
        tabs: event.state.tabs.map((tab) => ({
          id: tab.id,
          // A restored page can publish before Chromium assigns its URL.
          url: tab.url || entry.tabs.get(tab.id)?.url || "about:blank",
        })),
        focusedTabID: entry.focusedTabID,
      })
    const next = JSON.stringify(event)

    if (entry.lastState === next) return
    entry.lastState = next
    report(entry, event)
  }

  function report(entry: Entry, event: PaneEvent) {
    if (entry.report) return entry.report(event)
    publish(entry, event)
  }

  function inventory(entry: Entry): Browser.State {
    return {
      tabs: Array.from(entry.tabs, ([id, tab]) => entry.pages.get(id)?.state() ?? tab),
      focusedTabID: entry.focusedTabID,
    }
  }

  function load(entry: Entry, tabID: Browser.TabID) {
    const page = entry.pages.get(tabID)

    if (page) return page
    const tab = entry.tabs.get(tabID)

    return tab ? create(entry, true, undefined, tab) : undefined
  }

  function create(
    entry: Entry,
    initialize = true,
    popupOptions?: Electron.BrowserWindowConstructorOptions,
    restore?: Browser.Tab,
  ) {
    if (!entry.network) throw new Error("Browser network is not ready; no tab was opened.")
    const id = restore?.id ?? Browser.TabID.make(`tab_${crypto.randomUUID()}`)
    // Read once: the workspace a pane was attached to does not change under its tabs.
    const jarKey = entry.jarKey

    const fail = () => {
      if (entry.pages.has(id)) void closePage(entry, id, "page_crashed").catch(() => undefined)
    }

    const page = createBrowserPage(entry.win, {
      id,
      partition: entry.partition,
      network: entry.network,
      initialize,
      restore,
      popupOptions,
      fileRoots: () => entry.fileRoots,
      systemProxy: entry.local,
      // Same workspace key as the cookie jar: signing in once in a project carries to its other sessions.
      ...(jarKey
        ? {
            localStorage: {
              load: (origin: string) => originStorage.load(jarKey, origin),
              save: (origin: string, entries: Readonly<Record<string, string>>) =>
                originStorage.save(jarKey, origin, entries),
            },
            // SiCode: a tab opened right after a sync gets the pasted values over its partition's leftovers. Taken once,
            // and only while the store still holds what the paste wrote: once the site (or another tab) has saved a newer
            // login, replaying this snapshot over it would sign the user back out.
            takePendingStorage: (origin: string) => {
              const pending = entry.pendingStorage

              if (pending?.origin !== origin) return
              entry.pendingStorage = undefined
              const current = originStorage.load(jarKey, origin)

              return current && sameEntries(current, pending.entries) ? pending.source : undefined
            },
          }
        : undefined),
      shared,
      embeds: input.embeds,
      fail,
      publish: (error) => {
        if (entry.pages.has(id)) publishState(entry, error)
      },
      inspect: (event) => {
        if (entry.pages.has(id)) report(entry, { type: "inspect", tabID: id, ...event })
      },
      // Icons and zoom are local to this desktop, but wait behind the states reported before them, so the window files
      // a new page's icon under that page's URL.
      detail: (value) => {
        if (entry.pages.has(id)) report(entry, { type: "page", tabID: id, ...value })
      },
      zoomed: () => entry.pages.forEach((page) => page.detail()),
      address: () => {
        if (!entry.pages.has(id) || entry.win.isDestroyed()) return
        // The page held keyboard focus; the app's address field needs it back.
        entry.win.webContents.focus()
        publish(entry, { type: "address", tabID: id })
      },
      popup: (popupOptions, background) => {
        const popup = create(entry, false, popupOptions)

        if (!background) focus(entry, popup.state().id)

        return popup.contents
      },
    })

    entry.pages.set(id, page)
    entry.tabs.set(id, restore ?? page.state())
    // Straight to the window, not through the server report: the embed is local to this desktop.
    publish(entry, { type: "embed", tabID: id, embed: page.embed })
    void page.ready
      .then(() => {
        if (entry.pages.get(id) === page) publishState(entry)
      })
      .catch(fail)

    return page
  }

  async function execute(entry: Entry, command: Browser.Command, signal: AbortSignal) {
    const action = command.action

    if (signal.aborted)
      throw new Error(
        "Browser request was cancelled. Do not repeat a mutating action until you have inspected its outcome.",
      )

    if (action.type === "tabs.list") return { value: inventory(entry), files: [] }

    if (action.type === "preview") {
      // The renderer owns file tabs; it resolves the path against the session's workspace.
      report(entry, { type: "preview", path: action.path })

      return { value: { path: action.path }, files: [] }
    }

    if (action.type === "tabs.open") {
      const page = create(entry)

      if (action.focus !== false) focus(entry, page.state().id)
      await page.ready
      await page.execute(
        { action: { type: "navigate", tabID: page.state().id, url: action.url ?? "about:blank" }, files: [] },
        signal,
      )
      publishState(entry)

      return { value: page.state(), files: [] }
    }

    const tab = inventory(entry).tabs.find((tab) => tab.id === action.tabID)

    if (!tab)
      throw new Error(
        "Browser tab is unavailable. Call browser.tabs.list({}) and use an existing tabID from this session; a closed tab is not replaced automatically.",
      )

    if (action.type === "tabs.focus") {
      focus(entry, action.tabID)

      return { value: tab, files: [] }
    }

    if (action.type === "tabs.close") {
      await closePage(entry, action.tabID)

      return { value: inventory(entry), files: [] }
    }

    const page = entry.pages.get(action.tabID) ?? create(entry, true, undefined, tab)
    await page.ready
    const result = await page.execute(command, signal)
    publishState(entry)

    return result
  }

  function focus(entry: Entry, tabID: Browser.TabID) {
    entry.focusedTabID = tabID
    publishState(entry)
    report(entry, { type: "focus", tabID })
  }
}
