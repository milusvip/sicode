import { describe, expect, test } from "bun:test"
import { providerDisplay } from "./display"

describe("providerDisplay", () => {
  test("keeps a human name and surfaces baseURL", () => {
    expect(
      providerDisplay({
        id: "mc",
        name: "M-C API",
        options: { baseURL: "https://gateway.example/v1" },
      }),
    ).toEqual({
      title: "M-C API",
      subtitle: "https://gateway.example/v1",
    })
  })

  test("collapses a URL name to the host slug", () => {
    expect(
      providerDisplay({
        id: "zzz",
        name: "https://api.zzzai.vip/v1",
      }),
    ).toEqual({
      title: "zzzai",
      subtitle: "https://api.zzzai.vip/v1",
    })
  })

  test("prefers explicit baseURL over a URL-like name", () => {
    expect(
      providerDisplay({
        id: "vortex",
        name: "https://vortexapi.xyz/v1",
        options: { baseURL: "https://vortexapi.xyz/v1" },
      }),
    ).toEqual({
      title: "vortexapi",
      subtitle: "https://vortexapi.xyz/v1",
    })
  })
})
