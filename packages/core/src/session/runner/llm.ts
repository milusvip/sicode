export * as SessionRunnerLLM from "./llm.js"

import { Message } from "@opencode/ai/effect"
import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { Cause, Effect, Exit, FiberMap, Layer } from "effect"
import { Database } from "../../database/database.js"
import { Bus } from "../../bus.js"
import { LocationLifecycle } from "../../location-lifecycle.js"
import { InstructionState } from "../instruction-state.js"
import { SessionCompaction } from "../compaction.js"
import { SessionContext } from "../context.js"
import { SessionTopicSwitch } from "../topic-switch.js"
import { SessionEvent } from "../event.js"
import { SessionInbox } from "../inbox.js"
import { SessionHistory } from "../history.js"
import { PromptPrefix } from "../prompt-prefix.js"
import { SessionModelRequest } from "../model-request.js"
import { SessionModelTransport } from "../model-transport.js"
import { SessionMessage } from "../message.js"
import { SessionSchema } from "../schema.js"
import { SessionStore } from "../store.js"
import { SessionMessageTable } from "../sql.js"
import { SessionTitle } from "../title.js"
import { toSessionError } from "../to-session-error.js"
import { DrainResult, Service, type Interface } from "./index.js"
import { Snapshot } from "../../snapshot.js"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { llmClient } from "../../effect/app-node-platform.js"
import { StepFailedError } from "../error.js"
import { SessionRunnerRetry } from "./retry.js"
import { SessionStep } from "./step.js"
import { ToolOutput } from "../../tool-output.js"
import { Plugin } from "../../plugin.js"
import { NARRATE_EVERY_STEPS } from "./narrate.js"
import {
  EXPLORE_FOCUS_TOOLS,
  EXPLORE_FORCE_GRACE,
  EXPLORE_HANDOFF_STEPS,
  EXPLORE_HARD_STEPS,
  exploreSoftEvery,
  locatingSteps,
  readOnlySteps,
  spinningSteps,
} from "./explore-budget.js"
import { detectEditSpiral } from "./edit-spiral.js"
import { detectLoop, detectRepeatedProbe } from "./loop-detection.js"
import {
  detectFailureStreak,
  FAILURE_STREAK_EVERY,
  FAILURE_STREAK_FIRST,
} from "./failure-streak.js"
import {
  detectSearchMissStreak,
  shouldNudgeSearchMiss,
  shouldStopSearchMiss,
} from "./search-miss.js"
import { detectProbeScript } from "./probe-script.js"
import { detectSubagentWait } from "./subagent-wait.js"
import {
  PLAN_FOCUS_TOOLS,
  shouldAwaitPlanApproval,
  shouldStopSearchCap,
  shouldSuppressTodoForDesign,
  shouldUpfrontExplore,
  shouldUpfrontPlan,
} from "./locate-intent.js"
import { BATCH_FOCUS_TOOLS, shouldNudgeBatch } from "./batch-pace.js"
import { selectSteer } from "./steer.js"
import { TODO_CLOSEOUT_STEPS, effectiveStepLimit } from "./max-steps.js"
import {
  completionContinue,
  detectCompletableTodos,
  isCompletionHolding,
  resolveStepToolChoice,
  waitingOnBackgroundShell,
  type CompletionContinueState,
} from "./completion-gate.js"
import {
  CONTINUE_INTENT_PROMPT,
  continueIntentFingerprint,
  mixedProseQuestionFingerprint,
  turnAwaitingUser,
} from "./continue-intent-gate.js"
import { BROWSER_DRIVE_GATE_PROMPT, browserDriveIdleFingerprint } from "./browser-drive-gate.js"
import { FINAL_ANSWER_PROMPT, unansweredPrompt } from "./final-answer-gate.js"
import { REPLY_STYLE_PROMPT, replyStyleFingerprint } from "./reply-style-gate.js"
import { REPLY_LANGUAGE_PROMPT, replyLanguageFingerprint } from "./reply-language-gate.js"
import { CHECKPOINT_PROMPT, checkpointFingerprint } from "../checkpoint-hint.js"
import {
  TODO_STALE_STEPS,
  TODO_START_STEPS,
  continuePlanStartThresholds,
  hasTodowriteSinceUser,
  staleTodoSteps,
} from "./planning-gate.js"

const CONTINUE_AFTER_INCOMPLETE_STREAM =
  "The previous response was interrupted. Continue from where you left off without repeating completed content."

const CONTINUE_AFTER_OUTPUT_LIMIT =
  "Your last response hit the output token limit (stop reason: length). Do not apologize, recap, or repeat yourself. Break the remaining work into smaller pieces."

/**
 * Trailing assistant steps of the current turn that produced no text. A step counts as silent when
 * its message carries tools or reasoning but no non-empty text part; the walk stops at the first
 * step that spoke, or at the user message that opened the turn.
 */
function silentSteps(messages: ReadonlyArray<SessionMessage.Info>) {
  let count = 0

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!
    if (message.type === "user") break
    if (message.type !== "assistant") continue
    if (message.content.some((part) => part.type === "text" && part.text.trim().length > 0)) break

    count += 1
  }

  return count
}

/**
 * SiCode: soft pacing injects — opt-in only (`=1`). Hard stops / toolChoice still default on.
 * Soft nags make the harness feel restricted without making the model smarter (harness-slim).
 */
