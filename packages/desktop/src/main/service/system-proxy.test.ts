import { describe, expect, test } from "bun:test"
import { EventEmitter } from "node:events"

import {
  applyProxyEnv,
  MIRRORED_PROXY_FLAG,
  pacFindProxyReturn,
  pacScriptDataUrl,
  parseChromiumProxy,
  parseChromiumProxyChain,
  pickLiveProxy,
  probeProxyTcp,
  proxyHostPort,
} from "./system-proxy"

describe("system proxy", () => {
  test("parseChromiumProxyChain keeps PAC order and DIRECT", () => {
    expect(parseChromiumProxyChain("PROXY 127.0.0.1:7897")).toEqual({
      proxies: ["http://127.0.0.1:7897"],
      allowDirect: false,
      pac: "PROXY 127.0.0.1:7897",
    })
    expect(parseChromiumProxyChain("PROXY a.test:1080; PROXY b.test:8080; DIRECT")).toEqual({
      proxies: ["http://a.test:1080", "http://b.test:8080"],
      allowDirect: true,
      pac: "PROXY a.test:1080; PROXY b.test:8080; DIRECT",
    })
    expect(parseChromiumProxyChain("DIRECT")).toEqual({
      proxies: [],
      allowDirect: true,
      pac: "DIRECT",
    })
  })

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

  test("pacFindProxyReturn preserves Chromium's answer for native failover", () => {
    const chain = parseChromiumProxyChain("PROXY 127.0.0.1:7897; DIRECT")
    expect(pacFindProxyReturn(chain)).toBe("PROXY 127.0.0.1:7897; DIRECT")
    expect(pacScriptDataUrl(chain)).toContain("FindProxyForURL")
    expect(pacScriptDataUrl(chain)).toContain("7897")
  })

  test("proxyHostPort parses host and port", () => {
    expect(proxyHostPort("http://127.0.0.1:7897")).toEqual({ host: "127.0.0.1", port: 7897 })
    expect(proxyHostPort("not a url")).toBeUndefined()
  })

  test("pickLiveProxy skips dead proxies and falls back to direct", async () => {
    const chain = parseChromiumProxyChain("PROXY dead:1; PROXY live:2; DIRECT")
    const picked = await pickLiveProxy(chain, async (proxy) => proxy.includes("live"))
    expect(picked).toBe("http://live:2")

    const allDead = await pickLiveProxy(chain, async () => false)
    expect(allDead).toBeUndefined()
  })

  test("pickLiveProxy falls back to direct when PAC has no DIRECT but every proxy is dead", async () => {
    const chain = parseChromiumProxyChain("PROXY dead:1")
    expect(await pickLiveProxy(chain, async () => false)).toBeUndefined()
  })

  test("probeProxyTcp reports connect success and failure", async () => {
    const okConnect = Object.assign(
      () => {
        const socket = new EventEmitter() as EventEmitter & { setTimeout: Function; destroy: Function }
        socket.setTimeout = () => {}
        socket.destroy = () => {}
        queueMicrotask(() => socket.emit("connect"))
        return socket
      },
      { prototype: {} },
    )
    await expect(probeProxyTcp("http://127.0.0.1:7897", 50, okConnect as never)).resolves.toBe(true)

    const badConnect = Object.assign(
      () => {
        const socket = new EventEmitter() as EventEmitter & { setTimeout: Function; destroy: Function }
        socket.setTimeout = () => {}
        socket.destroy = () => {}
        queueMicrotask(() => socket.emit("error", new Error("ECONNREFUSED")))
        return socket
      },
      { prototype: {} },
    )
    await expect(probeProxyTcp("http://127.0.0.1:7897", 50, badConnect as never)).resolves.toBe(false)
  })

  test("applyProxyEnv only clears mirrors it owns", () => {
    const previous = { ...process.env }
    try {
      delete process.env.HTTP_PROXY
      delete process.env.HTTPS_PROXY
      delete process.env.http_proxy
      delete process.env.https_proxy
      delete process.env[MIRRORED_PROXY_FLAG]

      expect(applyProxyEnv("http://127.0.0.1:7897")).toEqual({
        applied: true,
        proxy: "http://127.0.0.1:7897",
      })
      expect(process.env.HTTP_PROXY).toBe("http://127.0.0.1:7897")
      expect(process.env[MIRRORED_PROXY_FLAG]).toBe("http://127.0.0.1:7897")

      applyProxyEnv(undefined)
      expect(process.env.HTTP_PROXY).toBeUndefined()
      expect(process.env[MIRRORED_PROXY_FLAG]).toBeUndefined()

      process.env.HTTP_PROXY = "http://user-set:1"
      expect(applyProxyEnv("http://127.0.0.1:7897").applied).toBe(false)
      expect(process.env.HTTP_PROXY).toBe("http://user-set:1")
    } finally {
      for (const key of Object.keys(process.env)) {
        if (!(key in previous)) delete process.env[key]
      }
      Object.assign(process.env, previous)
    }
  })
})
