import { describe, expect, test } from "bun:test"
import {
  isHostBlocked,
  isUrlBlocked,
  matchedBlockedDomain,
  normalizeBlockedDomain,
} from "./blocked-domain"

describe("normalizeBlockedDomain", () => {
  test("strips scheme path and www", () => {
    expect(normalizeBlockedDomain("https://www.Example.com/path")).toBe("example.com")
    expect(normalizeBlockedDomain("EXAMPLE.COM")).toBe("example.com")
  })

  test("rejects bare TLD and junk", () => {
    expect(normalizeBlockedDomain("com")).toBeUndefined()
    expect(normalizeBlockedDomain("")).toBeUndefined()
    expect(normalizeBlockedDomain("not a host")).toBeUndefined()
  })

  test("keeps multi-label roots the user typed", () => {
    expect(normalizeBlockedDomain("foo.co.uk")).toBe("foo.co.uk")
  })
})

describe("isUrlBlocked", () => {
  const list = ["example.com", "foo.co.uk"]

  test("blocks host and subdomains", () => {
    expect(isUrlBlocked("https://example.com/a", list)).toBe(true)
    expect(isUrlBlocked("https://a.b.example.com/", list)).toBe(true)
    expect(isUrlBlocked("https://shop.foo.co.uk", list)).toBe(true)
  })

  test("does not block sibling or parent lookalikes", () => {
    expect(isUrlBlocked("https://example.com.evil.test/", list)).toBe(false)
    expect(isUrlBlocked("https://notexample.com/", list)).toBe(false)
    expect(isUrlBlocked("https://co.uk/", list)).toBe(false)
  })

  test("ignores non-http(s)", () => {
    expect(isUrlBlocked("about:blank", list)).toBe(false)
    expect(isUrlBlocked("file:///tmp/x", list)).toBe(false)
  })
})

describe("matchedBlockedDomain", () => {
  test("returns the list entry that matched", () => {
    expect(matchedBlockedDomain("https://a.example.com", ["example.com"])).toBe("example.com")
  })
})

describe("isHostBlocked", () => {
  test("localhost exact and *.localhost", () => {
    expect(isHostBlocked("localhost", ["localhost"])).toBe(true)
    expect(isHostBlocked("app.localhost", ["localhost"])).toBe(true)
    expect(isHostBlocked("localhost.localdomain", ["localhost"])).toBe(false)
  })
})
