import { expect, test } from "bun:test"
import {
  extractLivePreviewUrls,
  formatLivePreviewUrls,
  hasLiveRemoteUrlTarget,
  isRemoteLiveUrl,
  liveBrowserTargetReminder,
  LIVE_BROWSER_TARGET_REMINDER,
  prioritizeNetworkEvidence,
} from "./live-preview-urls.js"

test("extracts http(s) URLs structurally and dedupes", () => {
  expect(
    extractLivePreviewUrls([
      "see https://example.com/a and https://example.com/a again",
      "local http://127.0.0.1:5173/ui,",
    ]),
  ).toEqual(["https://example.com/a", "http://127.0.0.1:5173/ui"])
})

test("formatLivePreviewUrls wraps a phantom block", () => {
  expect(formatLivePreviewUrls(["https://x.test"])).toContain("<live_preview_urls>")
  expect(formatLivePreviewUrls([])).toBeUndefined()
})

test("liveBrowserTargetReminder never injects coach copy; remote URL shape stays structural", () => {
  expect(LIVE_BROWSER_TARGET_REMINDER).toBeUndefined()
  expect(liveBrowserTargetReminder([])).toBeUndefined()
  expect(liveBrowserTargetReminder(["https://ai.example/log"])).toBeUndefined()
  expect(isRemoteLiveUrl("https://ai.example/log")).toBe(true)
  expect(isRemoteLiveUrl("http://localhost:5173")).toBe(false)
  expect(isRemoteLiveUrl("http://127.0.0.1:3000")).toBe(false)
})

test("prioritizeNetworkEvidence puts failures and 4xx+ first (Cursor evidence speed)", () => {
  const ranked = prioritizeNetworkEvidence([
    { id: "ok", state: "completed", statusCode: 200 },
    { id: "fail", state: "failed" },
    { id: "5xx", state: "completed", statusCode: 502 },
    { id: "pend", state: "pending" },
    { id: "4xx", state: "completed", statusCode: 404 },
  ])
  expect(ranked.map((row) => row.id)).toEqual(["fail", "5xx", "4xx", "pend", "ok"])
  expect(hasLiveRemoteUrlTarget("看下 https://ai.iiit.cn/meituai/dashboard 怎么回事")).toBe(true)
  expect(hasLiveRemoteUrlTarget("http://localhost:5173/app")).toBe(false)
})
