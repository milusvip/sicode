import { describe, expect, test } from "bun:test"
import { MAX_AGENT_INVENTORY_TABS, selectAgentInventoryTabs } from "./agent-inventory"

const tabs = [
  { id: "tab_a", url: "https://a.example/" },
  { id: "tab_b", url: "https://b.example/" },
  { id: "tab_c", url: "https://c.example/" },
  { id: "tab_d", url: "https://d.example/" },
  { id: "tab_e", url: "https://e.example/" },
  { id: "tab_f", url: "https://f.example/" },
]

describe("selectAgentInventoryTabs (Cursor browser_tabs parity)", () => {
  test("returns empty when nothing touched and no focus — no ambient Chrome dump", () => {
    expect(
      selectAgentInventoryTabs({
        tabs,
        focusedTabID: null,
        touchedTabIDs: new Set(),
      }),
    ).toEqual([])
  })

  test("includes only focused when the agent has not touched any tab yet", () => {
    expect(
      selectAgentInventoryTabs({
        tabs,
        focusedTabID: "tab_c",
        touchedTabIDs: new Set(),
      }),
    ).toEqual([{ id: "tab_c", url: "https://c.example/" }])
  })

  test("prefers touched over ambient siblings; keeps focused if distinct", () => {
    expect(
      selectAgentInventoryTabs({
        tabs,
        focusedTabID: "tab_a",
        touchedTabIDs: new Set(["tab_d", "tab_b"]),
      }),
    ).toEqual([
      { id: "tab_d", url: "https://d.example/" },
      { id: "tab_b", url: "https://b.example/" },
      { id: "tab_a", url: "https://a.example/" },
    ])
  })

  test("caps at MAX_AGENT_INVENTORY_TABS", () => {
    const touched = new Set(tabs.map((tab) => tab.id))
    const selected = selectAgentInventoryTabs({
      tabs,
      focusedTabID: "tab_a",
      touchedTabIDs: touched,
    })
    expect(selected).toHaveLength(MAX_AGENT_INVENTORY_TABS)
    expect(selected.map((tab) => tab.id)).toEqual(["tab_a", "tab_b", "tab_c", "tab_d", "tab_e"])
  })
})
