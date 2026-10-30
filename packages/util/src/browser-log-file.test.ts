import { expect, test } from "bun:test"
import {
  BROWSER_LOG_INLINE_MAX,
  browserLogFileHint,
  packConsoleLog,
  packNetworkLog,
  previewNetworkEntries,
} from "./browser-log-file.js"

test("packConsoleLog offloads when over inline max and prefers errors in preview", () => {
  const entries = Array.from({ length: BROWSER_LOG_INLINE_MAX + 3 }, (_, index) => ({
    id: `m${index}`,
    level: index === 0 ? "info" : index === 1 ? "error" : "warning",
    text: `msg-${index}`,
  }))
  const pack = packConsoleLog(entries)
  expect(pack.offload).toBe(true)
  expect(pack.lineCount).toBe(entries.length)
  expect(pack.body).toContain("[console.error] msg-1")
  expect(pack.previewLines[0]).toContain("[console.error]")
  expect(pack.previewLines.length).toBeLessThanOrEqual(BROWSER_LOG_INLINE_MAX)
})

test("packNetworkLog failure-first and hint mentions grep/read", () => {
  const pack = packNetworkLog([
    { id: "a", method: "GET", url: "https://x/ok", state: "completed", statusCode: 200 },
    { id: "b", method: "POST", url: "https://x/fail", state: "failed", failure: "net" },
    { id: "c", method: "GET", url: "https://x/404", state: "completed", statusCode: 404 },
  ])
  expect(pack.body.split("\n")[0]).toContain("id=b")
  expect(
    previewNetworkEntries([
      { id: "a", method: "GET", url: "https://x/ok", state: "completed", statusCode: 200 },
      { id: "b", method: "POST", url: "https://x/fail", state: "failed" },
    ])[0]?.id,
  ).toBe("b")
  expect(browserLogFileHint("network", 9)).toContain("grep/read")
  expect(pack.offload).toBe(false)
})
