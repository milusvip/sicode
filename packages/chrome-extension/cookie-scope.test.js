import { describe, expect, test } from "bun:test"
import { cookieQueries, coversHost, mergeCookies } from "./cookie-scope.js"

describe("cookieQueries", () => {
  test("a subdomain page asks for its own host and its parent, which is where the login usually is", () => {
    // The regression this guards: asking only `{ domain: "www.example.com" }` returns cookies whose domain
    // matches or is a subdomain of it, so `.example.com` — the login — never comes back.
    expect(cookieQueries("https://www.example.com/account")).toEqual([
      { url: "https://www.example.com/account" },
      { domain: "www.example.com" },
      { domain: "example.com" },
    ])
  })

  test("a two-label host has no parent query, because its parent is a public suffix", () => {
    // `com` would return every site's cookies; `example.com` is already asked for by host.
    expect(cookieQueries("https://example.com/")).toEqual([
      { url: "https://example.com/" },
      { domain: "example.com" },
    ])
  })

  test("a deep host asks one level up, which covers the domain the cookie was set on", () => {
    expect(cookieQueries("https://a.b.example.com/")).toEqual([
      { url: "https://a.b.example.com/" },
      { domain: "a.b.example.com" },
      { domain: "b.example.com" },
    ])
  })

  test("the host is lowercased, so a pasted uppercase URL still matches a stored cookie", () => {
    expect(cookieQueries("https://WWW.Example.COM/x")).toEqual([
      { url: "https://WWW.Example.COM/x" },
      { domain: "www.example.com" },
      { domain: "example.com" },
    ])
  })
})

describe("coversHost", () => {
  test("a leading dot is the same domain, not a different one", () => {
    expect(coversHost("www.example.com", ".example.com")).toBe(true)
    expect(coversHost("www.example.com", "example.com")).toBe(true)
    expect(coversHost("example.com", ".example.com")).toBe(true)
  })

  test("a lookalike suffix is not covered", () => {
    expect(coversHost("evilexample.com", "example.com")).toBe(false)
    expect(coversHost("www.example.com", "notexample.com")).toBe(false)
  })

  test("a missing domain covers nothing", () => {
    expect(coversHost("example.com", "")).toBe(false)
    expect(coversHost("example.com", undefined)).toBe(false)
  })
})

describe("mergeCookies", () => {
  const host = "www.example.com"

  test("the parent-domain login survives even when the host query returned only noise", () => {
    // This is the reported failure: the host query answers, so the old code never fell back to the URL
    // query, and the session cookie on `.example.com` was never in the paste at all.
    const byHost = [{ name: "_ga", value: "1", domain: "www.example.com", path: "/" }]
    const byURL = [
      { name: "sid", value: "secret", domain: ".example.com", path: "/" },
      { name: "_ga", value: "1", domain: "www.example.com", path: "/" },
    ]

    expect(mergeCookies([byHost, byURL], host)).toEqual([
      { name: "_ga", value: "1", domain: "www.example.com", path: "/" },
      { name: "sid", value: "secret", domain: ".example.com", path: "/" },
    ])
  })

  test("a cookie two queries both return is written once", () => {
    const cookie = { name: "sid", value: "s", domain: ".example.com", path: "/" }

    expect(mergeCookies([[cookie], [cookie], [cookie]], host)).toEqual([cookie])
  })

  test("cookies of an unrelated domain are dropped, whatever query returned them", () => {
    expect(mergeCookies([[{ name: "x", value: "1", domain: ".other.com", path: "/" }]], host)).toEqual([])
  })

  test("a nameless cookie is dropped instead of failing the whole sync", () => {
    // The store rejects it, so it must not travel; the rest of the login still lands.
    const list = [
      { name: "", value: "v", domain: ".example.com", path: "/" },
      { value: "v", domain: ".example.com", path: "/" },
      { name: "sid", value: "s", domain: ".example.com", path: "/" },
    ]

    expect(mergeCookies([list], host)).toEqual([{ name: "sid", value: "s", domain: ".example.com", path: "/" }])
  })

  test("a query that failed contributes nothing instead of losing the others", () => {
    expect(mergeCookies([[], [{ name: "sid", value: "s", domain: ".example.com", path: "/" }]], host)).toHaveLength(1)
  })

  test("the same name on a different path is a different cookie and is kept", () => {
    const list = [
      { name: "sid", value: "a", domain: ".example.com", path: "/" },
      { name: "sid", value: "b", domain: ".example.com", path: "/admin" },
    ]

    expect(mergeCookies([list], host)).toHaveLength(2)
  })
})
