import { describe, expect, test } from "bun:test"
import { BATCH_PROMPT } from "../src/session/runner/batch-pace.js"
import {
  EXPLORE_BUDGET_PROMPT,
  EXPLORE_FORCE_PROMPT,
  EXPLORE_HANDOFF_PROMPT,
  EXPLORE_HARD_LOCATE_PROMPT,
  EXPLORE_SOFT_PROMPT,
} from "../src/session/runner/explore-budget.js"
import { FAILURE_RESEARCH_PROMPT } from "../src/session/runner/failure-streak.js"
import {
  EDIT_SPIRAL_NUDGE_PROMPT,
  EDIT_SPIRAL_STOP_PROMPT,
} from "../src/session/runner/edit-spiral.js"
import { LOOP_NUDGE_PROMPT, LOOP_STOP_PROMPT } from "../src/session/runner/loop-detection.js"
import { MAX_STEPS_PROMPT, MAX_STEPS_TODO_CLOSEOUT_PROMPT } from "../src/session/runner/max-steps.js"
import { NARRATE_PROMPT } from "../src/session/runner/narrate.js"
import {
  TODO_CONTINUE_SOFT_PROMPT,
  TODO_START_SOFT_PROMPT,
} from "../src/session/runner/planning-gate.js"
import { MIXED_PROSE_QUESTION_PROMPT } from "../src/session/runner/continue-intent-gate.js"
import {
  EXPLORE_UPFRONT_PROMPT,
  PLAN_AWAIT_PROMPT,
  PLAN_UPFRONT_PROMPT,
  SEARCH_CAP_PROMPT,
} from "../src/session/runner/locate-intent.js"
import { SEARCH_MISS_STOP_PROMPT } from "../src/session/runner/search-miss.js"
import { SEARCH_MISS_PROMPT } from "../src/session/runner/search-miss.js"
import { PROBE_SCRIPT_PROMPT } from "../src/session/runner/probe-script.js"
import {
  SUBAGENT_WAIT_NUDGE_PROMPT,
  SUBAGENT_WAIT_STOP_PROMPT,
} from "../src/session/runner/subagent-wait.js"
import { selectSteer, type SteerInput } from "../src/session/runner/steer.js"

