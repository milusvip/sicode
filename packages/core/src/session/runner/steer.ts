/**
 * SiCode: which steering message, if any, replaces the tail of a step's request.
 *
 * A turn can go wrong in several ways at once — out of steps, stuck in a loop, exploring forever,
 * going quiet. Only one message is sent, so the order below is the priority: the conditions that
 * also withdraw tools come first, because they end the turn, and among those a reached step limit
 * outranks everything else. The softer pacing hints come last.
 *
 * Kept pure and separate from the runner so the ordering is testable without simulating a model.
 */
import { BATCH_PROMPT } from "./batch-pace.js"
import { EDIT_SPIRAL_NUDGE_PROMPT, EDIT_SPIRAL_STOP_PROMPT } from "./edit-spiral.js"
import {
  EXPLORE_BUDGET_PROMPT,
  EXPLORE_FORCE_PROMPT,
  EXPLORE_HANDOFF_PROMPT,
  EXPLORE_HARD_LOCATE_PROMPT,
  EXPLORE_SOFT_PROMPT,
} from "./explore-budget.js"
import { FAILURE_RESEARCH_PROMPT } from "./failure-streak.js"
import { LOOP_NUDGE_PROMPT, LOOP_STOP_PROMPT, probeNudgePrompt } from "./loop-detection.js"
import { MAX_STEPS_PROMPT, MAX_STEPS_TODO_CLOSEOUT_PROMPT } from "./max-steps.js"
import { NARRATE_PROMPT } from "./narrate.js"
import {
  TODO_CONTINUE_SOFT_PROMPT,
  TODO_STALE_PROMPT,
  TODO_START_SOFT_PROMPT,
} from "./planning-gate.js"
import { MIXED_PROSE_QUESTION_PROMPT } from "./continue-intent-gate.js"
import {
  EXPLORE_UPFRONT_PROMPT,
  PLAN_AWAIT_PROMPT,
  PLAN_UPFRONT_PROMPT,
  SEARCH_CAP_PROMPT,
} from "./locate-intent.js"
import { SEARCH_MISS_PROMPT, SEARCH_MISS_STOP_PROMPT } from "./search-miss.js"
import { PROBE_SCRIPT_PROMPT } from "./probe-script.js"
import { SUBAGENT_WAIT_NUDGE_PROMPT, SUBAGENT_WAIT_STOP_PROMPT } from "./subagent-wait.js"

export interface Steer {
  readonly prompt: string
  /** `assistant` states the situation as the model's own; `system` is an instruction about form. */
  readonly role: "assistant" | "system"
  /** Withdraws tools for this request, which is what actually ends the turn. */
  readonly stop: boolean
  /**
   * SiCode: historically narrowed the advertised tool list. Runner no longer applies this to the
   * request (full snapshot stays cache-stable); kept on Steer so priority tests can still assert
   * which branch won. Prefer `toolChoice` when a hard bind is required.
   */
  readonly tools?: readonly string[]
  /**
   * SiCode: provider toolChoice for this request. `"none"` ends the turn; a tool name forces that
   * call (locate handoff → `subagent`); `"required"` forces some tool. Undefined leaves auto.
   */
  readonly toolChoice?: "none" | "required" | string
}

