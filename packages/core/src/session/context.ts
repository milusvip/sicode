export * as SessionContext from "./context.js"

import { Model } from "../model.js"
import { Permission } from "../permission.js"
import { Context, Effect, Layer } from "effect"
import { Agent } from "../agent.js"
import { CodeModeInstructions } from "../codemode/instructions.js"
import { Database } from "../database/database.js"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { InstructionDiscovery } from "../instruction-discovery.js"
import { Instructions } from "../instructions/index.js"
import { InstructionBuiltIns } from "../instructions/builtins.js"
import { Location } from "../location.js"
import { McpInstructions } from "../mcp/instructions.js"
import { McpTool } from "../tool/mcp.js"
import { ReferenceInstructions } from "../reference/instructions.js"
import { SkillInstructions } from "../skill/instructions.js"
import { Tool } from "../tool.js"
import { SessionClarifyHint } from "./clarify-hint.js"
import { SessionUiBehaviorHint } from "./ui-behavior-hint.js"
import { SessionContextHints } from "./context-hints.js"
import { SessionConstraintLedger } from "./constraint-ledger.js"
import { SessionDecisionFreeze } from "./decision-freeze.js"
import { SessionDesignHint } from "./design-hint.js"
import { SessionBrowserDriveHint } from "./browser-drive-hint.js"
import { SessionObeyFixHint } from "./obey-fix-hint.js"
import { SessionPackageRules } from "./package-rules.js"
import { SessionScopedRules } from "./scoped-rules.js"
import { SessionTopicSwitch } from "./topic-switch.js"
import { SessionWorkingPin } from "./working-pin.js"
import { AgentNotFoundError } from "./error.js"
import { SessionHistory } from "./history.js"
import { InstructionEntry } from "./instruction-entry.js"
import { SessionMessage } from "./message.js"
import { SessionModelRequest } from "./model-request.js"
import { SessionRunnerModel } from "./runner/model.js"
import { Bus } from "../bus.js"
import { SessionEvent } from "./event.js"
import { SessionSchema } from "./schema.js"
import { SessionStore } from "./store.js"

export interface Selection {
  readonly session: SessionSchema.Info
  readonly agent: Agent.Selection & { readonly info: Agent.Info }
  readonly instructions: Instructions.List
  readonly tools: Tool.Snapshot
}

export interface Loaded {
  readonly session: SessionSchema.Info
  readonly agent: Agent.Selection & { readonly info: Agent.Info }
  readonly model: SessionRunnerModel.Resolved
  readonly initial: string
  readonly messages: ReadonlyArray<SessionMessage.Info>
  readonly tools: Tool.Snapshot
}

/**
 * Resolves model-request state in two phases: `select` fixes the Session,
 * agent, instruction sources, and tool snapshot; `load` adds the model and
 * active history for that selection. Auxiliary operations resolve only the
 * capabilities they need; request preparation stays separate from selection.
 */
export interface Interface {
  /** Selects the Session, agent, instructions, and tools used by subsequent work. */
  readonly select: (sessionID: SessionSchema.ID) => Effect.Effect<Selection, AgentNotFoundError>
  /** Resolves the model and active history for that selection. */
  readonly load: (selection: Selection) => Effect.Effect<Loaded, SessionRunnerModel.Error>
  readonly resolveModel: (
    session: SessionSchema.Info,
  ) => Effect.Effect<SessionRunnerModel.Resolved, SessionRunnerModel.Error>
  /** Selects auxiliary title capabilities without instruction or tool preflight. */
  readonly selectTitle: (session: SessionSchema.Info) => Effect.Effect<
    | {
        readonly agent: Agent.Info
        readonly primary: SessionRunnerModel.Resolved | undefined
        readonly selected: SessionRunnerModel.Resolved
      }
    | undefined
  >
  readonly request: SessionModelRequest.Interface
}

