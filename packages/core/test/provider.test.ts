import { describe, expect, test } from "bun:test"
import path from "node:path"
import { Effect } from "effect"
import { Provider } from "@opencode/core/provider"

describe("Provider", () => {
  test("bundles every native provider entrypoint that exports model()", async () => {
    const providers = path.join(import.meta.dir, "../../ai/src/providers")
    const entrypoints = await Promise.all(
      Array.from(new Bun.Glob("**/*.ts").scanSync(providers)).map(async (file) => {
        // Bun.Glob yields native separators, and package specifiers always use "/".
        const specifier = `@opencode/ai/providers/${file.replace(/\.ts$/, "").replaceAll(path.sep, "/")}`
        const module = await import(specifier)
        return typeof module.model === "function" ? specifier : undefined
      }),
    )
    const packages = entrypoints.filter((specifier) => specifier !== undefined).toSorted()

    expect(packages.filter((specifier) => !Provider.builtinPackages.has(specifier))).toEqual([])
    expect(Array.from(Provider.builtinPackages).toSorted()).toEqual(packages)
    for (const specifier of packages) {
      const loaded = await Effect.runPromise(Provider.loadPackage(specifier))
      expect(loaded.model).toBeFunction()
    }
  })

  test("passes flat settings to native packages without Core settings", () => {
    expect(
      Provider.nativeSettings({
        apiKey: "secret",
        reasoningEffort: "high",
        chunkTimeout: 1000,
        compaction: { type: "native" },
        transport: "websocket",
      }),
    ).toEqual({
      apiKey: "secret",
      reasoningEffort: "high",
    })
  })

  test("inherits shared and loose settings without provider-only policies", () => {
    expect(
      Provider.modelSettings({
        timeout: 60_000,
        chunkTimeout: 30_000,
        transport: "websocket",
        compaction: { type: "native" },
        reasoningEffort: "high",
      }),
    ).toEqual({
      compaction: { type: "native" },
      reasoningEffort: "high",
    })
  })

  test("DeepSeek model ids default to a long chunkTimeout; others keep the short dead-relay window", () => {
    expect(Provider.defaultChunkTimeoutMs("deepseek-v4.1-flash")).toBe(Provider.DEEPSEEK_CHUNK_TIMEOUT_MS)
    expect(Provider.defaultChunkTimeoutMs("gpt-4o")).toBe(Provider.DEFAULT_CHUNK_TIMEOUT_MS)
    expect(Provider.timeouts({}, "m-c-api/deepseek-v4.1-flash").chunkTimeout).toBe(
      Provider.DEEPSEEK_CHUNK_TIMEOUT_MS,
    )
    expect(Provider.timeouts({ chunkTimeout: 12_000 }, "deepseek-v4.1-flash").chunkTimeout).toBe(12_000)
    expect(Provider.timeouts({ chunkTimeout: false }, "deepseek-v4.1-flash").chunkTimeout).toBe(false)
    expect(Provider.timeouts({}).chunkTimeout).toBe(Provider.DEFAULT_CHUNK_TIMEOUT_MS)
  })
})