export interface SteerInput {
  readonly stepLimitReached: boolean
  /**
   * SiCode: step ceiling hit with open todos — short closeout window (todowrite), not a status essay.
   */
  readonly stepLimitTodoCloseout: boolean
  /** A loop that already survived a nudge this turn. */
  readonly loopStopped: boolean
  /** Edit↔read spiral that already survived a soft nudge this turn. */
  readonly editSpiralStopped: boolean
  readonly exploreHard: boolean
  /**
   * Hard budget reached while the turn is still spinning (`spinningSteps` > 0: hunt or throwaway
   * measurement). Unlike a long document read, this shape stops the turn — a hint alone was
   * ignored for ~15 minutes (ses_e5ea441c).
   */
  readonly exploreHardLocate: boolean
  /** Read-only steps that are mostly searches crossed the handoff threshold. */
  readonly exploreHandoff: boolean
  /**
   * SiCode: broad-locate intent on a pristine turn — force Explore once up front (Cursor shape),
   * not after empty greps.
   */
  readonly exploreUpfront: boolean
  /**
   * SiCode: design intent on a pristine turn — force one write to `.sicode/plans/` (Build-native plan).
   */
  readonly planUpfront: boolean
  /**
   * SiCode: design turn already wrote the plan — withdraw tools and wait for user approval.
   */
  readonly planAwait: boolean
  /**
   * SiCode: main-chain grep/glob budget exhausted — stop tools; do not divert into Explore.
   */
  readonly searchCapStop: boolean
  /**
   * SiCode: empty-search soft nudge already spent and streak is still empty — stop tools.
   */
  readonly searchMissStop: boolean
  /**
   * SiCode: background-subagent wait polling survived a soft nudge — stop tools.
   */
  readonly subagentWaitStop: boolean
  /**
   * SiCode: assistant prose asked `?` while also calling non-question tools — stop the theater.
   */
  readonly mixedProseQuestion: boolean
  /** A soft nudge already went out and the model read again instead of acting. */
  readonly exploreForce: boolean
  /** Trailing steps each used exactly one look tool — force a batched fan-out. */
  readonly batchNudge: boolean
  /** A loop seen for the first time this turn. */
  readonly loopNudged: boolean
  /** Edit↔read spiral seen for the first time this turn. */
  readonly editSpiralNudged: boolean
  /** The file a turn keeps re-reading without changing, when that is worth saying once. */
  readonly probeNudged?: string
  /** A failure streak that crossed its threshold this step. */
  readonly failureNudged: boolean
  /** Consecutive empty greps/globs — Flash serial keyword guessing (soft, once). */
  readonly searchMissNudged: boolean
  /** Background subagents outstanding + wait narration — soft once. */
  readonly subagentWaitNudged: boolean
  /** Repeated write→shell of one-off probe scripts — soft once. */
  readonly probeScriptNudged: boolean
  readonly narrate: boolean
  readonly exploreSoft: boolean
  /** Soft: multi-step turn with no todowrite yet (Cursor-shaped — never force open). */
  readonly todoStartSoft: boolean
  /**
   * SiCode: soft remind after bare `继续` once the prior plan finished (earlier softAt; still no force).
   */
  readonly todoStartSoftContinue?: boolean
  /** The list has fallen behind the work: several finished tool calls since the last todowrite. */
  readonly todoStale: boolean
  /** Tools the narrowed explore/force/handoff request may still advertise. */
  readonly focusTools: readonly string[]
  /** Tools the batching step may still advertise (grep/glob/read). */
  readonly batchTools: readonly string[]
}

