import { describe, expect, test } from "bun:test"
import { EXPLORE_BUDGET_PROMPT, EXPLORE_SOFT_PROMPT } from "../src/session/runner/explore-budget.js"
import { FAILURE_RESEARCH_PROMPT } from "../src/session/runner/failure-streak.js"
import { LOOP_NUDGE_PROMPT, LOOP_STOP_PROMPT } from "../src/session/runner/loop-detection.js"
import { MAX_STEPS_PROMPT } from "../src/session/runner/max-steps.js"
import { NARRATE_PROMPT } from "../src/session/runner/narrate.js"
import { selectSteer, type SteerInput } from "../src/session/runner/steer.js"

const quiet: SteerInput = {
  stepLimitReached: false,
  loopStopped: false,
  exploreHard: false,
  loopNudged: false,
  failureNudged: false,
  narrate: false,
  exploreSoft: false,
}

const steer = (patch: Partial<SteerInput>) => selectSteer({ ...quiet, ...patch })

describe("selectSteer", () => {
  test("says nothing when nothing is wrong", () => {
    expect(selectSteer(quiet)).toBeUndefined()
  })

  test("a reached step limit wins over everything and withdraws tools", () => {
    expect(steer({ stepLimitReached: true, loopStopped: true, exploreHard: true, narrate: true })).toEqual({
      prompt: MAX_STEPS_PROMPT,
      role: "assistant",
      stop: true,
    })
  })

  test("a loop that survived its nudge stops the turn", () => {
    expect(steer({ loopStopped: true, exploreHard: true, narrate: true })).toEqual({
      prompt: LOOP_STOP_PROMPT,
      role: "assistant",
      stop: true,
    })
  })

  test("a spent exploration budget urges an explore handoff, but keeps tools and never stops", () => {
    expect(steer({ exploreHard: true, narrate: true, exploreSoft: true })).toEqual({
      prompt: EXPLORE_BUDGET_PROMPT,
      role: "assistant",
      stop: false,
    })
  })

  test("a fresh loop is nudged, and keeps tools", () => {
    expect(steer({ loopNudged: true, failureNudged: true, narrate: true, exploreSoft: true })).toEqual({
      prompt: LOOP_NUDGE_PROMPT,
      role: "system",
      stop: false,
    })
  })

  test("a file probed over and over is named, and never stops the turn", () => {
    const result = steer({ probeNudged: "packages/ui/package.json" })
    expect(result?.stop).toBe(false)
    expect(result?.role).toBe("system")
    expect(result?.prompt).toContain("packages/ui/package.json")
  })

  test("a loop outranks a repeated probe, because it is the more specific signal", () => {
    expect(steer({ loopNudged: true, probeNudged: "a.ts", narrate: true })).toEqual({
      prompt: LOOP_NUDGE_PROMPT,
      role: "system",
      stop: false,
    })
  })

  test("a failure streak is nudged toward research when no loop is in play", () => {
    expect(steer({ failureNudged: true, narrate: true, exploreSoft: true })).toEqual({
      prompt: FAILURE_RESEARCH_PROMPT,
      role: "system",
      stop: false,
    })
  })

  test("narration is requested when a loop is not in play", () => {
    expect(steer({ narrate: true, exploreSoft: true })).toEqual({
      prompt: NARRATE_PROMPT,
      role: "system",
      stop: false,
    })
  })

  test("the soft exploration hint is the last resort", () => {
    expect(steer({ exploreSoft: true })).toEqual({
      prompt: EXPLORE_SOFT_PROMPT,
      role: "system",
      stop: false,
    })
  })

  test("only the step limit and a survived loop withdraw tools", () => {
    expect(steer({ stepLimitReached: true })!.stop).toBe(true)
    expect(steer({ loopStopped: true })!.stop).toBe(true)
    expect(steer({ exploreHard: true })!.stop).toBe(false)
    expect(steer({ loopNudged: true })!.stop).toBe(false)
    expect(steer({ narrate: true })!.stop).toBe(false)
    expect(steer({ exploreSoft: true })!.stop).toBe(false)
  })
})
