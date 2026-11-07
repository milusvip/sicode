import { describe, expect, test } from "bun:test"
import type { SessionMessage } from "../src/session/message.js"
import { browserDriveIdleFingerprint } from "../src/session/runner/browser-drive-gate.js"
import { BROWSER_TABS_KEY } from "../src/session/browser-tools.js"

const user = (text: string, id = "u1") =>
  ({
    id,
    type: "user",
    text,
    time: { created: 0 },
    files: [],
    agents: [],
    skills: [],
  }) as unknown as SessionMessage.Info

const assistant = (
  id: string,
  parts: ReadonlyArray<{ type: "text"; text: string } | { type: "tool"; id: string; name: string; state: object }>,
) => ({ id, type: "assistant", time: { created: 0 }, content: parts }) as unknown as SessionMessage.Info

const driveTools = ["browser_click", "browser_snapshot", "browser_tabs_list"]

const openTabs = {
  [BROWSER_TABS_KEY]: {
    access: "full",
    focusedTabID: "tab_1",
    tabs: [{ id: "tab_1", title: "Goofish", url: "https://www.goofish.com/publish" }],
  },
}

describe("browserDriveIdleFingerprint", () => {
  test("fires when open tabs exist and the turn used zero browser tools", () => {
    const messages = [
      user("say something", "msg_user"),
      assistant("msg_a", [{ type: "text", text: "Stopped without calling browser tools." }]),
    ]
    expect(browserDriveIdleFingerprint(messages, driveTools, openTabs)).toBe("msg_user")
  })

  test("does not require a publish phrase on the user message", () => {
    const messages = [user("hello"), assistant("a", [{ type: "text", text: "hi" }])]
    expect(browserDriveIdleFingerprint(messages, driveTools, openTabs)).toBe("u1")
  })

  test("does not fire on plain prompts when no tabs are mirrored", () => {
    const messages = [user("help me publish"), assistant("a", [{ type: "text", text: "ok" }])]
    expect(browserDriveIdleFingerprint(messages, driveTools, {})).toBeUndefined()
    expect(browserDriveIdleFingerprint(messages, driveTools)).toBeUndefined()
  })

  test("fires from a browser element note even when tabs are not mirrored", () => {
    const note =
      'The user made the following comment regarding the "Publish" element in browser tab tab_abc at https://www.goofish.com/publish (browser ref @e12, usable as ref in any browser tool including browser.evaluate until the page navigates): click here'
    const messages = [user(note, "msg_note"), assistant("a", [{ type: "text", text: "No browser tools called." }])]
    expect(browserDriveIdleFingerprint(messages, driveTools, {})).toBe("msg_note")
  })

  test("does not fire after any browser tool call", () => {
    const messages = [
      user("hello"),
      assistant("a", [
        { type: "text", text: "Listing tabs" },
        { type: "tool", id: "t1", name: "browser_tabs_list", state: { status: "completed" } },
      ]),
    ]
    expect(browserDriveIdleFingerprint(messages, driveTools, openTabs)).toBeUndefined()
  })

  test("look/log follow-up after an earlier page note still gates", () => {
    const page =
      'Can you drive the system browser?\nThe user made the following comment regarding browser page at https://example.com/admin/events titled "event log": https://example.com/admin/events'
    const inspectOnly = ["browser_snapshot", "browser_tabs_list"]
    const messages = [
      user(page, "msg_page"),
      assistant("a0", [{ type: "text", text: "Yes — the side browser can drive it." }]),
      user("check the log", "msg_log"),
      assistant("a1", [{ type: "text", text: "No event in the local API log — which source?" }]),
    ]
    expect(browserDriveIdleFingerprint(messages, inspectOnly, {})).toBe("msg_log")
    expect(browserDriveIdleFingerprint(messages, driveTools, {})).toBe("msg_log")
  })

  test("inspect tools are enough to look; bare screenshot is not", () => {
    const messages = [user("hello"), assistant("a", [{ type: "text", text: "hi" }])]
    expect(
      browserDriveIdleFingerprint(messages, ["browser_snapshot", "browser_tabs_list"], openTabs),
    ).toBe("u1")
    expect(
      browserDriveIdleFingerprint(messages, ["browser_screenshot", "browser_tabs_list"], openTabs),
    ).toBeUndefined()
  })
})
