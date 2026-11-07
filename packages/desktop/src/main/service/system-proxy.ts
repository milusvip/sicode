// SiCode: the sidecar's fetch (webfetch, provider HTTP) honors HTTP_PROXY/HTTPS_PROXY env vars,
// but a GUI-launched desktop app on Windows inherits no shell profile and the OS proxy never
// reaches it — so webfetch went direct and died with transport errors while the shell tool's
// curl (login shell, proxy resolvers, happy eyeballs) kept succeeding. Chromium already knows
// the OS proxy (registry and PAC), so mirror it into the env the sidecar inherits. Upstream only
// respects pre-set env vars (see #25846); this closes the GUI-launch gap.
//
// Smart failover: PAC answers are often `PROXY a; PROXY b; DIRECT`. We probe TCP to each proxy
// and only inject a live one; if every proxy is dead and DIRECT is listed, leave env unset so
// Bun goes direct. OPENCODE_MIRRORED_PROXY marks keys we own so the server can clear them when
// a mid-session proxy death is detected. Browser panes use a PAC data-URL with the full chain
// so Chromium fails over natively.
import type { Session } from "electron"
import { Effect } from "effect"
import net from "node:net"

const PROXY_KEYS = ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"] as const
export const MIRRORED_PROXY_FLAG = "OPENCODE_MIRRORED_PROXY"

export type ProxyChain = {
  /** http://host:port entries, PAC order preserved */
  readonly proxies: readonly string[]
  /** PAC listed DIRECT after / among the proxies */
  readonly allowDirect: boolean
  /** Original Chromium PAC result string (for browser pacScript) */
  readonly pac: string
}

/** Chromium resolveProxy answer → ordered proxies + whether DIRECT is an allowed fallback. */
export function parseChromiumProxyChain(answer: string): ProxyChain {
  const parts = answer
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)

  const proxies: string[] = []
  let allowDirect = false
  for (const part of parts) {
    const upper = part.toUpperCase()
    if (upper === "DIRECT") {
      allowDirect = true
      continue
    }
    if (!upper.startsWith("PROXY ")) continue
    const host = part.slice(6).trim()
    if (!host) continue
    proxies.push(`http://${host}`)
  }
  return { proxies, allowDirect, pac: answer.trim() }
}

/** Back-compat: first proxy only. Prefer parseChromiumProxyChain + pickLiveProxy. */
export function parseChromiumProxy(answer: string) {
  return parseChromiumProxyChain(answer).proxies[0]
}

/** PAC return value Chromium understands for native PROXY…; DIRECT failover. */
export function pacFindProxyReturn(chain: ProxyChain): string {
  if (chain.pac) return chain.pac
  if (chain.proxies.length === 0) return "DIRECT"
  const proxies = chain.proxies.map((url) => {
    const host = url.replace(/^https?:\/\//i, "")
    return `PROXY ${host}`
  })
  if (chain.allowDirect) proxies.push("DIRECT")
  return proxies.join("; ")
}

/** data: URL pacScript so partition sessions get the same failover chain. */
export function pacScriptDataUrl(chain: ProxyChain): string {
  const body = `function FindProxyForURL(url, host) { return ${JSON.stringify(pacFindProxyReturn(chain))}; }\n`
  return `data:application/x-ns-proxy-autoconfig;charset=utf-8,${encodeURIComponent(body)}`
}

export function proxyHostPort(proxyUrl: string): { host: string; port: number } | undefined {
  try {
    const url = new URL(proxyUrl)
    const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80
    if (!url.hostname || !Number.isFinite(port)) return undefined
    return { host: url.hostname, port }
  } catch {
    return undefined
  }
}

/** TCP connect probe — Clash/V2Ray down ⇒ ECONNREFUSED within timeout. */
export function probeProxyTcp(
  proxyUrl: string,
  timeoutMs = 400,
  connect: typeof net.connect = net.connect,
): Promise<boolean> {
  const target = proxyHostPort(proxyUrl)
  if (!target) return Promise.resolve(false)

  return new Promise((resolve) => {
    const socket = connect({ host: target.host, port: target.port })
    let settled = false
    const done = (ok: boolean) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once("connect", () => done(true))
    socket.once("timeout", () => done(false))
    socket.once("error", () => done(false))
  })
}

/** First live proxy in PAC order; undefined means go direct (or no usable proxy). */
export async function pickLiveProxy(
  chain: ProxyChain,
  probe: (proxyUrl: string) => Promise<boolean> = probeProxyTcp,
): Promise<string | undefined> {
  for (const proxy of chain.proxies) {
    if (await probe(proxy)) return proxy
  }
  if (chain.allowDirect || chain.proxies.length === 0) return undefined
  // PAC listed only dead proxies and no DIRECT — still fall back to direct rather than hang.
  return undefined
}

export function applyProxyEnv(proxy: string | undefined) {
  if (!proxy) {
    if (process.env[MIRRORED_PROXY_FLAG]) {
      for (const key of PROXY_KEYS) delete process.env[key]
      delete process.env[MIRRORED_PROXY_FLAG]
    }
    return { applied: false as const }
  }

  // Any pre-set proxy key means the user (or shell) owns the tunnel — do not partially fill.
  const userOwns =
    !process.env[MIRRORED_PROXY_FLAG] && PROXY_KEYS.some((key) => process.env[key] !== undefined)
  if (userOwns) return { applied: false as const }

  for (const key of PROXY_KEYS) process.env[key] = proxy
  process.env[MIRRORED_PROXY_FLAG] = proxy
  return { applied: true as const, proxy }
}

// Runs after app.whenReady() and before the sidecar spawns. Existing env always wins: an
// explicitly configured proxy (or an intentional NO_PROXY) must not be second-guessed.
export const syncSystemProxy = Effect.gen(function* () {
  const { session } = yield* Effect.promise(() => import("electron"))
  const answer = yield* Effect.tryPromise(() =>
    (session.defaultSession as Session).resolveProxy("https://github.com/"),
  )
  const chain = parseChromiumProxyChain(answer)
  const live = yield* Effect.promise(() => pickLiveProxy(chain))

  if (!live) {
    applyProxyEnv(undefined)
    if (chain.proxies.length > 0) {
      yield* Effect.logWarning(
        `[server] System proxy unreachable (${chain.proxies.join(", ")}); using direct${chain.allowDirect ? " (PAC DIRECT)" : ""}`,
      )
    }
    return
  }

  const result = applyProxyEnv(live)
  if (result.applied) {
    yield* Effect.logInfo(`[server] System proxy ${live} applied to server environment`)
  }
}).pipe(Effect.catch((error) => Effect.logWarning("[server] Failed to resolve system proxy", { error })))
