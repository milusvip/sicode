import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import {
  Input,
  MAX_GREP_PATTERNS,
  expandPatternAlternation,
  resolveGrepPatterns,
  usablePrefilter,
} from "../src/tool/plugin/grep.js"

describe("expandPatternAlternation", () => {
  test("splits plain a|b|c synonym batches Flash prefers over patterns[]", () => {
    expect(expandPatternAlternation("padding-bottom|paddingBlockEnd|pb-|paddingBottom")).toEqual([
      "padding-bottom",
      "paddingBlockEnd",
      "pb-",
      "paddingBottom",
    ])
  })

  test("leaves real regex alone", () => {
    expect(expandPatternAlternation("(foo|bar)+")).toEqual(["(foo|bar)+"])
    expect(expandPatternAlternation("a\\|b")).toEqual(["a\\|b"])
  })
})

describe("resolveGrepPatterns", () => {
  test("keeps pattern alone when patterns is omitted", () => {
    expect(resolveGrepPatterns({ pattern: "waitForScan" })).toEqual(["waitForScan"])
  })

  test("accepts patterns alone when Flash omits pattern", () => {
    expect(resolveGrepPatterns({ patterns: ["主图", "thumb", "cover"] })).toEqual(["主图", "thumb", "cover"])
  })

  test("Input schema accepts patterns-only and rejects empty search", () => {
    expect(Schema.decodeUnknownSync(Input)({ patterns: ["主图", "cover"], mode: "content" })).toEqual({
      patterns: ["主图", "cover"],
      mode: "content",
    })
    expect(() => Schema.decodeUnknownSync(Input)({ mode: "content" })).toThrow(/pattern/)
  })

  // SiCode: Flash often batches 9 synonyms; hard-reject burned a whole step (ses_e507 D).
  // Schema must accept the oversize list; resolveGrepPatterns still caps execution.
  test("Input schema accepts more than MAX_GREP_PATTERNS and resolveGrepPatterns caps them", () => {
    const patterns = Array.from({ length: MAX_GREP_PATTERNS + 1 }, (_, i) => `syn${i}`)
    const decoded = Schema.decodeUnknownSync(Input)({ patterns, mode: "content" })
    expect(decoded.patterns).toHaveLength(MAX_GREP_PATTERNS + 1)
    expect(resolveGrepPatterns(decoded)).toHaveLength(MAX_GREP_PATTERNS)
  })

  test("merges pattern with synonyms, de-duplicates, trims", () => {
    expect(
      resolveGrepPatterns({
        pattern: "sidebar",
        patterns: [" footer ", "sidebar", "empty space", ""],
      }),
    ).toEqual(["sidebar", "footer", "empty space"])
  })

  test("expands plain alternation inside pattern into the synonym batch", () => {
    expect(resolveGrepPatterns({ pattern: "once|always|batch" })).toEqual(["once", "always", "batch"])
  })

  test(`caps at ${MAX_GREP_PATTERNS} patterns`, () => {
    const patterns = Array.from({ length: 20 }, (_, i) => `term${i}`)
    const resolved = resolveGrepPatterns({ pattern: "head", patterns })
    expect(resolved).toHaveLength(MAX_GREP_PATTERNS)
    expect(resolved[0]).toBe("head")
    expect(resolved.at(-1)).toBe(`term${MAX_GREP_PATTERNS - 2}`)
  })

  test("appends concept extras so compress also searches compaction in one call", () => {
    const resolved = resolveGrepPatterns({ pattern: "compress" })
    expect(resolved[0]).toBe("compress")
    expect(resolved).toContain("compaction")
  })

  test("appends Chinese-intent extras without waiting for a zero-hit shortlist", () => {
    const resolved = resolveGrepPatterns({ pattern: "上下文压缩" })
    expect(resolved).toContain("compaction")
  })

  test("OPENCODE_QEXPAND=0 skips concept extras", () => {
    const previous = process.env.OPENCODE_QEXPAND
    process.env.OPENCODE_QEXPAND = "0"
    try {
      expect(resolveGrepPatterns({ pattern: "compress" })).toEqual(["compress"])
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_QEXPAND
      else process.env.OPENCODE_QEXPAND = previous
    }
  })
})

describe("usablePrefilter", () => {
  test("null and empty lists both mean fall back to a full sweep", () => {
    expect(usablePrefilter(null)).toBeNull()
    expect(usablePrefilter([])).toBeNull()
  })

  test("a non-empty list may narrow the sweep", () => {
    expect(usablePrefilter(["a.ts", "b.ts"])).toEqual(["a.ts", "b.ts"])
  })
})
