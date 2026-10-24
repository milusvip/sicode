// SiCode: tests for the in-process literal match fast path (stage two of two-stage search).
import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { Effect } from "effect"
import { matchLiteralInMemory } from "../src/filesystem/trigram-search.ts"

const setup = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), "sicode-memmatch-"))
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel)
    mkdirSync(join(abs, ".."), { recursive: true })
    writeFileSync(abs, content)
  }
  return dir
}

const run = (dir: string, paths: string[], pattern: string, options: Parameters<typeof matchLiteralInMemory>[3]) =>
  Effect.runPromise(matchLiteralInMemory(dir, paths, pattern, options))

describe("matchLiteralInMemory", () => {
  test("returns matching lines with 1-based line numbers and submatches", async () => {
    const dir = setup({ "a.ts": "foo\nwaitForScan here\nbar\n" })
    const rows = await run(dir, ["a.ts"], "waitForScan", { limit: 100 })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.kind).toBe("match")
    expect(rows[0]!.match.line).toBe(2)
    expect(rows[0]!.match.text).toBe("waitForScan here")
    expect(rows[0]!.match.submatches).toEqual([{ text: "waitForScan", start: 0, end: 11 }])
    expect(String(rows[0]!.match.entry.path)).toBe("a.ts")
  })

  test("finds every occurrence on a line, not just the first", async () => {
    const dir = setup({ "a.ts": "x waitForScan y waitForScan z\n" })
    const rows = await run(dir, ["a.ts"], "waitForScan", { limit: 100 })
    expect(rows[0]!.match.submatches).toEqual([
      { text: "waitForScan", start: 2, end: 13 },
      { text: "waitForScan", start: 16, end: 27 },
    ])
  })

  test("is case-insensitive only when asked", async () => {
    const dir = setup({ "a.ts": "WaitForScan\n" })
    expect((await run(dir, ["a.ts"], "waitforscan", { limit: 100, caseSensitive: true }))).toHaveLength(0)
    expect((await run(dir, ["a.ts"], "waitforscan", { limit: 100, caseSensitive: false }))).toHaveLength(1)
  })

  test("files mode stops at one match per file", async () => {
    const dir = setup({ "a.ts": "x\nx\nx\n", "b.ts": "x\n" })
    const rows = await run(dir, ["a.ts", "b.ts"], "x", { limit: 100, mode: "files" })
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => String(r.match.entry.path)).sort()).toEqual(["a.ts", "b.ts"])
  })

  test("respects the limit across files", async () => {
    const dir = setup({ "a.ts": "x\nx\n", "b.ts": "x\n" })
    const rows = await run(dir, ["a.ts", "b.ts"], "x", { limit: 2 })
    expect(rows).toHaveLength(2)
  })

  test("skips binary and unreadable files", async () => {
    const dir = setup({ "a.ts": "x\n" })
    writeFileSync(join(dir, "bin.dat"), Buffer.from([0, 120, 10]))
    const rows = await run(dir, ["a.ts", "bin.dat"], "x", { limit: 100 })
    expect(rows).toHaveLength(1)
    expect(String(rows[0]!.match.entry.path)).toBe("a.ts")
  })

  test("normalizes windows separators in candidate paths", async () => {
    const dir = setup({ "sub/x.ts": "needle\n" })
    const rows = await run(dir, ["sub\\x.ts"], "needle", { limit: 100 })
    expect(String(rows[0]!.match.entry.path)).toBe("sub/x.ts")
  })
})