const quiet: SteerInput = {
  stepLimitReached: false,
  stepLimitTodoCloseout: false,
  loopStopped: false,
  editSpiralStopped: false,
  exploreHard: false,
  exploreHardLocate: false,
  exploreHandoff: false,
  exploreUpfront: false,
  planUpfront: false,
  planAwait: false,
  searchCapStop: false,
  searchMissStop: false,
  subagentWaitStop: false,
  mixedProseQuestion: false,
  exploreForce: false,
  batchNudge: false,
  loopNudged: false,
  editSpiralNudged: false,
  failureNudged: false,
  searchMissNudged: false,
  subagentWaitNudged: false,
  probeScriptNudged: false,
  narrate: false,
  exploreSoft: false,
  todoStartSoft: false,
  todoStale: false,
  focusTools: ["read", "edit", "subagent"],
  batchTools: ["grep", "glob", "read"],
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
      toolChoice: "none",
    })
  })

  test("open todos at the step ceiling force todowrite closeout instead of a status essay", () => {
    expect(
      steer({
        stepLimitTodoCloseout: true,
        stepLimitReached: true,
        loopStopped: true,
        narrate: true,
      }),
    ).toEqual({
      prompt: MAX_STEPS_TODO_CLOSEOUT_PROMPT,
      role: "assistant",
      stop: false,
      toolChoice: "todowrite",
    })
  })

  test("a loop that survived its nudge stops the turn", () => {
    expect(steer({ loopStopped: true, exploreHard: true, narrate: true })).toEqual({
      prompt: LOOP_STOP_PROMPT,
      role: "assistant",
      stop: true,
      toolChoice: "none",
    })
  })

  test("locate handoff forces a subagent call and narrows tools", () => {
    expect(steer({ exploreHandoff: true, narrate: true, exploreSoft: true, batchNudge: true })).toEqual({
      prompt: EXPLORE_HANDOFF_PROMPT,
      role: "assistant",
      stop: false,
      tools: quiet.focusTools,
      toolChoice: "subagent",
    })
  })

  test("search cap stops the turn without opening Explore", () => {
    expect(steer({ searchCapStop: true, exploreHandoff: true, exploreUpfront: true, narrate: true })).toEqual({
      prompt: SEARCH_CAP_PROMPT,
      role: "assistant",
      stop: true,
      toolChoice: "none",
    })
  })

  test("upfront Explore beats late handoff when intent is broad and pristine", () => {
    expect(steer({ exploreUpfront: true, exploreHandoff: true, batchNudge: true, exploreSoft: true })).toEqual({
      prompt: EXPLORE_UPFRONT_PROMPT,
      role: "assistant",
      stop: false,
      tools: quiet.focusTools,
      toolChoice: "subagent",
    })
  })

  test("upfront plan forces write and beats Explore / todo force", () => {
    expect(
      steer({ planUpfront: true, exploreUpfront: true, todoStartSoft: true, batchNudge: true }),
    ).toEqual({
      prompt: PLAN_UPFRONT_PROMPT,
      role: "assistant",
      stop: false,
      tools: quiet.focusTools,
      toolChoice: "write",
    })
  })

  test("plan await stops the turn after the plan file lands", () => {
    expect(steer({ planAwait: true, planUpfront: true, todoStartSoft: true, narrate: true })).toEqual({
      prompt: PLAN_AWAIT_PROMPT,
      role: "assistant",
      stop: true,
      toolChoice: "none",
    })
  })

  test("search-miss stop withdraws tools after the soft synonym chance", () => {
    expect(steer({ searchMissStop: true, searchMissNudged: true, exploreHandoff: true })).toEqual({
      prompt: SEARCH_MISS_STOP_PROMPT,
      role: "assistant",
      stop: true,
      toolChoice: "none",
    })
  })

  test("mixed prose question stops ask-then-continue theater", () => {
    expect(steer({ mixedProseQuestion: true, searchMissNudged: true, todoStartSoft: true })).toEqual({
      prompt: MIXED_PROSE_QUESTION_PROMPT,
      role: "assistant",
      stop: true,
      toolChoice: "none",
    })
  })

  test("a spent exploration budget on a long read urges a handoff, but keeps tools and never stops", () => {
    // Long-document shape: exploring >= hard but searches do not dominate, so stopping would
    // cut off a legitimate analysis. Hint only.
    expect(steer({ exploreHard: true, narrate: true, exploreSoft: true })).toEqual({
      prompt: EXPLORE_BUDGET_PROMPT,
      role: "assistant",
      stop: false,
    })
  })

  test("a spent exploration budget that is still a hunt stops the turn", () => {
    // ses_e5ea441c: hard fired as a hint and the model kept going another ~15 minutes. A locate
    // shape at the hard threshold has already had handoff chances — withdraw tools and answer.
    expect(steer({ exploreHardLocate: true, exploreHard: true, exploreHandoff: true, narrate: true })).toEqual({
      prompt: EXPLORE_HARD_LOCATE_PROMPT,
      role: "assistant",
      stop: true,
      toolChoice: "none",
    })
  })

  test("explore force narrows tools after a soft nudge was ignored", () => {
    expect(steer({ exploreForce: true, batchNudge: true, exploreSoft: true })).toEqual({
      prompt: EXPLORE_FORCE_PROMPT,
      role: "assistant",
      stop: false,
      tools: quiet.focusTools,
    })
  })

  test("batch nudge narrows to grep/glob/read below force, above soft", () => {
    expect(steer({ batchNudge: true, narrate: true, exploreSoft: true })).toEqual({
      prompt: BATCH_PROMPT,
      role: "system",
      stop: false,
      tools: quiet.batchTools,
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

  test("empty-search streak nudges synonym expansion, below failure research", () => {
    expect(steer({ searchMissNudged: true, narrate: true, exploreSoft: true })).toEqual({
      prompt: SEARCH_MISS_PROMPT,
      role: "system",
      stop: false,
    })
    expect(steer({ failureNudged: true, searchMissNudged: true })).toEqual({
      prompt: FAILURE_RESEARCH_PROMPT,
      role: "system",
      stop: false,
    })
  })

  test("subagent wait soft then stop; stop outranks soft probe-script", () => {
    expect(steer({ subagentWaitNudged: true, probeScriptNudged: true, narrate: true })).toEqual({
      prompt: SUBAGENT_WAIT_NUDGE_PROMPT,
      role: "system",
      stop: false,
    })
    expect(steer({ subagentWaitStop: true, subagentWaitNudged: true, searchMissNudged: true })).toEqual({
      prompt: SUBAGENT_WAIT_STOP_PROMPT,
      role: "assistant",
      stop: true,
      toolChoice: "none",
    })
    expect(steer({ probeScriptNudged: true, narrate: true })).toEqual({
      prompt: PROBE_SCRIPT_PROMPT,
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

  test("todo-start soft never forces toolChoice and outranks soft explore", () => {
    expect(steer({ todoStartSoft: true, batchNudge: true, exploreSoft: true })).toEqual({
      prompt: BATCH_PROMPT,
      role: "system",
      stop: false,
      tools: quiet.batchTools,
    })
    expect(steer({ todoStartSoft: true, exploreSoft: true })).toEqual({
      prompt: TODO_START_SOFT_PROMPT,
      role: "system",
      stop: false,
    })
  })

  test("continue-after-plan soft uses the next-phase prompt without forcing", () => {
    expect(steer({ todoStartSoft: true, todoStartSoftContinue: true })).toEqual({
      prompt: TODO_CONTINUE_SOFT_PROMPT,
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

  test("only hard stops withdraw tools (limit / loop / spiral / locate-hard / search-cap / miss-stop / wait-stop / prose-q / plan-await)", () => {
    expect(steer({ stepLimitReached: true })!.stop).toBe(true)
    expect(steer({ loopStopped: true })!.stop).toBe(true)
    expect(steer({ editSpiralStopped: true })!.stop).toBe(true)
    expect(steer({ exploreHardLocate: true })!.stop).toBe(true)
    expect(steer({ searchCapStop: true })!.stop).toBe(true)
    expect(steer({ searchMissStop: true })!.stop).toBe(true)
    expect(steer({ subagentWaitStop: true })!.stop).toBe(true)
    expect(steer({ mixedProseQuestion: true })!.stop).toBe(true)
    expect(steer({ planAwait: true })!.stop).toBe(true)
    expect(steer({ exploreHard: true })!.stop).toBe(false)
    expect(steer({ exploreUpfront: true })!.stop).toBe(false)
    expect(steer({ planUpfront: true })!.stop).toBe(false)
    expect(steer({ loopNudged: true })!.stop).toBe(false)
    expect(steer({ editSpiralNudged: true })!.stop).toBe(false)
    expect(steer({ subagentWaitNudged: true })!.stop).toBe(false)
    expect(steer({ probeScriptNudged: true })!.stop).toBe(false)
    expect(steer({ narrate: true })!.stop).toBe(false)
    expect(steer({ exploreSoft: true })!.stop).toBe(false)
  })

  test("edit spiral soft nudge keeps tools; stop withdraws them", () => {
    expect(steer({ editSpiralNudged: true })).toEqual({
      prompt: EDIT_SPIRAL_NUDGE_PROMPT,
      role: "system",
      stop: false,
    })
    expect(steer({ editSpiralStopped: true, editSpiralNudged: true, narrate: true })).toEqual({
      prompt: EDIT_SPIRAL_STOP_PROMPT,
      role: "assistant",
      stop: true,
      toolChoice: "none",
    })
  })
})
