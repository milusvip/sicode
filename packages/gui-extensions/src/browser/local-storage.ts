import { Schema } from "effect"
import type { Storage } from "../sdk/main"

/** The most one origin's localStorage may keep; a login is a few kilobytes. */
export const MAX_ORIGIN_BYTES = 512_000

/** The most origins one workspace keeps. Least recently saved is dropped first. */
export const MAX_ORIGINS = 64

const Entries = Schema.Record(Schema.String, Schema.String)

/**
 * One origin's localStorage. Most recent is last, so trimming drops what the user touched longest ago.
 */
const Stored = Schema.Array(Schema.Struct({ origin: Schema.String, entries: Entries }))

type Stored = typeof Stored.Type

const empty: Stored = []

/** A web page's own origin; anything else has no localStorage to keep. */
export function storageOrigin(input: string) {
  if (!URL.canParse(input)) return
  const url = new URL(input)

  return /^https?:$/.test(url.protocol) ? url.origin : undefined
}

/** Bytes these entries take as JSON, the unit the limits are expressed in. */
export function entriesBytes(entries: Readonly<Record<string, string>>) {
  return JSON.stringify(entries).length
}

/**
 * The script that puts one origin's localStorage back before the page's own code runs.
 *
 * Whether a site keeps its session in a cookie or in localStorage is the site's choice, and the ones that use
 * localStorage read it from `<head>` — early enough that writing it after `dom-ready` would be too late. Chromium runs
 * this before the document exists, so the value is there for the first script that asks.
 *
 * It only fills in entries the document does not have yet. The script stays installed for the page's later documents,
 * and a value the site has written since — a refreshed token, a signed-out marker — must win over this snapshot. The
 * entry list is scoped by origin because the script runs in every frame of every page in this partition,
 * cross-origin ones included.
 */
export function restoreScript(origin: string, entries: Readonly<Record<string, string>>) {
  // `location.origin` cannot contain a quote, but the values can carry anything, so they go in as a JSON literal.
  return `(() => {
  if (location.origin !== ${JSON.stringify(origin)}) return
  const entries = ${JSON.stringify(entries)}
  for (const name of Object.keys(entries)) {
    try { if (localStorage.getItem(name) === null) localStorage.setItem(name, entries[name]) } catch {}
  }
})()`
}

/**
 * The script that puts a pasted login's localStorage into the document that is already open.
 *
 * A paste arrives while the page is up, and what the user just handed over is the login they want, so this one
 * overwrites where {@link restoreScript} fills gaps. The page reads it back when it reloads for the cookies.
 */
export function writeScript(origin: string, entries: Readonly<Record<string, string>>) {
  return `(() => {
  if (location.origin !== ${JSON.stringify(origin)}) return
  const entries = ${JSON.stringify(entries)}
  for (const name of Object.keys(entries)) {
    try { localStorage.setItem(name, entries[name]) } catch {}
  }
})()`
}

/**
 * What a page's localStorage keeps, per workspace.
 *
 * A pane's partition is per attachment, so a site's localStorage is thrown away when the pane closes, exactly as its
 * cookies were — a login kept there asked for a password again on every restart. The cookie jar fixes that half;
 * this keeps the other half, and is stored apart from it so an existing cookie jar keeps loading unchanged.
 *
 * Scoped to the session's workspace directory, so signing in once in a project carries to its other sessions.
 */
export function createLocalStorageStore(storage: Storage) {
  const open = (key: string) => storage.store(`local-storage:${key}`, { schema: Stored, initial: empty })
  const stores = new Map<string, ReturnType<typeof open>>()

  const store = (key: string) => {
    const existing = stores.get(key)

    if (existing) return existing

    const created = open(key)
    stores.set(key, created)

    return created
  }

  const read = (key: string) => store(key).value

  return {
    /** What this workspace saved for one origin, or nothing when it never had any. */
    load(key: string, origin: string) {
      return read(key).find((saved) => saved.origin === origin)?.entries
    },
    /** Replaces one origin's entries, so the next page of that origin opens signed in. Nothing kept signs it out. */
    save(key: string, origin: string, entries: Readonly<Record<string, string>>) {
      if (entriesBytes(entries) > MAX_ORIGIN_BYTES) return
      const rest = read(key).filter((saved) => saved.origin !== origin)

      if (Object.keys(entries).length === 0) {
        const target = store(key)

        if (target.value.length !== rest.length) target.set(rest)

        return
      }

      const trimmed = [...rest, { origin, entries }]

      // Newest last: drop from the front until the count fits.
      const kept = trimmed.slice(-MAX_ORIGINS)
      const target = store(key)

      if (JSON.stringify(target.value) !== JSON.stringify(kept)) target.set(kept)
    },
  }
}
