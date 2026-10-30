import { describe, expect, test } from "bun:test"
import {
  CHROME_BRIDGE_BETA_PORT,
  CHROME_BRIDGE_DEFAULT_PORT,
  CHROME_BRIDGE_DEV_PORT,
  chromeBridgeDefaultPort,
  formatChromeBridgeListenError,
  migrateChromeBridgePort,
} from "./protocol"

describe("chromeBridgeDefaultPort", () => {
  test("prod packaged owns the formal port", () => {
    expect(chromeBridgeDefaultPort({ channel: "prod", packaged: true })).toBe(CHROME_BRIDGE_DEFAULT_PORT)
  })

  test("unpackaged always uses the dev port", () => {
    expect(chromeBridgeDefaultPort({ channel: "prod", packaged: false })).toBe(CHROME_BRIDGE_DEV_PORT)
    expect(chromeBridgeDefaultPort({ channel: "dev", packaged: false })).toBe(CHROME_BRIDGE_DEV_PORT)
  })

  test("beta and dev packaged use dedicated ports", () => {
    expect(chromeBridgeDefaultPort({ channel: "beta", packaged: true })).toBe(CHROME_BRIDGE_BETA_PORT)
    expect(chromeBridgeDefaultPort({ channel: "dev", packaged: true })).toBe(CHROME_BRIDGE_DEV_PORT)
    expect(chromeBridgeDefaultPort({ channel: "local", packaged: true })).toBe(CHROME_BRIDGE_DEV_PORT)
  })
})

describe("migrateChromeBridgePort", () => {
  test("moves legacy shared 17891 off non-prod builds", () => {
    expect(
      migrateChromeBridgePort({ stored: CHROME_BRIDGE_DEFAULT_PORT, channel: "dev", packaged: false }),
    ).toBe(CHROME_BRIDGE_DEV_PORT)
    expect(
      migrateChromeBridgePort({ stored: CHROME_BRIDGE_DEFAULT_PORT, channel: "beta", packaged: true }),
    ).toBe(CHROME_BRIDGE_BETA_PORT)
  })

  test("keeps prod on 17891 and preserves packaged custom ports", () => {
    expect(
      migrateChromeBridgePort({ stored: CHROME_BRIDGE_DEFAULT_PORT, channel: "prod", packaged: true }),
    ).toBe(CHROME_BRIDGE_DEFAULT_PORT)
    expect(migrateChromeBridgePort({ stored: 19000, channel: "prod", packaged: true })).toBe(19000)
  })

  test("unpackaged always reclaims the dev port even with a custom store", () => {
    expect(migrateChromeBridgePort({ stored: 19000, channel: "dev", packaged: false })).toBe(
      CHROME_BRIDGE_DEV_PORT,
    )
  })
})

describe("formatChromeBridgeListenError", () => {
  test("maps EADDRINUSE to port_in_use", () => {
    expect(formatChromeBridgeListenError({ code: "EADDRINUSE" }, 17891)).toBe("port_in_use:17891")
  })

  test("keeps Error messages for other failures", () => {
    expect(formatChromeBridgeListenError(new Error("boom"), 17891)).toBe("boom")
  })
})
