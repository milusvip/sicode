import { expect, test } from "bun:test"
import { addressParts, connection, resolveAddress, SEARCH_ENGINES, searchQuery } from "./address"
import { remember, suggest } from "./history"

test("the address field navigates to what reads as an address and searches for anything else", () => {
  const search = (query: string) => `https://www.google.com/search?q=${encodeURIComponent(query)}`

  expect(
    [
      "",
      "https://example.com/a b",
      "about:blank",
      "localhost:3000",
      "localhost",
      "[::1]:5173/app",
      "127.0.0.1:8080",
      "dev-box:4096/health",
      "developer.mozilla.org/en-US/docs",
      "mdn",
      "css grid gap",
      "localhost 3000",
      "ABOUT:BLANK",
      "file:///C:/repo/index.html",
      // A typed scheme is an address even where main refuses it, which then says why.
      "file://server/share/x.html",
      "ftp://example.com",
      "about:config",
      // Text that is no URL searches: no host, a space in it, or a host main would not open as a web page.
      "https://",
      "http:// foo",
      "about: the movie",
      "user@example.com",
      ":8080",
      "error: cannot find module",
    ].map((input) => resolveAddress(input)),
  ).toEqual([
    "about:blank",
    "https://example.com/a b",
    "about:blank",
    "localhost:3000",
    "localhost",
    "[::1]:5173/app",
    "127.0.0.1:8080",
    "dev-box:4096/health",
    "developer.mozilla.org/en-US/docs",
    search("mdn"),
    search("css grid gap"),
    search("localhost 3000"),
    "about:blank",
    "file:///C:/repo/index.html",
    "file://server/share/x.html",
    "ftp://example.com",
    "about:config",
    search("https://"),
    search("http:// foo"),
    search("about: the movie"),
    search("user@example.com"),
    search(":8080"),
    search("error: cannot find module"),
  ])
})

test("HTTPS with an accepted untrusted certificate reads as insecure in site information", () => {
  expect(connection("https://self-signed.example/")).toBe("secure")
  expect(connection("https://self-signed.example/", { certificateWarning: true })).toBe("insecure")
  expect(connection("http://localhost:3000/")).toBe("local")
  expect(connection("http://example.com/")).toBe("insecure")
})

test("text that is not an address searches with the chosen engine, Google by default", () => {
  const bing = SEARCH_ENGINES.find((engine) => engine.id === "bing")
  const baidu = SEARCH_ENGINES.find((engine) => engine.id === "baidu")

  expect(SEARCH_ENGINES[0].id).toBe("google")
  expect(resolveAddress("css grid gap")).toBe("https://www.google.com/search?q=css%20grid%20gap")
  expect(bing && resolveAddress("css grid gap", bing)).toBe("https://www.bing.com/search?q=css%20grid%20gap")
  expect(baidu && resolveAddress("css grid gap", baidu)).toBe("https://www.baidu.com/s?wd=css%20grid%20gap")
  // An address never searches, whichever engine is chosen.
  expect(bing && resolveAddress("developer.mozilla.org", bing)).toBe("developer.mozilla.org")
  // A search URL names the query it carries, and only for its own engine.
  expect(bing && searchQuery(bing, "https://www.bing.com/search?q=css%20grid%20gap")).toBe("css grid gap")
  expect(bing && searchQuery(bing, "https://www.google.com/search?q=css")).toBeUndefined()
  expect(bing && searchQuery(bing, "https://www.bing.com/search?q=%E0%A4%A")).toBe("%E0%A4%A")
})

test("the field draws the whole URL, split around its host, in exactly the input's characters", () => {
  const urls = [
    "https://developer.mozilla.org/en-US/docs/Web?q=1#top",
    "http://localhost:5173/",
    "https://alpha.example",
    "file:///C:/repo/out/index.html",
    "HTTPS://Example.COM/%7Euser",
  ]

  expect(urls.map(addressParts)).toEqual([
    { scheme: "https://", host: "developer.mozilla.org", rest: "/en-US/docs/Web?q=1#top" },
    { scheme: "http://", host: "localhost:5173", rest: "/" },
    { scheme: "https://", host: "alpha.example", rest: "" },
    { scheme: "file://", host: "", rest: "/C:/repo/out/index.html" },
    { scheme: "HTTPS://", host: "Example.COM", rest: "/%7Euser" },
  ])
  expect(urls.map((url) => Object.values(addressParts(url)).join(""))).toEqual(urls)
})

test("history keeps one newest-first visit per URL and suggests addresses that complete the query first", () => {
  const visits = ["https://docs.example/mdn-guide", "https://developer.mozilla.org/", "https://www.mdn.dev/"].reduce(
    (list, url) => remember(list, { url, title: url.includes("mozilla") ? "MDN Web Docs" : "Other" }),
    remember([], { url: "https://developer.mozilla.org/", title: "Old title" }),
  )

  expect(visits.map((visit) => [visit.url, visit.title])).toEqual([
    ["https://www.mdn.dev/", "Other"],
    ["https://developer.mozilla.org/", "MDN Web Docs"],
    ["https://docs.example/mdn-guide", "Other"],
  ])
  // A leading www. and the scheme are not typed, so mdn completes www.mdn.dev; the others only contain it.
  expect(suggest(visits, "MDN", 5).map((visit) => visit.url)).toEqual([
    "https://www.mdn.dev/",
    "https://developer.mozilla.org/",
    "https://docs.example/mdn-guide",
  ])
  expect(suggest(visits, "  ", 5)).toEqual([])
  expect(
    Array.from({ length: 40 }, (_, index) => `https://example.com/${index}`).reduce(
      (list, url) => remember(list, { url, title: "" }),
      visits,
    ),
  ).toHaveLength(30)
})