/** Location-scoped model-context loader for durable Session Steps. */
export class Service extends Context.Service<Service, Interface>()("@opencode/SessionContext") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const agents = yield* Agent.Service
    const builtins = yield* InstructionBuiltIns.Service
    const contextHints = yield* SessionContextHints.Service
    const model = yield* Model.Service
    const db = (yield* Database.Service).db
    const discovery = yield* InstructionDiscovery.Service
    const entries = yield* InstructionEntry.Service
    const location = yield* Location.Service
    const mcpInstructions = yield* McpInstructions.Service
    const mcpTools = yield* McpTool.Service
    const models = yield* SessionRunnerModel.Service
    const request = yield* SessionModelRequest.Service
    const referenceInstructions = yield* ReferenceInstructions.Service
    const skillInstructions = yield* SkillInstructions.Service
    const store = yield* SessionStore.Service
    const bus = yield* Bus.Service
    const registry = yield* Tool.Service

    const resolveModel = (session: SessionSchema.Info) => models.resolve(session, model.available)

    const selectTitle = Effect.fn("SessionContext.selectTitle")(function* (session: SessionSchema.Info) {
      const agent = yield* agents.get(Agent.ID.make("title"))
      if (!agent) return
      const primary = yield* resolveModel(session).pipe(Effect.orElseSucceed(() => undefined))
      const candidate = yield* Effect.gen(function* () {
        if (agent.model) {
          const info = yield* model.get(agent.model.providerID, agent.model.id)
          return info && { info, variant: agent.model.variant ?? minimalVariant(info) }
        }
        if (!primary) return
        const small = yield* model.small(primary.ref.providerID)
        if (small) return { info: small, variant: minimalVariant(small) }
        // Without a lower variant, the primary model at its selected variant is already the fallback.
        const info = yield* model.get(primary.ref.providerID, primary.ref.id)
        const variant = info && lowerVariant(info, primary.ref.variant)
        return variant && { info, variant }
      })
      const preferred =
        candidate &&
        (yield* resolveModel({
          ...session,
          model: Model.Ref.make({
            providerID: candidate.info.providerID,
            id: candidate.info.id,
            ...(candidate.variant ? { variant: candidate.variant } : {}),
          }),
        }).pipe(Effect.orElseSucceed(() => undefined)))
      const selected = preferred ?? primary
      if (!selected) return
      return { agent, primary, selected }
    })

    const select = Effect.fn("SessionContext.select")(function* (sessionID: SessionSchema.ID) {
      const session = yield* store.get(sessionID)
      if (!session) return yield* Effect.die(new Error(`Session not found: ${sessionID}`))
      if (session.location.directory !== location.directory || session.location.workspaceID !== location.workspaceID)
        return yield* Effect.interrupt

      yield* mcpTools.flush
      const agent = yield* agents.select(session.agent)
      if (!agent.info) return yield* new AgentNotFoundError({ sessionID: session.id, agent: session.agent ?? agent.id })
      // Session permissions narrow discovery the same way they narrow the tool snapshot.
      const permissions = Permission.merge(agent.info.permissions, session.permissions ?? [])
      const loaded = yield* Effect.all(
        {
          tools: registry.snapshot(permissions),
          builtins: builtins.load(),
          discovery: discovery.load(),
          skills: skillInstructions.load(permissions),
          references: referenceInstructions.load(),
          mcp: mcpInstructions.load(permissions),
          entries: entries.load(sessionID),
        },
        { concurrency: "unbounded" },
      )
      return {
        session,
        agent: { ...agent, info: agent.info },
        // Ordered from most to least shared across sessions so the baseline stays a reusable
        // prompt-cache prefix: user-level catalog and guidance, then project instructions, then
        // the date and environment, which vary by day and directory.
        instructions: Instructions.combine([
          CodeModeInstructions.make(loaded.tools.codeModeCatalog),
          loaded.mcp,
          loaded.references,
          loaded.skills,
          loaded.discovery,
          loaded.builtins,
          loaded.entries,
        ]),
        tools: loaded.tools,
      }
    })

    const load = Effect.fn("SessionContext.load")(function* (selection: Selection) {
      const model = yield* resolveModel(selection.session)
      const history = yield* SessionHistory.entriesForRunner(
        db,
        selection.session.id,
        selection.instructions,
        model.ref,
      )
      // SiCode: the likely files of a new request go in front of the model, so it stops guessing
      // which names to search for. This rides the request only — nothing is written to the session,
      // and the system prompt (the cacheable prefix) is untouched.
      const messages = yield* contextHints.inject({
        sessionID: selection.session.id,
        messages: history.entries.map((entry) => entry.message),
      })
      // SiCode: a UI turn gets the repository's design values condensed in, because the rule in
      // AGENTS.md ("read DESIGN.md before changing CSS") is not followed — 5 reads in 510, against
      // 245 edits under the UI packages. Request-only, and only on turns that touch UI.
      const designed = yield* Effect.tryPromise(() =>
        SessionDesignHint.inject({
          messages,
          directory: location.directory,
          // SiCode: opt-in (OPENCODE_DESIGN=1). Default off — harness-slim; values dump competes with the task.
          enabled: process.env.OPENCODE_DESIGN === "1",
        }),
      ).pipe(Effect.catch(() => Effect.succeed(messages)))
      // SiCode: path-scoped rules from `.sicode/rules` — a rule names its own globs, so it only
      // enters the turn already touching those files. Same request-only pattern as package-rules.
      const scoped = yield* Effect.tryPromise(() =>
        SessionScopedRules.inject({
          messages: designed,
          directory: location.directory,
          enabled: process.env.OPENCODE_SCOPED_RULES === "0" ? false : true,
        }),
      ).pipe(Effect.catch(() => Effect.succeed(designed)))
      // SiCode: nested package AGENTS.md only appear when the session directory sits inside that
      // package. Sessions start at the repo root, so inject them on demand when the turn already
      // names or touches those paths — same request-only pattern as design-hint.
      const ruled = yield* Effect.tryPromise(() =>
        SessionPackageRules.inject({
          messages: scoped,
          directory: location.directory,
          enabled: process.env.OPENCODE_PACKAGE_RULES === "0" ? false : true,
        }),
      ).pipe(Effect.catch(() => Effect.succeed(scoped)))
      // SiCode: sticky "don't edit" locks from explicit user decisions — survive compaction via
      // session metadata, hot-cached for edit/write/patch. `OPENCODE_DECISION_FREEZE=0` off.
      const historyMessages = history.entries.map((entry) => entry.message)
      const meta = selection.session.metadata as Record<string, unknown> | undefined
      // SiCode: warm freeze + allow-scope caches, then publish one merged metadata patch so the
      // two ledgers cannot clobber each other (long-context-use P2).
      const freezeNext = SessionDecisionFreeze.enabled()
        ? SessionDecisionFreeze.sync({
            sessionID: selection.session.id,
            messages: historyMessages,
            metadata: meta,
          })
        : SessionDecisionFreeze.pathsOf(meta)
      // SiCode: scrub stale allow-scope metadata from the removed constraint ledger.
      const staleScope = meta?.[SessionConstraintLedger.METADATA_KEY] !== undefined
      const freezeChanged =
        SessionDecisionFreeze.enabled() && freezeNext.join("\0") !== SessionDecisionFreeze.pathsOf(meta).join("\0")
      if (freezeChanged || staleScope) {
        let nextMeta = meta ?? {}
        if (SessionDecisionFreeze.enabled()) nextMeta = SessionDecisionFreeze.withPaths(nextMeta, freezeNext)
        if (staleScope) nextMeta = SessionConstraintLedger.withScope(nextMeta, [])
        // Publish directly — Session.Service would cycle SessionContext ↔ Session.
        yield* bus
          .publish(SessionEvent.MetadataUpdated, {
            sessionID: selection.session.id,
            metadata: nextMeta as SessionSchema.Metadata,
          })
          .pipe(Effect.catch(() => Effect.void))
      }
      return {
        session: selection.session,
        agent: selection.agent,
        model,
        initial: history.initial,
        // SiCode: mid-session topic changes get a reorient nudge so Flash stops walking the prior
        // tool trajectory. Request-only; `OPENCODE_TOPIC_SWITCH=0` off.
        // SiCode: clarify / ui-behavior / obey-fix / decision-freeze default OFF (`=1`).
        // Browser-drive / working-pin / topic-switch stay default-on (structural).
        // SiCode: working-pin is outermost so it sits closest to the latest user message
        // (long-context-use P1); specialty hints splice under it.
        messages: SessionWorkingPin.inject({
          messages: SessionBrowserDriveHint.inject({
            messages: SessionObeyFixHint.inject({
              messages: SessionUiBehaviorHint.inject({
                messages: SessionClarifyHint.inject({
                  messages: SessionTopicSwitch.inject({
                    messages: ruled,
                    enabled: process.env.OPENCODE_TOPIC_SWITCH !== "0",
                  }),
                  // SiCode: default OFF — clarify injects still invite ask-theater; opt in with =1.
                  enabled: process.env.OPENCODE_CLARIFY === "1",
                }),
                // SiCode: default OFF — phrase lists removed; key-chord trigger only; opt in with =1.
                enabled: process.env.OPENCODE_UI_BEHAVIOR === "1",
              }),
              // SiCode: default OFF — obey-fix still needs a phrase trigger; opt in with =1.
              enabled: process.env.OPENCODE_OBEY_FIX === "1",
            }),
            tools: selection.tools.definitions.map((tool) => tool.name),
            metadata: selection.session.metadata as Record<string, unknown> | undefined,
            enabled: process.env.OPENCODE_BROWSER_DRIVE !== "0",
          }),
          frozen: SessionDecisionFreeze.cached(selection.session.id),
          enabled: process.env.OPENCODE_WORKING_PIN !== "0",
        }),
        tools: selection.tools,
      }
    })

    return Service.of({ select, load, resolveModel, selectTitle, request })
  }),
)

