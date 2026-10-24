/** A cookie the pane can write for the current page. */
export type CookieDraft = {
  name: string
  value: string
  domain?: string
  path?: string
  secure?: boolean
  httpOnly?: boolean
  /** Unix seconds, as Electron's cookies.set expects. */
  expirationDate?: number
  sameSite?: "unspecified" | "no_restriction" | "lax" | "strict"
}

/** What Electron's session.cookies.set accepts for one cookie. */
export type CookieSet = {
  url: string
  name: string
  value: string
  domain?: string
  path?: string
  secure?: boolean
  httpOnly?: boolean
  expirationDate?: number
  sameSite?: CookieDraft["sameSite"]
}

/** The longest paste the pane accepts, also the Ipc schema's bound. */
export const MAX_COOKIE_TEXT = 262_144

/**
 * Parse pasted login cookies: a `Cookie` header (`a=1; b=2`, or one pair per line as DevTools and most
 * cookie listings copy them), a JSON name→value map, or a JSON array of cookie objects (Chrome /
 * EditThisCookie style).
 */
export function parseCookies(input: string): CookieDraft[] {
  const text = input.trim()

  if (!text) return []

  if (text.length > MAX_COOKIE_TEXT) throw new Error("Cookie paste is too large.")

  if (text.startsWith("{") || text.startsWith("[")) return fromJSON(text)

  return fromHeader(text)
}

/** Turn drafts into cookie.set payloads scoped to the open page; rejects unrelated domains. */
export function cookiesForPage(pageURL: string, drafts: readonly CookieDraft[]): CookieSet[] {
  if (!URL.canParse(pageURL)) throw new Error("Open a web page before pasting cookies.")
  const page = new URL(pageURL)

  if (!/^https?:$/.test(page.protocol)) throw new Error("Cookies can only be set on http(s) pages.")

  if (drafts.length === 0) throw new Error("No cookies found in the paste.")

  return drafts.map((draft) => {
    if (!draft.name) throw new Error("Each cookie needs a name.")
    const domain = draft.domain?.trim()

    if (domain && !hostMatches(page.hostname, domain)) {
      throw new Error(`Cookie "${draft.name}" targets ${domain}, which does not match ${page.hostname}.`)
    }

    const secure = draft.secure ?? page.protocol === "https:"
    const path = draft.path?.trim() || "/"
    // Host-only cookies omit domain; domain cookies keep the pasted host (with or without a leading dot).
    const url = cookieSetURL(page, domain, path, secure)

    return cookieSet({ url, draft, domain, path, secure })
  })
}

/**
 * Cookies pasted with no page open: each names its own domain, which the paste then writes for. A cookie without one
 * has nowhere to go, so it fails with the reason instead of landing on a site the user did not pick.
 */
export function cookiesForDomain(drafts: readonly CookieDraft[]): CookieSet[] {
  if (drafts.length === 0) throw new Error("No cookies found in the paste.")

  return drafts.map((draft) => {
    if (!draft.name) throw new Error("Each cookie needs a name.")
    const domain = draft.domain?.trim()

    if (!domain) throw new Error(`Cookie "${draft.name}" needs a domain: no page is open to write it for.`)
    const path = draft.path?.trim() || "/"
    // Without a page there is no scheme to inherit; the paste's own or https, as a login usually is.
    const secure = draft.secure ?? true
    const host = domain.replace(/^\./, "")
    const url = `${secure ? "https:" : "http:"}//${host}${path.startsWith("/") ? path : `/${path}`}`

    return cookieSet({ url, draft, domain, path, secure })
  })
}

function cookieSet(input: { url: string; draft: CookieDraft; domain?: string; path: string; secure: boolean }): CookieSet {
  const { draft } = input

  return {
    url: input.url,
    name: draft.name,
    value: draft.value,
    ...(input.domain ? { domain: input.domain } : undefined),
    path: input.path,
    secure: input.secure,
    ...(draft.httpOnly !== undefined ? { httpOnly: draft.httpOnly } : undefined),
    ...(draft.expirationDate !== undefined ? { expirationDate: draft.expirationDate } : undefined),
    ...(draft.sameSite ? { sameSite: draft.sameSite } : undefined),
  }
}

export function hostMatches(pageHost: string, domain: string) {
  const host = pageHost.toLowerCase()
  const target = domain.replace(/^\./, "").toLowerCase()

  return host === target || host.endsWith(`.${target}`)
}

