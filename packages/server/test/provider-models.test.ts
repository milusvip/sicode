import { afterAll, describe, expect, test } from "bun:test"
import { Context, Effect, Layer } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { probeModels } from "@opencode/core/provider-probe"
import { SdkPlugins } from "@opencode/core/plugin/sdk"
import { Plugin } from "@opencode/plugin/effect"
import { createRoutes } from "../src/routes"
import { it } from "../../core/test/lib/effect"

const probe = (input: Parameters<typeof probeModels>[0]) => Effect.runPromise(probeModels(input))

const hits: { path: string; authorization?: string }[] = []

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    const authorization = request.headers.get("authorization") ?? undefined
    hits.push({ path: url.pathname, authorization })

    if (url.pathname === "/v1/models") {
      if (authorization !== "Bearer secret")
        return Response.json({ error: { message: "Invalid API key" } }, { status: 401 })
      return Response.json({
        data: [{ id: "deepseek-chat" }, { id: "deepseek-reasoner", name: "DeepSeek Reasoner" }, { id: "echo" }],
      })
    }

    if (url.pathname === "/plain/models") return Response.json([{ id: "bare-array-model" }])
    if (url.pathname === "/ollama/models") return Response.json({ models: [{ name: "llama3:8b" }] })
    if (url.pathname === "/weird/models")
      return Response.json({ data: [{ id: "dup" }, { id: "dup", name: "dup" }, { id: 42 }, null] })

    return new Response("not found", { status: 404 })
  },
})

const base = `http://localhost:${server.port}`

afterAll(() => {
  server.stop(true)
})

describe("probeModels", () => {
  test("reads the OpenAI shape from a /v1 base and sends the key as a bearer token", async () => {
    const models = await probe({ baseURL: `${base}/v1`, apiKey: "secret" })
    expect(models).toEqual([
      { id: "deepseek-chat" },
      { id: "deepseek-reasoner", name: "DeepSeek Reasoner" },
      { id: "echo" },
    ])
    expect(hits.at(-1)).toEqual({ path: "/v1/models", authorization: "Bearer secret" })
  })

  test("falls back to /v1/models when the bare base 404s", async () => {
    const before = hits.length
    const models = await probe({ baseURL: base, apiKey: "secret" })
    expect(models.map((model) => model.id)).toContain("deepseek-chat")
    const tried = hits.slice(before).map((hit) => hit.path)
    expect(tried).toEqual(["/models", "/v1/models"])
  })

  test("reads bare arrays and ollama-style listings", async () => {
    await expect(probe({ baseURL: `${base}/plain` })).resolves.toEqual([{ id: "bare-array-model" }])
    await expect(probe({ baseURL: `${base}/ollama` })).resolves.toEqual([{ id: "llama3:8b" }])
  })

  test("skips entries without a usable id and drops a matching duplicate name", async () => {
    await expect(probe({ baseURL: `${base}/weird` })).resolves.toEqual([{ id: "dup" }])
  })

  test("surfaces the endpoint's own error message", async () => {
    expect(probe({ baseURL: `${base}/v1` })).rejects.toThrow("Invalid API key")
  })

  test("rejects a base url that is not http(s)", async () => {
    expect(probe({ baseURL: "ftp://example.com" })).rejects.toThrow("http:// or https://")
  })
})

// SiCode: the form calls this over HTTP, not by importing the function — cover the wire path the
// renderer actually takes, including the 400 the handler maps probe failures to.
describe("POST /api/provider/models", () => {
  it.live("returns the probe result over the wire and maps failures to a 400 with the endpoint's message", () =>
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-provider-models-route-")),
      )
      const context = yield* Layer.build(
        createRoutes({
          password: "secret",
          database: { path: ":memory:" },
          models: { fetch: false },
          fs: { filewatcher: false },
          config: { directory, project: false, content: "{}" },
        }).pipe(Layer.provide(HttpServer.layerServices)),
      )
      // Route middleware waits for plugin activation; register a completing one so requests flow.
      yield* Context.get(context, SdkPlugins.Service).register(Plugin.define({ id: "noop", effect: () => Effect.void }))
      const handler = Context.get(context, HttpRouter.HttpRouter)
        .asHttpEffect()
        .pipe(HttpEffect.toWebHandlerWith(context))
      const post = (body: Record<string, unknown>) =>
        Effect.promise(() =>
          handler(
            new Request("http://opencode.local/api/provider/models", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: `Basic ${btoa("opencode:secret")}`,
              },
              body: JSON.stringify(body),
            }),
          ),
        )

      const ok = yield* post({ baseURL: `${base}/v1`, apiKey: "secret" })
      expect(ok.status).toBe(200)
      expect(yield* Effect.promise(() => ok.json())).toEqual({
        models: [{ id: "deepseek-chat" }, { id: "deepseek-reasoner", name: "DeepSeek Reasoner" }, { id: "echo" }],
      })

      const bad = yield* post({ baseURL: `${base}/v1` })
      expect(bad.status).toBe(400)
      expect(yield* Effect.promise(() => bad.json())).toMatchObject({
        _tag: "InvalidRequestError",
        message: expect.stringContaining("Invalid API key"),
      })
    }),
  )
})
