/**
 * SiCode: the part of a site's cookies and localStorage that actually carries its login.
 *
 * "Copy login state" used to hand over everything the page had — up to a hundred cookies and a
 * hundred storage keys, most of them analytics ids, consent flags, A/B buckets and app state. That
 * pasted text was long, slow to move, and mostly noise. A login is a handful of session cookies
 * and, for sites that keep it there, one or two tokens in localStorage, so this keeps those and
 * leaves the rest behind. What it drops is reported back, so the popup can say so.
 */

/** The most one dump may take. A login is kilobytes; past this it is something nobody pastes. */
export const MAX_DUMP_CHARS = 16_384

/**
 * The most the dump spends on entries that are not credentials. A site also needs a CSRF cookie, a
 * Cloudflare clearance, a language preference; it does not need its analytics buckets or its draft
 * autosave, which is where a copied login used to get long. Credentials are never charged to this.
 *
 * Counted in entries as well as bytes: a site's app state comes in many small keys, so a byte
 * allowance alone still let thirty of them through.
 */
export const MAX_CONTEXT_ENTRIES = 10
export const MAX_CONTEXT_CHARS = 2_048

/** The most cookies and storage keys a dump may carry, before the size budget applies. */
export const MAX_COOKIES = 40
export const MAX_STORAGE = 40

/** One value past this is app state or a blob, not a credential. */
const MAX_VALUE = 8_192

/** Names that read like a credential, matched anywhere in the name. */
const AUTH =
  /(?:sess|sid|token|auth|jwt|sso|log(?:in|on)|signin|account|uid|user|csrf|xsrf|remember|passport|credential|ticket|cf_clearance|__cf_bm)/i

/**
 * Names that belong to measurement, advertising or consent, listed whole.
 *
 * Exact, never a substring or a loose prefix: dropping a real session cookie breaks the login this
 * exists to carry, so a name is only dropped when the whole of it is a known tracker. `IDE` is here,
 * `IDENTITY_TOKEN` is not.
 */
const TRACKING_EXACT = new Set(
  [
    "_ga",
    "_gid",
    "_gat",
    "_fbp",
    "_fbc",
    "_clck",
    "_clsk",
    "_dd_s",
    "__qca",
    "__hstc",
    "__hssc",
    "__hssrc",
    "_ttp",
    "_ttclid",
    "_uetsid",
    "_uetvid",
    "hubspotutk",
    "personalization_id",
    "guest_id",
    "s_ecid",
    "s_vi",
    "s_fid",
    "s_cc",
    "s_sq",
    "mbox",
    "amcv",
    "lidc",
    "bcookie",
    "bscookie",
    "usermatchhistory",
    "analyticssynclist",
    "analyticssynchistory",
    "optanonconsent",
    "optanonalertboxclosed",
    "cookieconsent",
    "cookieyes-consent",
    "ide",
    "dsid",
    "anid",
    "nid",
  ].map((name) => name.toLowerCase()),
)

/**
 * Vendor or family prefixes, each ending in `_` or naming one vendor's namespace, so that only that
 * family matches. `_ga_` catches GA4's per-property cookies without catching `_gameSession`.
 */
const TRACKING_PREFIX = [
  "_ga_",
  "_gat_",
  "_gcl_",
  "_gac_",
  "_hjid",
  "__utm",
  "ajs_",
  "amp_",
  "mp_",
  "_hj",
  "_pin_",
  "_cs_",
  "_iub",
  "_scid",
  "hm_",
  "intercom",
  "amplitude",
]

/** True when the whole name, or its vendor prefix, is a known tracker. */
function isTracking(name) {
  const lower = name.toLowerCase()

  return TRACKING_EXACT.has(lower) || TRACKING_PREFIX.some((prefix) => lower.startsWith(prefix))
}

