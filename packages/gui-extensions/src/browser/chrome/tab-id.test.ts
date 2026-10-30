import { describe, expect, test } from "bun:test"
import { agentTabIDForChrome, chromeIdFromTabID } from "./tab-id"

describe("chrome tab id stability", () => {
  test("same chrome tab keeps the same agent tabID across reloads", () => {
    expect(agentTabIDForChrome(42)).toBe("tab_chrome_42")
    expect(agentTabIDForChrome(42)).toBe(agentTabIDForChrome(42))
  })

  test("accepts push chip and stable agent forms", () => {
    expect(chromeIdFromTabID("chrome_tab_9")).toBe(9)
    expect(chromeIdFromTabID("tab_chrome_9")).toBe(9)
    expect(chromeIdFromTabID("tab_065d02ca-7fbf-487d-8318-aaaaaaaaaaaa")).toBeUndefined()
  })
})
