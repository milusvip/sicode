import { afterEach, describe, expect, test } from "bun:test"
import { autoEnabled, filterForAdmit } from "../src/session/memory/consolidate.js"
import type { Observation } from "../src/session/memory/observation.js"

afterEach(() => {
  delete process.env.OPENCODE_MEMORY_AUTO
})

const explicit: Observation = {
  scope: "persona",
  kind: "preference",
  text: "Prefer short answers",
  strength: 0.9,
  source: { type: "user" },
  explicit: true,
}

const auto: Observation = {
  scope: "project",
  kind: "convention",
  text: "Frequent edit locus: packages/core",
  strength: 0.65,
  source: { type: "tool" },
  explicit: false,
}

describe("SessionMemoryConsolidate.filterForAdmit", () => {
  test("keeps auto observations by default", () => {
    expect(autoEnabled()).toBe(true)
    expect(filterForAdmit([explicit, auto])).toHaveLength(2)
  })

  test("OPENCODE_MEMORY_AUTO=0 drops only non-explicit observations", () => {
    process.env.OPENCODE_MEMORY_AUTO = "0"
    expect(autoEnabled()).toBe(false)
    expect(filterForAdmit([explicit, auto])).toEqual([explicit])
  })
})