function fromHeader(text: string): CookieDraft[] {
  // A Cookie header separates pairs with ";", but a listing copied from DevTools or a site's own docs puts one pair
  // per line. A cookie value can carry neither a ";" nor a newline, so both are separators here.
  return text
    .split(/[;\r\n]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const index = part.indexOf("=")

      if (index <= 0) throw new Error(`Invalid cookie pair: ${part}`)

      return { name: part.slice(0, index).trim(), value: part.slice(index + 1).trim() }
    })
}

function fromJSON(text: string): CookieDraft[] {
  let value: unknown

  try {
    value = JSON.parse(text)
  } catch {
    throw new Error("Cookie JSON could not be parsed.")
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => {
      if (!item || typeof item !== "object") throw new Error(`Cookie at index ${index} is not an object.`)

      return fromObject(item as Record<string, unknown>, `at index ${index}`)
    })
  }

  if (value && typeof value === "object") {
    // EditThisCookie / cookie-editor sometimes wrap a list.
    const record = value as Record<string, unknown>

    if (Array.isArray(record.cookies)) return fromJSON(JSON.stringify(record.cookies))

    return Object.entries(record).map(([name, entry]) => {
      if (entry && typeof entry === "object") return fromObject({ name, ...(entry as object) }, `named ${name}`)

      return { name, value: String(entry ?? "") }
    })
  }

  throw new Error("Cookie JSON must be an array or an object.")
}

function fromObject(item: Record<string, unknown>, where: string): CookieDraft {
  const name = stringField(item, "name") ?? stringField(item, "Name")

  if (!name) throw new Error(`Cookie ${where} is missing a name.`)
  const value = stringField(item, "value") ?? stringField(item, "Value") ?? ""
  const domain = stringField(item, "domain") ?? stringField(item, "Domain")
  const path = stringField(item, "path") ?? stringField(item, "Path")
  const secure = boolField(item, "secure") ?? boolField(item, "Secure")
  const httpOnly = boolField(item, "httpOnly") ?? boolField(item, "HttpOnly") ?? boolField(item, "http_only")
  const expirationDate = expiry(item)
  const sameSite = sameSiteField(item)

  return {
    name,
    value,
    ...(domain ? { domain } : undefined),
    ...(path ? { path } : undefined),
    ...(secure !== undefined ? { secure } : undefined),
    ...(httpOnly !== undefined ? { httpOnly } : undefined),
    ...(expirationDate !== undefined ? { expirationDate } : undefined),
    ...(sameSite ? { sameSite } : undefined),
  }
}

function stringField(item: Record<string, unknown>, key: string) {
  const value = item[key]

  return typeof value === "string" ? value : undefined
}

function boolField(item: Record<string, unknown>, key: string) {
  const value = item[key]

  return typeof value === "boolean" ? value : undefined
}

function expiry(item: Record<string, unknown>) {
  const seconds = item.expirationDate ?? item.expiration_date ?? item.expires

  if (typeof seconds === "number" && Number.isFinite(seconds)) {
    // Milliseconds from some exporters.
    return seconds > 1e12 ? Math.floor(seconds / 1000) : seconds
  }

  if (typeof seconds === "string" && seconds.trim()) {
    const parsed = Date.parse(seconds)

    if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000)
  }
}

function sameSiteField(item: Record<string, unknown>): CookieDraft["sameSite"] | undefined {
  const value = stringField(item, "sameSite") ?? stringField(item, "same_site") ?? stringField(item, "SameSite")

  if (!value) return

  const normalized = value.toLowerCase().replace(/-/g, "_")

  if (normalized === "no_restriction" || normalized === "none") return "no_restriction"

  if (normalized === "lax") return "lax"

  if (normalized === "strict") return "strict"

  if (normalized === "unspecified") return "unspecified"
}

function cookieSetURL(page: URL, domain: string | undefined, path: string, secure: boolean) {
  if (!domain) return `${page.protocol}//${page.host}${path.startsWith("/") ? path : `/${path}`}`
  const host = domain.replace(/^\./, "")
  const scheme = secure || page.protocol === "https:" ? "https:" : "http:"

  return `${scheme}//${host}${path.startsWith("/") ? path : `/${path}`}`
}
