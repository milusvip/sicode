import { Option, Schema } from "effect"

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
  return parseLoginPaste(input).cookies
}

/** A login handed over in one paste: the cookies, the localStorage half, and the page both came from. */
export type LoginPaste = {
  cookies: CookieDraft[]
  /** A dump's localStorage entries by name; absent when the paste carries none. */
  storage?: Record<string, string>
  /** The page the paste was copied from, when it names one. */
  url?: string
}

/**
 * Parse a login paste. Besides the cookie shapes {@link parseCookies} takes, this understands the dump the
 * browser extension's「复制登录态」copies — a `网址：`, a `cookie：`, and a `Token：` section, one `name=value` per
 * line — and the JSON form that replaces it, which also carries each cookie's domain and the localStorage entries.
 *
 * A site that keeps its session in localStorage cannot be signed in by cookies alone, so the two halves travel
 * together and the caller writes both.
 */
export function parseLoginPaste(input: string): LoginPaste {
  const text = input.trim()

  if (!text) return { cookies: [] }

  if (text.length > MAX_COOKIE_TEXT) throw new Error("Cookie paste is too large.")

  if (text.startsWith("{") || text.startsWith("[")) return fromJSON(text)

  // The dump always opens with the page it came from; without it a paste is just a Cookie header.
  if (DUMP_URL.test(text.split(/\r?\n/, 1)[0] ?? "")) return fromDump(text)

  return { cookies: fromHeader(text) }
}

/** A dump's first line names the page, with the label in whichever language the extension's popup used. */
const DUMP_URL = /^(?:网址|網址|url)\s*[:：]/i

/** The line that starts the dump's cookie section; the lines that follow are `name=value`. */
const DUMP_COOKIES = /^(?:cookie|cookies)\s*[:：]\s*$/i

/** The line that starts the dump's localStorage section, which the extension also labels「Token」. */
const DUMP_STORAGE = /^(?:token|storage|localstorage)\s*[:：]\s*$/i

/** How the dump marks a localStorage entry: `name=value（localStorage）`, in either bracket width. */
const DUMP_ENTRY = /\s*[（(]\s*localstorage\s*[）)]\s*$/i

/**
 * The dump the extension's「复制登录态」copies. It is written for a person to read, so nothing is escaped: the page on
 * the first line, then a `cookie：` section and a `Token：` section of one `name=value` per line. Its cookies carry no
 * domain, so the page it names is what tells the pane which site they belong to.
 */
function fromDump(text: string): LoginPaste {
  const cookies: CookieDraft[] = []
  const storage: Record<string, string> = {}
  let url: string | undefined
  let section: "cookies" | "storage" = "cookies"

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()

    if (!line) continue

    const page = DUMP_URL.exec(line)

    if (page) {
      url = line.slice(page[0].length).trim()

      continue
    }

    if (DUMP_COOKIES.test(line)) {
      section = "cookies"

      continue
    }

    if (DUMP_STORAGE.test(line)) {
      section = "storage"

      continue
    }

    // A value can carry anything but a line break, so the first "=" separates the name from the rest.
    const entry = section === "storage" ? line.replace(DUMP_ENTRY, "") : line
    const stored = section === "storage" || DUMP_ENTRY.test(line)
    const index = entry.indexOf("=")

    if (index <= 0) throw new Error(`Invalid ${stored ? "localStorage" : "cookie"} pair: ${entry}`)

    const name = entry.slice(0, index).trim()
    const value = entry.slice(index + 1)

    if (stored) storage[name] = value
    else cookies.push({ name, value: value.trim() })
  }

  return {
    cookies,
    ...(Object.keys(storage).length > 0 ? { storage } : undefined),
    ...(url ? { url } : undefined),
  }
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
    // Host-only cookies omit domain; domain cookies keep the pasted host (leading dot stripped for Electron).
    const url = cookieSetURL(page, domain, path, secure)

    return cookieSet({ url, draft, domain: domain?.replace(/^\./, ""), path, secure })
  })
}

/**
 * Cookies pasted with no page open: each names its own domain, which the paste then writes for. A dump names the page
 * instead of every cookie's domain, so `source` stands in for it — the cookie is then written for that host alone,
 * host-only, exactly as the site set it. A cookie with neither has nowhere to go and fails instead of landing on a
 * site the user did not pick.
 */
