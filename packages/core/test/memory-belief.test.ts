import { describe, expect, test } from "bun:test"
import {
  activeOnly,
  beliefId,
  fromFact,
  invalidate,
  isActive,
  linkContradicts,
  mergeBeliefs,
  proseContradicts,
  supersede,
  toFact,
  verifyBeliefs,
  type Belief,
  type Scope,
} from "../src/session/memory/belief.js"
import { MISS_LIMIT } from "../src/session/project-memory.js"
import type { Fact } from "../src/session/project-memory.js"

const scope: Scope = { projectKey: "/repo" }

const belief = (patch: Partial<Belief> & Pick<Belief, "id" | "proposition" | "kind">): Belief => ({
  scope,
  paths: [],
  entities: [],
  validAt: 1_000,
  importance: 0.5,
  confidence: 0.7,
  misses: 0,
  seenAt: 1_000,
  contradicts: [],
  provenance: [],
  ...patch,
})

describe("SessionMemoryBelief", () => {
  test("beliefId is stable for the same scope+kind+proposition", () => {
    expect(beliefId(scope, "decision", "Use Bun")).toBe(beliefId(scope, "decision", "use bun"))
    expect(beliefId(scope, "decision", "Use Bun")).not.toBe(
      beliefId({ ...scope, personaId: "me" }, "decision", "Use Bun"),
    )
  })

  test("isActive respects invalidAt and supersededBy", () => {
    const live = belief({ id: "a", kind: "context", proposition: "live" })
    expect(isActive(live, 2_000)).toBe(true)
    expect(isActive({ ...live, invalidAt: 1_500 }, 2_000)).toBe(false)
    expect(isActive({ ...live, supersededBy: "b" }, 2_000)).toBe(false)
  })

  test("fromFact / toFact round-trip the fields recall still needs", () => {
    const fact: Fact = {
      kind: "file",
      text: "permission dock",
      paths: ["packages/app/src/session/requests/session-permission-dock.tsx"],
      misses: 1,
      seen: 9_000,
    }
    const lifted = fromFact(fact, scope)
    expect(lifted.kind).toBe("file")
    expect(lifted.proposition).toBe(fact.text)
    expect(lifted.paths).toEqual(fact.paths)
    expect(lifted.misses).toBe(1)
    expect(toFact(lifted)).toEqual({
      kind: "file",
      text: fact.text,
      paths: fact.paths,
      misses: 1,
      seen: 9_000,
    })
  })

  test("mergeBeliefs refreshes seenAt and clears prior invalidation on re-admit", () => {
    const prior = belief({
      id: beliefId(scope, "decision", "Prefer Flash golden"),
      kind: "decision",
      proposition: "Prefer Flash golden",
      invalidAt: 5_000,
      seenAt: 4_000,
    })
    const next = mergeBeliefs(
      [prior],
      [
        belief({
          id: prior.id,
          kind: "decision",
          proposition: "Prefer Flash golden",
        }),
      ],
      9_000,
    )
    expect(next).toHaveLength(1)
    expect(next[0]?.seenAt).toBe(9_000)
    expect(next[0]?.invalidAt).toBeUndefined()
  })

  test("mergeBeliefs same-id re-admit unions paths and keeps the stronger importance", () => {
    const prior = belief({
      id: beliefId(scope, "file", "dock lives in requests"),
      kind: "file",
      proposition: "dock lives in requests",
      paths: ["packages/app/src/session/requests/session-permission-dock.tsx"],
      importance: 0.9,
      confidence: 0.5,
      seenAt: 1_000,
      validAt: 500,
    })
    const next = mergeBeliefs(
      [prior],
      [
        belief({
          id: prior.id,
          kind: "file",
          proposition: "dock lives in requests",
          paths: ["packages/app/src/session/requests/session-permission-dock.tsx", "packages/app/src/session/screen.tsx"],
          importance: 0.4,
          confidence: 0.95,
        }),
      ],
      9_000,
    )
    expect(next).toHaveLength(1)
    expect(next[0]?.paths).toEqual([
      "packages/app/src/session/requests/session-permission-dock.tsx",
      "packages/app/src/session/screen.tsx",
    ])
    expect(next[0]?.importance).toBe(0.9)
    expect(next[0]?.confidence).toBe(0.95)
    expect(next[0]?.validAt).toBe(500)
  })

  test("activeOnly drops superseded and sorts by seenAt", () => {
    const a = belief({ id: "a", kind: "context", proposition: "a", seenAt: 1 })
    const b = belief({ id: "b", kind: "context", proposition: "b", seenAt: 3, supersededBy: "c" })
    const c = belief({ id: "c", kind: "context", proposition: "c", seenAt: 2 })
    expect(activeOnly([a, b, c]).map((item) => item.id)).toEqual(["c", "a"])
  })

  test("invalidate and supersede mark a belief inactive", () => {
    const live = belief({ id: "a", kind: "context", proposition: "live" })
    expect(isActive(invalidate(live, 2_000), 2_000)).toBe(false)
    expect(isActive(supersede(live, "b", 2_000), 2_000)).toBe(false)
  })

  test("mergeBeliefs supersedes an older file fact that shares a path", () => {
    const older = belief({
      id: "old",
      kind: "file",
      proposition: "dock was in sidebar",
      paths: ["packages/app/src/session/requests/session-permission-dock.tsx"],
      seenAt: 1_000,
    })
    const newer = belief({
      id: "new",
      kind: "file",
      proposition: "dock owns always/once",
      paths: ["packages/app/src/session/requests/session-permission-dock.tsx"],
      seenAt: 2_000,
    })
    const next = mergeBeliefs([older], [newer], 3_000)
    expect(next.find((item) => item.id === "old")?.supersededBy).toBe("new")
    expect(isActive(next.find((item) => item.id === "old")!, 3_000)).toBe(false)
  })

  test("mergeBeliefs does not supersede across kinds or without shared paths", () => {
    const decision = belief({
      id: "d",
      kind: "decision",
      proposition: "Use Bun",
      paths: ["a.ts"],
    })
    const file = belief({
      id: "f",
      kind: "file",
      proposition: "entry",
      paths: ["a.ts"],
    })
    const other = belief({
      id: "o",
      kind: "decision",
      proposition: "Use Node",
      paths: ["b.ts"],
    })
    const next = mergeBeliefs([decision], [file, other], 2_000)
    expect(next.find((item) => item.id === "d")?.supersededBy).toBeUndefined()
  })

  test("linkContradicts records both sides without invalidating", () => {
    const a = belief({ id: "a", kind: "decision", proposition: "Use Bun" })
    const b = belief({ id: "b", kind: "decision", proposition: "Use Node" })
    const [left, right] = linkContradicts(a, b)
    expect(left.contradicts).toEqual(["b"])
    expect(right.contradicts).toEqual(["a"])
    expect(isActive(left)).toBe(true)
    expect(isActive(right)).toBe(true)
    const [again] = linkContradicts(left, right)
    expect(again.contradicts).toEqual(["b"])
  })

  test("mergeBeliefs auto-links prose decisions that share a topic but disagree", () => {
    const bun = belief({
      id: beliefId(scope, "decision", "Prefer Bun for tests"),
      kind: "decision",
      proposition: "Prefer Bun for tests",
    })
    const node = belief({
      id: beliefId(scope, "decision", "Prefer Node for tests"),
      kind: "decision",
      proposition: "Prefer Node for tests",
    })
    expect(proseContradicts(bun, node)).toBe(true)
    const next = mergeBeliefs([bun], [node], 2_000)
    expect(next.find((item) => item.id === bun.id)?.contradicts).toContain(node.id)
    expect(next.find((item) => item.id === node.id)?.contradicts).toContain(bun.id)
    expect(isActive(next.find((item) => item.id === bun.id)!, 2_000)).toBe(true)
  })

  test("verifyBeliefs bumps misses and invalidates after MISS_LIMIT", () => {
    const live = belief({
      id: "f",
      kind: "file",
      proposition: "gone file",
      paths: ["missing/path.ts"],
      misses: MISS_LIMIT - 1,
    })
    const first = verifyBeliefs([live], () => false, 2_000)
    expect(first.dropped).toHaveLength(1)
    expect(isActive(first.dropped[0]!, 2_000)).toBe(false)

    const ok = belief({
      id: "ok",
      kind: "file",
      proposition: "still here",
      paths: ["present.ts"],
      misses: 1,
    })
    const second = verifyBeliefs([ok], () => true, 2_000)
    expect(second.dropped).toHaveLength(0)
    expect(second.beliefs[0]?.misses).toBe(0)
  })
})
