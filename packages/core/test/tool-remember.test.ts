import { describe, expect, test } from "bun:test"
import { toModelContent } from "../src/tool/plugin/remember.js"
import { toModelContent as recallContent } from "../src/tool/plugin/recall.js"
import { linkContradicts, type Belief, type Scope } from "../src/session/memory/belief.js"
import { searchBeliefs } from "../src/session/memory/search.js"

describe("RememberTool.toModelContent", () => {
  test("confirms scope and kind", () => {
    expect(
      toModelContent({
        id: "x",
        scope: "persona",
        kind: "preference",
        text: "Prefer concise replies",
      }),
    ).toBe("Remembered as persona [preference]: Prefer concise replies")
  })

  test("reports supersede and conflict outcomes", () => {
    expect(
      toModelContent(
        { id: "x", scope: "project", kind: "file", text: "dock is in requests" },
        {
          superseded: ["dock was in sidebar"],
          conflicts: ["dock is in the header"],
        },
      ),
    ).toBe(
      'Remembered as project [file]: dock is in requests (superseded prior: "dock was in sidebar"; conflicts with: "dock is in the header")',
    )
  })
})

describe("RecallTool contradiction surfacing", () => {
  const scope: Scope = { projectKey: "/repo" }
  const belief = (patch: Partial<Belief> & Pick<Belief, "id" | "proposition" | "kind">): Belief => ({
    scope,
    paths: [],
    entities: [],
    validAt: 1,
    importance: 0.8,
    confidence: 0.7,
    misses: 0,
    seenAt: 1,
    contradicts: [],
    provenance: [],
    ...patch,
  })

  test("searchBeliefs keeps both sides of a contradiction and flags them", () => {
    const a = belief({ id: "a", kind: "decision", proposition: "Prefer Bun for tests" })
    const b = belief({ id: "b", kind: "decision", proposition: "Prefer Node for tests" })
    const [left, right] = linkContradicts(a, b)
    const hits = searchBeliefs([left, right], "Prefer tests", 5)
    expect(hits.map((hit) => hit.belief.id).sort()).toEqual(["a", "b"])
    expect(hits.every((hit) => hit.contradicts.length > 0)).toBe(true)
  })

  test("recall content annotates conflicts", () => {
    const text = recallContent(
      [
        {
          kind: "decision",
          text: "Use Bun",
          paths: [],
          stale: false,
          conflicts: true,
        },
      ],
      2,
    )
    expect(text).toContain("conflicts with another memory")
  })
})