/** Variant IDs that minimize reasoning output, in preference order. */
const MINIMAL_REASONING_VARIANTS = ["none", "minimal", "low"].map((id) => Model.VariantID.make(id))

const minimalVariant = (info: Model.Info) =>
  MINIMAL_REASONING_VARIANTS.find((id) => info.variants.some((item) => item.id === id))

/**
 * `none` and `minimal` always reduce reasoning. `low` can enable reasoning on a model whose default
 * does not reason, so it is only used when it ranks below the variant the session selected.
 */
const lowerVariant = (info: Model.Info, selected: Model.VariantID | undefined) => {
  const rank = (id: Model.VariantID | undefined) => info.variants.findIndex((item) => item.id === id)
  return MINIMAL_REASONING_VARIANTS.find((id) => rank(id) !== -1 && (id !== "low" || rank(id) < rank(selected)))
}

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    Agent.node,
    Bus.node,
    Model.node,
    Database.node,
    InstructionBuiltIns.node,
    InstructionDiscovery.node,
    InstructionEntry.node,
    Location.node,
    McpInstructions.node,
    McpTool.node,
    ReferenceInstructions.node,
    SessionContextHints.node,
    SessionRunnerModel.node,
    SessionModelRequest.node,
    SessionStore.node,
    SkillInstructions.node,
    Tool.node,
  ],
})
