/** Root-domain blocklist: Agent may not remotely control matching sites. */

/** Normalize user input to a lowercase hostname root (strip scheme/path/`www.`). */
export function normalizeBlockedDomain(input: string): string | undefined {
  const raw = input.trim().toLowerCase()
  if (!raw) return

  let host = raw
  try {
    if (raw.includes("://")) host = new URL(raw).hostname
    else host = raw.split("/")[0] ?? ""
  } catch {
    return
  }

  host = host.replace(/^\.+|\.+$/g, "")
  if (host.startsWith("www.")) host = host.slice(4)
  // Drop accidental port.
  if (host.includes(":") && !host.startsWith("[")) host = host.slice(0, host.indexOf(":"))

  if (host === "localhost") return host
  // At least one dot for a registrable-style root (user adds example.com, not "com").
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(host)) return
  return host
}

export function isHostBlocked(hostname: string, list: readonly string[]): boolean {
  if (!list.length) return false
  const host = hostname.trim().toLowerCase().replace(/\.+$/g, "")
  if (!host) return false
  return list.some((domain) => host === domain || host.endsWith(`.${domain}`))
}

export function isUrlBlocked(url: string, list: readonly string[]): boolean {
  if (!list.length) return false
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false
    return isHostBlocked(parsed.hostname, list)
  } catch {
    return false
  }
}

export function blockedDomainMessage(domain: string) {
  return (
    `Domain ${domain} is blocked from Agent browser control (Settings → Browser). ` +
    "Remove it from the blocklist to allow remote control of this site."
  )
}

/** Best-effort root label for error text when a URL matched the list. */
export function matchedBlockedDomain(url: string, list: readonly string[]): string | undefined {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return list.find((domain) => host === domain || host.endsWith(`.${domain}`))
  } catch {
    return
  }
}
