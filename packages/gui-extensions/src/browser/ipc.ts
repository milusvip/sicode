import { Browser } from "@opencode/plugin-browser/rpc"
import { Schema } from "effect"
import { Ipc } from "../sdk"
import { MAX_COOKIE_TEXT } from "./cookies"

const text = (maximum: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(maximum))

const detail = (maximum: number) => Schema.String.check(Schema.isMaxLength(maximum))

const binding = text(128)

/** The longest page icon data URL main reports: a 32px PNG is a few kilobytes; larger icons are dropped. */
export const MAX_ICON_URL = 24_576

/** An element the user picked in the page. The ref stays valid for browser tools until the page navigates. */
export const PaneElement = Schema.Struct({
  ref: Browser.Ref,
  selector: detail(2_048),
  label: detail(512),
  role: Schema.optionalKey(detail(128)),
  name: Schema.optionalKey(detail(512)),
  text: Schema.optionalKey(detail(512)),
  /** Border box in the native view's DIPs. */
  rect: Schema.Struct({ x: Schema.Finite, y: Schema.Finite, width: Schema.Finite, height: Schema.Finite }),
})

export type PaneElement = typeof PaneElement.Type

export const PaneEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("focus"), tabID: Browser.TabID }),
  Schema.Struct({ type: Schema.Literal("preview"), path: text(2_048) }),
  Schema.Struct({
    type: Schema.Literal("state"),
    state: Schema.NullOr(Browser.State),
    error: Schema.optionalKey(Schema.String),
  }),
  // A tab's page exists; the renderer lays it out through this host embed.
  Schema.Struct({ type: Schema.Literal("embed"), tabID: Browser.TabID, embed: text(256) }),
  // The page's element picker started, stopped, or picked an element.
  Schema.Struct({
    type: Schema.Literal("inspect"),
    tabID: Browser.TabID,
    active: Schema.Boolean,
    element: Schema.optionalKey(PaneElement),
  }),
  // Details only this desktop shows, kept out of the server's tab state: the page's icon as a data URL, its zoom
  // factor (1 at 100%), and whether TLS was accepted after Chromium rejected the certificate.
  Schema.Struct({
    type: Schema.Literal("page"),
    tabID: Browser.TabID,
    icon: Schema.optionalKey(detail(MAX_ICON_URL).check(Schema.isStartingWith("data:image/"))),
    zoom: Schema.Finite.check(Schema.isBetween({ minimum: 0.25, maximum: 5 })),
    certificateWarning: Schema.optionalKey(Schema.Boolean),
  }),
  // The page asked for the address field, with the platform's address shortcut.
  Schema.Struct({ type: Schema.Literal("address"), tabID: Browser.TabID }),
])

export type PaneEvent = typeof PaneEvent.Type

/**
 * The native browser pane in the main process. A binding is one registration of a session's pane
 * by a window; its events go to that window only.
 */
export const BrowserPane = Ipc.define({
  id: "browser.pane",
  methods: {
    register: {
      input: Schema.Struct({
        binding,
        server: text(16_384),
        session: text(256).check(Schema.isStartingWith("ses")),
        restore: Schema.optionalKey(Browser.State),
        // Omitted → read. Renderer keeps this across suspend/reopen for the same session connection.
        access: Schema.optionalKey(Schema.Literals(["full", "read"])),
      }),
    },
    // Creates the page of a restored tab the first time the pane shows it.
    load: { input: Schema.Struct({ binding, tabID: Browser.TabID }) },
    command: { input: Schema.Struct({ binding, command: Browser.Action }) },
    // Starts or stops the page's element picker; the page reports picks and exits as inspect events.
    inspect: { input: Schema.Struct({ binding, tabID: Browser.TabID, enabled: Schema.Boolean }) },
    // Highlights a picked element briefly, or clears any highlight when ref is omitted.
    highlight: { input: Schema.Struct({ binding, tabID: Browser.TabID, ref: Schema.optionalKey(Browser.Ref) }) },
    // Zooms the page one step in or out, or back to 100%; the page reports its new zoom as a page event.
    zoom: {
      input: Schema.Struct({ binding, tabID: Browser.TabID, zoom: Schema.Literals(["in", "out", "reset"]) }),
    },
    // The site data the page's address can read in this desktop's browser: its cookie count. Zero for a page that is
    // not a web page.
    site: {
      input: Schema.Struct({ binding, tabID: Browser.TabID }),
      output: Schema.Struct({ cookies: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)) }),
    },
    // Deletes the cookies the page's address can read and its origin's stored data, then reloads the page.
    clearSite: { input: Schema.Struct({ binding, tabID: Browser.TabID }) },
    // Agent browser access for this attachment: read (observe/navigate) or full (also click/fill/evaluate).
    // locked.write means config denied write — the panel switch must stay off and disabled.
    access: {
      input: Schema.Struct({ binding }),
      output: Schema.Struct({
        access: Schema.Literals(["full", "read"]),
        locked: Schema.Struct({ read: Schema.Boolean, write: Schema.Boolean }),
      }),
    },
    // Recompute server permissions in place; does not reload pages or rebuild the attachment.
    setAccess: {
      input: Schema.Struct({ binding, access: Schema.Literals(["full", "read"]) }),
      output: Schema.Struct({
        access: Schema.Literals(["full", "read"]),
        locked: Schema.Struct({ read: Schema.Boolean, write: Schema.Boolean }),
      }),
    },
    // Writes pasted login cookies for the page's own site, then reloads it so the site sees them. Resolves with the
    // number of cookies written and the best-effort login-state read; a paste for another site, or one Chromium
    // rejects, fails with the reason.
    setCookies: {
      input: Schema.Struct({ binding, tabID: Browser.TabID, text: text(MAX_COOKIE_TEXT) }),
      output: Schema.Struct({
        cookies: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
        login: Schema.Struct({
          state: Schema.Literals(["likely", "unclear", "unlikely"]),
          kept: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
          pasted: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
        }),
      }),
    },
    close: { input: Schema.Struct({ binding }) },
  },
  events: {
    event: Schema.Struct({ binding: Schema.String, event: PaneEvent }),
  },
})
