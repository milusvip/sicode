// SiCode: the sidecar's fetch (webfetch, provider HTTP) honors HTTP_PROXY/HTTPS_PROXY env vars,
// but a GUI-launched desktop app on Windows inherits no shell profile and the OS proxy never
// reaches it — so webfetch went direct and died with transport errors while the shell tool's
// curl (login shell, proxy resolvers, happy eyeballs) kept succeeding. Chromium already knows
// the OS proxy (registry and PAC), so mirror it into the env the sidecar inherits. Upstream only
// respects pre-set env vars (see #25846); this closes the GUI-launch gap.
import type { Session } from "electron"
import { Effect } from "effect"

// Chromium's resolveProxy answer is a PAC result string, e.g. "PROXY 127.0.0.1:7897",
// "PROXY a:1; PROXY b:2; DIRECT", or "DIRECT". The first non-direct proxy is the one
// nearly every request will use.
export function parseChromiumProxy(answer: string) {
  const entry = answer
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.toUpperCase().startsWith("PROXY "))
  const host = entry?.slice(6).trim()
  return host ? `http://${host}` : undefined
}

// Runs after app.whenReady() and before the sidecar spawns. Existing env always wins: an
// explicitly configured proxy (or an intentional NO_PROXY) must not be second-guessed.
export const syncSystemProxy = Effect.gen(function* () {
  const { session } = yield* Effect.promise(() => import("electron"))
  const answer = yield* Effect.tryPromise(() =>
    (session.defaultSession as Session).resolveProxy("https://github.com/"),
  )
  const proxy = parseChromiumProxy(answer)
  if (!proxy) return
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"]) {
    process.env[key] ??= proxy
  }
  yield* Effect.logInfo(`[server] System proxy ${proxy} applied to server environment`)
}).pipe(
  Effect.catch((error) => Effect.logWarning("[server] Failed to resolve system proxy", { error })),
)
