import { describe, expect, test } from "bun:test"
import { editLineChanges, patchLineChanges, streamedLineChanges } from "./stream-changes"

describe("streamedLineChanges", () => {
  test("counts the block an edit replaces", () => {
    expect(streamedLineChanges({ oldString: "a\nb\nc", newString: "a\nB\nc\nd" })).toEqual({ additions: 2, deletions: 1 })
  })

  test("counts a write as additions only", () => {
    expect(streamedLineChanges({ content: "one\ntwo\nthree" })).toEqual({ additions: 3, deletions: 0 })
  })

  test("stays quiet until text arrives", () => {
    expect(streamedLineChanges({ oldString: "a\nb\nc", newString: "" })).toBeUndefined()
    expect(streamedLineChanges({})).toBeUndefined()
  })

  test("counts a patch from its own diff lines", () => {
    const patch = ["--- a/x.ts", "+++ b/x.ts", "@@ -1,2 +1,2 @@", "-old", "+new", " same"].join("\n")

    expect(streamedLineChanges({ patchText: patch })).toEqual({ additions: 1, deletions: 1 })
  })
})

describe("editLineChanges", () => {
  test("keeps untouched lines out of the counts", () => {
    expect(editLineChanges("a\nb\nc\nd", "a\nb\nc\nd")).toEqual({ additions: 0, deletions: 0 })
  })

  test("handles a replacement at the end of the file", () => {
    expect(editLineChanges("a\nb", "a\nb\nc")).toEqual({ additions: 1, deletions: 0 })
  })
})

describe("patchLineChanges", () => {
  test("ignores the file headers", () => {
    expect(patchLineChanges("--- a\n+++ b\n+x\n-y")).toEqual({ additions: 1, deletions: 1 })
  })
})
