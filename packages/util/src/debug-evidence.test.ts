import { expect, test } from "bun:test"
import {
  clampDebugEvidenceLine,
  formatConsoleEvidence,
  formatNetworkEvidence,
  mergeDebugEvidence,
  parseBrowserConsoleResult,
  parseBrowserNetworkResult,
  redactDebugEvidenceLine,
} from "./debug-evidence.js"

test("redactDebugEvidenceLine strips secret-looking assignments", () => {
  expect(redactDebugEvidenceLine("Authorization: Bearer abc123")).toContain("[redacted]")
  expect(redactDebugEvidenceLine("cookie=session=xyz")).toContain("[redacted]")
  expect(redactDebugEvidenceLine("normal error")).toBe("normal error")
})

test("formatConsoleEvidence keeps warning/error only and respects sinceMs", () => {
  const lines = formatConsoleEvidence(
    [
      { level: "info", text: "noise", timestampMs: 20 },
      { level: "error", text: "boom", timestampMs: 30 },
      { level: "warning", text: "old", timestampMs: 5 },
    ],
    10,
  )
  expect(lines).toEqual(["[console.error] boom"])
})

test("formatNetworkEvidence keeps failed and HTTP >=400", () => {
  expect(
    formatNetworkEvidence([
      { method: "GET", url: "/ok", state: "completed", statusCode: 200 },
      { method: "POST", url: "/fail", state: "failed", failure: "net::ERR" },
      { method: "GET", url: "/gone", state: "completed", statusCode: 404 },
    ]),
  ).toEqual(["[network] POST /fail (net::ERR)", "[network] GET /gone 404"])
})

test("mergeDebugEvidence prefers agent lines, dedupes, clamps", () => {
  const long = "x".repeat(600)
  expect(mergeDebugEvidence(["a", long], ["a", "b"])).toEqual(["a", `${"x".repeat(499)}…`, "b"])
})

test("parseBrowser*Result is structural", () => {
  expect(
    parseBrowserConsoleResult({
      messages: [{ level: "error", text: "x", timestampMs: 1 }],
    }),
  ).toEqual([{ level: "error", text: "x", timestampMs: 1, source: undefined }])
  expect(
    parseBrowserNetworkResult({
      requests: [{ method: "GET", url: "/a", state: "failed", failure: "x" }],
    }),
  ).toEqual([{ method: "GET", url: "/a", state: "failed", failure: "x", statusCode: undefined, timestampMs: undefined }])
})

test("clampDebugEvidenceLine drops empty", () => {
  expect(clampDebugEvidenceLine("   ")).toBe("")
})
