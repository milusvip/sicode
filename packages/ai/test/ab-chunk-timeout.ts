/**
 * A/B：chunkTimeout 改前(900000) vs 改后(30000)
 *
 * 跑的是 SiCode 真实传输层代码（packages/ai/src/route/transport/http.ts 的
 * Stream.timeoutOrElse + DEFAULT_CHUNK_TIMEOUT_MS），只把时钟换成虚拟时钟，
 * 所以 900s / 30s 都能瞬间测完，不用真等 15 分钟。
 *
 * 场景：服务端发 1 个 delta 后彻底静默（正是"中转站挂住"的形态）。
 */
import { Deferred, Effect, Exit, Fiber } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { LLM, isRetryable } from "../src/index.js"
import { LLMClient } from "../src/route.js"
import { configure } from "../src/providers/openai.js"
import { dynamicResponse } from "./lib/http.js"
import { deltaChunk, finishChunk } from "./lib/openai-chunks.js"
import { sseEvents, sseRaw } from "./lib/sse.js"

const model = configure({ baseURL: "https://api.openai.test/v1/", apiKey: "test" }).chat("gpt-4.1-mini")
const SSE = { headers: { "content-type": "text/event-stream" } }

const stalledServer = Effect.gen(function* () {
  const stalled = yield* Deferred.make<void>()
  let resume = () => {}
  const released = new Promise<void>((resolve) => (resume = resolve))
  const encoder = new TextEncoder()
  const layer = dynamicResponse((input) =>
    Effect.sync(() =>
      input.respond(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(sseRaw(`data: ${JSON.stringify(deltaChunk({ content: "Hi" }))}`)))
          },
          async pull(controller) {
            Deferred.doneUnsafe(stalled, Effect.void)
            await released
            controller.enqueue(encoder.encode(sseEvents(finishChunk("stop"))))
            controller.close()
          },
        }),
        SSE,
      ),
    ),
  )
  return { layer, stalled, resume: () => resume() }
})

type Row = {
  label: string
  chunkTimeout: number | false
  detectedMs?: number
  kind: string
  retryable?: boolean
  text?: string
}

const measure = (label: string, chunkTimeout: number | false | "default") =>
  Effect.gen(function* () {
    const server = yield* stalledServer
    const start = yield* Effect.clockWith((c) => c.currentTimeMillis)
    const row: Row = { label, chunkTimeout: chunkTimeout === "default" ? undefined : chunkTimeout, kind: "-" }

    const request =
      chunkTimeout === "default"
        ? LLM.request({ model, prompt: "Hello" })
        : LLM.request({ model, prompt: "Hello", http: { chunkTimeout } })

    const program = LLMClient.generate(request).pipe(
      Effect.provide(server.layer),
      Effect.tapError((error) =>
        Effect.gen(function* () {
          const now = yield* Effect.clockWith((c) => c.currentTimeMillis)
          row.detectedMs = now - start
          row.kind = `${error.reason._tag}/${(error.reason as any).operation ?? "-"}/${(error.reason as any).code ?? "-"}`
          row.retryable = isRetryable(error)
        }),
      ),
      Effect.map((response) => {
        const now = 0
        row.text = response.text
      }),
      Effect.exit,
    )

    const fiber = yield* Effect.forkChild(program, { startImmediately: true })
    yield* Deferred.await(server.stalled)
    yield* Effect.yieldNow

    // 快进 920s：覆盖改前的 900s 窗口
    yield* TestClock.adjust("920 seconds")
    yield* Effect.yieldNow

    // 若还没结束（关掉超时的情况），放行让它正常收尾
    server.resume()
    yield* Effect.yieldNow
    yield* TestClock.adjust("1 second")

    const exit = yield* Fiber.join(fiber)
    if (Exit.isSuccess(exit)) {
      if (row.kind === "-") row.kind = "成功"
    }
    return row
  }).pipe(Effect.provide(TestClock.layer()))

const fmt = (ms: number | undefined) => (ms === undefined ? "未触发" : `${(ms / 1000).toFixed(0)}s`)

const rows: Row[] = []
for (const [label, ms] of [
  ["改前(显式900s)", 900_000],
  ["改后(不配置，走默认)", "default"],
  ["改后(显式30s)", 30_000],
  ["关掉超时(对照)", false],
] as const) {
  rows.push(await Effect.runPromise(measure(label, ms) as Effect.Effect<Row>))
}

console.log("\n| 配置 | chunkTimeout | 静默多久后报错 | 错误形态 | 可重试 |")
console.log("|---|---|---|---|---|")
for (const r of rows) {
  console.log(
    `| ${r.label} | ${r.chunkTimeout === false ? "false" : (r.chunkTimeout ?? "默认")} | ${fmt(r.detectedMs)} | ${r.kind} | ${
      r.retryable === undefined ? "-" : r.retryable
    } |`,
  )
}
