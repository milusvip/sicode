import { describe, expect, test } from "bun:test"

import { parseChromiumProxy } from "./system-proxy"

describe("system proxy", () => {
  test("parseChromiumProxy picks the first non-direct entry", () => {
    expect(parseChromiumProxy("PROXY 127.0.0.1:7897")).toBe("http://127.0.0.1:7897")
    expect(parseChromiumProxy("PROXY a.test:1080; PROXY b.test:8080; DIRECT")).toBe("http://a.test:1080")
    expect(parseChromiumProxy(" direct ; PROXY 10.0.0.1:3128")).toBe("http://10.0.0.1:3128")
  })

  test("parseChromiumProxy returns undefined without a usable proxy", () => {
    expect(parseChromiumProxy("DIRECT")).toBeUndefined()
    expect(parseChromiumProxy("")).toBeUndefined()
    expect(parseChromiumProxy("PROXY ; DIRECT")).toBeUndefined()
  })
})
