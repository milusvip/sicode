import { Schema } from "effect"
import { Extension, Ipc, Store } from "../sdk"
import { SEARCH_ENGINES } from "./address"
import { Browser } from "./contract"
import { ChromeBridge, CHROME_BRIDGE_DEFAULT_PORT } from "./chrome-bridge"
import { History } from "./history"
import en from "./i18n/en"
import type { BrowserPane } from "./ipc"

// The pane's Ipc, which the main entry provides and the renderer's model reads as `ctx.uses.pane` once a session
// opens. A reference, so its protocol schemas load with the model instead of at startup.
const Pane = Ipc.ref<typeof BrowserPane>("browser.pane")

export default Extension.define({
  id: "browser",
  provides: { browser: Browser, pane: Pane, chromeBridge: ChromeBridge },
  stores: {
    // The end of the last block of element refs main reserved, so refs stay unique across reloads.
    refs: Store.main(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)), 0),
    // SiCode: system-Chrome bridge. Off by default; the token is minted when first enabled.
    chromeBridgeEnabled: Store.main(Schema.Boolean, false),
    chromeBridgeToken: Store.main(Schema.String, ""),
    chromeBridgePort: Store.main(Schema.Number, CHROME_BRIDGE_DEFAULT_PORT),
    /** True after the extension has successfully hello'd at least once (proxy for "installed"). */
    chromeBridgeEverConnected: Store.main(Schema.Boolean, false),
    /**
     * Per-conversation sticky: `ses…` / `draft:<id>` → true=system, false=in-app pane.
     * Set by extension push (true) or in-app「加入对话」(false). Absent → default system.
     */
    chromeBridgePreferSystem: Store.main(Schema.Record(Schema.String, Schema.Boolean), {}),
    /**
     * Root domains Agent must not remotely control (http/https host or subdomain match).
     * Applies to the system-Chrome agent channel; edited in Settings → Browser.
     */
    chromeBridgeBlockedDomains: Store.main(Schema.Array(Schema.String), []),
    // Pages the browser showed, for the new tab page and the address field's suggestions. One list for every
    // session and server, kept on this device.
    history: Store.global(History, { visits: [] }),
    // The engine the address field searches with. A stored id this build does not know falls back to the first
    // engine, so an older or newer value never fails the extension's setup.
    search: Store.global(Schema.Struct({ engine: Schema.String }), { engine: SEARCH_ENGINES[0].id }),
  },
  i18n: {
    en,
    am: () => import("./i18n/am"),
    ar: () => import("./i18n/ar"),
    az: () => import("./i18n/az"),
    bg: () => import("./i18n/bg"),
    bn: () => import("./i18n/bn"),
    br: () => import("./i18n/br"),
    bs: () => import("./i18n/bs"),
    ca: () => import("./i18n/ca"),
    cs: () => import("./i18n/cs"),
    da: () => import("./i18n/da"),
    de: () => import("./i18n/de"),
    dv: () => import("./i18n/dv"),
    dz: () => import("./i18n/dz"),
    el: () => import("./i18n/el"),
    es: () => import("./i18n/es"),
    et: () => import("./i18n/et"),
    fa: () => import("./i18n/fa"),
    fi: () => import("./i18n/fi"),
    fo: () => import("./i18n/fo"),
    fr: () => import("./i18n/fr"),
    he: () => import("./i18n/he"),
    hi: () => import("./i18n/hi"),
    hr: () => import("./i18n/hr"),
    hu: () => import("./i18n/hu"),
    hy: () => import("./i18n/hy"),
    id: () => import("./i18n/id"),
    is: () => import("./i18n/is"),
    it: () => import("./i18n/it"),
    ja: () => import("./i18n/ja"),
    ka: () => import("./i18n/ka"),
    km: () => import("./i18n/km"),
    ko: () => import("./i18n/ko"),
    lo: () => import("./i18n/lo"),
    lt: () => import("./i18n/lt"),
    lv: () => import("./i18n/lv"),
    mk: () => import("./i18n/mk"),
    mn: () => import("./i18n/mn"),
    ms: () => import("./i18n/ms"),
    my: () => import("./i18n/my"),
    ne: () => import("./i18n/ne"),
    nl: () => import("./i18n/nl"),
    no: () => import("./i18n/no"),
    pa: () => import("./i18n/pa"),
    pl: () => import("./i18n/pl"),
    ro: () => import("./i18n/ro"),
    ru: () => import("./i18n/ru"),
    si: () => import("./i18n/si"),
    sk: () => import("./i18n/sk"),
    sl: () => import("./i18n/sl"),
    sq: () => import("./i18n/sq"),
    sr: () => import("./i18n/sr"),
    sv: () => import("./i18n/sv"),
    tg: () => import("./i18n/tg"),
    th: () => import("./i18n/th"),
    tk: () => import("./i18n/tk"),
    tr: () => import("./i18n/tr"),
    uk: () => import("./i18n/uk"),
    ur: () => import("./i18n/ur"),
    uz: () => import("./i18n/uz"),
    vi: () => import("./i18n/vi"),
    zh: () => import("./i18n/zh"),
    zht: () => import("./i18n/zht"),
  },
})
