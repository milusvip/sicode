import { expect, test } from "bun:test"
import { Browser } from "../src/rpc.js"

// The split only protects the user if nothing mutating lands in the read class, so pin both
// directions: a new operation must be classified, and the write list must be exactly this.
const mutating: string[] = [
  "check",
  "click",
  "dialog",
  "drag",
  "evaluate",
  "files.drop",
  "files.upload",
  "fill",
  "fill_form",
  "hover",
  "press",
  "select",
]

const names = (access: Browser.Access) =>
  Browser.Operations.filter((operation) => operation.access === access).map((operation) => operation.name as string)

test("every browser operation declares a read or write class", () => {
  expect(Browser.Operations.length).toBeGreaterThan(0)
  for (const operation of Browser.Operations) expect(["read", "write"]).toContain(operation.access)
})

test("only mutating operations are classified as write", () => {
  expect(names("write").sort()).toEqual(mutating)
})

test("read keeps navigation and inspection usable, and never exposes evaluate", () => {
  const read = new Set(names("read"))
  // A read-only agent that cannot navigate, inspect, or capture cannot do its job.
  for (const name of ["navigate", "reload", "snapshot", "find", "screenshot", "console", "network.list", "wait"])
    expect(read.has(name)).toBe(true)
  // evaluate can rewrite the DOM and read storage, so it may never be reachable with only read granted.
  expect(read.has("evaluate")).toBe(false)
  // Navigate by URL is read; following a link is not.
  expect(read.has("click")).toBe(false)
})
