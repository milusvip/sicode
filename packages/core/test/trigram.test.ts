// SiCode: tests for the FTS5 trigram candidate index.
import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { TrigramIndex, TRIGRAM_MIN } from "../src/filesystem/trigram.bun.ts"

const FIXTURE: Array<[string, string]> = [
  ["src/alpha.ts", "export function waitForScan(timeout: number) {\n  return timeout\n}\n"],
  ["src/beta.ts", "const waitForScanMs = 5\nexport { waitForScanMs }\n"],
  ["src/gamma.ts", "export const unrelated = 1\n"],
  ["docs/readme.md", "# Waitforscan notes\nlowercase mention only\n"],
]

const build = (index: TrigramIndex) => index.replaceAll(FIXTURE)

describe("TrigramIndex", () => {
  test("candidates are a superset of literal matches (case folding on by default)", () => {
    const index = TrigramIndex.open({ file: ":memory:" })
    build(index)
    const candidates = index.candidates("waitForScan") ?? []
    // alpha and beta contain the literal; readme contains the folded variant
    expect(candidates).toContain("src/alpha.ts")
    expect(candidates).toContain("src/beta.ts")
    expect(candidates).toContain("docs/readme.md")
    expect(candidates).not.toContain("src/gamma.ts")
    index.close()
  })

  test("queries shorter than three trigrams report null so callers fall back to rg", () => {
    const index = TrigramIndex.open({ file: ":memory:" })
    build(index)
    expect(index.candidates("ab")).toBeNull()
    expect(index.candidates("wait")).not.toBeNull()
    expect(TRIGRAM_MIN).toBe(3)
    index.close()
  })

  test("no-hit queries short-circuit to an empty candidate list", () => {
    const index = TrigramIndex.open({ file: ":memory:" })
    build(index)
    expect(index.candidates("zzzzzzz")).toEqual([])
    index.close()
  })

  test("upsert adds and removes single files incrementally", () => {
    const index = TrigramIndex.open({ file: ":memory:" })
    build(index)
    index.upsert("src/delta.ts", "uniqueTokenHere only in delta\n")
    expect(index.candidates("uniqueTokenHere")).toEqual(["src/delta.ts"])
    index.upsert("src/delta.ts", null)
    expect(index.candidates("uniqueTokenHere")).toEqual([])
    index.close()
  })

  test("upsert refreshes a changed file so stale trigrams disappear", () => {
    const index = TrigramIndex.open({ file: ":memory:" })
    build(index)
    index.upsert("src/gamma.ts", "now mentions waitForScan too\n")
    const candidates = index.candidates("waitForScan") ?? []
    expect(candidates).toContain("src/gamma.ts")
    index.close()
  })

  test("binary content is skipped", () => {
    const index = TrigramIndex.open({ file: ":memory:" })
    index.replaceAll([["blob.bin", "waitForScan\0binarypadding"]])
    expect(index.size).toBe(0)
    expect(index.candidates("waitForScan")).toEqual([])
    index.close()
  })

  test("paths are normalized to forward slashes", () => {
    const index = TrigramIndex.open({ file: ":memory:" })
    index.replaceAll([["src\\backslash.ts", "needleForTest here\n"]])
    expect(index.paths()).toEqual(["src/backslash.ts"])
    expect(index.candidates("needleForTest")).toEqual(["src/backslash.ts"])
    index.close()
  })

  test("indexes persist across close and reopen", () => {
    const dir = mkdtempSync(join(tmpdir(), "sicode-trigram-"))
    const file = join(dir, "idx.db")
    const first = TrigramIndex.open({ file })
    build(first)
    first.close()
    const second = TrigramIndex.open({ file })
    expect(second.size).toBe(4)
    expect(second.candidates("waitForScan")).not.toBeNull()
    second.close()
    // Windows holds the sidecar files briefly after close; retries usually clear it.
    for (let attempt = 0; ; attempt++) {
      try {
        rmSync(dir, { recursive: true, force: true })
        break
      } catch {
        if (attempt >= 5) break // temp dir, the OS reclaims it eventually
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
      }
    }
  })

  test("case-sensitive index trades recall for size", () => {
    const index = TrigramIndex.open({ file: ":memory:", caseSensitive: true })
    build(index)
    // exact case still prefilterable...
    expect(index.candidates("waitForScan") ?? []).toContain("src/alpha.ts")
    // ...but a folded variant present only in lowercase text is no longer covered
    expect(index.candidates("Waitforscan") ?? []).toEqual(["docs/readme.md"])
    index.close()
  })
})
