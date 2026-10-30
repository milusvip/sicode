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
import { EXPLORE_HARD_STEPS, EXPLORE_SOFT_STEPS, readOnlySteps } from "./explore-budget.js"
import { detectLoop, detectRepeatedProbe } from "./loop-detection.js"
import {
  detectFailureStreak,
  FAILURE_STREAK_EVERY,
  FAILURE_STREAK_FIRST,
} from "./failure-streak.js"
import { selectSteer } from "./steer.js"
import { effectiveStepLimit } from "./max-steps.js"
import { completionFingerprint, completionGatePrompt, detectPendingTodos } from "./completion-gate.js"
import { FINAL_ANSWER_PROMPT, unansweredPrompt } from "./final-answer-gate.js"

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
      // SiCode: todo fingerprints already gated this turn. The completion gate fires once per open
      // todo set, so a model that insists the todos are stale is not reminded a second time.
      const completionNudged = new Set<string>()
      // SiCode: prompts already asked to say something. A turn that ends silently is nudged once per
      // prompt; asking again after that would only add an empty round trip.
      const answerNudged = new Set<string>()
      // SiCode: whole-turn failed tool calls at the time the research nudge last fired. The trigger
      // is the trailing-window density (objective, variant-proof), this paces the re-nudges.
      const failureNudged = { at: 0 }
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
                  if (promoted > 0) step = 1
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
          completionNudged,
          answerNudged,
          failureNudged,
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
      completionNudged: Set<string>,
      answerNudged: Set<string>,
      failureNudged: { at: number },
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
        const stepLimitReached = step >= effectiveStepLimit(loaded.messages, loaded.agent.info.steps)
        // Say something before the silence gets long: a turn that only speaks at the end leaves an
        // interrupted conversation with no assistant text at all.
        const silent = silentSteps(loaded.messages)
        const narrate = !stepLimitReached && silent > 0 && silent % NARRATE_EVERY_STEPS === 0
        // SiCode: 连续只读太多步就要求汇报，而不是一直读到用户放弃。硬阈值和步数上限一样收掉回合。
        const exploring = readOnlySteps(loaded.messages)
        const exploreHard = !stepLimitReached && exploring >= EXPLORE_HARD_STEPS
        const exploreSoft = !stepLimitReached && !exploreHard && exploring > 0 && exploring % EXPLORE_SOFT_STEPS === 0
        // SiCode: repeating one tool call with the same arguments and the same result. A loop is the
        // most specific of these signals, so it is raised before the softer pacing ones; a loop that
        // survived an earlier nudge ends the turn instead of being described again.
        const loop = stepLimitReached ? null : detectLoop(loaded.messages)
        const loopStop = loop !== null && loopNudged.has(loop.fingerprint)
        const loopNudge = loop !== null && !loopStop
        if (loopNudge) loopNudged.add(loop.fingerprint)
        // SiCode: one file probed over and over with a new pattern or command each time. The loop
        // detector needs identical calls, so this shape slips past it; nudged once per file and
        // never fatal, because a re-read can still be legitimate.
        const probe = loop === null && !stepLimitReached ? detectRepeatedProbe(loaded.messages) : null
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
        // One steering message replaces the tail, most specific first.
        const steer = selectSteer({
          stepLimitReached,
          loopStopped: loopStop,
          exploreHard,
          loopNudged: loopNudge,
          probeNudged: probeNudge?.path,
          failureNudged: failureNudge,
          narrate,
          exploreSoft,
        })
        const transcript = SessionModelRequest.baseTranscript({
          agent: loaded.agent.info,
          model: loaded.model,
          tools: loaded.tools,
          initial: loaded.initial,
          messages: loaded.messages,
        })
        // SiCode: Cursor measures prefix rebuilds (`agent.prompt_prefix.rebuilt`) because a rebuilt prefix is a
        // cache miss and a cache miss is latency plus cost. Recording it per step turns "the agent got slower" into
        // a number that can be traced back to whatever changed the request's stable head.
        yield* PromptPrefix.observe({
          sessionID,
          model: loaded.model.ref,
          tools: loaded.tools.definitions,
          system: transcript.system,
        })
        const prepared = yield* context.request.primary({
          session: loaded.session,
          agent: loaded.agent.id,
          model: loaded.model,
          tools: loaded.tools,
          system: transcript.system,
          messages: steer
            ? [
                ...transcript.messages,
                steer.role === "assistant" ? Message.assistant(steer.prompt) : Message.system(steer.prompt),
              ]
            : transcript.messages,
          // Keep tool definitions on the final Step to preserve the provider's cached prefix.
          toolChoice: steer?.stop ? "none" : undefined,
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
            // The Session is about to go idle, which leaves the background summary time to finish.
            if (!outcome.needsContinuation) {
              // Both gates below judge what the user will actually see, so they read the stored
              // transcript instead of the snapshot this step was planned from.
              const messages = yield* store.context(sessionID)
              // SiCode: completion gate. The turn is about to end because the model stopped calling
              // tools. If its latest todo list still has open items, remind it once and force one
              // more step instead of letting it declare victory mid-task. Fires once per fingerprint
              // so a model that considers the todos stale is not nagged twice.
              const pending = detectPendingTodos(messages)
              if (pending.length > 0) {
                const fingerprint = completionFingerprint(pending)
                if (!completionNudged.has(fingerprint)) {
                  completionNudged.add(fingerprint)
                  yield* bus.publish(SessionEvent.Synthetic, {
                    sessionID,
                    text: completionGatePrompt(pending),
                  })
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
