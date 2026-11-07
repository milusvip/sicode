import { Contract, type SessionRef } from "../sdk"

export interface Browser {
  /** The desktop browser pane exists for this session (the session is attached to a pane). */
  attached(session: SessionRef): boolean
  /** A workspace file (relative path) or http(s) URL can open in the pane for this session. */
  canOpen(session: SessionRef, path?: string): boolean
  /** Opens a URL (http(s) or file://) as a browser tab in the session's side panel. */
  open(session: SessionRef, url: string): void
  /**
   * Opens a workspace file (relative path) as a file:// browser tab. Check `canOpen(session, path)` first.
   * `select` also brings the pane forward with the new tab selected once the desktop reports it —
   * without it the tab quietly joins the strip, as the agent's own `tabs.open` does.
   */
  openFile(session: SessionRef, path: string, options?: { select?: boolean }): void
  /**
   * SiCode: reconnect the agent browser channel for this session so tools and tab inventory are
   * live again after idle eviction — call when the user picks an element or sends a browser note.
   */
  wake(session: SessionRef): void
  /**
   * SiCode: wake (and for system-Chrome push tabs, stick + pin) then wait until the agent RPC
   * attachment is bound. Call from prepareSend so the first browser.* tool is not disconnected.
   */
  ensure(session: SessionRef, options?: { chromeTabIDs?: readonly string[] }): Promise<void>
}

/** The browser extension provides this on desktop. Inactive on web or while the extension is off. */
export const Browser = Contract.define<Browser, "browser">("browser")
