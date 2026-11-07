import { afterEach, describe, expect, test } from "bun:test"
import {
  MIRRORED_PROXY_FLAG,
  clearMirroredProxyEnv,
  failoverMirroredProxy,
  isProxyTransportError,
  mirroredProxyUrl,
} from "../src/proxy-failover.js"

afterEach(() => {
  delete process.env[MIRRORED_PROXY_FLAG]
  delete process.env.HTTP_PROXY
  delete process.env.HTTPS_PROXY
  delete process.env.http_proxy
  delete process.env.https_proxy
})

describe("proxy-failover", () => {
  test("detects refused / tunnel proxy deaths", () => {
    expect(isProxyTransportError(Object.assign(new Error("fetch failed"), { code: "ECONNREFUSED" }))).toBe(true)
    expect(isProxyTransportError(new Error("Connecting to proxy failed"))).toBe(true)
    expect(isProxyTransportError(new Error("fetch failed"))).toBe(true)
    expect(isProxyTransportError(new Error("Unable to connect. Is the computer able to access the url?"))).toBe(true)
    expect(isProxyTransportError(new Error("invalid API key"))).toBe(false)
  })

  test("clearMirroredProxyEnv only acts when the desktop flag is set", () => {
    process.env.HTTP_PROXY = "http://127.0.0.1:7897"
    expect(clearMirroredProxyEnv()).toBe(false)
    expect(process.env.HTTP_PROXY).toBe("http://127.0.0.1:7897")

    process.env[MIRRORED_PROXY_FLAG] = "http://127.0.0.1:7897"
    process.env.HTTPS_PROXY = "http://127.0.0.1:7897"
    expect(clearMirroredProxyEnv()).toBe(true)
    expect(process.env.HTTP_PROXY).toBeUndefined()
    expect(process.env.HTTPS_PROXY).toBeUndefined()
    expect(mirroredProxyUrl()).toBeUndefined()
  })

  test("failoverMirroredProxy clears on proxy death and ignores other errors", () => {
    process.env[MIRRORED_PROXY_FLAG] = "http://127.0.0.1:7897"
    process.env.HTTP_PROXY = "http://127.0.0.1:7897"
    expect(failoverMirroredProxy(new Error("bad request"))).toBe(false)
    expect(process.env.HTTP_PROXY).toBe("http://127.0.0.1:7897")

    expect(failoverMirroredProxy(Object.assign(new Error("fetch failed"), { code: "ECONNREFUSED" }))).toBe(true)
    expect(process.env.HTTP_PROXY).toBeUndefined()
    expect(process.env[MIRRORED_PROXY_FLAG]).toBeUndefined()
  })
})
