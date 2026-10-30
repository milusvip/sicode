import { describe, expect, test } from "bun:test"
import { isPackageBehind } from "./protocol.js"

describe("isPackageBehind", () => {
  test("equal is not behind", () => {
    expect(isPackageBehind("0.2.21", "0.2.21")).toBe(false)
  })

  test("older patch is behind", () => {
    expect(isPackageBehind("0.2.20", "0.2.21")).toBe(true)
  })

  test("newer installed is not behind", () => {
    expect(isPackageBehind("0.3.0", "0.2.21")).toBe(false)
  })

  test("empty expected never behind", () => {
    expect(isPackageBehind("0.2.20", "")).toBe(false)
  })
})
