/**
 * SiCode: which cookies carry one page's login.
 *
 * `chrome.cookies.getAll({ domain })` returns cookies whose domain matches or is a *subdomain* of the
 * one asked for, so asking for the page's own host never returns a cookie the site set on a parent
 * domain. That parent cookie is the one a login usually needs: a site on `www.example.com` signs you
 * in with a cookie on `.example.com`. `getAll({ url })` is the query that returns it, because it asks
 * for the cookies the browser would actually send to that page.
 *
 * So both are asked for, plus the host's parent, because a cookie on the exact host whose path the
 * page's URL does not match still comes back from a domain query and nothing else. Results are merged
 * by identity, so a cookie two queries both return is written once.
 */

/** A name is only unique within a domain and path, which is what makes two cookies the same cookie. */
const identityOf = (cookie) => `${cookie.name}\u0000${cookie.domain ?? ""}\u0000${cookie.path ?? ""}`

/** The queries worth making for one page: by URL, by its host, and by the host's parent. */
export function cookieQueries(url) {
  const labels = new URL(url).hostname.toLowerCase().split(".")
  // A two-label host's parent is a public suffix (`com`), which would return every site's cookies.
  const parent = labels.length >= 3 ? labels.slice(1).join(".") : undefined

  return [{ url }, { domain: labels.join(".") }, ...(parent ? [{ domain: parent }] : [])]
}

/** Whether a cookie's domain covers the page's host, counting a leading dot as the same domain. */
export function coversHost(host, domain) {
  const target = (domain || "").replace(/^\./, "").toLowerCase()
  const page = host.toLowerCase()

  return !!target && (page === target || page.endsWith("." + target))
}

/**
 * One list per query, merged into what the page may use. A query that failed contributes nothing
 * rather than losing the others, and a nameless cookie is dropped because no store accepts one.
 *
 * @param {Array<Array<object>>} lists
 * @param {string} host
 */
export function mergeCookies(lists, host) {
  /** @type {Set<string>} */
  const seen = new Set()
  /** @type {Array<object>} */
  const merged = []

  for (const list of lists) {
    for (const cookie of list) {
      if (!cookie || typeof cookie.name !== "string" || !cookie.name) continue
      if (!coversHost(host, cookie.domain)) continue

      const key = identityOf(cookie)
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(cookie)
    }
  }

  return merged
}