export function selectSteer(input: SteerInput): Steer | undefined {
  // SiCode: open todos at the ceiling — close out; do not hand back a "remaining work" essay.
  if (input.stepLimitTodoCloseout)
    return {
      prompt: MAX_STEPS_TODO_CLOSEOUT_PROMPT,
      role: "assistant",
      stop: false,
      toolChoice: "todowrite",
    }
  if (input.stepLimitReached) return { prompt: MAX_STEPS_PROMPT, role: "assistant", stop: true, toolChoice: "none" }
  if (input.loopStopped) return { prompt: LOOP_STOP_PROMPT, role: "assistant", stop: true, toolChoice: "none" }
  // SiCode: edit→read→edit on one path survived a soft nudge — withdraw tools (same shape as locate hard).
  if (input.editSpiralStopped)
    return { prompt: EDIT_SPIRAL_STOP_PROMPT, role: "assistant", stop: true, toolChoice: "none" }
  // SiCode: hard budget + still hunting. Soft handoff already had its window; withdraw tools so the
  // model must answer instead of grepping for another quarter hour (ses_e5ea441c).
  if (input.exploreHardLocate)
    return { prompt: EXPLORE_HARD_LOCATE_PROMPT, role: "assistant", stop: true, toolChoice: "none" }
  // SiCode: main-chain search budget — stop like Cursor's MAX_TOOL_CALLS, do not open a second hunt.
  if (input.searchCapStop)
    return { prompt: SEARCH_CAP_PROMPT, role: "assistant", stop: true, toolChoice: "none" }
  // SiCode: synonym soft already spent, still empty — stop (do not keep grepping).
  if (input.searchMissStop)
    return { prompt: SEARCH_MISS_STOP_PROMPT, role: "assistant", stop: true, toolChoice: "none" }
  // SiCode: wait-polling soft already spent — stop so the parent cannot keep spinning on A–D.
  if (input.subagentWaitStop)
    return { prompt: SUBAGENT_WAIT_STOP_PROMPT, role: "assistant", stop: true, toolChoice: "none" }
  // SiCode: prose `?` mixed with tools never waits — withdraw tools this step.
  if (input.mixedProseQuestion)
    return { prompt: MIXED_PROSE_QUESTION_PROMPT, role: "assistant", stop: true, toolChoice: "none" }
  // SiCode: design plan already on disk — soft approve gate (stop; next user turn implements).
  if (input.planAwait)
    return { prompt: PLAN_AWAIT_PROMPT, role: "assistant", stop: true, toolChoice: "none" }
  // SiCode: design intent at turn start — one plan file before todowrite / product edits.
  if (input.planUpfront)
    return {
      prompt: PLAN_UPFRONT_PROMPT,
      role: "assistant",
      stop: false,
      tools: input.focusTools,
      toolChoice: "write",
    }
  // SiCode: broad locate at turn start — one Explore before any main-chain grep (intent-gated).
  if (input.exploreUpfront)
    return {
      prompt: EXPLORE_UPFRONT_PROMPT,
      role: "assistant",
      stop: false,
      tools: input.focusTools,
      toolChoice: "subagent",
    }
  // SiCode: a lost hunt hands its remaining search to `explore`. toolChoice forces the subagent
  // call — a prompt alone was declineable, and Flash kept grepping. Gated on locatingSteps so a
  // long document read never gets this force. Prefer searchCapStop / exploreUpfront when they apply.
  if (input.exploreHandoff)
    return {
      prompt: EXPLORE_HANDOFF_PROMPT,
      role: "assistant",
      stop: false,
      tools: input.focusTools,
      toolChoice: "subagent",
    }
  // SiCode: spent exploration budget on a long-document / analysis shape. Hint only — stopping
  // would cut off a legitimate read. Locate hunts take the exploreHardLocate branch above.
  if (input.exploreHard) return { prompt: EXPLORE_BUDGET_PROMPT, role: "assistant", stop: false }
  if (input.loopNudged) return { prompt: LOOP_NUDGE_PROMPT, role: "system", stop: false }
  // SiCode: first sighting of an edit↔read spiral — soft only; a second sighting stops above.
  if (input.editSpiralNudged) return { prompt: EDIT_SPIRAL_NUDGE_PROMPT, role: "system", stop: false }
  // SiCode: softer than a loop and deliberately never fatal — a re-read can still be legitimate,
  // so this only suggests, and only once per file.
  if (input.probeNudged !== undefined)
    return { prompt: probeNudgePrompt(input.probeNudged), role: "system", stop: false }
  if (input.failureNudged) return { prompt: FAILURE_RESEARCH_PROMPT, role: "system", stop: false }
  // SiCode: softer than research-on-failure — the model is finding nothing, not breaking tools.
  if (input.searchMissNudged) return { prompt: SEARCH_MISS_PROMPT, role: "system", stop: false }
  // SiCode: parent narrating "still waiting on A–D" — soft once, then stop above.
  if (input.subagentWaitNudged) return { prompt: SUBAGENT_WAIT_NUDGE_PROMPT, role: "system", stop: false }
  // SiCode: inventing .py / _tools probes instead of grep/read — soft only.
  if (input.probeScriptNudged) return { prompt: PROBE_SCRIPT_PROMPT, role: "system", stop: false }
  // SiCode: the soft nudge was already sent and the model read again. Repeating it does nothing, so
  // the next request advertises only tools that act, read a known file, or hand off.
  if (input.exploreForce)
    return { prompt: EXPLORE_FORCE_PROMPT, role: "assistant", stop: false, tools: input.focusTools }
  // SiCode: the list is the user's progress bar; a stale one is a wrong answer about progress.
  // Raised before the batching steer so a stale progress bar is not deferred another step.
  if (input.todoStale) return { prompt: TODO_STALE_PROMPT, role: "system", stop: false }
  // SiCode: consecutive single-tool look steps — prompt for a parallel batch (tool list stays full).
  if (input.batchNudge)
    return { prompt: BATCH_PROMPT, role: "system", stop: false, tools: input.batchTools }
  if (input.narrate) return { prompt: NARRATE_PROMPT, role: "system", stop: false }
  // Soft only — opening a checklist is discretionary (Cursor). Finish refuse lives in completion-gate.
  if (input.todoStartSoft)
    return {
      prompt: input.todoStartSoftContinue ? TODO_CONTINUE_SOFT_PROMPT : TODO_START_SOFT_PROMPT,
      role: "system",
      stop: false,
    }
  if (input.exploreSoft) return { prompt: EXPLORE_SOFT_PROMPT, role: "system", stop: false }
  return undefined
}