function softSlimOn(key: "OPENCODE_EXPLORE_SOFT" | "OPENCODE_BATCH_NUDGE" | "OPENCODE_TODO_SOFT" | "OPENCODE_NARRATE") {
  return process.env[key] === "1"
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const lifecycle = yield* LocationLifecycle.Service
    const store = yield* SessionStore.Service
    const context = yield* SessionContext.Service
    const modelTransport = yield* SessionModelTransport.Service
    const db = (yield* Database.Service).db
    const compaction = yield* SessionCompaction.Service
    const plugins = yield* Plugin.Service
    const title = yield* SessionTitle.Service
    const steps = yield* SessionStep.make
    // Title generation starts once input is visible and must not delay model execution.
    const titles = yield* FiberMap.make<SessionSchema.ID, void, never>()

    const drain = Effect.fn("SessionRunner.drain")(function* (input: Parameters<Interface["drain"]>[0]) {
      const sessionID = input.sessionID
      let force = input.force
      let continuing = input.continuation !== undefined
      let step = input.continuation?.step ?? 1
      // SiCode: loop fingerprints already nudged this turn. A second sighting means the nudge did
      // not help, so the turn stops rather than being told the same thing again.
      const loopNudged = new Set<string>()
      // SiCode: files already reported as re-probed this turn. One nudge per file; the detector
      // keeps firing as the count grows, so without this the same file would be named every step.
      const probeNudged = new Set<string>()
      // SiCode: edit↔read spiral fingerprints already nudged this turn. Second sighting stops.
      const editSpiralNudged = new Set<string>()
      // SiCode: background-subagent wait fingerprints already soft-nudged this turn. Second → stop.
      const subagentWaitNudged = new Set<string>()
      // SiCode: probe-script write→run fingerprints already soft-nudged this turn (once each).
      const probeScriptNudged = new Set<string>()
      // SiCode: open-todo continue budget for this drain. Same stuck fingerprint may be forced up
      // soft continues then escalate to toolChoice todowrite — never idle solely on budget
      // (ses_e58cab861ffd: 40 mid-list stops after soft budget handoff).
      const completionState: CompletionContinueState = { fingerprint: "", count: 0 }
      // SiCode: prompts already asked to say something. A turn that ends silently is nudged once per
      // prompt; asking again after that would only add an empty round trip.
      const answerNudged = new Set<string>()
      // SiCode: messy handover replies already rewritten once this turn (reply-style-gate).
      const replyStyleNudged = new Set<string>()
      // SiCode: English reply after Chinese user turns — rewrite once (reply-language-gate).
      const replyLanguageNudged = new Set<string>()
      // SiCode: announce-then-stop fingerprints already gated this turn. Flash otherwise says the
      // next step and idles with zero tools; one nudge per announce.
      const continueIntentNudged = new Set<string>()
      // SiCode: after step ceiling with open todos — limited closeout steps (not a status essay).
      const todoCloseoutPace = { count: 0 }
      // SiCode: publish/drive turns that refused with zero browser.* calls. Once per user prompt;
      // soft hint alone was ignored.
      const browserDriveNudged = new Set<string>()
      // SiCode: long tool-turn checkpoints already fired this drain. Once per user prompt so a
      // 20-step investigation is not reminded every sixth step.
      const checkpointNudged = new Set<string>()
      // SiCode: whole-turn failed tool calls at the time the research nudge last fired. The trigger
      // is the trailing-window density (objective, variant-proof), this paces the re-nudges.
      const failureNudged = { at: 0 }
      // SiCode: whole-turn empty greps/globs at the last expansion nudge. Soft once, then hard stop
      // — otherwise the model narrates and greps forever.
      const searchMissPace = { at: 0, soft: false }
      // SiCode: prose-? + tools fingerprints already stopped this turn.
      const mixedProseNudged = new Set<string>()
      // SiCode: read-only step count when the soft explore nudge last fired. A further read after
      // that grace window sends exploreForce (prompt-only; tool list stays full for cache).
      const exploreSoftPace = { at: 0 }
      // SiCode: runner step when the soft "open a todo list" nudge last fired (once per turn; no force).
      const todoStartPace = { at: 0 }
      // SiCode: finished-call count at the last "your todo list is stale" reminder, so the nudge
      // repeats only after another full window of work rather than on every step.
      const todoStalePace = { at: 0 }
      let entering = true
      const promotable = input.promotable ?? "input"
      if (!force && !continuing) {
        const pending = yield* SessionInbox.nextPromotable(db, sessionID, "input")
        if (!pending) return DrainResult.Complete()
        const control = pending.type === "compaction" || pending.type === "move"
        if (promotable === "steer" && pending.delivery === "queue" && !control) return DrainResult.Complete()
      }
      yield* plugins.awaitActivation
      yield* settleStaleCompactions(sessionID)
      yield* settleStaleToolCalls(sessionID)

      const advanceToStep = Effect.fn("SessionRunner.advanceToStep")(() =>
        Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            while (true) {
              if (lifecycle.isClosed()) {
                yield* restore(modelTransport.close(sessionID))
                return DrainResult.Reloaded({ force, continuation: continuing ? { step } : undefined })
              }
              // Location entry and idle boundaries allow queued controls, not necessarily queued prompts.
              const pending = yield* SessionInbox.serialized(
                sessionID,
                Effect.gen(function* () {
                  const next = yield* SessionInbox.nextPromotable(
                    db,
                    sessionID,
                    entering || !continuing ? "input" : "steer",
                  )
                  if (next?.type === "compaction")
                    yield* bus.publishAll([
                      [SessionEvent.InboxDelivered, { sessionID, inboxID: next.id }],
                      [SessionEvent.Compaction.Started, { sessionID, reason: "manual", inputID: next.id }],
                    ])
                  if (next?.type === "move")
                    yield* restore(
                      Effect.gen(function* () {
                        yield* modelTransport.close(sessionID)
                        yield* bus.publishAll([
                          [SessionEvent.InboxDelivered, { sessionID, inboxID: next.id }],
                          [SessionEvent.Moved, { sessionID, ...next.payload }],
                        ])
                      }),
                    )
                  return next
                }),
              )
              if (!continuing && pending?.delivery !== "steer") {
                entering = true
                step = 1
              }
              if (pending?.type === "move")
                return DrainResult.Moved({ continuation: continuing ? { step } : undefined })
              if (pending?.type === "compaction") {
                const compacted = yield* restore(
                  Effect.gen(function* () {
                    yield* plugins.awaitActivation
                    const selected = yield* context.select(sessionID)
                    const model = yield* context.resolveModel(selected.session)
                    // Preview updates without admitting them after the already-delivered compaction marker.
                    const history = yield* SessionHistory.preview(db, sessionID, selected.instructions, model.ref)
                    return yield* compaction.compact({
                      reason: "manual",
                      inputID: pending.id,
                      context: {
                        session: selected.session,
                        agent: selected.agent,
                        tools: selected.tools,
                        model,
                        initial: history.initial,
                        messages: history.messages,
                      },
                    })
                  }).pipe(
                    Effect.catch((error) =>
                      bus.publish(SessionEvent.Compaction.Failed, {
                        sessionID,
                        reason: "manual",
                        inputID: pending.id,
                        error: toSessionError(error),
                      }),
                    ),
                  ),
                ).pipe(Effect.exit)
                if (Exit.isFailure(compacted)) {
                  yield* bus.publish(SessionEvent.Compaction.Failed, {
                    sessionID,
                    reason: "manual",
                    error: Cause.hasInterruptsOnly(compacted.cause)
                      ? { type: "aborted", message: "Compaction cancelled" }
                      : { type: "compaction.failed", message: Cause.pretty(compacted.cause) },
                    inputID: pending.id,
                  })
                  return yield* Effect.failCause(compacted.cause)
                }
                force = false
                continue
              }
              if (!force && !continuing && (!pending || (pending.delivery === "queue" && promotable === "steer")))
                return DrainResult.Complete()
              const ready = yield* restore(
                Effect.gen(function* () {
                  const selected = yield* prepareContext(sessionID)
                  const promoted = yield* SessionInbox.promote(
                    db,
                    bus,
                    sessionID,
                    entering && !continuing ? promotable : "steer",
                  )
                  // A control admitted during context preparation owns this boundary.
                  if (promoted === undefined) return undefined
                  if (promoted > 0 && !selected.session.parentID && SessionTitle.isUntitled(selected.session))
                    yield* FiberMap.run(titles, sessionID, title.generate(sessionID), {
                      onlyIfMissing: true,
                    })
                  if (promoted > 0) {
                    step = 1
                    // SiCode: a new user prompt resets the planning-start gate for this drain.
                    todoStartPace.at = 0
                  }
                  return { _tag: "Ready" as const, context: yield* context.load(selected) }
                }),
              )
              if (ready) return ready
            }
          }),
        ),
      )

      while (true) {
        const next = yield* advanceToStep()
        if (next._tag !== "Ready") return next
        continuing = yield* runStep(
          next.context,
          step,
          loopNudged,
          probeNudged,
          editSpiralNudged,
          subagentWaitNudged,
          probeScriptNudged,
          completionState,
          continueIntentNudged,
          mixedProseNudged,
          browserDriveNudged,
          answerNudged,
          replyStyleNudged,
          replyLanguageNudged,
          checkpointNudged,
          failureNudged,
          searchMissPace,
          exploreSoftPace,
          todoStartPace,
          todoStalePace,
          todoCloseoutPace,
        )
        step++
        force = false
        entering = false
      }
    })

    const prepareContext = Effect.fn("SessionRunner.prepareContext")(function* (sessionID: SessionSchema.ID) {
      // Plugins can reload mid-turn; each step and retry must read the settled agents, models and skills.
      yield* plugins.awaitActivation
      const selected = yield* context.select(sessionID)
      // A blocked initial instruction baseline must leave admitted input pending.
      yield* InstructionState.prepare(db, bus, selected.instructions, sessionID)
      return selected
    })

    /** Owns logical Step policy; each attempt owns its streaming, tools, and durable settlement. */
    const runStep = Effect.fn("SessionRunner.runStep")(function* (
      first: SessionContext.Loaded,
      step: number,
      loopNudged: Set<string>,
      probeNudged: Set<string>,
      editSpiralNudged: Set<string>,
      subagentWaitNudged: Set<string>,
      probeScriptNudged: Set<string>,
      completionState: CompletionContinueState,
      continueIntentNudged: Set<string>,
      mixedProseNudged: Set<string>,
      browserDriveNudged: Set<string>,
      answerNudged: Set<string>,
      replyStyleNudged: Set<string>,
      replyLanguageNudged: Set<string>,
      checkpointNudged: Set<string>,
      failureNudged: { at: number },
      searchMissPace: { at: number; soft: boolean },
      exploreSoftPace: { at: number },
      todoStartPace: { at: number },
      todoStalePace: { at: number },
      todoCloseoutPace: { count: number },
    ) {
      const sessionID = first.session.id
      let assistantMessageID = SessionMessage.ID.create()
      const retry = yield* SessionRunnerRetry.make(bus, sessionID)
      let initial: SessionContext.Loaded | undefined = first
      let recoverOverflow = true
      let recoverContinuation = true
      while (true) {
        // Reuse boundary preparation once; retries refresh context without delivering more input.
        const loaded = initial ?? (yield* prepareContext(sessionID).pipe(Effect.flatMap(context.load)))
        initial = undefined
        // SiCode: structural topic switch — force a soft compact before the model runs, so old tool
        // traces are summarized away instead of only being warned about in a hint. Skips when the
        // prefix is small (`shouldCompact`) or auto-compact is off.
        if (
          SessionTopicSwitch.shouldCompact({
            messages: loaded.messages,
            estimate: SessionCompaction.estimateContext(loaded),
          })
        ) {
          const switched = yield* compaction.compact({ reason: "topic-switch", context: loaded })
          if (switched.status === "failed") return yield* new StepFailedError({ error: switched.error })
          if (switched.status === "completed") {
            assistantMessageID = SessionMessage.ID.create()
            continue
          }
        }
        const compacted = yield* compaction.compact({ reason: "auto", context: loaded })
        if (compacted.status === "failed") return yield* new StepFailedError({ error: compacted.error })
        if (compacted.status === "completed") {
          assistantMessageID = SessionMessage.ID.create()
          continue
        }
        yield* compaction.precompute(Effect.succeed(loaded))
        // SiCode: upstream left `steps` undefined by default, which made this the only hard stop
        // that never fired. Fall back to a default ceiling so a runaway turn always ends, the way
        // Cursor caps its agent, instead of letting the model edit-verify-edit for 77+ steps. A turn
        // the model planned out with a multi-item todo list gets more headroom, so a real multi-file
        // change is not cut off mid-job — only an unplanned spiral hits the tight ceiling.
        const stepCeiling = effectiveStepLimit(loaded.messages, loaded.agent.info.steps)
        const atStepCeiling = step >= stepCeiling
        // SiCode: ceiling + open todos → short closeout (finish/cancel), not a "remaining work" essay
        // that idles while the list is still open (ses_e4e536).
        const openAtCeiling = atStepCeiling && detectCompletableTodos(loaded.messages).length > 0
        const stepLimitTodoCloseout = openAtCeiling && todoCloseoutPace.count < TODO_CLOSEOUT_STEPS
        if (stepLimitTodoCloseout) todoCloseoutPace.count++
        const stepLimitReached = atStepCeiling && !stepLimitTodoCloseout
        // Say something before the silence gets long: a turn that only speaks at the end leaves an
        // interrupted conversation with no assistant text at all.
        const silent = silentSteps(loaded.messages)
        // SiCode: narrate is soft pacing — default off (OPENCODE_NARRATE=1).
        const narrate =
          softSlimOn("OPENCODE_NARRATE") &&
          !stepLimitReached &&
          silent > 0 &&
          silent % NARRATE_EVERY_STEPS === 0
        // SiCode: 连续只读太多步就要求汇报，而不是一直读到用户放弃。硬阈值和步数上限一样收掉回合。
        const exploring = readOnlySteps(loaded.messages)
        // SiCode: read-only *and* mostly searching — a locate task that is lost, rather than a long
        // document being read. Only this shape is forced into an explore handoff.
        const locating = locatingSteps(loaded.messages)
        const softEvery = exploreSoftEvery(loaded.messages)
        // SiCode: explore-budget is a *main-session* stop-loss. Inside an explore child it strips
        // grep/glob (force) or demands another subagent (handoff) that explore denies — leave the
        // child on its own step cap instead.
        const exploreChild = loaded.session.parentID !== undefined && String(loaded.agent.id) === "explore"
        // SiCode: searchCap/searchMiss withdrew tools (`toolChoice: none`) while completion-gate
        // kept forcing another step for open todos. Escalate asked for `todowrite` but steer.none
        // won, so the model idled in prose forever. While the gate is holding the turn (count > 0),
        // suppress tool-withdrawing search stops.
        const openTodos = detectCompletableTodos(loaded.messages)
        const completionHolding =
          !exploreChild && isCompletionHolding(openTodos.length, completionState.count)
        const exploreHard = !exploreChild && !stepLimitReached && exploring >= EXPLORE_HARD_STEPS
        // SiCode: hard + still spinning (search *or* scratch measurement) → stop. locatingSteps alone
        // missed ses_e5ea441c at hard (trailing streak was write+bun scratch → locating 0). Long
        // document reads keep spinningSteps at 0 and stay a hint.
        const exploreHardLocate =
          !completionHolding && exploreHard && spinningSteps(loaded.messages) > 0
        // SiCode: intent-gated Build plan — design on a pristine turn writes `.sicode/plans/` first.
        const planUpfront =
          !exploreChild && !stepLimitReached && shouldUpfrontPlan(loaded.messages)
        // SiCode: design turn already wrote the plan — stop and wait for approval (soft gate).
        const planAwait =
          !exploreChild && !stepLimitReached && !planUpfront && shouldAwaitPlanApproval(loaded.messages)
        // SiCode: intent-gated Explore — broad locate on a pristine turn only (not after empty greps).
        const exploreUpfront =
          !exploreChild &&
          !stepLimitReached &&
          !planUpfront &&
          !planAwait &&
          shouldUpfrontExplore(loaded.messages)
        // SiCode: main-chain search budget — stop; never divert into a second Explore hunt.
        const searchCapStop =
          !exploreChild &&
          !stepLimitReached &&
          !completionHolding &&
          shouldStopSearchCap(loaded.messages)
        // SiCode: explore soft + force default ON (kill OPENCODE_EXPLORE_SOFT=0). Prompt-only now.
        const exploreSoft =
          softSlimOn("OPENCODE_EXPLORE_SOFT") &&
          !exploreChild &&
          !stepLimitReached &&
          !exploreHard &&
          !planUpfront &&
          !planAwait &&
          !exploreUpfront &&
          !searchCapStop &&
          exploring > 0 &&
          exploring % softEvery === 0
        const exploreHandoff =
          !exploreChild &&
          !stepLimitReached &&
          !exploreHard &&
          !planUpfront &&
          !planAwait &&
          !exploreUpfront &&
          !searchCapStop &&
          locating >= EXPLORE_HANDOFF_STEPS
        // SiCode: soft already went out and the model read again. Prompt-only now (no tool-list
        // narrow) so the system/tool prefix stays cache-stable across steps.
        const exploreForce =
          softSlimOn("OPENCODE_EXPLORE_SOFT") &&
          !exploreChild &&
          !stepLimitReached &&
          !exploreHard &&
          !exploreHandoff &&
          !planUpfront &&
          !planAwait &&
          !exploreUpfront &&
          !searchCapStop &&
          exploreSoftPace.at > 0 &&
          exploring >= exploreSoftPace.at + EXPLORE_FORCE_GRACE
        if (exploreSoft) exploreSoftPace.at = exploring
        // SiCode: repeating one tool call with the same arguments and the same result. A loop is the
        // most specific of these signals, so it is raised before the softer pacing ones; a loop that
        // survived an earlier nudge ends the turn instead of being described again.
        const loop = stepLimitReached ? null : detectLoop(loaded.messages)
        const loopStop = loop !== null && loopNudged.has(loop.fingerprint)
        const loopNudge = loop !== null && !loopStop
        if (loopNudge) loopNudged.add(loop.fingerprint)
        // SiCode: edit→read→edit on one path. Loop needs identical calls; this catches the
        // self-correction spiral. Soft once, then stop on the same fingerprint.
        const editSpiral =
          loop === null && !stepLimitReached ? detectEditSpiral(loaded.messages) : null
        const editSpiralStop = editSpiral !== null && editSpiralNudged.has(editSpiral.fingerprint)
        const editSpiralNudge = editSpiral !== null && !editSpiralStop
        if (editSpiralNudge) editSpiralNudged.add(editSpiral.fingerprint)
        // SiCode: one file probed over and over with a new pattern or command each time. The loop
        // detector needs identical calls, so this shape slips past it; nudged once per file and
        // never fatal, because a re-read can still be legitimate.
        const probe =
          loop === null && editSpiral === null && !stepLimitReached
            ? detectRepeatedProbe(loaded.messages)
            : null
        const probeNudge = probe !== null && !probeNudged.has(probe.fingerprint) ? probe : null
        if (probeNudge) probeNudged.add(probeNudge.fingerprint)
        // SiCode: the framework counts tool failures the model would rather rebrand as variants.
        // Window density is the trigger; the monotonic whole-turn count only paces the re-nudges.
        const failures = stepLimitReached ? null : detectFailureStreak(loaded.messages)
        const failureNudge =
          failures !== null &&
          failures.recent >= FAILURE_STREAK_FIRST &&
          failures.total - failureNudged.at >= FAILURE_STREAK_EVERY
        if (failureNudge) failureNudged.at = failures.total
        const searchMisses = stepLimitReached || failureNudge ? null : detectSearchMissStreak(loaded.messages)
        // SiCode: CJK empty greps soft on the first miss (`early`); English still needs a streak of 2.
        // Soft once; a due streak after that soft is a hard stop (no ask/猜 theater).
        const searchMissDue =
          searchMisses !== null && shouldNudgeSearchMiss(searchMisses, searchMissPace.at)
        const searchMissStop =
          !exploreChild &&
          !stepLimitReached &&
          !completionHolding &&
          !searchCapStop &&
          searchMisses !== null &&
          shouldStopSearchMiss(searchMisses, searchMissPace.at, searchMissPace.soft)
        const searchMissNudge = searchMissDue && !searchMissStop && !completionHolding
        if (searchMissNudge) {
          searchMissPace.at = searchMisses!.total
          searchMissPace.soft = true
        }
        if (searchMissStop) searchMissPace.at = searchMisses!.total
        // SiCode: parent waiting on background A–D (ses_e508). Soft once, then stop.
        const subagentWait =
          !exploreChild && !stepLimitReached && !searchMissStop && !searchCapStop
            ? detectSubagentWait(loaded.messages)
            : null
        const subagentWaitStop =
          subagentWait !== null && subagentWaitNudged.has(subagentWait.fingerprint)
        const subagentWaitNudge = subagentWait !== null && !subagentWaitStop
        if (subagentWaitNudge) subagentWaitNudged.add(subagentWait.fingerprint)
        // SiCode: write→shell one-off probes instead of grep/read. Soft once per fingerprint.
        const probeScript =
          !exploreChild &&
          !stepLimitReached &&
          !searchMissStop &&
          !subagentWaitStop &&
          loop === null &&
          editSpiral === null
            ? detectProbeScript(loaded.messages)
            : null
        const probeScriptNudge =
          probeScript !== null && !probeScriptNudged.has(probeScript.fingerprint)
        if (probeScriptNudge) probeScriptNudged.add(probeScript.fingerprint)
        // SiCode: prose `?` + non-question tools in the same assistant message — stop once per fingerprint.
        const mixedProseKey =
          !exploreChild &&
          !stepLimitReached &&
          !completionHolding &&
          !searchCapStop &&
          !searchMissStop &&
          !subagentWaitStop
            ? mixedProseQuestionFingerprint(loaded.messages)
            : undefined
        const mixedProseQuestion =
          mixedProseKey !== undefined && !mixedProseNudged.has(mixedProseKey)
        if (mixedProseQuestion && mixedProseKey) mixedProseNudged.add(mixedProseKey)
        // SiCode: batch nudge — default on (OPENCODE_BATCH_NUDGE=0 kills). Prompt-only; no tool-list
        // rewrite, so it no longer busts the DeepSeek prefix cache.
        const batchNudge =
          softSlimOn("OPENCODE_BATCH_NUDGE") &&
          !stepLimitReached &&
          !exploreHard &&
          !exploreHandoff &&
          !planUpfront &&
          !planAwait &&
          !exploreUpfront &&
          !searchCapStop &&
          !searchMissStop &&
          !subagentWaitStop &&
          !mixedProseQuestion &&
          !exploreForce &&
          !searchMissNudge &&
          !subagentWaitNudge &&
          !probeScriptNudge &&
          shouldNudgeBatch(loaded.messages)
        // SiCode: todo soft remind — default on (OPENCODE_TODO_SOFT=0 kills). Finish refuse stays in
        // completion-gate. Design turns still suppress todo until `.sicode/plans/` lands.
        const todoAvailable = loaded.tools.definitions.some((tool) => tool.name === "todowrite")
        const planned = hasTodowriteSinceUser(loaded.messages)
        const designBlocksTodo =
          !exploreChild && shouldSuppressTodoForDesign(loaded.messages)
        const continuePlan = continuePlanStartThresholds(loaded.messages)
        const todoSoftAt = continuePlan?.softAt ?? TODO_START_STEPS
        const todoStartSoft =
          softSlimOn("OPENCODE_TODO_SOFT") &&
          todoAvailable &&
          !planned &&
          !designBlocksTodo &&
          !planUpfront &&
          !planAwait &&
          !searchMissStop &&
          !subagentWaitStop &&
          !mixedProseQuestion &&
          !stepLimitReached &&
          step >= todoSoftAt &&
          todoStartPace.at === 0
        if (todoStartSoft) todoStartPace.at = step
        // SiCode: the list the user sees is the last `todowrite` input, and nothing updates it on the
        // model's behalf. Once several finished calls have landed since that write, the pill is
        // describing old work. Say so on a request that was going to happen anyway — no extra round.
        // Paced by progress: a model that ignores the reminder is only re-asked after another
        // `TODO_STALE_STEPS` of work, so the batching and narration steers are not crowded out.
        const stale = todoAvailable && planned ? staleTodoSteps(loaded.messages) : 0
        if (stale === 0) todoStalePace.at = 0
        const todoStale = stale >= TODO_STALE_STEPS && stale - todoStalePace.at >= TODO_STALE_STEPS
        if (todoStale) todoStalePace.at = stale
        // One steering message replaces the tail, most specific first.
        const steer = selectSteer({
          stepLimitReached,
          stepLimitTodoCloseout,
          loopStopped: loopStop,
          editSpiralStopped: editSpiralStop,
          exploreHard,
          exploreHardLocate,
          exploreHandoff,
          exploreUpfront,
          planUpfront,
          planAwait,
          searchCapStop,
          searchMissStop,
          subagentWaitStop,
          mixedProseQuestion,
          exploreForce,
          batchNudge,
          loopNudged: loopNudge,
          editSpiralNudged: editSpiralNudge,
          probeNudged: probeNudge?.path,
          failureNudged: failureNudge,
          searchMissNudged: searchMissNudge,
          subagentWaitNudged: subagentWaitNudge,
          probeScriptNudged: probeScriptNudge,
          narrate,
          exploreSoft,
          todoStartSoft,
          todoStartSoftContinue: !!continuePlan && todoStartSoft,
          todoStale,
          focusTools: planUpfront ? PLAN_FOCUS_TOOLS : EXPLORE_FOCUS_TOOLS,
          batchTools: BATCH_FOCUS_TOOLS,
        })
        // SiCode: always advertise the full tool snapshot. Narrowing definitions used to rewrite
        // both system tool names and provider schemas on every exploreForce/batchNudge step, which
        // busted DeepSeek's prefix cache (audit: ~70% single-tool steps → frequent rebuilds).
        // Hard constraints bind via toolChoice (handoff/upfront/stop); soft steers are prompt-only.
        const tools = loaded.tools
        const base = SessionModelRequest.baseTranscript({
          agent: loaded.agent.info,
          model: loaded.model,
          tools,
          initial: loaded.initial,
          messages: loaded.messages,
        })
        // SiCode: Cursor measures prefix rebuilds (`agent.prompt_prefix.rebuilt`) because a rebuilt prefix is a
        // cache miss and a cache miss is latency plus cost. Recording it per step turns "the agent got slower" into
        // a number that can be traced back to whatever changed the request's stable head.
        yield* PromptPrefix.observe({
          sessionID,
          model: loaded.model.ref,
          tools: tools.definitions,
          system: base.system,
        })
        const prepared = yield* context.request.primary({
          session: loaded.session,
          agent: loaded.agent.id,
          model: loaded.model,
          tools,
          system: base.system,
          messages: steer
            ? [
                ...base.messages,
                steer.role === "assistant" ? Message.assistant(steer.prompt) : Message.system(steer.prompt),
              ]
            : base.messages,
          // Keep tool definitions on the final Step to preserve the provider's cached prefix.
          // SiCode: completion escalate's `todowrite` outranks searchCap/searchMiss `none`.
          toolChoice: resolveStepToolChoice({
            completionToolChoice: completionState.toolChoice,
            steerToolChoice: steer?.toolChoice,
            steerStop: steer?.stop,
          }),
          webSocket: "session",
          inputTokens: SessionCompaction.estimatePrompt(loaded),
        })
        const outcome = yield* steps.attempt({
          isLocationClosed: lifecycle.isClosed,
          sessionID,
          assistantMessageID,
          agent: loaded.agent.id,
          model: loaded.model,
          prepared: {
            ...prepared,
            // A tool call can arrive during a reload; its permission check reads the session's agent.
            executeTool: (call) => plugins.awaitActivation.pipe(Effect.andThen(prepared.executeTool(call))),
          },
          retry: (cause, error, proposed) =>
            retry.decide({
              cause,
              error,
              agent: loaded.agent.id,
              model: loaded.model.ref,
              hook: prepared.retry,
              retry: proposed,
            }),
          recoverContinuation,
          recoverOverflow: Effect.suspend(() =>
            recoverOverflow
              ? compaction
                  .compact({ reason: "overflow", context: loaded })
                  .pipe(Effect.map((result) => result.status === "completed"))
              : Effect.succeed(false),
          ),
        })
        const completed = yield* SessionStep.Outcome.$match(outcome, {
          Completed: Effect.fnUntraced(function* (outcome) {
            // SiCode: a completion after a retry is the success half of the retry telemetry pair.
            yield* retry.succeed()
            // SiCode: long-turn checkpoint. Opt-in (OPENCODE_CHECKPOINT=1); default off — another
            // soft inject that competed for Flash attention. Below step-limit; above final-answer.
            if (outcome.needsContinuation && !stepLimitReached) {
              const messages = yield* store.context(sessionID)
              const checkpoint = checkpointFingerprint(messages)
              if (checkpoint && !checkpointNudged.has(checkpoint)) {
                checkpointNudged.add(checkpoint)
                yield* bus.publish(SessionEvent.Synthetic, { sessionID, text: CHECKPOINT_PROMPT })
              }
              return true
            }
            // The Session is about to go idle, which leaves the background summary time to finish.
            if (!outcome.needsContinuation) {
              // Both gates below judge what the user will actually see, so they read the stored
              // transcript instead of the snapshot this step was planned from.
              const messages = yield* store.context(sessionID)
              // SiCode: completion gate. The turn is about to end because the model stopped calling
              // tools. While *this user turn's* todo list still has open items, refuse idle and force
              // another step. Prior-turn leftovers do not yank after a new ask (ses_e4e536). Soft
              // continues then escalate to toolChoice todowrite. Skip when step ceiling /
              // waitingOnUser / background shell already ended the turn.
              // SiCode: only a running `question` tool blocks auto-continue. Prose `?` does not wait.
              const waitingOnUser = turnAwaitingUser(messages)
              // SiCode: background shell still running — idle until its finish notification; do not
              // completion-force a read loop on open todos.
              const waitingOnShell = waitingOnBackgroundShell(messages)
              const pending =
                waitingOnUser || waitingOnShell || stepLimitReached ? [] : detectCompletableTodos(messages)
              // SiCode: open todos this turn still refuse idle (completion-gate). No idle-ask gate.
              const completion = completionContinue({ pending, state: completionState })
              completionState.fingerprint = completion.state.fingerprint
              completionState.count = completion.state.count
              completionState.toolChoice = completion.state.toolChoice
              if (completion.force && completion.prompt) {
                yield* bus.publish(SessionEvent.Synthetic, {
                  sessionID,
                  text: completion.prompt,
                })
                return true
              }
              // List cleared (or escape cleared pending) — drop any escalate toolChoice.
              completionState.toolChoice = undefined
              // SiCode: continue-intent gate. Announced the next move with zero tools — force one
              // more step so Flash cannot idle mid-investigation. Once per fingerprint,
              // and never when the step limit already decided the turn is over.
              const continueIntent =
                stepLimitReached || waitingOnUser ? undefined : continueIntentFingerprint(messages)
              if (continueIntent && !continueIntentNudged.has(continueIntent)) {
                continueIntentNudged.add(continueIntent)
                yield* bus.publish(SessionEvent.Synthetic, { sessionID, text: CONTINUE_INTENT_PROMPT })
                return true
              }
              // SiCode: browser-drive hard gate. User ordered publish/fill and click tools are in
              // the snapshot, but the turn used zero browser.* calls. Force one more step once per
              // user prompt.
              if (!stepLimitReached && process.env.OPENCODE_BROWSER_DRIVE !== "0") {
                const toolNames = loaded.tools.definitions.map((tool) => tool.name)
                const browserDrive = browserDriveIdleFingerprint(
                  messages,
                  toolNames,
                  loaded.session.metadata as Record<string, unknown> | undefined,
                )
                if (browserDrive && !browserDriveNudged.has(browserDrive)) {
                  browserDriveNudged.add(browserDrive)
                  yield* bus.publish(SessionEvent.Synthetic, { sessionID, text: BROWSER_DRIVE_GATE_PROMPT })
                  return true
                }
              }
              // SiCode: final answer gate. A turn that stops after nothing but tool calls leaves the
              // user an activity log and no answer. One nudge per prompt, and never when the step
              // limit already decided the turn is over.
              const unanswered = stepLimitReached ? undefined : unansweredPrompt(messages)
              if (unanswered && !answerNudged.has(unanswered)) {
                answerNudged.add(unanswered)
                yield* bus.publish(SessionEvent.Synthetic, { sessionID, text: FINAL_ANSWER_PROMPT })
                return true
              }
              // SiCode: idle reply is an engineering handover dump (ledger / path inventory /
              // heading tree) — force one 白话 rewrite. Soft system.txt alone never stuck.
              // Once per fingerprint; kill OPENCODE_REPLY_STYLE=0.
              if (!stepLimitReached && !waitingOnUser) {
                const replyStyle = replyStyleFingerprint(messages)
                if (replyStyle && !replyStyleNudged.has(replyStyle)) {
                  replyStyleNudged.add(replyStyle)
                  yield* bus.publish(SessionEvent.Synthetic, { sessionID, text: REPLY_STYLE_PROMPT })
                  return true
                }
              }
              // SiCode: Chinese session got an English idle reply — force 简体中文 rewrite.
              // Soft "same language" only lived on kimi; kill OPENCODE_REPLY_LANGUAGE=0.
              if (!stepLimitReached && !waitingOnUser) {
                const replyLanguage = replyLanguageFingerprint(messages)
                if (replyLanguage && !replyLanguageNudged.has(replyLanguage)) {
                  replyLanguageNudged.add(replyLanguage)
                  yield* bus.publish(SessionEvent.Synthetic, { sessionID, text: REPLY_LANGUAGE_PROMPT })
                  return true
                }
              }
              yield* compaction.precompute(Effect.succeed({ ...loaded, messages }))
            }
            return outcome.needsContinuation
          }),
          Retry: (outcome) =>
            retry.wait({
              decision: outcome.decision,
              error: outcome.error,
              assistantMessageID,
            }),
          Continue: Effect.fnUntraced(function* (outcome) {
            yield* retry.wait({
              decision: outcome.decision,
              error: outcome.error,
              assistantMessageID,
            })
            yield* bus.publish(SessionEvent.Synthetic, { sessionID, text: CONTINUE_AFTER_INCOMPLETE_STREAM })
            assistantMessageID = SessionMessage.ID.create()
          }),
          OutputLimit: Effect.fn("SessionRunner.continueOutputLimit")(function* (outcome) {
            // The current response is included. User input or any other finish breaks the streak.
            const recent = yield* db
              .select({
                type: SessionMessageTable.type,
                finish: sql<string | null>`json_extract(${SessionMessageTable.data}, '$.finish')`,
              })
              .from(SessionMessageTable)
              .where(
                and(
                  eq(SessionMessageTable.session_id, sessionID),
                  inArray(SessionMessageTable.type, ["user", "assistant"]),
                ),
              )
              .orderBy(desc(SessionMessageTable.seq))
              .limit(3)
              .all()
              .pipe(Effect.orDie)
            const exhausted =
              recent.length === 3 && recent.every((row) => row.type === "assistant" && row.finish === "length")
            if (exhausted)
              return yield* new StepFailedError({
                error: {
                  type: "output-limit",
                  message: "Response still truncated after two output token limit continuations",
                },
              })
            if (outcome.needsContinuation) return true
            yield* bus.publish(SessionEvent.Synthetic, { sessionID, text: CONTINUE_AFTER_OUTPUT_LIMIT })
            assistantMessageID = SessionMessage.ID.create()
          }),
          Compacted: Effect.fnUntraced(function* () {
            recoverOverflow = false
            assistantMessageID = SessionMessage.ID.create()
          }),
          RecoverFull: Effect.fnUntraced(function* () {
            recoverContinuation = false
          }),
        })
        if (completed !== undefined) return completed
      }
    })

    const settleStaleCompactions = Effect.fn("SessionRunner.settleStaleCompactions")(function* (
      sessionID: SessionSchema.ID,
    ) {
      // A process death skips compaction finalizers. Include orphans behind a
      // completed checkpoint, and settle newest first to match event projection.
      const rows = yield* db
        .select()
        .from(SessionMessageTable)
        .where(
          and(
            eq(SessionMessageTable.session_id, sessionID),
            eq(SessionMessageTable.type, "compaction"),
            sql`json_extract(${SessionMessageTable.data}, '$.status') = 'running'`,
          ),
        )
        .orderBy(desc(SessionMessageTable.seq))
        .all()
        .pipe(Effect.orDie)
      for (const row of rows) {
        const message = yield* SessionHistory.decodeMessageRow(row)
        if (message.type !== "compaction") continue
        yield* bus.publish(SessionEvent.Compaction.Failed, {
          sessionID,
          reason: message.reason,
          inputID: message.id,
          error: { type: "compaction.interrupted", message: "Compaction was interrupted" },
        })
      }
    })

    const settleStaleToolCalls = Effect.fn("SessionRunner.settleStaleToolCalls")(function* (
      sessionID: SessionSchema.ID,
    ) {
      for (const message of yield* store.context(sessionID)) {
        if (message.type !== "assistant") continue
        for (const tool of message.content) {
          if (tool.type !== "tool" || (tool.state.status !== "streaming" && tool.state.status !== "running")) continue
          const metadata = tool.state.status === "running" ? tool.state.metadata : undefined
          const childID =
            tool.name === "subagent" && typeof metadata?.sessionID === "string" ? metadata.sessionID : undefined
          yield* bus.publish(SessionEvent.Tool.Failed, {
            sessionID,
            assistantMessageID: message.id,
            id: tool.id,
            error: {
              type: "aborted",
              message: `Tool execution interrupted: ${tool.name}${childID ? ` (sessionID: ${childID})` : ""}`,
            },
            ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
            executed: tool.executed === true,
          })
        }
      }
    })

    return Service.of({ drain })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    Bus.node,
    LocationLifecycle.node,
    llmClient,
    SessionContext.node,
    SessionModelTransport.node,
    SessionStore.node,
    SessionCompaction.node,
    Plugin.node,
    SessionTitle.node,
    Snapshot.node,
    ToolOutput.node,
    Database.node,
  ],
})
