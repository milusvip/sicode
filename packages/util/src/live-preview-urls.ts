/**
 * Structural http(s) URL harvest for UI live-preview context.
 * No chat-phrase tables — only URL shape from user-authored text.
 */

const URL_RE = /https?:\/\/[^\s<>"'`)\]},]+/gi

/** Strip common trailing punctuation that is not part of the URL. */
function cleanUrl(raw: string) {
  return raw.replace(/[.,;:!?)]+$/g, "")
}

/**
 * Unique http(s) URLs from free text (newest-first texts preferred by caller order).
 * Caps length; skips empty / non-http.
 */
export function extractLivePreviewUrls(texts: readonly string[], limit = 5): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const text of texts) {
    if (!text) continue
    const matches = text.match(URL_RE)
    if (!matches) continue
    for (const match of matches) {
      const url = cleanUrl(match)
      if (!/^https?:\/\//i.test(url)) continue
      if (seen.has(url)) continue
      seen.add(url)
      out.push(url)
      if (out.length >= limit) return out
    }
  }
  return out
}

/** Phantom IDE block — structural URLs for smart open / reuse. */
export function formatLivePreviewUrls(urls: readonly string[]) {
  if (urls.length === 0) return
  return ["<live_preview_urls>", ...urls.map((url) => `- ${url}`), "</live_preview_urls>"].join("\n")
}

/**
 * Retired coach inject — live browser opt-in is `<live_preview_urls>` + system.txt,
 * not reminder prose. Kept empty so call sites / tests can assert "no coach inject".
 */
export const LIVE_BROWSER_TARGET_REMINDER = undefined

/** True when hostname is not loopback. */
export function isRemoteLiveUrl(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (!host) return false
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") return false
    if (host.endsWith(".localhost")) return false
    return true
  } catch {
    return false
  }
}

/** Structural: user text names a non-localhost http(s) target. */
export function hasLiveRemoteUrlTarget(text: string) {
  return extractLivePreviewUrls([text]).some((url) => isRemoteLiveUrl(url))
}

/** Never inject live-browser coach copy (`<live_preview_urls>` + system.txt own the gate). */
export function liveBrowserTargetReminder(_urls: readonly string[]) {
  return
}

/**
 * Cursor evidence speed: put failed / 4xx+ / pending ahead of 2xx noise.
 * Structural on request state + statusCode only — no phrase tables.
 */
export function prioritizeNetworkEvidence<
  T extends { readonly state?: string; readonly statusCode?: number },
>(requests: readonly T[]): T[] {
  if (requests.length <= 1) return [...requests]
  return [...requests].sort((a, b) => networkEvidenceRank(a) - networkEvidenceRank(b))
}

function networkEvidenceRank(request: { readonly state?: string; readonly statusCode?: number }) {
  if (request.state === "failed") return 0
  const code = request.statusCode
  if (typeof code === "number") {
    if (code >= 500) return 1
    if (code >= 400) return 2
    if (code === 0) return 3
  }
  if (request.state === "pending") return 4
  return 5
}
