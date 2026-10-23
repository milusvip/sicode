import { app } from "electron"

type Channel = "local" | "dev" | "beta" | "prod"

const raw = import.meta.env.OPENCODE_CHANNEL

export const CHANNEL: Channel = raw === "local" || raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

export const VERSION = app.isPackaged ? app.getVersion() : (process.env.OPENCODE_VERSION ?? app.getVersion())

const appNames: Record<string, string> = {
  dev: "SiCode Dev",
  beta: "SiCode Beta",
  prod: "SiCode",
}

const appIDs: Record<string, string> = {
  dev: "com.sicode.desktop.dev",
  beta: "com.sicode.desktop.beta",
  prod: "com.sicode.desktop",
}

// Local renderer/server mode keeps the dev application identity.
export const APP_NAME = app.isPackaged ? appNames[CHANNEL] : "SiCode Dev"

export const APP_ID = app.isPackaged ? appIDs[CHANNEL] : "com.sicode.desktop.dev"

// Custom URL scheme this fork registers. Inbound links that still use the upstream
// `opencode://` scheme are accepted as well, so console auth round-trips keep working.
export const PROTOCOL = "sicode"

export const PROTOCOLS = [PROTOCOL, "opencode"] as const

export function isDeepLink(value: string) {
  return PROTOCOLS.some((scheme) => value.startsWith(`${scheme}://`))
}
