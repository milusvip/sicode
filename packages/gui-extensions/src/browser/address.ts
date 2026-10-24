import { destinationOrigin } from "./policy"

/** A search the address field can send text to; `url` ends where the encoded query begins. */
export const SEARCH_ENGINES = [
  { id: "google", url: "https://www.google.com/search?q=" },
  { id: "bing", url: "https://www.bing.com/search?q=" },
  { id: "baidu", url: "https://www.baidu.com/s?wd=" },
  { id: "duckduckgo", url: "https://duckduckgo.com/?q=" },
  { id: "yandex", url: "https://yandex.com/search/?text=" },
] as const

export type SearchEngine = (typeof SEARCH_ENGINES)[number]

export type SearchEngineID = SearchEngine["id"]

/**
 * What the address field navigates to for the text the user entered: the text itself when it reads as an address
 * (a scheme, `localhost`, a port, or a dotted host), else a web search for it. Main adds the missing scheme.
 */
export function resolveAddress(input: string, engine: SearchEngine = SEARCH_ENGINES[0]) {
  const value = input.trim()

  if (!value || value.toLowerCase() === "about:blank") return "about:blank"

  return searches(value) ? `${engine.url}${encodeURIComponent(value)}` : value
}

/** The query a search URL carries, when it is that engine's; undefined for any other page. */
export function searchQuery(engine: SearchEngine, url: string) {
  if (!url.startsWith(engine.url)) return
  const query = decode(url.slice(engine.url.length)).trim()

  return query || undefined
}

/**
 * Whether the address field would search for the text rather than open it. A typed scheme means an address, which
 * main opens or explains why not; it searches only when the text is no URL at all, such as a bare `https://`. Text
 * without one is an address when it names a host main opens as a web page.
 */
export function searches(input: string) {
  const value = input.trim()

  if (!value || /^about:\S*$/i.test(value)) return false

  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value)) return !URL.canParse(value)

  if (/\s/.test(value)) return true
  const host = value.split(/[/?#]/, 1)[0] ?? ""

  const named =
    /^(?:localhost|\[[\da-f:.]+\])(?::\d+)?$/i.test(host) || /:\d+$/.test(host) || /^[^.]+(?:\.[^.]+)+$/.test(host)

  // Main adds the scheme the same way, so the text opens only if the whole URL it becomes does.
  return !named || !destinationOrigin(`https://${value}`)
}

/**
 * The address as the field draws it at rest: always the whole URL, with its host emphasized. The parts join back to
 * exactly the text given, so the drawing lines up with the input's own text.
 */
export function addressParts(url: string) {
  const match = /^([a-z][a-z\d+.-]*:\/\/)?([^/?#]*)(.*)$/is.exec(url)

  return { scheme: match?.[1] ?? "", host: match?.[2] ?? url, rest: match?.[3] ?? "" }
}

/**
 * How a page reached its content, for the site information.
 * - `secure`: HTTPS with a certificate Chromium accepted.
 * - `local`: HTTP on a loopback host, which resolves on the machine running the server.
 * - `insecure`: HTTP elsewhere, or HTTPS whose certificate Chromium rejected and the pane accepted.
 * - `file`: a workspace file.
 */
export function connection(url: string, opts?: { certificateWarning?: boolean }) {
  if (!URL.canParse(url)) return
  const parsed = new URL(url)

  if (parsed.protocol === "https:") return opts?.certificateWarning ? "insecure" : "secure"

  if (parsed.protocol === "file:") return "file"

  if (parsed.protocol !== "http:") return

  return loopback(parsed.hostname) ? "local" : "insecure"
}

/** Whether a host names this machine; for a remote server that is the server's machine, not the user's. */
export function loopback(hostname: string) {
  return /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\]|::1)$/i.test(hostname) || hostname.endsWith(".localhost")
}

/** A URL's own text, so a malformed escape in a page's address cannot break the field that reads it. */
function decode(text: string) {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}
