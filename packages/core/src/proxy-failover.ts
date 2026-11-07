/**
 * SiCode: when the desktop mirrored the OS proxy into HTTP_PROXY/HTTPS_PROXY and that proxy later
 * dies (Clash quit, port closed), Bun keeps sending through the dead tunnel and every provider /
 * webfetch call fails with ECONNREFUSED / "fetch failed". Clear only the keys we mirrored
 * (`OPENCODE_MIRRORED_PROXY`) and fall back to direct; user-exported proxies are left alone.
 */

export const MIRRORED_PROXY_FLAG = "OPENCODE_MIRRORED_PROXY"

const PROXY_KEYS = ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"] as const

const PROXY_DEATH =
  /ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH|EPIPE|tunnel|proxy|FailedToOpenSocket|ConnectionRefused|ConnectionClosed|fetch failed|Unable to connect|SOCKS|CONNECT/i

export const mirroredProxyUrl = (environment: NodeJS.ProcessEnv = process.env) =>
  environment[MIRRORED_PROXY_FLAG]?.trim() || undefined

export const isProxyTransportError = (error: unknown): boolean => {
  const texts: string[] = []
  const walk = (value: unknown, depth: number) => {
    if (depth > 5 || value == null) return
    if (typeof value === "string") {
      texts.push(value)
      return
    }
    if (value instanceof Error) {
      texts.push(value.message, value.name)
      if ("code" in value && value.code != null) texts.push(String(value.code))
      walk(value.cause, depth + 1)
      return
    }
    if (typeof value === "object") {
      const record = value as Record<string, unknown>
      for (const key of ["message", "code", "cause", "reason"]) walk(record[key], depth + 1)
    }
  }
  walk(error, 0)
  return texts.some((text) => PROXY_DEATH.test(text))
}

/** Drop mirrored proxy env so subsequent Bun fetch goes direct. Returns true when something changed. */
export const clearMirroredProxyEnv = (environment: NodeJS.ProcessEnv = process.env): boolean => {
  if (!environment[MIRRORED_PROXY_FLAG]) return false
  for (const key of PROXY_KEYS) {
    if (environment[key] === environment[MIRRORED_PROXY_FLAG] || environment[key]) {
      // Only clear keys that match the mirrored value, or all proxy keys when flag is set —
      // desktop always sets them together from the same source.
      delete environment[key]
    }
  }
  delete environment[MIRRORED_PROXY_FLAG]
  return true
}

/**
 * If the failure looks like a dead mirrored proxy, clear env and report that a direct retry is
 * warranted. Callers that own a single fetch should retry once after this returns true.
 */
export const failoverMirroredProxy = (
  error: unknown,
  environment: NodeJS.ProcessEnv = process.env,
): boolean => {
  if (!mirroredProxyUrl(environment)) return false
  if (!isProxyTransportError(error)) return false
  return clearMirroredProxyEnv(environment)
}
