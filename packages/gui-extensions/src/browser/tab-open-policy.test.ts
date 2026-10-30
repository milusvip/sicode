import { expect, test } from "bun:test"
import { canonicalizeBrowserURL, MAX_BROWSER_TABS, planTabsOpen } from "./tab-open-policy"

test("canonicalize strips hash, default port, and trailing slash", () => {
  expect(canonicalizeBrowserURL("https://Example.com:443/app/#x")).toBe("https://example.com/app")
  expect(canonicalizeBrowserURL("http://localhost:80/")).toBe("http://localhost/")
  expect(canonicalizeBrowserURL("about:blank")).toBe("about:blank")
  expect(canonicalizeBrowserURL("")).toBe("about:blank")
})

test("reuses the matching URL and closes blank extras", () => {
  const plan = planTabsOpen({
    tabs: [
      { id: "tab_a", url: "about:blank" },
      { id: "tab_b", url: "https://example.com/app/" },
      { id: "tab_c", url: "about:blank" },
    ],
    focusedTabID: "tab_a",
    url: "https://example.com/app#section",
  })

  expect(plan.reuseTabID).toBe("tab_b")
  expect(plan.closeTabIDs).toEqual(["tab_a", "tab_c"])
})

test("opening blank reuses an existing blank and closes the rest", () => {
  const plan = planTabsOpen({
    tabs: [
      { id: "tab_a", url: "https://example.com" },
      { id: "tab_b", url: "about:blank" },
      { id: "tab_c", url: "about:blank" },
    ],
    focusedTabID: "tab_a",
    url: "about:blank",
  })

  expect(plan.reuseTabID).toBe("tab_b")
  expect(plan.closeTabIDs).toEqual(["tab_c"])
})

test("closes URL duplicates keeping focused when no reuse target", () => {
  const plan = planTabsOpen({
    tabs: [
      { id: "tab_a", url: "https://example.com/x" },
      { id: "tab_b", url: "https://example.com/x/" },
      { id: "tab_c", url: "https://other.test" },
    ],
    focusedTabID: "tab_b",
    url: "https://fresh.test",
    maxTabs: 3,
  })

  expect(plan.reuseTabID).toBeUndefined()
  expect(plan.closeTabIDs).toContain("tab_a")
  expect(plan.closeTabIDs).not.toContain("tab_b")
})

test("overflow closes oldest unused tabs before creating", () => {
  const plan = planTabsOpen({
    tabs: [
      { id: "tab_1", url: "https://a.test" },
      { id: "tab_2", url: "https://b.test" },
      { id: "tab_3", url: "https://c.test" },
    ],
    focusedTabID: "tab_3",
    url: "https://d.test",
    maxTabs: MAX_BROWSER_TABS,
  })

  expect(plan.reuseTabID).toBeUndefined()
  expect(plan.closeTabIDs.length).toBeGreaterThanOrEqual(1)
  expect(plan.closeTabIDs[0]).toBe("tab_1")
  expect(plan.closeTabIDs).not.toContain("tab_3")
})

test("at max with matching URL reuses without closing the focused match", () => {
  const plan = planTabsOpen({
    tabs: [
      { id: "tab_1", url: "https://a.test" },
      { id: "tab_2", url: "https://b.test" },
      { id: "tab_3", url: "https://c.test" },
    ],
    focusedTabID: "tab_2",
    url: "https://b.test/",
  })

  expect(plan.reuseTabID).toBe("tab_2")
  expect(plan.closeTabIDs).not.toContain("tab_2")
})
