import { describe, expect, test } from "bun:test"
import { effectivePreferSystem } from "./prefer-system"

describe("effectivePreferSystem", () => {
  test("omit session → global default", () => {
    expect(effectivePreferSystem({ globalDefault: true, map: {} })).toBe(true)
    expect(effectivePreferSystem({ globalDefault: false, map: { ses_a: true } })).toBe(false)
  })

  test("absent key inherits global (connected default = system)", () => {
    expect(effectivePreferSystem({ session: "ses_a", globalDefault: true, map: {} })).toBe(true)
  })

  test("in-app attach sticks false; push sticks true", () => {
    expect(effectivePreferSystem({ session: "ses_a", globalDefault: true, map: { ses_a: false } })).toBe(false)
    expect(effectivePreferSystem({ session: "ses_a", globalDefault: true, map: { ses_a: true } })).toBe(true)
  })
})
