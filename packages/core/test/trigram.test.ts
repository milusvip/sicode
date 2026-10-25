// SiCode: tests for the FTS5 trigram candidate index.
import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { NOT_INDEXED, TrigramIndex, TRIGRAM_MIN } from "../src/filesystem/trigram.bun.ts"

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

  test("binary content is recorded but not indexed", () => {
    const index = TrigramIndex.open({ file: ":memory:" })
    index.replaceAll([
      ["src/alpha.ts", "waitForScan\n"],
      ["blob.bin", "waitForScan\0binarypadding"],
    ])
    // Every enumerated file gets a row, so the stored path set can still match what ripgrep
    // lists — otherwise a repo with one PNG could never reuse its index.
    expect(index.size).toBe(2)
    // ...but none of the binary's bytes can produce a candidate.
    expect(index.indexed).toBe(1)
    expect(index.candidates("waitForScan")).toEqual(["src/alpha.ts"])
    expect(index.fingerprints().get("blob.bin")?.mtimeMs).toBe(NOT_INDEXED)
    index.close()
  })

  test("fingerprints round-trip so a later run can prove the content is unchanged", () => {
    const index = TrigramIndex.open({ file: ":memory:" })
    index.replaceAll([["src/alpha.ts", "waitForScan\n", { mtimeMs: 1_700_000_000_123.7, size: 12 }]])
    // Floored to whole milliseconds: a float in an INTEGER column would never compare equal.
    expect(index.fingerprints().get("src/alpha.ts")).toEqual({ mtimeMs: 1_700_000_000_123, size: 12 })

    index.upsert("src/alpha.ts", "waitForScan\n", { mtimeMs: 1_700_000_009_000, size: 13 })
    expect(index.fingerprints().get("src/alpha.ts")).toEqual({ mtimeMs: 1_700_000_009_000, size: 13 })
    index.close()
  })

  test("an index written before fingerprints existed upgrades in place and reads as unknown", () => {
    const dir = mkdtempSync(join(tmpdir(), "sicode-trigram-legacy-"))
    const file = join(dir, "legacy.db")
    const legacy = new Database(file)
    legacy.exec("CREATE TABLE m(id INTEGER PRIMARY KEY, p TEXT NOT NULL UNIQUE)")
    legacy.exec("INSERT INTO m(id, p) VALUES (1, 'src/alpha.ts')")
    legacy.close()

    // Opening must migrate rather than fail on an INSERT built for the new column list.
    const index = TrigramIndex.open({ file })
    expect(index.size).toBe(1)
    // 0 = "cannot vouch for this content", which makes the caller rebuild once.
    expect(index.fingerprints().get("src/alpha.ts")).toEqual({ mtimeMs: 0, size: 0 })
    index.close()
    for (let attempt = 0; ; attempt++) {
      try {
        rmSync(dir, { recursive: true, force: true })
        break
      } catch {
        if (attempt >= 5) break
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
      }
    }
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