/**
 * What "Copy login state" puts on the clipboard: the page, the cookies and storage that carry the
 * session, and how many entries were left behind.
 *
 * The JSON form is what the in-app browser imports. Chrome's cookie objects carry the domain, path,
 * expiry and SameSite the pane needs to write each cookie at the site that set it; only the fields
 * the pane reads are kept, because `hostOnly`, `session` and `storeId` are a third of the text and
 * say nothing.
 * @param {string} url
 * @param {Array<object>} cookies Chrome cookie objects
 * @param {Array<{ key: string; value: string }>} storage localStorage rows
 * @returns {{ text: string; cookies: number; storage: number; skipped: number }}
 */
export function loginStateDump(url, cookies, storage) {
  const selected = selectLoginState(cookies, storage)

  return {
    text: JSON.stringify({
      url,
      cookies: selected.cookies,
      localStorage: Object.fromEntries(selected.storage.map((row) => [row.key, row.value])),
    }),
    cookies: selected.cookies.length,
    storage: selected.storage.length,
    skipped: selected.skipped,
  }
}

/**
 * The cookies and storage rows worth copying, credentials first.
 *
 * A tracker is dropped, and so is a value too large to be a credential. What is left is ranked so
 * the credentials come first: running out of room must never be what drops the session cookie.
 * @param {Array<object>} cookies Chrome cookie objects
 * @param {Array<{ key: string; value: string }>} storage localStorage rows
 * @returns {{ cookies: Array<object>; storage: Array<{ key: string; value: string }>; skipped: number }}
 */
export function selectLoginState(cookies, storage) {
  let skipped = 0

  const worth = [
    ...cookies.map((cookie) => ({
      kind: "cookie",
      name: cookie.name,
      value: cookie.value ?? "",
      item: compactCookie(cookie),
    })),
    ...storage.map((row) => ({ kind: "storage", name: row.key, value: row.value, item: row })),
  ].filter((candidate) => {
    if (!isTracking(candidate.name) && candidate.value.length <= MAX_VALUE) return true

    skipped++

    return false
  })

  // Stable sort, so entries of equal rank stay in the order the page had them.
  const ranked = worth.sort((left, right) => Number(isCredential(right.name)) - Number(isCredential(left.name)))

  const keptCookies = []
  const keptStorage = []
  let budget = MAX_DUMP_CHARS
  let context = MAX_CONTEXT_CHARS
  let contextCount = 0
  let cookieCount = 0
  let storageCount = 0

  for (const candidate of ranked) {
    const credential = isCredential(candidate.name)
    // The JSON around one entry: the quoting, the field names, and the commas between entries.
    const size = candidate.name.length + candidate.value.length + 40
    const room = candidate.kind === "cookie" ? cookieCount < MAX_COOKIES : storageCount < MAX_STORAGE
    // An ordinary entry also spends the small allowance for context, so a page full of app state
    // cannot fill what the credentials left behind.
    const fits =
      size <= budget && (credential || (contextCount < MAX_CONTEXT_ENTRIES && size <= context))

    if (!room || !fits) {
      skipped++

      continue
    }

    budget -= size

    if (!credential) {
      contextCount++
      context -= size
    }

    if (candidate.kind === "cookie") {
      cookieCount++
      keptCookies.push(candidate.item)

      continue
    }

    storageCount++
    keptStorage.push(candidate.item)
  }

  return { cookies: keptCookies, storage: keptStorage, skipped }
}

function isCredential(name) {
  return AUTH.test(name)
}

/** Only the fields the in-app browser writes; the rest of Chrome's cookie object is text for nothing. */
function compactCookie(cookie) {
  return {
    name: cookie.name,
    value: cookie.value,
    ...(cookie.domain ? { domain: cookie.domain } : {}),
    ...(cookie.path ? { path: cookie.path } : {}),
    ...(cookie.secure !== undefined ? { secure: cookie.secure } : {}),
    ...(cookie.httpOnly !== undefined ? { httpOnly: cookie.httpOnly } : {}),
    ...(cookie.expirationDate !== undefined ? { expirationDate: cookie.expirationDate } : {}),
    ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {}),
  }
}
