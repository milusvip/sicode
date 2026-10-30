import { expect, test } from "bun:test"
import { Schema } from "effect"
import type { Storage } from "../sdk/main"
import {
  MAX_ORIGINS,
  createLocalStorageStore,
  entriesBytes,
  restoreScript,
  storageOrigin,
  writeScript,
} from "./local-storage"

/** A real `Storage` backed by a map, so the store is exercised through its own contract. */
function fakeStorage(): Storage {
  const values = new Map<string, unknown>()

  return {
    store(key, options) {
      if (!values.has(key)) values.set(key, options.initial)

      return {
        get value() {
          return Schema.decodeUnknownSync(options.schema)(values.get(key))
        },
        ready: () => true,
        update: () => undefined,
        set(next) {
          values.set(key, next)
        },
      }
    },
    remove(key) {
      values.delete(key)
    },
  }
}

test("only a web page's own origin has localStorage to keep", () => {
  expect(storageOrigin("https://example.com/a/b?c=1")).toBe("https://example.com")
  expect(storageOrigin("http://localhost:4096/session")).toBe("http://localhost:4096")
  expect(storageOrigin("about:blank")).toBeUndefined()
  expect(storageOrigin("file:///C:/tmp/a.html")).toBeUndefined()
  expect(storageOrigin("not a url")).toBeUndefined()
})

test("the restore script carries this origin's entries and nothing else", () => {
  const script = restoreScript("https://example.com", { token: 'a"b', sid: "1" })

  expect(script).toContain('if (location.origin !== "https://example.com") return')
  // A quote in a value must stay data, not end the literal.
  expect(script).toContain(String.raw`"token":"a\"b"`)
  // A value the page has written since — a refreshed token, a signed-out marker — must win over this snapshot.
  expect(script).toContain('if (localStorage.getItem(name) === null) localStorage.setItem(name, entries[name])')
})

test("bytes are measured as the JSON the store keeps", () => {
  expect(entriesBytes({})).toBe(2)
  expect(entriesBytes({ a: "1" })).toBe(JSON.stringify({ a: "1" }).length)
})

test("a pasted login overwrites what the site already had, unlike a restore", () => {
  const script = writeScript("https://example.com", { token: "pasted" })

  expect(script).toContain('if (location.origin !== "https://example.com") return')
  // A restore only fills gaps; a paste is the login the user handed over, so it replaces an older value outright.
  expect(script).toContain('try { localStorage.setItem(name, entries[name]) } catch {}')
  expect(script).not.toContain("localStorage.getItem(name) === null")
})

test("an origin's entries come back for the workspace that saved them", () => {
  const local = createLocalStorageStore(fakeStorage())

  expect(local.load("project", "https://example.com")).toBeUndefined()
  local.save("project", "https://example.com", { token: "abc" })
  expect(local.load("project", "https://example.com")).toEqual({ token: "abc" })
  // Another site, and another workspace, keep their own.
  expect(local.load("project", "https://other.test")).toBeUndefined()
  expect(local.load("other", "https://example.com")).toBeUndefined()
})

test("saving an origin again replaces it rather than appending", () => {
  const local = createLocalStorageStore(fakeStorage())

  local.save("project", "https://example.com", { token: "old" })
  local.save("project", "https://example.com", { token: "new" })

  expect(local.load("project", "https://example.com")).toEqual({ token: "new" })
})

test("signing out forgets the origin instead of keeping an empty entry", () => {
  const local = createLocalStorageStore(fakeStorage())

  local.save("project", "https://example.com", { token: "abc" })
  local.save("project", "https://example.com", {})

  expect(local.load("project", "https://example.com")).toBeUndefined()
  // A later save still lands, so a signed-out site can sign in again.
  local.save("project", "https://example.com", { token: "next" })
  expect(local.load("project", "https://example.com")).toEqual({ token: "next" })
})

test("an oversized origin is dropped instead of filling the store", () => {
  const local = createLocalStorageStore(fakeStorage())

  local.save("project", "https://example.com", { blob: "x".repeat(600_000) })

  expect(local.load("project", "https://example.com")).toBeUndefined()
})

test("the oldest origin is forgotten once a workspace is full", () => {
  const local = createLocalStorageStore(fakeStorage())

  for (let index = 0; index <= MAX_ORIGINS; index++)
    local.save("project", `https://site${index}.test`, { index: String(index) })

  expect(local.load("project", "https://site0.test")).toBeUndefined()
  expect(local.load("project", "https://site1.test")).toEqual({ index: "1" })
  expect(local.load("project", `https://site${MAX_ORIGINS}.test`)).toEqual({ index: String(MAX_ORIGINS) })
})
