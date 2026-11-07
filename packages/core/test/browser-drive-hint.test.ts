import { describe, expect, test } from "bun:test"
import type { SessionMessage } from "../src/session/message.js"
import { canDrive, inject } from "../src/session/browser-drive-hint.js"
import { BROWSER_TABS_KEY, mentionsAttachedBrowser } from "../src/session/browser-tools.js"

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

const assistant = (id = "a1") =>
  ({ id, type: "assistant", time: { created: 0 }, content: [] }) as unknown as SessionMessage.Info

const driveTools = ["browser_click", "browser_snapshot", "browser_tabs_list"]

const openTabs = {
  [BROWSER_TABS_KEY]: {
    access: "full",
    focusedTabID: "tab_1",
    tabs: [{ id: "tab_1", title: "Goofish", url: "https://www.goofish.com/publish" }],
  },
}

const elementNote =
  'fix this\nThe user made the following comment regarding the "Publish" element in browser tab tab_abc at https://www.goofish.com/publish (browser ref @e12, usable as ref in any browser tool including browser.evaluate until the page navigates): click here'

describe("canDrive", () => {
  test("requires click plus a way to see the page, dotted or underscored", () => {
    expect(canDrive(driveTools)).toBe(true)
    expect(canDrive(["browser.click", "browser.tabs.list"])).toBe(true)
    expect(canDrive(["browser.snapshot", "browser.tabs.list"])).toBe(false)
    expect(canDrive([])).toBe(false)
  })
})

describe("mentionsAttachedBrowser", () => {
  test("recognizes in-app element and page note subjects", () => {
    expect(mentionsAttachedBrowser(elementNote)).toBe(true)
    expect(
      mentionsAttachedBrowser(
        'The user made the following comment regarding the page in browser tab tab_x at https://example.com titled "Home": look',
      ),
    ).toBe(true)
    expect(
      mentionsAttachedBrowser(
        'The user made the following comment regarding the "Save" element on the browser page at https://example.com: fix',
      ),
    ).toBe(true)
    expect(mentionsAttachedBrowser("tweak the sidebar styles")).toBe(false)
  })
})

describe("inject", () => {
  test("lists mirrored open tabs without matching user phrases", () => {
    const messages = inject({
      messages: [user("hello")],
      tools: driveTools,
      metadata: openTabs,
    })
    expect(messages).toHaveLength(2)
    const hint = messages[1]
    expect(hint?.type).toBe("synthetic")
    if (hint?.type !== "synthetic") return
    expect(hint.metadata?.notice).toBe("browser-drive-hint")
    expect(hint.text).toContain("<browser-tabs>")
    expect(hint.text).toContain("tab_1")
    expect(hint.text).toContain("goofish.com/publish")
    expect(hint.text).toContain("[focused]")
    expect(hint.text).toMatch(/Do not refuse/i)
    expect(hint.text).toMatch(/click \/ publish/i)
  })

  test("injects from a browser element note even when tabs are not mirrored yet", () => {
    const messages = inject({
      messages: [user(elementNote)],
      tools: driveTools,
      metadata: {},
    })
    expect(messages).toHaveLength(2)
    const hint = messages[1]
    expect(hint?.type).toBe("synthetic")
    if (hint?.type !== "synthetic") return
    expect(hint.metadata?.notice).toBe("browser-drive-hint")
    expect(hint.text).toContain("<browser-tabs>")
    expect(hint.text).toContain("tabs.list")
    expect(hint.text).toContain("Do not refuse")
  })

  test("skips plain prompts when no tabs are mirrored", () => {
    expect(inject({ messages: [user("help me publish")], tools: driveTools, metadata: {} })).toHaveLength(1)
  })

  test("inspect tools are enough when tabs are mirrored; bare screenshot is not", () => {
    expect(
      inject({
        messages: [user("hello")],
        tools: ["browser_snapshot", "browser_tabs_list"],
        metadata: openTabs,
      }),
    ).toHaveLength(2)
    expect(
      inject({
        messages: [user("hello")],
        tools: ["browser_screenshot", "browser_tabs_list"],
        metadata: openTabs,
      }),
    ).toHaveLength(1)
  })

  test("look/log follow-up after a page note injects do-not-ask", () => {
    const page =
      'Can you drive the system browser?\nThe user made the following comment regarding browser page at https://example.com/admin/events titled "event log": https://example.com/admin/events'
    const messages = inject({
      messages: [
        user(page, "u0"),
        assistant("a0"),
        user("check the log", "u1"),
      ],
      tools: ["browser_snapshot", "browser_tabs_list"],
      metadata: {},
    })
    expect(messages).toHaveLength(4)
    const hint = messages[3]
    expect(hint?.type).toBe("synthetic")
    if (hint?.type !== "synthetic") return
    expect(hint.text).toContain("example.com")
    expect(hint.text).toContain("Do not ask which log source")
    expect(hint.text).toContain("question tool")
  })

  test("skips when the turn already has an assistant reply", () => {
    expect(
      inject({
        messages: [user("hello"), assistant()],
        tools: driveTools,
        metadata: openTabs,
      }),
    ).toHaveLength(2)
  })

  test("honors the kill switch", () => {
    expect(
      inject({
        messages: [user("hello")],
        tools: driveTools,
        metadata: openTabs,
        enabled: false,
      }),
    ).toHaveLength(1)
  })
})
