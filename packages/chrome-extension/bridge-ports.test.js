import { describe, expect, test } from "bun:test"
import { PROBE_TIMEOUT_MS, candidatePorts, respondingPorts } from "./bridge-ports.js"

describe("candidatePorts", () => {
  test("the desktop's own ports come first, so a leftover dev instance cannot take a push", () => {
    expect(candidatePorts(17893, [17891, 17892])).toEqual([17891, 17892, 17893])
  })

  test("the stored hint is tried once, even when it is also a discovery port", () => {
    expect(candidatePorts(17891, [17891, 17892])).toEqual([17891, 17892])
  })

  test("a missing or nonsense hint leaves the discovery ports alone", () => {
    expect(candidatePorts(undefined, [17891, 17892])).toEqual([17891, 17892])
    expect(candidatePorts(0, [17891])).toEqual([17891])
    expect(candidatePorts(Number.NaN, [17891])).toEqual([17891])
  })
})

describe("respondingPorts", () => {
  test("a probe that hangs only rules out its own port", async () => {
    // This is the delay the popup used to sit through: one silent port, then the next, then the next.
    const started = Date.now()
    const ports = await respondingPorts([17891, 17892, 17893], async (port, timeoutMs) => {
      if (port !== 17892) return new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs))
      return true
    }, 50)

    expect(ports).toEqual([17892])
    // All three were probed at once: the wait is one deadline, not three.
    expect(Date.now() - started).toBeLessThan(300)
  })

  test("answers come back in candidate order, not in the order the ports replied", async () => {
    const ports = await respondingPorts([17891, 17892, 17893], async (port) => {
      await new Promise((resolve) => setTimeout(resolve, port === 17891 ? 20 : 1))

      return port !== 17892
    })

    expect(ports).toEqual([17891, 17893])
  })

  test("a probe that throws counts as not listening", async () => {
    const ports = await respondingPorts([17891, 17892], async (port) => {
      if (port === 17891) throw new Error("ECONNREFUSED")

      return true
    })

    expect(ports).toEqual([17892])
  })

  test("nothing answering yields no ports, which is what schedules the retry", async () => {
    expect(await respondingPorts([17891, 17892], async () => false)).toEqual([])
  })

  test("the default deadline is short enough to not be felt", () => {
    expect(PROBE_TIMEOUT_MS).toBeLessThanOrEqual(1_000)
  })
})
