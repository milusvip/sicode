import { Schema } from "effect"
import { Ipc } from "../sdk"

/** Mounted session (`ses…`) or new-session draft sticky (`draft:<id>`). */
const PreferKey = Schema.Union([
  Schema.String.check(Schema.isStartingWith("ses")),
  Schema.String.check(Schema.isStartingWith("draft:")),
])

export const ChromeBridgeStatus = Schema.Struct({
  enabled: Schema.Boolean,
  running: Schema.Boolean,
  port: Schema.Number,
  token: Schema.String,
  connected: Schema.Boolean,
  /** Default when a conversation has no sticky yet (always true: follow system while connected). */
  defaultSystem: Schema.Boolean,
  /** Effective sticky for the queried conversation (or the default when session omitted). */
  preferSystem: Schema.Boolean,
  /** Agent uses system Chrome: connected and this conversation's sticky prefers system. */
  owningAttach: Schema.Boolean,
  /**
   * Extension has connected at least once in this app profile.
   * Used as "likely installed" — Chromium does not expose a real install query to the desktop host.
   */
  everConnected: Schema.Boolean,
  extensionPath: Schema.String,
  /** Version inside the packed SiCode-Browser-Bridge.crx / materialized manifest. */
  packageVersion: Schema.String,
  /**
   * Empty when the loopback server is fine. `port_in_use:<port>` when another SiCode (often `bun dev`)
   * already owns the port — Settings must not keep saying “waiting for extension”.
   */
  listenError: Schema.String,
})

/** Desktop loopback bridge for the system Chrome MV3 extension. */
export const ChromeBridge = Ipc.define({
  id: "browser.chromeBridge",
  methods: {
    /** Bridge + per-conversation sticky. Omit session → prefer/owning use the default. */
    status: {
      input: Schema.Struct({ session: Schema.optionalKey(PreferKey) }),
      output: ChromeBridgeStatus,
    },
    /** Enable/disable the loopback host. When enabling, mints a token if empty. */
    setEnabled: { input: Schema.Boolean, output: ChromeBridgeStatus },
    /**
     * Sticky Agent backend for one conversation (like cross-project focus):
     * true → system while connected; false → in-app pane. Set by push / 内置加入对话.
     */
    setPreferSystem: {
      input: Schema.Struct({ prefer: Schema.Boolean, session: PreferKey }),
      output: ChromeBridgeStatus,
    },
    /** Internal store rotate (not shown in the simple UI). */
    rotateToken: { output: ChromeBridgeStatus },
    setPort: { input: Schema.Number, output: ChromeBridgeStatus },
    /** MVP probe: ask the connected extension for chrome.tabs.query. */
    listTabs: {
      output: Schema.Struct({
        tabs: Schema.Array(
          Schema.Struct({
            id: Schema.String,
            chromeTabId: Schema.Number,
            url: Schema.String,
            title: Schema.String,
            active: Schema.Boolean,
            windowId: Schema.Number,
          }),
        ),
        focusedTabID: Schema.NullOr(Schema.String),
      }),
    },
    /** List Chromium-family browsers that can Load unpacked (Chrome / Cent / Edge / …). */
    listBrowsers: {
      output: Schema.Struct({
        browsers: Schema.Array(
          Schema.Struct({
            id: Schema.String,
            name: Schema.String,
            path: Schema.String,
          }),
        ),
      }),
    },
    /** Manual fallback: file picker for a browser .exe. */
    pickBrowser: {
      output: Schema.NullOr(
        Schema.Struct({
          id: Schema.String,
          name: Schema.String,
          path: Schema.String,
        }),
      ),
    },
    /** Open the chosen browser's extensions page and reveal the unpacked folder. */
    openInstall: {
      input: Schema.Struct({
        /** Absolute path or id from listBrowsers. Omit when only one browser is installed. */
        browserPath: Schema.optional(Schema.String),
      }),
      output: Schema.Struct({
        ok: Schema.Boolean,
        chromePath: Schema.NullOr(Schema.String),
        browserName: Schema.NullOr(Schema.String),
        extensionPath: Schema.String,
        detected: Schema.Array(
          Schema.Struct({
            id: Schema.String,
            name: Schema.String,
            path: Schema.String,
          }),
        ),
        actions: Schema.Array(Schema.String),
        message: Schema.String,
      }),
    },
    /** Force session browser attachments to re-register (pane ↔ system Chrome). */
    reattach: { output: ChromeBridgeStatus },
    /** Domains Agent cannot remotely control (root host; subdomains included). */
    blockedDomains: {
      output: Schema.Struct({ domains: Schema.Array(Schema.String) }),
    },
    setBlockedDomains: {
      input: Schema.Struct({ domains: Schema.Array(Schema.String) }),
      output: Schema.Struct({ domains: Schema.Array(Schema.String) }),
    },
    /** Launch Chromium so the extension service worker can reconnect (no install dialog). */
    wakeBrowser: {
      input: Schema.Struct({
        browserPath: Schema.optional(Schema.String),
      }),
      output: Schema.Struct({
        ok: Schema.Boolean,
        chromePath: Schema.NullOr(Schema.String),
        browserName: Schema.NullOr(Schema.String),
        message: Schema.String,
      }),
    },
  },
  events: {
    /** Fired when the extension connects or disconnects (and when owningAttach may flip). */
    connection: Schema.Struct({
      connected: Schema.Boolean,
      enabled: Schema.Boolean,
      /** Owning for `session` when set; otherwise a bridge-level flip (re-query per session). */
      owningAttach: Schema.Boolean,
      /** When set, only this conversation's prefer / attach ownership changed. */
      session: Schema.optionalKey(PreferKey),
      /** When true, renderer re-registers even if owningAttach did not change. */
      force: Schema.optional(Schema.Boolean),
    }),
    /** Extension popup / context menu sent a page into the Composer. */
    tabOffer: Schema.Struct({
      tab: Schema.Struct({
        id: Schema.String,
        chromeTabId: Schema.Number,
        url: Schema.String,
        title: Schema.String,
        active: Schema.Boolean,
        windowId: Schema.Number,
      }),
    }),
    /** Extension picker sent one or more page elements into the Composer. */
    elementOffer: Schema.Struct({
      tab: Schema.Struct({
        id: Schema.String,
        chromeTabId: Schema.Number,
        url: Schema.String,
        title: Schema.String,
        active: Schema.Boolean,
        windowId: Schema.Number,
      }),
      element: Schema.Struct({
        selector: Schema.String,
        label: Schema.String,
        role: Schema.optionalKey(Schema.String),
        name: Schema.optionalKey(Schema.String),
        text: Schema.optionalKey(Schema.String),
      }),
      elements: Schema.Array(
        Schema.Struct({
          selector: Schema.String,
          label: Schema.String,
          role: Schema.optionalKey(Schema.String),
          name: Schema.optionalKey(Schema.String),
          text: Schema.optionalKey(Schema.String),
        }),
      ),
      comment: Schema.optionalKey(Schema.String),
    }),
  },
})

export {
  CHROME_BRIDGE_DEFAULT_PORT,
  CHROME_BRIDGE_BETA_PORT,
  CHROME_BRIDGE_DEV_PORT,
  CHROME_BRIDGE_DISCOVERY_PORTS,
  chromeBridgeDefaultPort,
  migrateChromeBridgePort,
  formatChromeBridgeListenError,
} from "./chrome/protocol"
