import { describe, expect, test } from "bun:test"
import { DENY, MUTATIONS, advertised, whollyDisabled } from "../src/session/ask-mode.js"

describe("Ask admit-time strip", () => {
  test("denies edit and execute at the permission root", () => {
    expect(whollyDisabled("edit", DENY)).toBe(true)
    expect(whollyDisabled("execute", DENY)).toBe(true)
    expect(whollyDisabled("read", DENY)).toBe(false)
    expect(whollyDisabled("grep", DENY)).toBe(false)
  })

  test("write edit patch execute leave the advertised set", () => {
    const names = ["read", "grep", "write", "edit", "patch", "execute", "shell", "todowrite"]
    const next = advertised(names, DENY)
    for (const name of MUTATIONS) expect(next).not.toContain(name)
    expect(next).toContain("read")
    expect(next).toContain("grep")
    expect(next).toContain("shell")
  })
})
