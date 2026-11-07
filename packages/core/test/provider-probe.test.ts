import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { probeTest } from "../src/provider-probe"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("probeTest", () => {
  test("falls back to the model listing when chat returns 401", async () => {
    const calls: string[] = []

    globalThis.fetch = (async (input) => {
      const url = String(input)
      calls.push(url)

      if (url.includes("/chat/completions")) {
        return new Response(JSON.stringify({ error: { message: "Invalid token" } }), {
          status: 401,
          statusText: "Unauthorized",
        })
      }

      if (url.includes("/models")) {
        return Response.json({ data: [{ id: "deepseek-v4.1-flash" }] })
      }

      return new Response("not found", { status: 404 })
    }) as typeof fetch

    const result = await Effect.runPromise(
      probeTest({
        baseURL: "https://gateway.example/v1",
        apiKey: "sk-test",
        model: "deepseek-v4.1-flash",
      }),
    )

    expect(result).toEqual({ mode: "models" })
    expect(calls.some((url) => url.endsWith("/chat/completions"))).toBe(true)
    expect(calls.some((url) => url.endsWith("/models"))).toBe(true)
  })

  test("keeps the chat error when the model listing also fails", async () => {
    globalThis.fetch = (async (input) => {
      const url = String(input)

      if (url.includes("/chat/completions")) {
        return new Response(JSON.stringify({ error: { message: "Invalid token" } }), {
          status: 401,
          statusText: "Unauthorized",
        })
      }

      return new Response(JSON.stringify({ error: { message: "no listing" } }), {
        status: 404,
        statusText: "Not Found",
      })
    }) as typeof fetch

    const error = await Effect.runPromise(
      probeTest({
        baseURL: "https://gateway.example/v1",
        apiKey: "sk-test",
        model: "deepseek-v4.1-flash",
      }).pipe(Effect.flip),
    )

    expect(error.message).toContain("/chat/completions")
    expect(error.message).toContain("Invalid token")
  })

  test("reports chat mode when the one-token turn succeeds", async () => {
    globalThis.fetch = (async (input) => {
      if (String(input).includes("/chat/completions")) {
        return Response.json({ choices: [{ message: { content: "ok" } }] })
      }

      return new Response("not found", { status: 404 })
    }) as typeof fetch

    const result = await Effect.runPromise(
      probeTest({
        baseURL: "https://gateway.example/v1",
        apiKey: "sk-test",
        model: "deepseek-v4.1-flash",
      }),
    )

    expect(result).toEqual({ mode: "chat" })
  })
})
