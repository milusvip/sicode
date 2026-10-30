import { expect, test } from "bun:test"
import {
  cookieURL,
  cookiesForDomain,
  cookiesForPage,
  hostMatches,
  parseCookies,
  parseLoginPaste,
} from "./cookies"

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
  // A real export carries fields this pane ignores; they must not reject the whole paste.
  expect(
    parseCookies(JSON.stringify([{ name: "sid", value: "abc", hostOnly: true, session: false, storeId: "0" }])),
  ).toEqual([{ name: "sid", value: "abc" }])
  // A live sync can carry one cookie the store would reject. Dropping it is what keeps the other
  // cookies of that login, which is why the whole paste must not fail over a single bad entry.
  expect(
    parseCookies(JSON.stringify([{ value: "abc" }, { name: "sid", value: "abc" }, { name: "", value: "x" }])),
  ).toEqual([{ name: "sid", value: "abc" }])
  expect(parseCookies('[{"value":"abc"}]')).toEqual([])
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
  // A pasted domain that covers the page keeps its own host (leading dot stripped for Electron), so subdomains share.
  expect(cookiesForPage(page, [{ name: "sid", value: "abc", domain: ".example.com" }])[0]).toMatchObject({
    url: "https://example.com/",
    domain: "example.com",
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

test("a cookie's own address keeps its scope, and an IPv6 host gets its brackets", () => {
  // Restoring a stored cookie needs the address it was written at, not the page that is open later.
  expect(cookieURL({ domain: ".example.com", path: "/app", secure: true })).toBe("https://example.com/app")
  expect(cookieURL({ domain: "localhost", path: "/", secure: false })).toBe("http://localhost/")
  // Without a path or scheme a session cookie still names a usable address.
  expect(cookieURL({ domain: "example.com" })).toBe("http://example.com/")
  expect(cookieURL({ domain: "::1", path: "/", secure: true })).toBe("https://[::1]/")
})

test("with no page open, a paste writes for the domains it names", () => {
  expect(cookiesForDomain([{ name: "sid", value: "abc", domain: ".example.com" }])).toEqual([
    {
      url: "https://example.com/",
      name: "sid",
      value: "abc",
      domain: "example.com",
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

test("a dump copied by the extension's「复制登录态」pastes its page, cookies, and localStorage", () => {
  // Verbatim shape of the older text dump: the page, then a cookie section and a `Token：` section whose entries
  // each carry the `（localStorage）` marker. Its cookies name no domain, so the page supplies it.
  const dump = [
    "网址：https://chat.deepseek.com/a/chat/s/75d27f7d-1",
    "cookie：",
    "intercom-device-id-abc=1f4c",
    ".thumbcache_abc=xyz",
    "Token：",
    "__appKit_deepseek/chat_bannerSettings={\"schemaVersion\":2}（localStorage）",
    "userToken=eyJhbGci（localStorage）",
  ].join("\n")

  const pasted = parseLoginPaste(dump)

  expect(pasted.url).toBe("https://chat.deepseek.com/a/chat/s/75d27f7d-1")
  expect(pasted.cookies).toEqual([
    { name: "intercom-device-id-abc", value: "1f4c" },
    { name: ".thumbcache_abc", value: "xyz" },
  ])
  // A value keeps everything after the first "=", and the marker is not part of it.
  expect(pasted.storage).toEqual({
    "__appKit_deepseek/chat_bannerSettings": '{"schemaVersion":2}',
    userToken: "eyJhbGci",
  })
  // The page fills in the domain the dump dropped, as a host-only cookie for that site.
  expect(cookiesForDomain(pasted.cookies, pasted.url)[0]).toEqual({
    url: "https://chat.deepseek.com/",
    name: "intercom-device-id-abc",
    value: "1f4c",
    path: "/",
    secure: true,
  })
  // A dump of cookies alone carries no storage, and one of storage alone is still a login.
  expect(parseLoginPaste("网址：https://a.test/\ncookie：\nsid=1").storage).toBeUndefined()
  expect(parseLoginPaste("网址：https://a.test/\nToken：\nsid=1（localStorage）")).toEqual({
    cookies: [],
    storage: { sid: "1" },
    url: "https://a.test/",
  })
  expect(() => parseLoginPaste("网址：https://a.test/\ncookie：\nnovalue")).toThrow(
    "Invalid cookie pair: novalue",
  )
})

test("the extension's JSON dump carries each cookie's domain and the localStorage", () => {
  // What the extension now copies: Chrome's own cookie objects plus the page and its localStorage.
  const dump = JSON.stringify({
    url: "https://chat.deepseek.com/",
    cookies: [
      { name: "sid", value: "abc", domain: ".deepseek.com", path: "/", secure: true, hostOnly: false },
      { name: "lang", value: "zh" },
    ],
    localStorage: { userToken: "eyJhbGci", visits: 3, signedIn: true, ignored: { nested: true } },
  })

  expect(parseLoginPaste(dump)).toEqual({
    url: "https://chat.deepseek.com/",
    cookies: [
      { name: "sid", value: "abc", domain: ".deepseek.com", path: "/", secure: true },
      { name: "lang", value: "zh" },
    ],
    // Numbers and flags become the strings localStorage stores; an object is not an entry.
    storage: { userToken: "eyJhbGci", visits: "3", signedIn: "true" },
  })
  // A wrapper with only storage is a login too, and needs no cookie to parse.
  expect(parseLoginPaste('{"url":"https://a.test/","localStorage":{"token":"t"}}')).toEqual({
    url: "https://a.test/",
    cookies: [],
    storage: { token: "t" },
  })
  // An array of cookies is still a cookie list, not a wrapper.
  expect(parseLoginPaste('[{"name":"sid","value":"abc"}]')).toEqual({ cookies: [{ name: "sid", value: "abc" }] })
})
