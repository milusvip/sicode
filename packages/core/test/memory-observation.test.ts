import { describe, expect, test } from "bun:test"
import { PERSONA_PROJECT_KEY } from "../src/session/memory/belief.js"
import { normalize, normalizeAll, toBelief } from "../src/session/memory/observation.js"
import * as ExplicitPolicy from "../src/session/memory/policy/explicit.js"
import { fromUserTexts } from "../src/session/memory/policy/repeated-constraint.js"
import { fromEditPaths } from "../src/session/memory/policy/edit-locus.js"
import { fromPromptTurn } from "../src/session/memory/policy/collect.js"

describe("observation normalize", () => {
  test("drops progress chatter", () => {
    expect(
      normalize({
        scope: "persona",
        kind: "preference",
        text: "go",
        strength: 1,
        source: { type: "user" },
      }),
    ).toBeUndefined()
  })

  test("dedupes normalized observations", () => {
    const out = normalizeAll([
      { scope: "persona", kind: "preference", text: "short replies", strength: 0.9, source: { type: "user" } },
      { scope: "persona", kind: "preference", text: "short replies", strength: 0.5, source: { type: "user" } },
    ])
    expect(out).toHaveLength(1)
  })
})

describe("explicit policy", () => {
  test("记住： becomes persona observations", () => {
    // Explicit remember command surface stays Chinese — that is the user-facing verb.
    const out = ExplicitPolicy.fromUserText("记住：我偏好简短回复，改动前先说要改哪些文件。")
    expect(out.map((item) => item.text)).toEqual(["我偏好简短回复", "改动前先说要改哪些文件"])
    expect(out.every((item) => item.explicit && item.scope === "persona")).toBe(true)
  })

  test("ordinary questions produce nothing", () => {
    expect(ExplicitPolicy.fromUserText("where is the sidebar bottom padding controlled?")).toEqual([])
  })
})

describe("auto policies", () => {
  test("repeated constraint becomes an observation", () => {
    const out = fromUserTexts(["do not edit packages/ui", "I said do not edit packages/ui"])
    expect(out.some((item) => item.text.includes("packages/ui"))).toBe(true)
    expect(out[0]?.explicit).toBe(false)
  })

  test("single constraint does not promote", () => {
    expect(fromUserTexts(["do not edit packages/ui"])).toEqual([])
  })

  test("edit locus needs three hits under one package", () => {
    expect(fromEditPaths(["packages/core/src/a.ts", "packages/core/src/b.ts"])).toEqual([])
    const out = fromEditPaths([
      "packages/core/src/a.ts",
      "packages/core/src/b.ts",
      "packages/core/src/c.ts",
    ])
    expect(out).toEqual([
      expect.objectContaining({
        scope: "project",
        text: "Frequent edit locus: packages/core",
      }),
    ])
  })
})

describe("collect.fromPromptTurn", () => {
  test("combines explicit remember with repeated constraints", () => {
    const out = fromPromptTurn({
      text: "do not edit packages/app",
      recentUserTexts: ["do not edit packages/app"],
    })
    expect(out.some((item) => item.text.includes("packages/app"))).toBe(true)
  })
})

describe("toBelief", () => {
  test("persona observations land under PERSONA_PROJECT_KEY", () => {
    const belief = toBelief(
      {
        scope: "persona",
        kind: "preference",
        text: "Prefer short answers",
        strength: 0.9,
        source: { type: "user" },
        explicit: true,
      },
      { personaId: "local", projectKey: "/repo", now: 1000 },
    )
    expect(belief?.scope).toEqual({ projectKey: PERSONA_PROJECT_KEY, personaId: "local" })
    expect(belief?.kind).toBe("preference")
  })
})
