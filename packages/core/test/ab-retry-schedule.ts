/**
 * 用真实 ModelRetry.policy 跑：一个 Transport/read/Timeout 错误，最多重试几次、间隔多久。
 * 不 sleep，直接读 policy 给出的 attempt / delay。
 */
import { AIError, TransportError, isRetryable } from "@opencode/ai"
import { Effect } from "effect"
import { ModelRetry } from "../src/model-retry.js"

const timeoutError = () =>
  new AIError({
    reason: new TransportError({
      message: "Timed out waiting for response data",
      transport: "http",
      operation: "read",
      code: "Timeout",
      url: "http://relay/v1/chat/completions",
    }),
  })

const program = Effect.gen(function* () {
  const decide = yield* ModelRetry.policy
  const out: { attempt: number; delay: number; retry: boolean }[] = []
  for (let i = 0; i < 8; i++) {
    const error = timeoutError()
    const next = yield* decide({ cause: error, retry: isRetryable(error) })
    if (!next) {
      out.push({ attempt: -1, delay: 0, retry: false })
      break
    }
    out.push({ attempt: next.attempt, delay: next.delay, retry: next.retry })
    if (!next.retry) break
  }
  return out
})

const rows = await Effect.runPromise(program)
console.log("\n| 第 N 次重试 | 等待 | 还会重试 |")
console.log("|---|---|---|")
for (const r of rows) {
  if (r.attempt === -1) {
    console.log(`| 超出上限 | - | 否（放弃，报错给用户） |`)
    continue
  }
  console.log(`| ${r.attempt} | ${(r.delay / 1000).toFixed(1)}s | ${r.retry ? "是" : "否（超时类已达上限）"} |`)
}
