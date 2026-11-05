import type { MainSetup } from "../sdk/main"
import type definition from "./index"
import type { Pane } from "./pane"
import type { ChromeAttachment } from "./chrome/attachment"
import { ChromeBridge } from "./chrome-bridge"
import { createChromeBridgeHost } from "./chrome/host"
import {
  listChromiumBrowsers,
  openChromeExtensionInstall,
  pickChromiumBrowser,
  wakeChromiumBrowser,
} from "./chrome/install"
import { migrateChromeBridgePort } from "./chrome/protocol"
import { effectivePreferSystem } from "./prefer-system"
import { BrowserPane, type PaneEvent } from "./ipc"

/** The pane once a window first registered one. */
type LoadedPane = { pane?: Promise<Pane>; chrome?: Promise<ChromeAttachment> }

type Backend = "chrome" | "pane"

type PaneEmit = (window: number, value: { readonly binding: string; readonly event: PaneEvent }) => void

const setup: MainSetup<typeof definition> = (ctx) => {
  const loaded: LoadedPane = {}
  const backends = new Map<string, Backend>()
  // Sink breaks the load→provider circular inference that collapses provide()'s Ipc generic.
  let paneEmit: PaneEmit = () => undefined

  // SiCode: system-Chrome loopback bridge. Prod owns 17891; unpackaged / dev / beta use
  // other ports so `bun dev` cannot steal the extension's push connection.
  const bridgePort = migrateChromeBridgePort({
    stored: ctx.stores.chromeBridgePort.value,
    channel: ctx.build.channel,
    packaged: ctx.build.packaged,
  })
  if (bridgePort !== ctx.stores.chromeBridgePort.value) ctx.stores.chromeBridgePort.set(bridgePort)
  const chromeHost = createChromeBridgeHost(
    {
      enabled: ctx.stores.chromeBridgeEnabled,
      token: ctx.stores.chromeBridgeToken,
      port: ctx.stores.chromeBridgePort,
    },
    { channel: ctx.build.channel },
  )

  const preferOf = (session?: string) =>
    effectivePreferSystem({
      session,
      globalDefault: true,
      map: ctx.stores.chromeBridgePreferSystem.value,
    })

  const bridgeStatus = (session?: string) => {
    const status = chromeHost.status()
    const prefer = preferOf(session)
    const owning = status.enabled && status.connected && prefer
    return {
      ...status,
      defaultSystem: true,
      preferSystem: prefer,
      owningAttach: owning,
      everConnected: ctx.stores.chromeBridgeEverConnected.value,
    }
  }

  const blockedDomains = () => ctx.stores.chromeBridgeBlockedDomains.value

  const owningFor = (session: string) => {
    const status = chromeHost.status()
    return status.enabled && status.connected && preferOf(session)
  }

  // The pane brings the CDP driver and the full RPC client with every protocol schema;
  // load it when a window first registers a pane instead of at startup.
  const load = () =>
    (loaded.pane ??= import("./pane").then((module) =>
      module.createBrowserPane({
        windows: ctx.windows,
        serverEndpoints: ctx.serverEndpoints,
        storage: ctx.storage,
        refs: ctx.stores.refs,
        embeds: ctx.embeds,
        emit: (window, value) => paneEmit(window, value),
      }),
    ))

  // SiCode: system Chrome RPC attach — same BrowserPane binding surface when preferSystem owns the session.
  const loadChrome = () =>
    (loaded.chrome ??= import("./chrome/attachment").then((module) =>
      module.createChromeAttachment({
        serverEndpoints: ctx.serverEndpoints,
        host: chromeHost,
        blockedDomains,
        emit: (window, value) => paneEmit(window, value),
      }),
    ))

  // Every other call names a binding, and bindings exist only after a register loaded the pane.
  const existing = () => loaded.pane ?? Promise.reject(new Error("browser.pane.unavailable"))

  // Filled after ChromeBridge is provided — prefer/bridge flips need its emit.
  let emitConnection: (force?: boolean) => void = () => undefined

  const provider = ctx.provide(BrowserPane, {
    register: async (input, caller) => {
      if (owningFor(input.session)) {
        backends.set(input.binding, "chrome")
        return (await loadChrome()).register(caller.window, input.binding, input)
      }
      backends.set(input.binding, "pane")
      return (await load()).register(caller.window, input.binding, input)
    },
    load: async (input, caller) => {
      if (backends.get(input.binding) === "chrome") return
      return (await existing()).load(caller.window, input.binding, input.tabID)
    },
    command: async (input, caller) => {
      if (backends.get(input.binding) === "chrome") {
        return (await loadChrome()).command(caller.window, input.binding, input.command)
      }
      return (await existing()).command(caller.window, input.binding, input.command)
    },
    inspect: async (input, caller) => {
      if (backends.get(input.binding) === "chrome") return
      return (await existing()).inspect(caller.window, input.binding, input.tabID, input.enabled)
    },
    highlight: async (input, caller) => {
      if (backends.get(input.binding) === "chrome") return
      return (await existing()).highlight(caller.window, input.binding, input.tabID, input.ref)
    },
    zoom: async (input, caller) => {
      if (backends.get(input.binding) === "chrome") return
      return (await existing()).zoom(caller.window, input.binding, input.tabID, input.zoom)
    },
    site: async (input, caller) => {
      if (backends.get(input.binding) === "chrome") return { cookies: 0 }
      return (await existing()).site(caller.window, input.binding, input.tabID)
    },
    clearSite: async (input, caller) => {
      if (backends.get(input.binding) === "chrome") return
      return (await existing()).clearSite(caller.window, input.binding, input.tabID)
    },
    access: async (input, caller) => {
      if (backends.get(input.binding) === "chrome") {
        return { access: "full" as const, locked: { read: false, write: false } }
      }
      return (await existing()).access(caller.window, input.binding)
    },
    setAccess: async (input, caller) => {
      if (backends.get(input.binding) === "chrome") {
        return { access: input.access, locked: { read: false, write: false } }
      }
      return (await existing()).setAccess(caller.window, input.binding, input.access)
    },
    setCookies: async (input, caller) => {
      if (backends.get(input.binding) === "chrome") {
        throw new Error("chrome.bridge.cookies_unsupported")
      }
      return (await existing()).setCookies(caller.window, input.binding, input.tabID, input.text)
    },
    setDomainCookies: async (input, caller) => {
      if (backends.get(input.binding) === "chrome") {
        throw new Error("chrome.bridge.cookies_unsupported")
      }
      return (await existing()).setDomainCookies(caller.window, input.binding, input.text)
    },
    close: async (input, caller) => {
      const backend = backends.get(input.binding)
      backends.delete(input.binding)
      if (backend === "chrome") {
        ;(await loadChrome()).close(input.binding)
        return
      }
      return (await existing()).close(caller.window, input.binding)
    },
  })

  paneEmit = (window, value) => provider.emit("event", value, window)

  const chromeProvider = ctx.provide(ChromeBridge, {
    status: async (input) => {
      // Settings polls this — retry bind when another SiCode released the port.
      const current = chromeHost.status()
      if (current.enabled && !current.running) {
        await chromeHost.setEnabled(true)
      }
      return bridgeStatus(input.session)
    },
    setEnabled: async (enabled) => {
      await chromeHost.setEnabled(enabled)
      return bridgeStatus()
    },
    setPreferSystem: async (input) => {
      ctx.stores.chromeBridgePreferSystem.update((draft) => {
        draft[input.session] = input.prefer
      })
      // Flip may need the live session to drop the other backend and re-register.
      emitConnection(true)
      return bridgeStatus(input.session)
    },
    pinWorkingTab: async (input) => {
      // Prefer may already be true from push; pin before/after register — attachment queues if needed.
      ;(await loadChrome()).pinWorkingTab(input.session, input.tabID)
    },
    rotateToken: async () => {
      await chromeHost.rotateToken()
      return bridgeStatus()
    },
    setPort: async (port) => {
      await chromeHost.setPort(port)
      return bridgeStatus()
    },
    listTabs: async () => chromeHost.listTabs(),
    listBrowsers: async () => ({ browsers: await listChromiumBrowsers() }),
    pickBrowser: async () => pickChromiumBrowser(),
    openInstall: async (input) => openChromeExtensionInstall(bridgeStatus().extensionPath, input.browserPath),
    wakeBrowser: async (input) => wakeChromiumBrowser(input.browserPath),
    reattach: async () => {
      emitConnection(true)
      return bridgeStatus()
    },
    blockedDomains: async () => ({ domains: [...blockedDomains()] }),
    setBlockedDomains: async (input) => {
      const { normalizeBlockedDomain } = await import("./chrome/blocked-domain")
      const next = [
        ...new Set(
          input.domains.flatMap((value) => {
            const domain = normalizeBlockedDomain(value)
            return domain ? [domain] : []
          }),
        ),
      ].sort()
      ctx.stores.chromeBridgeBlockedDomains.set(next)
      return { domains: next }
    },
  })

  emitConnection = (force = false) => {
    const next = bridgeStatus()
    chromeProvider.emit("connection", {
      connected: next.connected,
      enabled: next.enabled,
      owningAttach: next.owningAttach,
      ...(force ? { force: true } : {}),
    })
  }

  ctx.scope.addFinalizer(
    chromeHost.onConnectionChange(async (connected) => {
      if (connected) ctx.stores.chromeBridgeEverConnected.set(true)
      // Re-register UI panes so Agent chrome side channels start/stop with the bridge.
      emitConnection(true)
    }),
  )

  ctx.scope.addFinalizer(
    chromeHost.onCookieSync((event) => {
      chromeProvider.emit("cookieSync", { url: event.url, text: event.text })
      const window = ctx.windows.focused() ?? ctx.windows.list()[0]
      window?.focus()
    }),
  )

  ctx.scope.addFinalizer(
    chromeHost.onTabOffer((tab) => {
      chromeProvider.emit("tabOffer", { tab })
      const window = ctx.windows.focused() ?? ctx.windows.list()[0]
      window?.focus()
    }),
  )

  ctx.scope.addFinalizer(
    chromeHost.onElementOffer((offer) => {
      chromeProvider.emit("elementOffer", offer)
      const window = ctx.windows.focused() ?? ctx.windows.list()[0]
      window?.focus()
    }),
  )

  // The host withdraws the Ipc before this runs, so windows hear nothing; they suspend on the Ipc going away.
  ctx.scope.addFinalizer(async () => {
    await chromeHost.dispose()
    if (loaded.chrome) await (await loaded.chrome).dispose()
    if (loaded.pane) await (await loaded.pane).dispose()
  })
}

export default setup
