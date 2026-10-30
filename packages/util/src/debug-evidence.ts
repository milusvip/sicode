/** Format/redact browser console + network rows for Debug reproduction evidence (Cursor-style). */

export const DEBUG_EVIDENCE_MAX_LINES = 40
export const DEBUG_EVIDENCE_MAX_LINE_CHARS = 500

export type DebugConsoleEntry = {
  readonly level: string
  readonly text: string
  readonly timestampMs?: number
  readonly source?: { readonly url?: string; readonly line?: number }
}

export type DebugNetworkEntry = {
  readonly method: string
  readonly url: string
  readonly state: string
  readonly statusCode?: number
  readonly failure?: string
  readonly timestampMs?: number
}

const SECRET =
  /\b(authorization|proxy-authorization|cookie|set-cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\b\s*[:=]\s*\S+/gi

export function redactDebugEvidenceLine(line: string) {
  return line.replace(SECRET, (_, name: string) => `${name}=[redacted]`)
}

export function clampDebugEvidenceLine(line: string) {
  const redacted = redactDebugEvidenceLine(line.trim())
  if (!redacted) return ""
  if (redacted.length <= DEBUG_EVIDENCE_MAX_LINE_CHARS) return redacted

  return `${redacted.slice(0, DEBUG_EVIDENCE_MAX_LINE_CHARS - 1)}…`
}

export function formatConsoleEvidence(entries: readonly DebugConsoleEntry[], sinceMs?: number) {
  return entries.flatMap((entry) => {
    if (sinceMs !== undefined && entry.timestampMs !== undefined && entry.timestampMs < sinceMs) return []
    if (entry.level !== "error" && entry.level !== "warning") return []
    const where =
      entry.source?.url !== undefined
        ? ` @ ${entry.source.url}${entry.source.line !== undefined ? `:${entry.source.line}` : ""}`
        : ""
    const line = clampDebugEvidenceLine(`[console.${entry.level}] ${entry.text}${where}`)

    return line ? [line] : []
  })
}

export function formatNetworkEvidence(entries: readonly DebugNetworkEntry[], sinceMs?: number) {
  return entries.flatMap((entry) => {
    if (sinceMs !== undefined && entry.timestampMs !== undefined && entry.timestampMs < sinceMs) return []
    const failed = entry.state === "failed"
    const httpError = entry.statusCode !== undefined && entry.statusCode >= 400
    if (!failed && !httpError) return []
    const status = entry.statusCode !== undefined ? ` ${entry.statusCode}` : ""
    const failure = entry.failure ? ` (${entry.failure})` : ""
    const line = clampDebugEvidenceLine(`[network] ${entry.method} ${entry.url}${status}${failure}`)

    return line ? [line] : []
  })
}

/** Prefer agent-supplied lines, then auto-collected; dedupe exact matches; cap count. */
export function mergeDebugEvidence(agentLogs: readonly string[], autoLogs: readonly string[]) {
  const seen = new Set<string>()
  const out: string[] = []

  for (const raw of [...agentLogs, ...autoLogs]) {
    const line = clampDebugEvidenceLine(raw)
    if (!line || seen.has(line)) continue
    seen.add(line)
    out.push(line)
    if (out.length >= DEBUG_EVIDENCE_MAX_LINES) break
  }

  return out
}

export function parseBrowserConsoleResult(value: unknown): DebugConsoleEntry[] {
  if (!value || typeof value !== "object") return []
  const messages = (value as { messages?: unknown }).messages
  if (!Array.isArray(messages)) return []

  return messages.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const record = item as Record<string, unknown>
    if (typeof record.level !== "string" || typeof record.text !== "string") return []
    const source =
      record.source && typeof record.source === "object"
        ? {
            url:
              typeof (record.source as { url?: unknown }).url === "string"
                ? (record.source as { url: string }).url
                : undefined,
            line:
              typeof (record.source as { line?: unknown }).line === "number"
                ? (record.source as { line: number }).line
                : undefined,
          }
        : undefined

    return [
      {
        level: record.level,
        text: record.text,
        timestampMs: typeof record.timestampMs === "number" ? record.timestampMs : undefined,
        source,
      },
    ]
  })
}

export function parseBrowserNetworkResult(value: unknown): DebugNetworkEntry[] {
  if (!value || typeof value !== "object") return []
  const requests = (value as { requests?: unknown }).requests
  if (!Array.isArray(requests)) return []

  return requests.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const record = item as Record<string, unknown>
    if (typeof record.method !== "string" || typeof record.url !== "string" || typeof record.state !== "string")
      return []

    return [
      {
        method: record.method,
        url: record.url,
        state: record.state,
        statusCode: typeof record.statusCode === "number" ? record.statusCode : undefined,
        failure: typeof record.failure === "string" ? record.failure : undefined,
        timestampMs: typeof record.timestampMs === "number" ? record.timestampMs : undefined,
      },
    ]
  })
}
