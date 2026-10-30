/**
 * Cursor Browser log efficiency: full console/network → file; model gets preview + path.
 * No auto-collect — only formats what browser.console / network.list already returned.
 */

import { prioritizeNetworkEvidence } from "./live-preview-urls.js"
import { redactDebugEvidenceLine, clampDebugEvidenceLine } from "./debug-evidence.js"

/** Keep this many rows in the tool JSON; the rest live in the log file. */
export const BROWSER_LOG_INLINE_MAX = 12

export type BrowserConsoleLogRow = {
  readonly id?: string
  readonly level: string
  readonly text: string
  readonly timestampMs?: number
  readonly source?: { readonly url?: string; readonly line?: number; readonly column?: number }
}

export type BrowserNetworkLogRow = {
  readonly id?: string
  readonly method?: string
  readonly url?: string
  readonly state?: string
  readonly statusCode?: number
  readonly failure?: string
  readonly resourceType?: string
}

export type BrowserLogPack = {
  /** Full log body (UTF-8 text). */
  readonly body: string
  /** Line count in the full log. */
  readonly lineCount: number
  /** Short preview lines for the tool JSON (interesting first). */
  readonly previewLines: readonly string[]
  /** True when the model should prefer the file over inlining everything. */
  readonly offload: boolean
}

export function formatConsoleLogLine(entry: BrowserConsoleLogRow) {
  const where =
    entry.source?.url !== undefined
      ? ` @ ${entry.source.url}${entry.source.line !== undefined ? `:${entry.source.line}` : ""}`
      : ""
  const id = entry.id ? ` id=${entry.id}` : ""
  return clampDebugEvidenceLine(`[console.${entry.level}] ${entry.text}${where}${id}`)
}

export function formatNetworkLogLine(entry: BrowserNetworkLogRow) {
  const method = entry.method ?? "?"
  const url = entry.url ?? "?"
  const status = entry.statusCode !== undefined ? ` ${entry.statusCode}` : ""
  const failure = entry.failure ? ` (${entry.failure})` : ""
  const state = entry.state ? ` ${entry.state}` : ""
  const id = entry.id ? ` id=${entry.id}` : ""
  const type = entry.resourceType ? ` type=${entry.resourceType}` : ""
  return clampDebugEvidenceLine(`[network]${state} ${method} ${url}${status}${failure}${type}${id}`)
}

function interestingConsoleFirst(entries: readonly BrowserConsoleLogRow[]) {
  const rank = (level: string) => {
    if (level === "error") return 0
    if (level === "warning") return 1
    return 2
  }
  return [...entries].sort((a, b) => rank(a.level) - rank(b.level))
}

/** Pack console rows: full text + error/warning-first preview. */
export function packConsoleLog(entries: readonly BrowserConsoleLogRow[]): BrowserLogPack {
  const lines = entries.map(formatConsoleLogLine).filter(Boolean)
  const previewSource = interestingConsoleFirst(entries).slice(0, BROWSER_LOG_INLINE_MAX)
  const previewLines = previewSource.map(formatConsoleLogLine).filter(Boolean)
  return {
    body: lines.length ? `${lines.join("\n")}\n` : "",
    lineCount: lines.length,
    previewLines,
    offload: lines.length > BROWSER_LOG_INLINE_MAX,
  }
}

/** Pack network rows: failure-first full text + compact preview. */
export function packNetworkLog(entries: readonly BrowserNetworkLogRow[]): BrowserLogPack {
  const ranked = prioritizeNetworkEvidence(entries)
  const lines = ranked.map(formatNetworkLogLine).filter(Boolean)
  const previewLines = ranked.slice(0, BROWSER_LOG_INLINE_MAX).map(formatNetworkLogLine).filter(Boolean)
  return {
    body: lines.length ? `${lines.join("\n")}\n` : "",
    lineCount: lines.length,
    previewLines,
    offload: lines.length > BROWSER_LOG_INLINE_MAX,
  }
}

/** Preview rows to keep in tool JSON when offloading (preserve original objects, failure-first). */
export function previewConsoleEntries<T extends BrowserConsoleLogRow>(entries: readonly T[]): T[] {
  return interestingConsoleFirst(entries).slice(0, BROWSER_LOG_INLINE_MAX) as T[]
}

export function previewNetworkEntries<T extends BrowserNetworkLogRow>(entries: readonly T[]): T[] {
  return prioritizeNetworkEvidence(entries).slice(0, BROWSER_LOG_INLINE_MAX) as T[]
}

/** One-line steer for the model when a log file was attached. */
export function browserLogFileHint(kind: "console" | "network", lineCount: number) {
  return redactDebugEvidenceLine(
    `Full ${kind} log (${lineCount} lines) is in the returned file path — use grep/read on that path for detail; tool JSON is a short preview only.`,
  )
}
