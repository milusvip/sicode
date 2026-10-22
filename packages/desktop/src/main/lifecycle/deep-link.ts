import { PROTOCOLS } from "../constants"

export function consoleReturnWindow(value: string) {
  try {
    const url = new URL(value)

    if (!PROTOCOLS.includes(url.protocol.slice(0, -1) as (typeof PROTOCOLS)[number])) return

    if (url.hostname !== "console" || url.pathname !== "/authorized") return
    const id = url.searchParams.get("window")

    if (!id || id.length > 256 || /[\u0000-\u001f\u007f]/.test(id)) return

    return id
  } catch {
    return
  }
}
