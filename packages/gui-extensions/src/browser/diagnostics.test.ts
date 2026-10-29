import { expect, test } from "bun:test"
import type { Cdp } from "./cdp"
import { createDiagnostics } from "./diagnostics"

/** Minimal CDP double: records the diagnostics handlers and replays events on demand. */
function fakeCdp() {
  const listeners = new Map<string, Set<(params: unknown, sessionID?: string) => void>>()
  const cdp = {
    send: async () => undefined as never,
    on(name: string, callback: (params: unknown, sessionID?: string) => void) {
      const handlers = listeners.get(name) ?? new Set()

      handlers.add(callback)
      listeners.set(name, handlers)

      return () => handlers.delete(callback)
    },
    dispose() {},
    emit(name: string, params: unknown) {
      listeners.get(name)?.forEach((callback) => callback(params))
    },
  }

  return cdp as unknown as Cdp & { emit(name: string, params: unknown): void }
}

test("completedSince reports only requests that finish after the wait's baseline", () => {
  const cdp = fakeCdp()
  const diagnostics = createDiagnostics(cdp)

  const begin = (id: string, url: string) =>
    cdp.emit("Network.requestWillBeSent", {
      requestId: id,
      timestamp: 1,
      wallTime: Date.now() / 1000,
      request: { url, method: "GET", headers: {} },
      type: "Fetch",
    })

  begin("1", "https://site.test/api/old")
  cdp.emit("Network.loadingFinished", { requestId: "1", timestamp: 2 })
  const baseline = diagnostics.done()

  expect(baseline).toBe(1)
  // A request that finished before the wait began must not satisfy it, or an older
  // request to the same URL would resolve the wait instantly.
  expect(diagnostics.completedSince({ urlContains: "/api", since: baseline })).toBe(false)

  // A request still in flight when the wait began counts once it finishes.
  begin("2", "https://site.test/api/items")
  expect(diagnostics.completedSince({ urlContains: "/api/items", since: baseline })).toBe(false)
  cdp.emit("Network.loadingFinished", { requestId: "2", timestamp: 3 })
  expect(diagnostics.completedSince({ urlContains: "/api/items", since: baseline })).toBe(true)

  // A failed request also leaves "pending": the wait resolves so the agent can read its fate.
  begin("3", "https://site.test/api/other")
  cdp.emit("Network.loadingFailed", { requestId: "3", timestamp: 4, errorText: "ERR_FAILED" })
  expect(diagnostics.completedSince({ urlContains: "/api/other", since: baseline })).toBe(true)

  // A URL that never matched never resolves.
  expect(diagnostics.completedSince({ urlContains: "/api/missing", since: baseline })).toBe(false)
})