export function cookiesForDomain(drafts: readonly CookieDraft[], source?: string): CookieSet[] {
  if (drafts.length === 0) throw new Error("No cookies found in the paste.")

  const pageURL = source && URL.canParse(source) ? new URL(source) : undefined
  const page = pageURL && /^https?:$/.test(pageURL.protocol) ? pageURL : undefined

  return drafts.map((draft) => {
    if (!draft.name) throw new Error("Each cookie needs a name.")
    const domain = draft.domain?.trim()
    const path = draft.path?.trim() || "/"

    if (!domain) {
      if (!page) throw new Error(`Cookie "${draft.name}" needs a domain: no page is open to write it for.`)
      const secure = draft.secure ?? page.protocol === "https:"
      // No `domain` field: a host-only cookie is what a site sets for itself, and it must not leak to subdomains.

      return cookieSet({ url: cookieSetURL(page, undefined, path, secure), draft, path, secure })
    }

    // Without a page there is no scheme to inherit; the paste's own or https, as a login usually is.
    // SiCode: chrome.cookies.getAll returns a leading-dot domain (`.example.com`), which Electron's
    // cookies.set rejects; strip it so the domain matches the URL we write at.
    const secure = draft.secure ?? true
    const host = domain.replace(/^\./, "")
    const url = `${secure ? "https:" : "http:"}//${host}${path.startsWith("/") ? path : `/${path}`}`

    return cookieSet({ url, draft, domain: host, path, secure })
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

/**
 * The address a cookie is written or removed at: its domain without the leading dot, its path, and its scheme. An IPv6
 * host needs its brackets in a URL.
 */
export function cookieURL(cookie: { domain?: string; path?: string; secure?: boolean }) {
  const domain = (cookie.domain ?? "").replace(/^\./, "")
  const host = domain.includes(":") && !domain.startsWith("[") ? `[${domain}]` : domain

  return `${cookie.secure ? "https" : "http"}://${host}${cookie.path ?? "/"}`
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

/** An expiry as exporters write it: Unix seconds, Unix milliseconds, or a date string. */
const Expiry = Schema.Union([Schema.Number, Schema.String])

/**
 * One cookie object from a paste. Every field is optional and both spellings are accepted, because Chrome, EditThisCookie,
 * cookie-editor and DevTools each capitalize a different subset. Exports also carry fields this pane ignores (`hostOnly`,
 * `session`, `storeId`), so decoding ignores excess properties rather than rejecting the paste.
 */
const CookieItem = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  Name: Schema.optionalKey(Schema.String),
  value: Schema.optionalKey(Schema.String),
  Value: Schema.optionalKey(Schema.String),
  domain: Schema.optionalKey(Schema.String),
  Domain: Schema.optionalKey(Schema.String),
  path: Schema.optionalKey(Schema.String),
  Path: Schema.optionalKey(Schema.String),
  secure: Schema.optionalKey(Schema.Boolean),
  Secure: Schema.optionalKey(Schema.Boolean),
  httpOnly: Schema.optionalKey(Schema.Boolean),
  HttpOnly: Schema.optionalKey(Schema.Boolean),
  http_only: Schema.optionalKey(Schema.Boolean),
  expirationDate: Schema.optionalKey(Expiry),
  expiration_date: Schema.optionalKey(Expiry),
  expires: Schema.optionalKey(Expiry),
  sameSite: Schema.optionalKey(Schema.String),
  same_site: Schema.optionalKey(Schema.String),
  SameSite: Schema.optionalKey(Schema.String),
})

type Item = typeof CookieItem.Type

/** A name→value map, or a name→cookie-object map: both are pasted as one object. */
const CookieMap = Schema.Record(
  Schema.String,
  Schema.Union([Schema.String, Schema.Number, Schema.Boolean, Schema.Null, CookieItem]),
)

const Decode = { onExcessProperty: "ignore" } as const

/** A JSON object whose values a schema decides on; the shape a wrapper's `localStorage` arrives in. */
const Dictionary = Schema.Record(Schema.String, Schema.Unknown)

type Dictionary = typeof Dictionary.Type

/** One localStorage entry; JSON may have turned a number or a flag into its own type. */
const Entry = Schema.Union([Schema.String, Schema.Number, Schema.Boolean])

const decodeEntry = Schema.decodeUnknownOption(Entry)

const decodeJSON = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

const decodeArray = Schema.decodeUnknownOption(Schema.Array(Schema.Unknown))

/** A paste that wraps its parts: the extension's own JSON dump, or any exporter that also names the page. */
const LoginWrapper = Schema.Struct({
  url: Schema.optionalKey(Schema.String),
  cookies: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  localStorage: Schema.optionalKey(Dictionary),
})

const decodeWrapper = Schema.decodeUnknownOption(LoginWrapper, Decode)

const decodeMap = Schema.decodeUnknownOption(CookieMap, Decode)

const decodeItem = Schema.decodeUnknownOption(CookieItem, Decode)

function fromJSON(text: string): LoginPaste {
  const parsed = Option.getOrUndefined(decodeJSON(text))

  if (parsed === undefined) throw new Error("Cookie JSON could not be parsed.")

  const array = Option.getOrUndefined(decodeArray(parsed))

  if (array) return { cookies: draftsOf(array) }

  // EditThisCookie / cookie-editor sometimes wrap a list; a dump also carries the page and the localStorage.
  const wrapped = Option.getOrUndefined(decodeWrapper(parsed))

  if (wrapped && (wrapped.cookies || wrapped.localStorage))
    return {
      cookies: wrapped.cookies ? draftsOf(wrapped.cookies) : [],
      ...(wrapped.localStorage ? { storage: entriesOf(wrapped.localStorage) } : undefined),
      ...(wrapped.url ? { url: wrapped.url } : undefined),
    }

  const map = Option.getOrUndefined(decodeMap(parsed))

  if (map)
    return {
      cookies: Object.entries(map).map(([name, entry]) => {
        const item = Option.getOrUndefined(decodeItem(entry))

        // The key names the cookie unless the value is an object that says otherwise.
        return item ? draft({ name, ...item }, `named ${name}`) : { name, value: String(entry ?? "") }
      }),
    }

  throw new Error("Cookie JSON must be an array or an object.")
}

/** localStorage is strings, but a dump that passed through JSON may have stringified a number or a flag. */
function entriesOf(input: Dictionary) {
  return Object.entries(input).reduce<Record<string, string>>((entries, [name, value]) => {
    const entry = Option.getOrUndefined(decodeEntry(value))

    // An object or a null is not a value localStorage stores, so it is dropped rather than stringified.
    if (entry !== undefined) entries[name] = String(entry)

    return entries
  }, {})
}

function draftsOf(entries: readonly unknown[]) {
  return entries.flatMap((entry, index) => {
    const where = `at index ${index}`
    const item = Option.getOrUndefined(decodeItem(entry))

    if (!item) throw new Error(`Cookie ${where} is not an object.`)

    // A real browser dump can carry one malformed entry — a cookie with no usable name, which no cookie
    // store accepts. Skipping it keeps the rest of a live sync from failing over one bad row.
    try {
      return [draft(item, where)]
    } catch {
      return []
    }
  })
}

function draft(item: Item, where: string): CookieDraft {
  const name = item.name ?? item.Name

  if (!name) throw new Error(`Cookie ${where} is missing a name.`)
  const value = item.value ?? item.Value ?? ""
  const domain = item.domain ?? item.Domain
  const path = item.path ?? item.Path
  const secure = item.secure ?? item.Secure
  const httpOnly = item.httpOnly ?? item.HttpOnly ?? item.http_only
  const expirationDate = expiry(item.expirationDate, item.expiration_date, item.expires)
  const sameSite = sameSiteOf(item.sameSite, item.same_site, item.SameSite)

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

function expiry(...candidates: readonly (number | string | undefined)[]) {
  const seconds = candidates.find((value) => value !== undefined)

  if (seconds === undefined) return

  if (Schema.is(Schema.String)(seconds)) {
    const trimmed = seconds.trim()

    if (!trimmed) return

    const parsed = Date.parse(trimmed)

    return Number.isNaN(parsed) ? undefined : Math.floor(parsed / 1000)
  }

  if (!Number.isFinite(seconds)) return

  // Milliseconds from some exporters.
  return seconds > 1e12 ? Math.floor(seconds / 1000) : seconds
}

function sameSiteOf(...candidates: readonly (string | undefined)[]): CookieDraft["sameSite"] | undefined {
  const value = candidates.find((entry) => entry !== undefined)

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
