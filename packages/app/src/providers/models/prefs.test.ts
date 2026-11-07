import { describe, expect, test } from "bun:test"
import { compareProviderOrder, reorderProviderOrder } from "./provider-order"

describe("compareProviderOrder", () => {
  test("honors remembered order before popular defaults", () => {
    const order = ["custom-b", "custom-a"]
    expect(
      compareProviderOrder({ id: "custom-a", name: "A" }, { id: "custom-b", name: "B" }, order),
    ).toBeGreaterThan(0)
  })

  test("falls back to name when neither is ordered", () => {
    expect(compareProviderOrder({ id: "z", name: "Zed" }, { id: "a", name: "Ace" }, [])).toBeGreaterThan(0)
  })
})

describe("reorderProviderOrder", () => {
  test("moves within the visible section and keeps the rest", () => {
    expect(reorderProviderOrder(["a", "b", "c", "d"], ["b", "c", "d"], 0, 2)).toEqual(["c", "d", "b", "a"])
  })
})
