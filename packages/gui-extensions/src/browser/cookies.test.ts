import { expect, test } from "bun:test"
import { cookiesForDomain, cookiesForPage, hostMatches, parseCookies } from "./cookies"

test("a Cookie header pastes as name and value pairs", () => {
  expect(parseCookies("  session=abc; token = x y ;  ")).toEqual([
    { name: "session", value: "abc" },
    { name: "token", value: "x y" },
  ])
  expect(parseCookies("")).toEqual([])
  expect(() => parseCookies("novalue")).toThrow("Invalid cookie pair: novalue")
  expect(() => parseCookies("=abc")).toThrow("Invalid cookie pair: =abc")
})

test("one pair per line pastes the same as a Cookie header", () => {
  // How DevTools, cookie listings and site docs copy them: no ";", one name=value per line.
  const listed = "PHPSESSID=enn2jac0\nANACCOUNT=8c32ebd2\r\nANASID=dd1f55f4\n"

  const expected = [
    { name: "PHPSESSID", value: "enn2jac0" },
    { name: "ANACCOUNT", value: "8c32ebd2" },
    { name: "ANASID", value: "dd1f55f4" },
  ]

  expect(parseCookies(listed)).toEqual(expected)
  expect(parseCookies("PHPSESSID=enn2jac0; ANACCOUNT=8c32ebd2;ANASID=dd1f55f4")).toEqual(expected)
  // Mixed line breaks, blank lines, and trailing separators all drop out.
  expect(parseCookies("a=1;\n\nb=2\r\n;\n")).toEqual([
    { name: "a", value: "1" },
    { name: "b", value: "2" },
  ])
  // A line that is not a pair still fails instead of being written as a cookie.
  expect(() => parseCookies("a=1\nToken：abc")).toThrow("Invalid cookie pair: Token：abc")
})

test("a JSON map pastes as cookies, keeping an object's fields", () => {
  expect(parseCookies('{"session":"abc","theme":"dark"}')).toEqual([
    { name: "session", value: "abc" },
    { name: "theme", value: "dark" },
  ])
  // Some exports name the cookie in a nested object instead of the key.
  expect(parseCookies('{"sid":{"value":"abc","path":"/app","secure":true}}')).toEqual([
    { name: "sid", value: "abc", path: "/app", secure: true },
  ])
  expect(() => parseCookies("{")).toThrow("Cookie JSON could not be parsed.")
})

test("an exported cookie list pastes with its domain, expiry, and SameSite", () => {
  const list = [
    {
      name: "sid",
      value: "abc",
      domain: ".example.com",
      path: "/",
      secure: true,
      httpOnly: true,
      // Milliseconds, as some exporters write it.
      expirationDate: 1_800_000_000_000,
      sameSite: "no_restriction",
    },
    { Name: "lang", Value: "zh", SameSite: "Lax", expires: "2027-01-01T00:00:00Z" },
  ]

  expect(parseCookies(JSON.stringify(list))).toEqual([
    {
      name: "sid",
      value: "abc",
      domain: ".example.com",
      path: "/",
      secure: true,
      httpOnly: true,
      expirationDate: 1_800_000_000,
      sameSite: "no_restriction",
    },
    { name: "lang", value: "zh", expirationDate: 1_798_761_600, sameSite: "lax" },
  ])
  // cookie-editor wraps the list.
  expect(parseCookies(JSON.stringify({ cookies: [{ name: "sid", value: "abc" }] }))).toEqual([
    { name: "sid", value: "abc" },
  ])
  expect(() => parseCookies('[{"value":"abc"}]')).toThrow("Cookie at index 0 is missing a name.")
  expect(() => parseCookies('["abc"]')).toThrow("Cookie at index 0 is not an object.")
})

test("a paste is written for the open page, and only for it", () => {
  const page = "https://app.example.com/login?next=%2F"

  expect(cookiesForPage(page, [{ name: "sid", value: "abc" }])).toEqual([
    {
      url: "https://app.example.com/",
      name: "sid",
      value: "abc",
      path: "/",
      secure: true,
    },
  ])
  // A pasted domain that covers the page keeps its own host, so subdomains share the login.
  expect(cookiesForPage(page, [{ name: "sid", value: "abc", domain: ".example.com" }])[0]).toMatchObject({
    url: "https://example.com/",
    domain: ".example.com",
  })
  expect(() => cookiesForPage(page, [{ name: "sid", value: "abc", domain: "other.test" }])).toThrow(
    'Cookie "sid" targets other.test, which does not match app.example.com.',
  )
  expect(() => cookiesForPage("", [{ name: "sid", value: "abc" }])).toThrow(
    "Open a web page before pasting cookies.",
  )
  expect(() => cookiesForPage("about:blank", [{ name: "sid", value: "abc" }])).toThrow(
    "Cookies can only be set on http(s) pages.",
  )
  expect(() => cookiesForPage("file:///C:/repo/index.html", [{ name: "sid", value: "abc" }])).toThrow(
    "Cookies can only be set on http(s) pages.",
  )
  expect(() => cookiesForPage(page, [])).toThrow("No cookies found in the paste.")
})

test("an http page writes insecure cookies unless the paste says otherwise", () => {
  expect(cookiesForPage("http://localhost:3000/app", [{ name: "sid", value: "abc", path: "/app" }])[0]).toEqual({
    url: "http://localhost:3000/app",
    name: "sid",
    value: "abc",
    path: "/app",
    secure: false,
  })
  expect(hostMatches("APP.example.com", ".example.com")).toBe(true)
  expect(hostMatches("example.com", "example.com")).toBe(true)
  expect(hostMatches("notexample.com", "example.com")).toBe(false)
})

test("with no page open, a paste writes for the domains it names", () => {
  expect(cookiesForDomain([{ name: "sid", value: "abc", domain: ".example.com" }])).toEqual([
    {
      url: "https://example.com/",
      name: "sid",
      value: "abc",
      domain: ".example.com",
      path: "/",
      secure: true,
    },
  ])
  // The paste can still pick an insecure or scoped cookie.
  expect(cookiesForDomain([{ name: "sid", value: "abc", domain: "dev.test", path: "/app", secure: false }])[0]).toEqual({
    url: "http://dev.test/app",
    name: "sid",
    value: "abc",
    domain: "dev.test",
    path: "/app",
    secure: false,
  })
  expect(() => cookiesForDomain([{ name: "sid", value: "abc" }])).toThrow(
    'Cookie "sid" needs a domain: no page is open to write it for.',
  )
  expect(() => cookiesForDomain([])).toThrow("No cookies found in the paste.")
})
