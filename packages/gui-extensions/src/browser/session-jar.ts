import electron from "electron"
import { Schema } from "effect"
import type { Storage } from "../sdk/main"
import { cookieURL } from "./cookies"

/**
 * One cookie as the jar keeps it: the same fields `session.cookies.set` takes, plus the address that scopes it. Cookies
 * written with no expiry (session cookies) keep none, which is what a login usually is — the jar restores them anyway.
 */
const Cookie = Schema.Struct({
  url: Schema.String,
  name: Schema.String,
  value: Schema.String,
  domain: Schema.optionalKey(Schema.String),
  path: Schema.optionalKey(Schema.String),
  secure: Schema.optionalKey(Schema.Boolean),
  httpOnly: Schema.optionalKey(Schema.Boolean),
  expirationDate: Schema.optionalKey(Schema.Number),
  sameSite: Schema.optionalKey(Schema.Literals(["unspecified", "no_restriction", "lax", "strict"])),
})

const Stored = Schema.Array(Cookie)

type Stored = typeof Stored.Type

const empty: Stored = []

/**
 * Login state that outlives the pane, per workspace.
 *
 * A pane's partition is per attachment (`pane.ts`), so it is thrown away when the pane closes and a site's cookies go
 * with it — every restart asked the user to sign in again. The partition stays per attachment because the local tunnel
 * proxy, the certificate handler, and `closeAllConnections` in `network.ts` are all bound to one attachment and would
 * fight over a shared one. So only the cookie jar crosses: captured when the attachment closes, restored into the new
 * partition before the first page loads.
 *
 * Scoped to the session's workspace directory, not the session: signing in once in a project carries to its other
 * sessions, while another project never sees these cookies.
 */
export function createSessionJar(storage: Storage) {
  const open = (key: string) => storage.store(`session:${key}`, { schema: Stored, initial: empty })
  const stores = new Map<string, ReturnType<typeof open>>()

  const store = (key: string) => {
    const existing = stores.get(key)

    if (existing) return existing
    const created = open(key)
    stores.set(key, created)

    return created
  }

  return {
    /** Writes this workspace's cookies into a fresh partition. Resolves with how many landed. */
    async restore(partition: string, key: string) {
      const cookies = store(key).value

      if (!cookies.length) return 0
      const session = electron.session.fromPartition(partition)
      const now = Date.now() / 1000
      let written = 0

      for (const cookie of cookies) {
        if (cookie.expirationDate !== undefined && cookie.expirationDate < now) continue

        // A cookie the site would reject must not keep the pane from opening the page without it.
        try {
          await session.cookies.set(cookie)
          written++
        } catch {
          continue
        }
      }

      return written
    },
    /** Replaces this workspace's jar with the partition's cookies, so the next pane opens signed in. */
    async capture(partition: string, key: string) {
      const cookies = await electron.session.fromPartition(partition).cookies.get({})

      const value = cookies.map((cookie) => ({
        url: cookieURL(cookie),
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        ...(cookie.expirationDate === undefined ? undefined : { expirationDate: cookie.expirationDate }),
        sameSite: cookie.sameSite,
      }))

      const target = store(key)

      if (JSON.stringify(target.value) !== JSON.stringify(value)) target.set(value)
    },
  }
}
