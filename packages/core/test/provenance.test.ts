import { describe, expect, test } from "bun:test"
import { wrapToolResult } from "../src/session/provenance.js"

describe("wrapToolResult", () => {
  test("wraps completed tool text with name and path when enabled", () => {
    process.env.OPENCODE_PROVENANCE = "1"
    try {
      const wrapped = wrapToolResult({
        name: "read",
        path: "packages/app/src/a.tsx",
        text: "export const a = 1\n",
      })
      expect(wrapped).toContain('<source kind="tool" name="read" path="packages/app/src/a.tsx">')
      expect(wrapped).toContain("export const a = 1")
      expect(wrapped).toContain("</source>")
      expect(wrapped).toContain("untrusted")
    } finally {
      delete process.env.OPENCODE_PROVENANCE
    }
  })

  test("distinguishes two reads by path when enabled", () => {
    process.env.OPENCODE_PROVENANCE = "1"
    try {
      const a = wrapToolResult({ name: "read", path: "packages/a.ts", text: "AAA" })
      const b = wrapToolResult({ name: "read", path: "packages/b.ts", text: "BBB" })
      expect(a).toContain('path="packages/a.ts"')
      expect(b).toContain('path="packages/b.ts"')
      expect(a).not.toContain("packages/b.ts")
    } finally {
      delete process.env.OPENCODE_PROVENANCE
    }
  })

  test("compact older omit/error lines stay a source header plus the line when enabled", () => {
    process.env.OPENCODE_PROVENANCE = "1"
    try {
      const compact = wrapToolResult({
        name: "shell",
        text: "[... 100 lines omitted from this earlier shell result; treat as noise ...]",
      })
      expect(compact.startsWith("<source ")).toBe(true)
      expect(compact).toContain("/>")
      expect(compact).not.toContain("</source>")
    } finally {
      delete process.env.OPENCODE_PROVENANCE
    }
  })

  test("stays off unless OPENCODE_PROVENANCE=1", () => {
    delete process.env.OPENCODE_PROVENANCE
    expect(wrapToolResult({ name: "read", path: "a.ts", text: "x" })).toBe("x")
    process.env.OPENCODE_PROVENANCE = "0"
    try {
      expect(wrapToolResult({ name: "read", path: "a.ts", text: "x" })).toBe("x")
    } finally {
      delete process.env.OPENCODE_PROVENANCE
    }
  })
})
