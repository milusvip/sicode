// Current Session tool presentation grouped by visual family.
import {
  Component,
  batch,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
  Index,
  on,
  type JSX,
} from "solid-js"
import { createStore } from "solid-js/store"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { Effect, Option, Schema } from "effect"
import stripAnsi from "strip-ansi"
import { createTwoFilesPatch, diffLines } from "diff"
import { Dynamic } from "solid-js/web"
import { type SessionSummary, useData } from "../context"
import { useFileComponent } from "@opencode/ui/context/file"
import { type UiI18n, useI18n } from "@opencode/ui/context/i18n"
import { BasicTool, GenericTool } from "../components/basic-tool"
import { FileIcon } from "@opencode/ui/file-icon"
import { Icon } from "@opencode/ui/icon"
import { ToolErrorCard } from "../components/tool-error-card"
import { DiffChanges } from "@opencode/ui/diff-changes"
import { Markdown } from "../components/markdown"
import { createMarkdownImages } from "../components/markdown-image"
import { createImagePreview } from "../components/image-preview"
import { useMarkdown } from "../context/markdown"
import { getDirectory, getFilename } from "@opencode/util/path"
import { checksum } from "@opencode/util/encode"
import { Tooltip } from "@opencode/ui/tooltip"
import { IconButton } from "@opencode/ui/icon-button"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import { AnimatedNumber } from "@opencode/ui/animated-number"
import { changedFileDiff, patchFileGroups, type ApplyPatchFileGroup } from "../components/apply-patch-file"
import { streamedLineChanges } from "./stream-changes"
import { animate } from "motion"
import { SessionProgressIndicatorV2 } from "../v2/components/session-progress-indicator-v2"
import { toolSpanElapsed } from "../timeline/work-shell"
import type {
  FileDiffInfo,
  SessionMessageAssistantReasoning,
  SessionMessageAssistantTool,
  SessionMessageShell,
} from "@opencode/client/promise"
import {
  currentToolError,
  currentToolFailed,
  currentToolGroupedRead,
  currentToolInput,
  currentToolMetadata,
  currentToolOutput,
  currentToolStatus,
  executeToolFailed,
  readImagePath,
} from "../message/current-tool-state"
import { AssistantReasoningContent, writeClipboard } from "../message/message-content"
import { followShellOutput } from "./shell-output"

function ShellSubmessage(props: { text: string; animate?: boolean }) {
  let widthRef: HTMLSpanElement | undefined
  let valueRef: HTMLSpanElement | undefined

  onMount(() => {
    if (!props.animate) return
    requestAnimationFrame(() => {
      if (widthRef) {
        animate(widthRef, { width: "auto" }, { type: "spring", visualDuration: 0.25, bounce: 0 })
      }

      if (valueRef) {
        animate(valueRef, { opacity: 1, filter: "blur(0px)" }, { duration: 0.32, ease: [0.16, 1, 0.3, 1] })
      }
    })
  })

  return (
    <span data-component="shell-submessage" dir="ltr">
      <span ref={widthRef} data-slot="shell-submessage-width" style={{ width: props.animate ? "0px" : undefined }}>
        <span data-slot="basic-tool-tool-subtitle">
          <span
            ref={valueRef}
            data-slot="shell-submessage-value"
            style={props.animate ? { opacity: 0, filter: "blur(2px)" } : undefined}
          >
            {props.text}
          </span>
        </span>
      </span>
    </span>
  )
}

// Tool input and metadata are open records shared by every tool. Each field decodes on its own,
// so a malformed value drops only that field.
function optional<S extends Schema.ConstraintCodec<unknown, unknown>>(schema: S) {
  const field = Schema.optional(schema)

  return Schema.catchDecoding<typeof field>(() => Effect.succeed(Option.none()))(field)
}

const toolInput = Schema.decodeUnknownSync(
  Schema.Struct({
    path: optional(Schema.String),
    pattern: optional(Schema.String),
    include: optional(Schema.String),
    offset: optional(Schema.Number),
    limit: optional(Schema.Number),
    url: optional(Schema.String),
    query: optional(Schema.String),
    agent: optional(Schema.String),
    description: optional(Schema.String),
    command: optional(Schema.String),
    code: optional(Schema.String),
    oldString: optional(Schema.String),
    newString: optional(Schema.String),
    content: optional(Schema.String),
    id: optional(Schema.String),
    name: optional(Schema.String),
    questions: optional(Schema.Array(Schema.Unknown)),
  }),
)

const toolMetadata = Schema.decodeUnknownSync(
  Schema.Struct({
    name: optional(Schema.String),
    provider: optional(Schema.String),
    sessionID: optional(Schema.String),
    command: optional(Schema.String),
    shellID: optional(Schema.String),
    status: optional(Schema.String),
    background: optional(Schema.Boolean),
    count: optional(Schema.Finite),
    matches: optional(Schema.Finite),
    files: optional(Schema.Array(Schema.Unknown)),
    loaded: optional(Schema.Array(Schema.Unknown)),
    answers: optional(Schema.Array(Schema.Unknown)),
    diagnostics: optional(Schema.Record(Schema.String, Schema.Array(Schema.Unknown))),
  }),
)

type ToolInput = ReturnType<typeof toolInput>

type ToolMetadata = ReturnType<typeof toolMetadata>

const decodeString = Schema.decodeUnknownOption(Schema.String)

const decodeQuestion = Schema.decodeUnknownOption(Schema.Struct({ question: Schema.String }))

const decodeAnswer = Schema.decodeUnknownOption(Schema.Array(Schema.String))

const decodeDiagnostic = Schema.decodeUnknownOption(
  Schema.Struct({
    range: Schema.Struct({ start: Schema.Struct({ line: Schema.Number, character: Schema.Number }) }),
    message: Schema.String,
    severity: Schema.optional(Schema.Number),
  }),
)

type Diagnostic = Option.Option.Value<ReturnType<typeof decodeDiagnostic>>

function questions(input: ToolInput) {
  return (input.questions ?? []).flatMap((question) => Option.toArray(decodeQuestion(question)))
}

function getDiagnostics(diagnosticsByFile: ToolMetadata["diagnostics"], filePath: string | undefined) {
  if (!filePath) return []

  return (diagnosticsByFile?.[filePath] ?? [])
    .flatMap((value) => Option.toArray(decodeDiagnostic(value)).filter((diagnostic) => diagnostic.severity === 1))
    .slice(0, 3)
}

function DiagnosticsDisplay(props: { diagnostics: readonly Diagnostic[] }): JSX.Element {
  const i18n = useI18n()

  return (
    <Show when={props.diagnostics.length > 0}>
      <div data-component="diagnostics">
        <For each={props.diagnostics}>
          {(diagnostic) => (
            <div data-slot="diagnostic">
              <span data-slot="diagnostic-label">{i18n.t("ui.messagePart.diagnostic.error")}</span>
              <span data-slot="diagnostic-location">
                [{diagnostic.range.start.line + 1}:{diagnostic.range.start.character + 1}]
              </span>
              <span data-slot="diagnostic-message">{diagnostic.message}</span>
            </div>
          )}
        </For>
      </div>
    </Show>
  )
}

function relativizeProjectPath(path: string, directory?: string) {  if (!path) return ""

  if (!directory) return path

  if (directory === "/") return path

  if (directory === "\\") return path

  if (path === directory) return ""

  const separator = directory.includes("\\") ? "\\" : "/"
  const prefix = directory.endsWith(separator) ? directory : directory + separator

  if (!path.startsWith(prefix)) return path

  return path.slice(directory.length)
}

function displayDirectory(path: string | undefined) {
  const data = useData()
  const relative = relativizeProjectPath(getDirectory(path), data.directory)

  // A bare "/" is the model's way of saying "the project root"; printing it on the row says nothing
  // and read as a broken path (`Grep "foo" · /`).
  return relative === "/" || relative === "\\" ? "" : relative
}

/** One token, in path order, project-relative and without a leading separator. */
function readDisplayPath(raw: string, directory?: string) {
  if (!raw) return ""

  const relative = relativizeProjectPath(raw, directory)

  return relative === raw ? relative : relative.replace(/^[/\\]/, "")
}

import { resolveFileDiff } from "../components/session-diff"

const agentTones = new Map([
  ["ask", "var(--icon-agent-ask-base)"],
  ["build", "var(--icon-agent-build-base)"],
  ["docs", "var(--icon-agent-docs-base)"],
  ["plan", "var(--icon-agent-plan-base)"],
])

const v2AgentTones = new Map([
  ["build", "var(--v2-agent-build-solid)"],
  ["explore", "var(--v2-agent-explore-solid)"],
  ["plan", "var(--v2-agent-plan-solid)"],
  ["review", "var(--v2-agent-review-solid)"],
  ["writer", "var(--v2-agent-writer-solid)"],
])

const agentThemeColors = new Map([
  ["primary", "var(--text-interactive-base)"],
  ["secondary", "var(--text-base)"],
  ["accent", "var(--icon-info-base)"],
  ["success", "var(--icon-success-base)"],
  ["warning", "var(--icon-warning-base)"],
  ["error", "var(--icon-critical-base)"],
  ["info", "var(--icon-info-base)"],
])

const v2AgentThemeColors = new Map([
  ["primary", "var(--v2-text-text-accent)"],
  ["secondary", "var(--v2-text-text-muted)"],
  ["accent", "var(--v2-icon-icon-accent)"],
  ["success", "var(--v2-state-fg-success)"],
  ["warning", "var(--v2-state-fg-warning)"],
  ["error", "var(--v2-state-fg-danger)"],
  ["info", "var(--v2-state-fg-info)"],
])

const agentPalette = [
  "var(--icon-agent-ask-base)",
  "var(--icon-agent-build-base)",
  "var(--icon-agent-docs-base)",
  "var(--icon-agent-plan-base)",
  "var(--syntax-info)",
  "var(--syntax-success)",
  "var(--syntax-warning)",
  "var(--syntax-property)",
  "var(--syntax-constant)",
  "var(--text-diff-add-base)",
  "var(--text-diff-delete-base)",
  "var(--icon-warning-base)",
]

function tone(name: string) {
  let hash = 0

  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0

  return agentPalette[hash % agentPalette.length]
}

function taskAgent(raw: string | undefined, list?: readonly { name: string; color?: string }[]) {
  if (!raw) return {}
  const key = raw.toLowerCase()
  const item = list?.find((entry) => entry.name === raw || entry.name.toLowerCase() === key)
  const v2Tone = item?.color ? undefined : v2AgentTones.get(key)
  const color = agentColor(item?.color, agentThemeColors) ?? agentTones.get(key) ?? tone(key)
  const v2Color = agentColor(item?.color, v2AgentThemeColors) ?? v2Tone ?? color

  return {
    name: item?.name ?? `${raw[0].toUpperCase()}${raw.slice(1)}`,
    color,
    v2Color,
  }
}

function agentColor(value: string | undefined, themeColors: ReadonlyMap<string, string>) {
  if (!value) return undefined

  return themeColors.get(value) ?? value
}

const webSearchProviderNames = new Map([
  ["tinyfish", "TinyFish"],
  ["opencode", "OpenCode"],
])

function webSearchProviderLabel(provider: string | undefined, i18n: ReturnType<typeof useI18n>) {
  if (!provider) return i18n.t("ui.tool.websearch")
  const name = webSearchProviderNames.get(provider) ?? `${provider[0].toUpperCase()}${provider.slice(1)}`

  return i18n.t("ui.tool.websearch.provider", { provider: name })
}

function readArgs(input: ToolInput) {
  return [
    ...(input.offset === undefined ? [] : [`offset=${input.offset}`]),
    ...(input.limit === undefined ? [] : [`limit=${input.limit}`]),
  ]
}

function skillToolName(input: ToolInput, metadata: ToolMetadata) {
  return metadata.name ?? input.id ?? input.name
}

function currentSkillName(tool: SessionMessageAssistantTool) {
  return skillToolName(toolInput(currentToolInput(tool)), toolMetadata(currentToolMetadata(tool)))
}

// Context group labels name each tool once; detailed subtitles belong to the tool rows.
function toolTitle(tool: SessionMessageAssistantTool, i18n: UiI18n) {
  switch (tool.name) {
    case "read":
      return i18n.t("ui.tool.read")
    case "list":
      return i18n.t("ui.tool.list")
    case "glob":
      return i18n.t("ui.tool.glob")
    case "grep":
      return i18n.t("ui.tool.grep")
    case "browser":
      return i18n.t("ui.tool.browser")
    case "webfetch":
      return i18n.t("ui.tool.webfetch")
    case "websearch":
      return webSearchProviderLabel(toolMetadata(currentToolMetadata(tool)).provider, i18n)
    case "subagent":
      return i18n.t("ui.tool.agent.default")
    case "shell":
      return i18n.t("ui.tool.shell")
    case "execute":
      return i18n.t("ui.tool.execute")
    case "edit":
      return i18n.t("ui.messagePart.title.edit")
    case "write":
      return i18n.t("ui.messagePart.title.write")
    case "patch":
      return i18n.t("ui.tool.patch")
    case "question":
      return i18n.t("ui.tool.questions")
    case "skill":
      return i18n.t("ui.tool.skill")
    default:
      return tool.name
  }
}

function urls(text: string | undefined) {
  if (!text) return []

  return [
    ...new Set(Array.from(text.matchAll(/https?:\/\/[^\s<>"'`)\]]+/g), (item) => item[0].replace(/[),.;:!?]+$/g, ""))),
  ]
}

function sessionLink(id: string | undefined, href?: (id: string) => string | undefined) {
  if (!id) return undefined

  return href?.(id)
}

function taskSession(
  description: string | undefined,
  parentID: string | undefined,
  sessions: SessionSummary[] | undefined,
) {
  if (!parentID) return undefined

  return (sessions ?? [])
    .filter((session) => session.parentID === parentID && !session.time?.archived)
    .filter((session) => (description ? session.title?.startsWith(description) : true))
    .sort((a, b) => (b.time.created ?? 0) - (a.time.created ?? 0))[0]?.id
}

function ExaOutput(props: { output?: string }) {
  const i18n = useI18n()
  const [showAll, setShowAll] = createSignal(false)
  let firstRevealedRef: HTMLAnchorElement | undefined
  const links = createMemo(() => urls(props.output))

  const visibleLinks = createMemo(() => {
    const all = links()

    if (showAll() || all.length <= 10) return all

    return all.slice(0, 10)
  })

  const remaining = createMemo(() => Math.max(0, links().length - 10))

  const expand = (event: MouseEvent) => {
    event.stopPropagation()
    setShowAll(true)
    requestAnimationFrame(() => {
      firstRevealedRef?.focus()
    })
  }

  return (
    <Show when={links().length > 0}>
      <div data-component="exa-tool-output">
        <div data-slot="exa-tool-links">
          <For each={visibleLinks()}>
            {(url, index) => (
              <a
                ref={(el) => {
                  if (index() === 10) firstRevealedRef = el
                }}
                data-slot="exa-tool-link"
                class="webfetch-link"
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => event.stopPropagation()}
              >
                <span data-slot="webfetch-link-text">{url}</span>
                <Icon name="outline-square-arrow" class="webfetch-link-icon" />
              </a>
            )}
          </For>
          <Show when={!showAll() && remaining() > 0}>
            <button type="button" data-slot="exa-tool-more" onClick={expand}>
              {i18n.plural("ui.common.moreCount", remaining())}
            </button>
          </Show>
        </div>
      </div>
    </Show>
  )
}

export type ContextGroupPart =
  | SessionMessageAssistantTool
  | (SessionMessageAssistantReasoning & { id: string; streaming?: boolean })
  | { type: "notice" | "shell"; id: string; render: () => JSX.Element; summary?: string }

export function CurrentContextToolGroup(props: {
  parts: ContextGroupPart[]
  busy: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onSizeChange?: () => void
  reasoningDefaultOpen?: boolean
  reasoningOpen?: (id: string) => boolean | undefined
  onReasoningOpenChange?: (id: string, open: boolean) => void
  toolDefaultOpen?: (tool: SessionMessageAssistantTool) => boolean | undefined
  toolOpen?: (id: string) => boolean | undefined
  onToolOpenChange?: (id: string, open: boolean) => void
  fileOpen?: (path: string) => boolean | undefined
  onFileOpenChange?: (path: string, open: boolean) => void
  patchGroupKey?: (tools: SessionMessageAssistantTool[]) => string
}) {
  const i18n = useI18n()
  const tools = createMemo(() => props.parts.filter((part) => part.type === "tool"))
  const [now, setNow] = createSignal(Date.now())

  const pending = createMemo(
    () => props.busy || tools().some((tool) => tool.state.status === "streaming" || tool.state.status === "running"),
  )

  // A finished process that contains a failed tool may not wear the success check: the collapsed
  // chain is the only place that failure shows, and `bun test` failing is a `completed` tool.
  const failed = createMemo(() => tools().some(currentToolFailed))

  createEffect(() => {
    if (!pending()) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => window.clearInterval(id))
  })

  const elapsed = createMemo(() => toolSpanElapsed(tools(), pending(), now()))

  // Three kinds is a row; six is a paragraph. The head already says how many tools ran, so the
  // tail collapses into a count instead of pushing the duration out of the row.
  const names = createMemo(() => {
    const kinds = [
      ...new Set(
        props.parts.flatMap((part) => {
          if (part.type !== "tool" && part.type !== "shell") return []

          return [part.type === "tool" ? toolTitle(part, i18n) : i18n.t("ui.tool.shell")]
        }),
      ),
    ]

    if (kinds.length <= 3) return i18n.list(kinds)

    return i18n.t("ui.processShell.moreKinds", {
      names: i18n.list(kinds.slice(0, 3)),
      count: kinds.length,
      more: kinds.length - 3,
    })
  })

  const label = createMemo(() => {
    const thoughts = props.parts.filter((part) => part.type === "reasoning").length

    if (!names() && !thoughts) {
      const text = i18n.t("ui.messagePart.context.updates")
      // SiCode: notices-only groups used to hide Loaded paths until expand; keep them on the trigger.
      const summary = props.parts
        .flatMap((part) => (part.type === "notice" && part.summary ? [part.summary] : []))
        .join(", ")
      const open = summary ? `${text} ${summary}` : text

      return {
        text,
        open,
        closed: open,
        tools: "",
        count: undefined as number | undefined,
        summary,
        before: "",
        mid: "",
        after: "",
      }
    }

    const count = props.parts.filter((part) => part.type === "tool" || part.type === "shell").length || thoughts
    const before = props.open ? i18n.t("ui.processShell.count.before") : i18n.t("ui.processShell.open.before")
    const after = i18n.plural("ui.processShell.count.after", count)
    // Expanded, the rows below already name every tool; repeating them in the header is noise.
    // Collapsed, that list is the only preview of what ran, so it stays.
    const tools = props.open ? "" : names() || i18n.plural("ui.messagePart.context.thought", thoughts)
    const mid = props.open ? "" : i18n.t("ui.processShell.open.mid")
    // "已完成 N 个工具" belongs on the work-shell head. Process rows always read as 过程.
    const text = i18n.plural("ui.processShell.open", count, { tools: names() || tools })

    return { text, open: text, closed: text, tools, count, summary: "", before, mid, after }
  })

  const items = createMemo(() =>
    (props.open ? props.parts : []).reduce<
      (SessionMessageAssistantTool[] | Exclude<ContextGroupPart, SessionMessageAssistantTool>)[]
    >((groups, tool) => {
      if (tool.type !== "tool") {
        groups.push(tool)

        return groups
      }

      const previous = groups.at(-1)

      if (isFileChangeTool(tool) && Array.isArray(previous) && previous[0] && isFileChangeTool(previous[0])) {
        previous.push(tool)

        return groups
      }

      if (
        currentToolGroupedRead(tool) &&
        Array.isArray(previous) &&
        previous[0] &&
        currentToolGroupedRead(previous[0])
      ) {
        previous.push(tool)

        return groups
      }

      if (
        tool.name === "skill" &&
        tool.state.status !== "error" &&
        currentSkillName(tool) &&
        Array.isArray(previous) &&
        previous?.[0]?.name === "skill" &&
        previous[0].state.status !== "error" &&
        currentSkillName(previous[0])
      ) {
        previous.push(tool)

        return groups
      }

      groups.push([tool])

      return groups
    }, []),
  )

  const patchKeys = createMemo(() => {
    const keys = new Map<SessionMessageAssistantTool, string>()
    items().forEach((item) => {
      if (!Array.isArray(item) || !item[0] || !isFileChangeTool(item[0])) return
      const key = props.patchGroupKey?.(item) ?? item[0].id
      item.forEach((tool) => keys.set(tool, key))
    })

    return keys
  })

  // SiCode: the open/close height animation must only play on user toggles. Without this gate the
  // animation also replays whenever an expanded shell mounts (session open, failed-turn default
  // open), sliding the transcript below it on every entry.
  const [animating, setAnimating] = createSignal(false)
  let animatingTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(animatingTimer))

  const change = (open: boolean) => {
    props.onOpenChange(open)
    props.onSizeChange?.()
    setAnimating(true)
    clearTimeout(animatingTimer)
    animatingTimer = setTimeout(() => setAnimating(false), 240)
  }

  return (
    <div
      data-component="collapsed-tool-group"
      data-process-shell=""
      data-open={props.open ? "true" : "false"}
      data-animating={animating() ? "true" : undefined}
      data-pending={pending() ? "true" : "false"}
      data-failed={failed() ? "true" : "false"}
      data-timeline-part-ids={props.parts.map((part) => part.id).join(",")}
    >
      <BasicTool
        status={pending() ? "running" : failed() ? "error" : "completed"}
        compact
        hasContent
        allowOpenWhilePending
        rail={false}
        open={props.open}
        onOpenChange={change}
        trigger={() => (
          <div
            data-component="context-tool-group-trigger"
            data-process-shell-trigger=""
            aria-label={label().open}
          >
            <span data-slot="process-shell-icon">
              <Show
                when={pending()}
                fallback={<Icon name={failed() ? "outline-hexagonal-warning" : "check"} size="small" />}
              >
                <SessionProgressIndicatorV2 width={13} height={13} />
              </Show>
            </span>
            <span data-slot="context-tool-group-title">
              <Show
                when={label().count !== undefined}
                fallback={
                  <>
                    <span data-slot="context-tool-group-prefix">{label().text}</span>
                    <Show when={label().summary}>
                      {(summary) => <span data-slot="basic-tool-tool-subtitle">{summary()}</span>}
                    </Show>
                  </>
                }
              >
                <span data-slot="context-tool-group-usage">
                  <span data-slot="context-tool-group-prefix">{label().before}</span>
                </span>
                <Show when={label().tools}>
                  {(tools) => <span data-slot="basic-tool-tool-title">{tools()}</span>}
                </Show>
                <span data-slot="context-tool-group-usage">
                  <span data-slot="context-tool-group-prefix">{label().mid}</span>
                  <span data-slot="context-tool-group-count">
                    <AnimatedNumber value={label().count!} />
                  </span>
                  <span data-slot="context-tool-group-prefix">{label().after}</span>
                </span>
              </Show>
            </span>
            <Show when={elapsed()}>
              {(value) => <span data-slot="process-shell-meta">{value()}</span>}
            </Show>
            <span data-slot="process-shell-chevron" aria-hidden="true">
              <Icon name="chevron-right" size="small" />
            </span>
          </div>
        )}
      >
        <div data-component="context-tool-group-list" data-slot="process-shell-chain">
          <Index each={items()}>
            {(item) => {
              const group = createMemo(() => {
                const value = item()

                return Array.isArray(value) ? value : undefined
              })

              const reasoning = createMemo(() => {
                const value = item()

                return !Array.isArray(value) && value.type === "reasoning" ? value : undefined
              })

              const callback = createMemo(() => {
                const value = item()

                return !Array.isArray(value) && (value.type === "notice" || value.type === "shell") ? value : undefined
              })

              return (
                <Show
                  when={group()}
                  fallback={
                    <Show
                      when={reasoning()}
                      fallback={
                        <Show when={callback()}>
                          {(part) => <div data-slot="context-tool-group-item">{part().render()}</div>}
                        </Show>
                      }
                    >
                      {(part) => (
                        <div data-slot="context-tool-group-item">
                          <AssistantReasoningContent
                            id={part().id}
                            content={part()}
                            streaming={part().streaming ?? false}
                            chain
                            defaultOpen={props.reasoningDefaultOpen}
                            open={props.reasoningOpen?.(part().id)}
                            onOpenChange={(open) => props.onReasoningOpenChange?.(part().id, open)}
                            onContentRendered={props.onSizeChange}
                          />
                        </div>
                      )}
                    </Show>
                  }
                >
                  {(group) => {
                    const tool = createMemo(() => group()[0]!)
                    const trigger = createMemo(() => currentContextToolTrigger(tool(), i18n))

                    const skills = createMemo(() =>
                      group().flatMap((item) => {
                        const name = currentSkillName(item)

                        return name ? [name] : []
                      }),
                    )

                    const marker = "__OPENCODE_LOADED_SKILL__"

                    const loaded = createMemo(() =>
                      i18n.plural("ui.tool.loadedSkills", skills().length, { name: marker }),
                    )

                    return (
                      <div data-slot="context-tool-group-item">
                        <Show
                          when={!currentToolGroupedRead(tool())}
                          fallback={
                            <CurrentReadToolGroup
                              tools={group()}
                              open={props.toolOpen?.(tool().id)}
                              onOpenChange={(open) => props.onToolOpenChange?.(tool().id, open)}
                              onSizeChange={props.onSizeChange}
                            />
                          }
                        >
                          <Show
                            when={tool().state.status !== "error" && ["glob", "grep", "list"].includes(tool().name)}
                            fallback={
                              <Show
                                when={
                                  tool().name === "skill" && group().length > 1 && skills().length === group().length
                                }
                                fallback={
                                  <Show
                                    when={isFileChangeTool(tool())}
                                    fallback={
                                      <ToolDisplay
                                        id={tool().id}
                                        tool={tool().name}
                                        input={currentToolInput(tool())}
                                        metadata={currentToolMetadata(tool())}
                                        output={currentToolOutput(tool())}
                                        error={currentToolError(tool())}
                                        status={currentToolStatus(tool())}
                                        defaultOpen={props.toolDefaultOpen?.(tool()) ?? false}
                                        open={props.toolOpen?.(tool().id) ?? props.toolDefaultOpen?.(tool())}
                                        onOpenChange={(open) => props.onToolOpenChange?.(tool().id, open)}
                                        deferContent
                                        virtualizeDiff={false}
                                        onContentRendered={props.onSizeChange}
                                      />
                                    }
                                  >
                                    <CurrentFileToolGroup
                                      tools={group()}
                                      fileOpen={
                                        props.fileOpen &&
                                        ((path) => props.fileOpen?.(`${patchKeys().get(tool())}:${path}`))
                                      }
                                      onFileOpenChange={
                                        props.onFileOpenChange &&
                                        ((path, open) =>
                                          props.onFileOpenChange?.(`${patchKeys().get(tool())}:${path}`, open))
                                      }
                                      onSizeChange={props.onSizeChange}
                                    />
                                  </Show>
                                }
                              >
                                <div
                                  data-component="tool-loaded-item"
                                  data-timeline-part-ids={group()
                                    .map((item) => item.id)
                                    .join(",")}
                                  aria-label={i18n.plural("ui.tool.loadedSkills", skills().length, {
                                    name: skills().join(", "),
                                  })}
                                >
                                  <span data-slot="tool-loaded-label" aria-hidden="true">
                                    {loaded().split(marker)[0]?.trim()}
                                  </span>
                                  <span data-slot="tool-loaded-value" aria-hidden="true">
                                    <For each={skills()}>
                                      {(name, index) => (
                                        <>
                                          <Show when={index() > 0}>, </Show>
                                          <TextShimmer
                                            as="span"
                                            text={name}
                                            active={["streaming", "running"].includes(group()[index()]!.state.status)}
                                          />
                                        </>
                                      )}
                                    </For>
                                  </span>
                                  <Show when={loaded().split(marker)[1]?.trim()}>
                                    {(suffix) => (
                                      <span data-slot="tool-loaded-kind" aria-hidden="true">
                                        {suffix()}
                                      </span>
                                    )}
                                  </Show>
                                </div>
                              </Show>
                            }
                          >
                            <div
                              data-component="tool-trigger"
                              data-status={
                                tool().state.status === "streaming" || tool().state.status === "running"
                                  ? "running"
                                  : currentToolStatus(tool())
                              }
                            >
                              <div data-slot="basic-tool-tool-trigger-content">
                                <span data-slot="basic-tool-tool-indicator">
                                  <Show
                                    when={
                                      tool().state.status === "streaming" || tool().state.status === "running"
                                    }
                                    fallback={<Icon name={contextToolIcon(tool().name)} size="small" />}
                                  >
                                    <span data-slot="basic-tool-tool-spinner">
                                      <SessionProgressIndicatorV2 width={13} height={13} />
                                    </span>
                                  </Show>
                                </span>
                                <div data-slot="basic-tool-tool-info">
                                  <div data-slot="basic-tool-tool-info-structured">
                                    <div data-slot="basic-tool-tool-info-main">
                                      <span data-slot="basic-tool-tool-title">
                                        <TextShimmer
                                          text={trigger().title}
                                          active={
                                            tool().state.status === "streaming" || tool().state.status === "running"
                                          }
                                        />
                                      </span>
                                      <Show when={trigger().subtitle}>
                                        {(subtitle) => <span data-slot="basic-tool-tool-subtitle">{subtitle()}</span>}
                                      </Show>
                                      <For each={trigger().args}>
                                        {(arg) => <span data-slot="basic-tool-tool-arg">{arg}</span>}
                                      </For>
                                    </div>
                                  </div>
                                </div>
                                <Show when={toolRowMeta(tool(), trigger().matches, now())}>
                                  {(meta) => <span data-slot="context-tool-group-meta">{meta()}</span>}
                                </Show>
                              </div>
                            </div>
                          </Show>
                        </Show>
                      </div>
                    )
                  }}
                </Show>
              )
            }}
          </Index>
        </div>
      </BasicTool>
    </div>
  )
}

export function CurrentReadToolGroup(props: {
  tools: SessionMessageAssistantTool[]
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onSizeChange?: () => void
}) {
  const i18n = useI18n()
  const data = useData()
  const [state, setState] = createStore({ open: false, truncated: false })
  const open = () => props.open ?? state.open
  const expandable = () => open() || state.truncated

  const pending = createMemo(() =>
    props.tools.some((tool) => tool.state.status === "streaming" || tool.state.status === "running"),
  )

  const files = createMemo(() => {
    const entries = props.tools.flatMap((tool) => {
      const input = toolInput(currentToolInput(tool))
      // read accepts a single path or a list; a list renders as one comma-separated row.
      const requested: unknown = input.path
      const raw =
        typeof requested === "string" ? requested : Array.isArray(requested) ? requested.join(", ") : ""
      if (!getFilename(raw)) return []

      return [{ id: tool.id, raw, args: readArgs(input) }]
    })

    // A single read is the same row as the plain read tool, so it shows the same project-relative
    // path. A list of several keeps filenames — three full paths would be all ellipsis.
    return entries.map((entry) => ({
      id: entry.id,
      name: entries.length === 1 ? readDisplayPath(entry.raw, data.directory) : getFilename(entry.raw),
      args: entry.args,
    }))
  })

  let list: HTMLSpanElement | undefined

  const measure = () => {
    if (!list || open()) return
    setState("truncated", list.scrollWidth > list.clientWidth)
  }

  createResizeObserver(() => list, measure)
  createEffect(on(files, measure))

  const toggle = () => {
    if (!expandable()) return
    const next = !open()
    setState("open", next)
    props.onOpenChange?.(next)
    props.onSizeChange?.()
  }

  return (
    <div
      data-component="read-tool-group"
      data-timeline-part-ids={props.tools.map((tool) => tool.id).join(",")}
      data-expanded={open() ? "true" : undefined}
      role={expandable() ? "button" : undefined}
      tabIndex={expandable() ? 0 : undefined}
      aria-expanded={expandable() ? open() : undefined}
      onClick={toggle}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        toggle()
      }}
    >
      <div data-component="tool-trigger">
        <div data-slot="basic-tool-tool-trigger-content">
          <span data-slot="basic-tool-tool-indicator">
            <Show
              when={pending()}
              fallback={<Icon name="glasses" size="small" />}
            >
              <span data-slot="basic-tool-tool-spinner">
                <SessionProgressIndicatorV2 width={13} height={13} />
              </span>
            </Show>
          </span>
          <div data-slot="basic-tool-tool-info">
            <div data-slot="basic-tool-tool-info-structured">
              <div data-slot="basic-tool-tool-info-main">
                <span data-slot="basic-tool-tool-title">
                  <TextShimmer text={i18n.t("ui.tool.read")} active={pending()} />
                </span>
                <span ref={list} data-slot="basic-tool-tool-subtitle">
                  <Index each={files()}>
                    {(file, index) => (
                      <>
                        <Show when={index > 0}> </Show>
                        <span data-slot="read-tool-group-file" data-timeline-part-id={file().id}>
                          {file().name}
                          <For each={file().args}>
                            {(arg) => <span data-slot="basic-tool-tool-arg">{` ${arg}`}</span>}
                          </For>
                          <Show when={index < files().length - 1}>,</Show>
                        </span>
                      </>
                    )}
                  </Index>
                </span>
              </div>
            </div>
          </div>
        </div>
        <Show when={expandable()}>
          <span data-slot="read-tool-group-arrow" aria-hidden="true">
            {/* SiCode: chevron-right matches the work-shell / process-shell heads, so every
                expand affordance in the transcript points the same way. */}
            <Icon name="chevron-right" size="small" />
          </span>
        </Show>
      </div>
    </div>
  )
}

export function CurrentFileToolGroup(props: {
  tools: SessionMessageAssistantTool[]
  fileOpen?: (path: string) => boolean | undefined
  onFileOpenChange?: (path: string, open: boolean) => void
  onSizeChange?: () => void
}) {
  const files = createMemo((previous: { key: string; toolID: string; value: FileDiffInfo }[]) => {
    const next = props.tools.flatMap((tool) => {
      const files = toolMetadata(currentToolMetadata(tool)).files ?? []

      // Invalid entries render nothing, but metadata files still replace the input-derived preview.
      if (files.length > 0)
        return files.flatMap((value, index) =>
          changedFileDiff(value) ? [{ key: `${tool.id}:${index}`, toolID: tool.id, value }] : [],
        )
      const input = toolInput(currentToolInput(tool))

      if (input.path === undefined) return []

      if (tool.name === "edit" && input.oldString !== undefined && input.newString !== undefined) {
        const changes = diffLines(input.oldString, input.newString)

        const additions = changes
          .filter((change) => change.added)
          .reduce((total, change) => total + (change.count ?? 0), 0)

        const deletions = changes
          .filter((change) => change.removed)
          .reduce((total, change) => total + (change.count ?? 0), 0)

        if (additions === 0 && deletions === 0) return []

        return [
          {
            key: `${tool.id}:0`,
            toolID: tool.id,
            value: {
              file: input.path,
              patch: createTwoFilesPatch(input.path, input.path, input.oldString, input.newString),
              additions,
              deletions,
              status: "modified" as const,
            },
          },
        ]
      }

      if (tool.name !== "write" || !input.content) return []

      return [
        {
          key: `${tool.id}:0`,
          toolID: tool.id,
          value: {
            file: input.path,
            patch: createTwoFilesPatch(input.path, input.path, "", input.content),
            additions: input.content.split("\n").length - Number(input.content.endsWith("\n")),
            deletions: 0,
            status: "added" as const,
          },
        },
      ]
    })

    const updates = new Map(next.map((entry) => [entry.key, entry.value]))
    const existing = new Set(previous.map((entry) => entry.key))
    const owners = new Set(props.tools.map((tool) => tool.id))

    const result = [
      ...previous.flatMap((entry) => {
        if (!owners.has(entry.toolID)) return []
        const value = updates.get(entry.key)

        if (!value || samePatchFile(value, entry.value)) return [entry]

        return [{ ...entry, value }]
      }),
      ...next.filter((entry) => !existing.has(entry.key)),
    ]

    return result.length === previous.length && result.every((entry, index) => entry === previous[index])
      ? previous
      : result
  }, [])

  const metadata = createMemo(() => ({
    files: files().map((entry) => entry.value),
  }))

  const pending = createMemo(() =>
    props.tools.some((tool) => tool.state.status === "streaming" || tool.state.status === "running"),
  )

  // SiCode: one chain row per changed file (glyph, action, path, ±stat, chevron-right) instead of
  // stacking file cards. Inside the process fold the card chrome read as an alien block, and its
  // -5px/-8px pull overshot the shell's rounded border. `patchFileGroups` is the same normalizer the
  // card used, so the diff bodies and the chained-edit merge stay identical.
  const i18n = useI18n()
  const fileComponent = useFileComponent()
  const groups = createMemo(() => patchFileGroups(metadata().files))

  // Same controlled/uncontrolled split the card used: the host owns each file's open state when it
  // passes `fileOpen`, otherwise the row keeps it locally.
  const [expanded, setExpanded] = createSignal<string[]>([])

  const open = createMemo(() => {
    if (!props.fileOpen) return expanded()

    return groups().flatMap((file) => (props.fileOpen?.(file.path) === true ? [file.path] : []))
  })

  const change = (next: string[]) => {
    if (!props.onFileOpenChange) {
      setExpanded(next)

      return
    }

    groups().forEach((file) => props.onFileOpenChange?.(file.path, next.includes(file.path)))
  }

  return (
    <div
      data-component="chain-file-group"
      data-timeline-part-id={props.tools.length === 1 ? props.tools[0]?.id : undefined}
      data-timeline-part-ids={props.tools.length > 1 ? props.tools.map((tool) => tool.id).join(",") : undefined}
    >
      {/* `FileAccordionGroup` (not a bare column) so the rows keep their keyboard arrow-key
          navigation and the `accordion`/`item`/`trigger` slots get their base geometry. */}
      <FileAccordionGroup>
        <Index each={groups()}>
          {(file) => {
            const active = createMemo(() => open().includes(file().path))

            return (
              <FileAccordionItem
                open={active()}
                onOpenChange={(next) =>
                  change(next ? [...open(), file().path] : open().filter((path) => path !== file().path))
                }
                type={file().type}
                collapse={i18n.t("ui.patch.collapse")}
                header={<ChainFileRow file={file()} pending={pending()} />}
              >
                <Show when={active()}>
                  <div data-component="apply-patch-file-diff">
                    <For each={file().views}>
                      {(view) => (
                        <Dynamic
                          component={fileComponent}
                          mode="diff"
                          virtualize={false}
                          fileDiff={view.fileDiff}
                          hunkSeparators={view.fileDiff.isPartial ? "simple" : "line-info-basic"}
                          onRendered={props.onSizeChange}
                        />
                      )}
                    </For>
                  </div>
                </Show>
              </FileAccordionItem>
            )
          }}
        </Index>
      </FileAccordionGroup>
    </div>
  )
}

/** The row's leading verb, keyed by the file's kind so the JSX has no ternary ladder. */
const FILE_ACTION = {
  add: "ui.patch.action.created",
  update: "ui.patch.action.updated",
  delete: "ui.patch.action.deleted",
} as const satisfies Record<ApplyPatchFileGroup["type"], string>

/** SiCode: the chain-language file row — same slot vocabulary as the shell and reasoning rows. */
function ChainFileRow(props: { file: ApplyPatchFileGroup; pending: boolean }) {
  const i18n = useI18n()
  const action = () => FILE_ACTION[props.file.type]

  return (
    <div data-component="tool-trigger" data-slot="chain-file-row">
      <div data-slot="basic-tool-tool-trigger-content">
        <span data-slot="basic-tool-tool-indicator">
          <Show when={props.pending} fallback={<Icon name="code-lines" size="small" />}>
            <span data-slot="basic-tool-tool-spinner">
              <SessionProgressIndicatorV2 width={13} height={13} />
            </span>
          </Show>
        </span>
        <div data-slot="basic-tool-tool-info">
          <div data-slot="basic-tool-tool-info-structured">
            <div data-slot="basic-tool-tool-info-main">
              <span data-slot="basic-tool-tool-title">{i18n.t(action())}</span>
              <span data-slot="basic-tool-tool-subtitle" class="tool-path">
                {`${displayDirectory(props.file.path)}${getFilename(props.file.path)}`}
              </span>
            </div>
          </div>
        </div>
      </div>
      <span data-slot="chain-tool-meta">
        <DiffChanges
          appearance="compact"
          changes={{ additions: props.file.additions, deletions: props.file.deletions }}
        />
      </span>
      <span data-slot="chain-file-arrow">
        <Icon name="chevron-right" size="small" />
      </span>
    </div>
  )
}

function isFileChangeTool(tool: SessionMessageAssistantTool) {
  return tool.state.status !== "error" && (tool.name === "edit" || tool.name === "write" || tool.name === "patch")
}

function samePatchFile(a: FileDiffInfo, b: FileDiffInfo) {
  return (
    a === b ||
    (a.file === b.file &&
      a.patch === b.patch &&
      a.additions === b.additions &&
      a.deletions === b.deletions &&
      a.status === b.status)
  )
}

function contextToolIcon(name: string) {
  switch (name) {
    case "read":
      return "glasses" as const
    case "list":
      return "bullet-list" as const
    case "glob":
    case "grep":
      return "magnifying-glass-menu" as const
    case "edit":
    case "write":
    case "patch":
      return "code-lines" as const
    case "bash":
    case "shell":
      return "console" as const
    case "webfetch":
    case "websearch":
      return "window-cursor" as const
    case "task":
    case "subagent":
      return "task" as const
    case "question":
      return "check" as const
    default:
      return "mcp" as const
  }
}

function toolRowMeta(tool: SessionMessageAssistantTool, matches: string | undefined, now = Date.now()) {
  const pending = tool.state.status === "streaming" || tool.state.status === "running"
  const elapsed = toolSpanElapsed([tool], pending, now)
  if (matches) return matches
  return elapsed
}

function currentContextToolTrigger(tool: SessionMessageAssistantTool, i18n: ReturnType<typeof useI18n>) {
  const input = toolInput(currentToolInput(tool))
  const metadata = toolMetadata(currentToolMetadata(tool))
  const path = displayDirectory(input.path ?? "/")
  const pathArg = path ? [`· ${path}`] : []

  const matches = (count: number | undefined) =>
    count ? i18n.plural("ui.messagePart.context.match", count) : undefined

  if (tool.name === "list")
    return { title: i18n.t("ui.tool.list"), subtitle: path, args: [], matches: undefined, meta: undefined }

  if (tool.name === "glob")
    return {
      title: i18n.t("ui.tool.glob"),
      subtitle: input.pattern,
      args: pathArg,
      matches: matches(metadata.count),
      meta: matches(metadata.count),
    }

  return {
    title: i18n.t("ui.tool.grep"),
    subtitle: input.pattern ? `"${input.pattern}"` : undefined,
    args: [...pathArg, ...(input.include ? [`include=${input.include}`] : [])],
    matches: matches(metadata.matches),
    meta: matches(metadata.matches),
  }
}

// SAFETY: tool input and metadata are open per-tool records. GenericTool shows arbitrary input keys, and
// renderers decode the fields they read with `toolInput` and `toolMetadata`.
export interface ToolProps {
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- see SAFETY above
  input: Record<string, unknown>
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- see SAFETY above
  metadata: Record<string, unknown>
  tool: string
  sessionID?: string
  output?: string
  status?: string
  hideDetails?: boolean
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  fileOpen?: (path: string) => boolean | undefined
  onFileOpenChange?: (path: string, open: boolean) => void
  deferContent?: boolean
  virtualizeDiff?: boolean
  onContentRendered?: () => void
  /** Paths the patch view lists, without change counts or diffs, instead of `metadata.files`. */
  pendingFiles?: readonly string[]
  forceOpen?: boolean
  locked?: boolean
}

export type ToolComponent = Component<ToolProps>

const state: Record<
  string,
  {
    name: string
    render?: ToolComponent
  }
> = {}

export function registerTool(input: { name: string; render?: ToolComponent }) {
  state[input.name] = input

  return input
}

export function getTool(name: string) {
  return state[name]?.render
}

export const ToolRegistry = {
  register: registerTool,
  render: getTool,
}

function FileTool(props: ToolProps & { title: string; count: number; children?: JSX.Element }) {
  const i18n = useI18n()

  return (
    <BasicTool
      {...props}
      open
      onOpenChange={undefined}
      locked
      icon="code-lines"
      hasContent
      defer={false}
      rail={false}
      trigger={{
        title: props.title,
        subtitle: props.count > 0 ? `${props.count} ${i18n.plural("ui.common.file", props.count)}` : "",
      }}
    >
      {props.children}
    </BasicTool>
  )
}

/**
 * Opens this file in the host's side panel from a file row.
 * The row header is itself a button, so this is a focusable span rather than a nested button.
 */
function FileRowOpenFile(props: { path: string }) {
  const i18n = useI18n()
  const data = useData()

  return (
    <Show when={data.openFile}>
      <Tooltip value={i18n.t("ui.sessionTurn.diffs.openInSidebar")} placement="top" class="flex">
        <span
          role="button"
          tabIndex={0}
          aria-label={i18n.t("ui.sessionTurn.diffs.openInSidebar")}
          data-slot="apply-patch-open-changes"
          onClick={(event) => {
            event.stopPropagation()
            data.openFile?.(props.path)
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return
            event.preventDefault()
            event.stopPropagation()
            data.openFile?.(props.path)
          }}
        >
          <Icon name="sidebar-right" size="small" />
        </span>
      </Tooltip>
    </Show>
  )
}

function FileAccordionGroup(props: { children: JSX.Element }) {
  return (
    <div
      data-component="accordion"
      data-scope="apply-patch"
      onKeyDown={(event) => {
        if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return

        if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return

        if (!(event.target instanceof HTMLButtonElement) || event.target.dataset.slot !== "accordion-trigger") return

        if (event.target.closest('[data-component="accordion"]') !== event.currentTarget) return

        const triggers = [
          ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
            ':scope > [data-slot="accordion-item"] > [data-slot="accordion-header"] > [data-slot="accordion-trigger"]',
          ),
        ]

        const index = triggers.indexOf(event.target)

        if (index < 0) return
        event.preventDefault()

        if (event.key === "Home") return triggers[0]?.focus()

        if (event.key === "End") return triggers.at(-1)?.focus()
        triggers[(index + (event.key === "ArrowDown" ? 1 : -1) + triggers.length) % triggers.length]?.focus()
      }}
    >
      {props.children}
    </div>
  )
}

function FileAccordionItem(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  type?: string
  header: JSX.Element
  children: JSX.Element
  /**
   * Label for the bar under the body. Passing it also caps the body and lets it scroll: a written
   * file can be hundreds of lines, and expanded at full height it pushes the rest of the turn (and
   * the next one) off the screen. The bar only appears once the body actually overflows — a four-line
   * diff does not need a second way to close it.
   */
  collapse?: string
}) {
  const id = createUniqueId()
  const [overflowing, setOverflowing] = createSignal(false)
  const [body, setBody] = createSignal<HTMLDivElement>()

  createEffect(() => {
    const node = body()
    if (!props.open || !props.collapse || !node) return

    const fold = node.closest<HTMLElement>('[data-slot="accordion-fold"]')

    const measure = () => {
      // The pending re-measure below can land after the row closed or unmounted; a body clipped to
      // zero height always looks like an overflow, so refuse to answer in that state.
      if (!node.isConnected || !props.open) return

      setOverflowing(node.scrollHeight > node.clientHeight + 1)
    }

    const sync = () => {
      // While the fold is animating, the body is only as tall as the frame it is growing through, so
      // every card would read as overflowing. Wait for the transition to land — and measure then,
      // because the resize that would have called us again has already fired by the time it settles.
      const running = fold?.getAnimations().filter((animation) => animation.playState === "running") ?? []

      if (running.length === 0) {
        measure()

        return
      }

      void Promise.all(running.map((animation) => animation.finished.catch(() => undefined))).then(measure)
    }

    // The diff renders after the fold opens and keeps growing while a tool streams, so the answer
    // has to be re-measured, not read once.
    const observer = new ResizeObserver(sync)
    observer.observe(node)
    sync()

    onCleanup(() => observer.disconnect())
  })

  return (
    <div
      data-slot="accordion-item"
      data-type={props.type}
      data-expanded={props.open ? "" : undefined}
      data-closed={!props.open ? "" : undefined}
      data-scroll={props.collapse ? "" : undefined}
    >
      <h3
        data-slot="accordion-header"
        data-component="sticky-accordion-header"
        data-expanded={props.open ? "" : undefined}
        data-closed={!props.open ? "" : undefined}
      >
        <button
          type="button"
          id={`${id}-trigger`}
          data-slot="accordion-trigger"
          data-expanded={props.open ? "" : undefined}
          data-closed={!props.open ? "" : undefined}
          aria-expanded={props.open}
          aria-controls={`${id}-content`}
          onClick={() => batch(() => props.onOpenChange(!props.open))}
        >
          {props.header}
        </button>
      </h3>
      {/* The content stays mounted so the fold can animate: `grid-template-rows: 0fr → 1fr` grows and
          shrinks it in flow, which `display: none` (what <Show> gives) cannot. Whatever is expensive
          inside (the diff) is gated by its own `defer` flag, not by this container. */}
      <div
        data-slot="accordion-fold"
        data-expanded={props.open ? "" : undefined}
        data-closed={!props.open ? "" : undefined}
      >
        <div
          id={`${id}-content`}
          role="region"
          aria-labelledby={`${id}-trigger`}
          data-slot="accordion-content"
          data-expanded={props.open ? "" : undefined}
          data-closed={!props.open ? "" : undefined}
        >
          <div data-slot="accordion-body" ref={setBody}>{props.children}</div>
          <Show when={props.collapse && overflowing()}>
            <button type="button" data-slot="accordion-collapse" onClick={() => batch(() => props.onOpenChange(false))}>
              <Icon name="chevron-up" size="small" />
              <span>{props.collapse}</span>
            </button>
          </Show>
        </div>
      </div>
    </div>
  )
}

function fileChangeAction(type: "add" | "update" | "delete" | undefined) {
  if (type === "add") return { key: "ui.patch.action.created" as const, kind: "added" as const }
  if (type === "delete") return { key: "ui.patch.action.deleted" as const, kind: "removed" as const }
  return { key: "ui.patch.action.updated" as const, kind: "modified" as const }
}

function FileChangeTriggerHeader(props: {
  path: string
  type?: "add" | "update" | "delete"
  actions?: JSX.Element
}) {
  const i18n = useI18n()
  const action = () => fileChangeAction(props.type)

  return (
    <div data-slot="apply-patch-trigger-content">
      <div data-slot="apply-patch-file-info">
        <FileIcon node={{ path: props.path, type: "file" }} />
        <span data-slot="apply-patch-change" data-type={action().kind}>
          {i18n.t(action().key)}
        </span>
        <div data-slot="apply-patch-file-name-container">
          <Show when={props.path.includes("/")}>
            <span data-slot="apply-patch-directory">{`\u202A${displayDirectory(props.path)}\u202C`}</span>
          </Show>
          <span data-slot="apply-patch-filename">{getFilename(props.path)}</span>
        </div>
      </div>
      <div data-slot="apply-patch-trigger-actions">
        {props.actions}
        <span data-slot="apply-patch-row-controls">
          <FileRowOpenFile path={props.path} />
          <Icon name="chevron-grabber-vertical" size="small" />
        </span>
      </div>
    </div>
  )
}

function ToolFileAccordion(props: {
  path: string
  type?: "add" | "update" | "delete"
  actions?: JSX.Element
  children: JSX.Element
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  forceOpen?: boolean
  defer?: boolean
}) {
  const [expanded, setExpanded] = createSignal(props.defaultOpen ?? false)
  const [visible, setVisible] = createSignal(false)
  const open = () => props.open ?? expanded()

  const change = (value: boolean) => {
    if (props.open === undefined) setExpanded(value)
    props.onOpenChange?.(value)
  }

  createEffect(() => {
    if (props.forceOpen && !open()) change(true)
  })

  createEffect(() => {
    if (!open()) {
      setVisible(false)

      return
    }

    const frame = requestAnimationFrame(() => setVisible(true))
    onCleanup(() => cancelAnimationFrame(frame))
  })

  return (
    <FileAccordionGroup>
      <FileAccordionItem
        open={open()}
        onOpenChange={change}
        header={<FileChangeTriggerHeader path={props.path} type={props.type} actions={props.actions} />}
      >
        <Show when={!props.defer || visible()}>{props.children}</Show>
      </FileAccordionItem>
    </FileAccordionGroup>
  )
}

export function ToolDisplay(
  props: ToolProps & {
    id: string
    error?: string
  },
) {
  const data = useData()
  const i18n = useI18n()

  if (props.tool === "todowrite") return null
  const hideQuestion = () => props.tool === "question" && (props.status === "streaming" || props.status === "running")

  const taskId = createMemo(() => {
    if (props.tool !== "subagent") return undefined

    return toolMetadata(props.metadata).sessionID || undefined
  })

  const taskHref = createMemo(() => sessionLink(taskId(), data.sessionHref))

  const taskSubtitle = createMemo(() => {
    if (props.tool !== "subagent") return undefined

    return toolInput(props.input).description || taskId()
  })

  const errorSubtitle = createMemo(() => toolErrorSubtitle(props, i18n))
  const error = createMemo(() => toolDisplayError(props, i18n.t("ui.toolErrorCard.failed")))
  const render = createMemo(() => ToolRegistry.render(props.tool) ?? GenericTool)

  return (
    <Show when={!hideQuestion()}>
      <div data-component="tool-part-wrapper" data-timeline-part-id={props.id}>
        <Switch>
          <Match when={error()}>
            {(error) => {
              const cleaned = error().replace("Error: ", "")

              if (props.tool === "question" && cleaned.includes("dismissed this question")) {
                return (
                  <div style="width: 100%; display: flex; justify-content: flex-end;">
                    <span class="text-13-regular text-text-weak cursor-default">
                      {i18n.t("ui.messagePart.questions.dismissed")}
                    </span>
                  </div>
                )
              }

              return (
                <ToolErrorCard
                  tool={props.tool}
                  error={error()}
                  title={
                    props.tool === "websearch"
                      ? webSearchProviderLabel(toolMetadata(props.metadata).provider, i18n)
                      : undefined
                  }
                  defaultOpen={props.defaultOpen}
                  open={props.open}
                  onOpenChange={props.onOpenChange}
                  subtitle={taskSubtitle() ?? errorSubtitle()}
                  href={taskHref()}
                  onSubtitleClick={(event) => {
                    if (!data.navigateToSession) return

                    if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
                    const id = taskId()

                    if (!id) return
                    event.preventDefault()
                    data.navigateToSession(id)
                  }}
                />
              )
            }}
          </Match>
          <Match when={true}>
            <Dynamic component={render()} {...props} />
          </Match>
        </Switch>
      </div>
    </Show>
  )
}

// Each branch must stay in sync with its tool trigger's subtitle expression so
// failed rows read like their non-error counterparts ("Shell sleep 30").
function toolErrorSubtitle(props: ToolProps, i18n: UiI18n) {
  const input = toolInput(props.input)
  const metadata = toolMetadata(props.metadata)

  if (props.tool === "shell") return input.command || metadata.command || undefined

  if (props.tool === "execute") return input.code || undefined

  if (props.tool === "read" || props.tool === "edit" || props.tool === "write") return getFilename(input.path ?? "")

  if (props.tool === "list" || props.tool === "glob" || props.tool === "grep")
    return displayDirectory(input.path || "/")

  if (props.tool === "webfetch") return input.url || undefined

  if (props.tool === "websearch") return input.query || undefined

  if (props.tool === "skill") return skillToolName(input, metadata)

  if (props.tool === "patch") {
    const count = new Set((metadata.files ?? []).flatMap((file) => (changedFileDiff(file) ? [file.file] : []))).size

    if (count === 0) return undefined

    return `${count} ${i18n.plural("ui.common.file", count)}`
  }

  if (props.tool === "question") {
    const count = questions(input).length

    if (count === 0) return undefined

    return `${count} ${i18n.plural("ui.common.question", count)}`
  }

  return undefined
}

function toolDisplayError(props: ToolProps & { error?: string }, fallback: string) {
  if (props.status === "error") return props.error

  if (props.tool !== "execute") return undefined

  if (!executeToolFailed(props.metadata)) return undefined

  return props.output || fallback
}

ToolRegistry.register({
  name: "read",
  render(props) {
    const data = useData()
    const i18n = useI18n()
    const image = createMemo(() => (props.status === "completed" ? readImagePath(props.input) : undefined))

    const loaded = createMemo(() => {
      if (props.status !== "completed") return []

      return (toolMetadata(props.metadata).loaded ?? []).flatMap((path) => Option.toArray(decodeString(path)))
    })

    const paths = createMemo(() =>
      loaded().map((filepath) => {
        const relative = relativizeProjectPath(filepath, data.directory)

        return relative === filepath ? relative : relative.replace(/^[/\\]/, "")
      }),
    )

    const marker = "__OPENCODE_LOADED_PATH__"
    const parts = createMemo(() => i18n.t("ui.tool.loadedFile", { path: marker }).split(marker))

    const path = () => toolInput(props.input).path ?? ""
    // One token, in path order: "session-status.tsx · packages/app/src/components/" read backwards
    // and repeated the whole path again on the Loaded line underneath.
    const display = createMemo(() => readDisplayPath(path(), data.directory))
    // A plain read lists itself under Loaded; only extra files (instructions, imports) add a line.
    const extraLoaded = createMemo(() => paths().filter((filepath) => filepath !== display()))

    return (
      <>
        <BasicTool
          {...props}
          icon="glasses"
          hasContent={!!image()}
          defer
          onOpenChange={(open) => {
            props.onOpenChange?.(open)
            props.onContentRendered?.()
          }}
          trigger={{
            title: i18n.t("ui.tool.read"),
            subtitle: display(),
            subtitleClass: "tool-path",
            args: readArgs(toolInput(props.input)),
          }}
        >
          <Show when={image()} keyed>
            {(path) => <ReadImage path={path} onContentRendered={props.onContentRendered} />}
          </Show>
        </BasicTool>
        <Show when={extraLoaded().length > 0}>
          <div
            data-component="tool-loaded-item"
            aria-label={i18n.t("ui.tool.loadedFile", { path: extraLoaded().join(", ") })}
          >
            <span data-slot="tool-loaded-label" aria-hidden="true">
              {parts()[0]?.trim()}
            </span>
            <span data-slot="tool-loaded-value" aria-hidden="true">
              {extraLoaded().join(", ")}
            </span>
            <Show when={parts()[1]?.trim()}>
              {(suffix) => (
                <span data-slot="tool-loaded-kind" aria-hidden="true">
                  {suffix()}
                </span>
              )}
            </Show>
          </div>
        </Show>
      </>
    )
  },
})

function ReadImage(props: { path: string; onContentRendered?: () => void }) {
  const markdown = useMarkdown()
  const previewImages = createImagePreview()
  let root!: HTMLDivElement
  createEffect(() => {
    previewImages(root)

    if (!markdown?.readImage) return
    const images = createMarkdownImages(markdown.readImage)
    images.update(root)
    onCleanup(() => images.dispose())
  })
  onMount(() => props.onContentRendered?.())

  return (
    <div ref={root} data-component="read-image">
      <img
        data-local-image={props.path}
        alt={getFilename(props.path)}
        onLoad={() => props.onContentRendered?.()}
        onError={() => props.onContentRendered?.()}
      />
    </div>
  )
}

ToolRegistry.register({
  name: "list",
  render(props) {
    const i18n = useI18n()

    return (
      <BasicTool
        {...props}
        icon="bullet-list"
        hasContent={!!props.output}
        trigger={{
          title: i18n.t("ui.tool.list"),
          subtitle: displayDirectory(toolInput(props.input).path ?? "/"),
        }}
      >
        <Show when={props.output}>
          <div
            data-component="tool-output"
            data-scrollable
            tabIndex={0}
            role="region"
            aria-label={i18n.t("ui.scrollView.ariaLabel")}
          >
            <Markdown text={props.output!} />
          </div>
        </Show>
      </BasicTool>
    )
  },
})

ToolRegistry.register({
  name: "glob",
  render(props) {
    const i18n = useI18n()
    const input = createMemo(() => toolInput(props.input))
    const path = createMemo(() => displayDirectory(input().path ?? "/"))

    return (
      <BasicTool
        {...props}
        icon="magnifying-glass-menu"
        hasContent={!!props.output}
        trigger={{
          title: i18n.t("ui.tool.glob"),
          subtitle: input().pattern,
          args: path() ? [`· ${path()}`] : [],
        }}
      >
        <Show when={props.output}>
          <div
            data-component="tool-output"
            data-scrollable
            tabIndex={0}
            role="region"
            aria-label={i18n.t("ui.scrollView.ariaLabel")}
          >
            <Markdown text={props.output!} />
          </div>
        </Show>
      </BasicTool>
    )
  },
})

ToolRegistry.register({
  name: "grep",
  render(props) {
    const i18n = useI18n()
    const input = createMemo(() => toolInput(props.input))
    const path = createMemo(() => displayDirectory(input().path ?? "/"))

    const args = () => [
      ...(path() ? [`· ${path()}`] : []),
      ...(input().include === undefined ? [] : ["include=" + input().include]),
    ]

    return (
      <BasicTool
        {...props}
        icon="magnifying-glass-menu"
        hasContent={!!props.output}
        trigger={{
          title: i18n.t("ui.tool.grep"),
          subtitle: input().pattern ? `"${input().pattern}"` : undefined,
          args: args(),
        }}
      >
        <Show when={props.output}>
          <div
            data-component="tool-output"
            data-scrollable
            tabIndex={0}
            role="region"
            aria-label={i18n.t("ui.scrollView.ariaLabel")}
          >
            <Markdown text={props.output!} />
          </div>
        </Show>
      </BasicTool>
    )
  },
})

ToolRegistry.register({
  name: "webfetch",
  render(props) {
    const i18n = useI18n()
    const pending = createMemo(() => props.status === "streaming" || props.status === "running")

    const url = createMemo(() => toolInput(props.input).url ?? "")

    return (
      <BasicTool
        {...props}
        hideDetails
        icon="window-cursor"
        trigger={
          <div data-slot="basic-tool-tool-info-structured">
            <div data-slot="basic-tool-tool-info-main">
              <span data-slot="basic-tool-tool-title">
                <TextShimmer text={i18n.t("ui.tool.webfetch")} active={pending()} />
              </span>
              <Show when={props.status !== "streaming" && url()}>
                <a
                  data-slot="basic-tool-tool-subtitle"
                  class="webfetch-link"
                  href={url()}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(event) => event.stopPropagation()}
                >
                  <span data-slot="webfetch-link-text">{url()}</span>
                  <Icon name="outline-square-arrow" class="webfetch-link-icon" />
                </a>
              </Show>
            </div>
          </div>
        }
      />
    )
  },
})

ToolRegistry.register({
  name: "websearch",
  render(props) {
    const i18n = useI18n()

    const query = createMemo(() => toolInput(props.input).query ?? "")

    const title = createMemo(() => webSearchProviderLabel(toolMetadata(props.metadata).provider, i18n))

    return (
      <BasicTool
        {...props}
        icon="window-cursor"
        trigger={{
          title: title(),
          subtitle: query(),
          subtitleClass: "exa-tool-query",
        }}
      >
        <ExaOutput output={props.output} />
      </BasicTool>
    )
  },
})

ToolRegistry.register({
  name: "subagent",
  render(props) {
    const data = useData()
    const i18n = useI18n()
    const delegating = () => props.status === "streaming"

    const input = createMemo(() => toolInput(props.input))
    const metadata = createMemo(() => toolMetadata(props.metadata))

    const childSessionId = createMemo(
      () => metadata().sessionID || taskSession(input().description, data.sessionID, data.store.session),
    )

    const agent = createMemo(() => taskAgent(input().agent, data.store.agent))
    const title = createMemo(() => agent().name ?? i18n.t("ui.tool.agent.default"))
    const tone = createMemo(() => agent().color)
    const v2Tone = createMemo(() => agent().v2Color)

    const background = createMemo(() => {
      return metadata().background === true || (props.status === "completed" && metadata().status === "running")
    })

    const subtitle = createMemo(() => {
      const value = input().description || childSessionId()

      if (!value) return value

      if (background()) return `${value} (background)`

      return value
    })

    const running = createMemo(() => {
      if (props.status === "streaming" || props.status === "running") return true
      const id = childSessionId()

      if (!id) return false

      return (data.store.session_status[id]?.type ?? "idle") !== "idle"
    })

    const href = createMemo(() => sessionLink(childSessionId(), data.sessionHref))
    const clickable = createMemo(() => !!(childSessionId() && (data.navigateToSession || href())))

    const open = () => {
      const id = childSessionId()

      if (!id) return
      data.navigateToSession?.(id)
    }

    const navigate = (event: MouseEvent) => {
      if (!data.navigateToSession) return

      if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      event.preventDefault()
      open()
    }

    const navigateKey = (event: KeyboardEvent) => {
      if (!clickable() || href()) return

      if (event.key !== "Enter" && event.key !== " ") return
      event.preventDefault()
      open()
    }

    const trigger = () => (
      <div
        data-component="task-tool-card"
        style={{
          "--task-agent-color": v2Tone(),
          "--task-agent-color-fallback": tone(),
        }}
      >
        <div data-component="task-tool-surface">
          <div data-slot="basic-tool-tool-info-structured">
            <div data-slot="basic-tool-tool-info-main">
              <Show
                when={running()}
                fallback={
                  <span data-component="task-tool-icon">
                    <Icon name="subagent" size="normal" />
                  </span>
                }
              >
                <span data-component="task-tool-spinner" style={{ color: tone() ?? "var(--icon-interactive-base)" }}>
                  <SessionProgressIndicatorV2
                    style={{ color: v2Tone() ?? "light-dark(var(--v2-text-text-base), #ffffff)" }}
                  />
                </span>
              </Show>
              <span data-component="task-tool-title">{title()}</span>
              <Show when={subtitle()}>
                <span data-slot="basic-tool-tool-subtitle">{subtitle()}</span>
              </Show>
            </div>
            <Show when={clickable()}>
              <div data-component="task-tool-action">
                <Icon name="chevron-right" size="normal" />
              </div>
            </Show>
          </div>
        </div>
      </div>
    )

    return (
      <Show
        when={delegating()}
        fallback={
          <BasicTool
            icon="task"
            status={props.status}
            trigger={trigger()}
            hideDetails
            triggerAsLink
            triggerHref={href()}
            clickable={clickable()}
            onTriggerClick={navigate}
            onTriggerKeyDown={navigateKey}
          />
        }
      >
        <div
          data-component="task-tool-delegating"
          class="flex h-9 w-fit max-w-full items-center gap-2 rounded-[8px] bg-v2-background-bg-layer-02 p-2.5 text-[13px] font-[530] leading-text-compact tracking-[-0.04px]"
        >
          <Icon name="subagent" size="normal" class="shrink-0 text-v2-icon-icon-faint" />
          <TextShimmer text={i18n.t("ui.tool.agent.delegating")} class="min-w-0 truncate" />
        </div>
      </Show>
    )
  },
})

function ConsoleOutput(props: { copy: string; children: JSX.Element; variant?: "shell" }) {
  const i18n = useI18n()
  const [copied, setCopied] = createSignal(false)

  const copy = async () => {
    if (!props.copy) return

    if (!(await writeClipboard(props.copy))) return
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div data-component="bash-output" data-variant={props.variant} dir="ltr">
      <div data-slot="bash-copy">
        <Tooltip value={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copy")} placement="top">
          <IconButton
            icon={<Icon name={copied() ? "check" : "outline-copy"} size="small" />}
            size="normal"
            variant="ghost-muted"
            onMouseDown={(event) => event.preventDefault()}
            onClick={copy}
            aria-label={copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copy")}
          />
        </Tooltip>
      </div>
      <div
        data-slot="bash-scroll"
        data-scrollable
        tabIndex={0}
        role="region"
        aria-label={i18n.t("ui.scrollView.ariaLabel")}
      >
        <pre data-slot="bash-pre">
          <code>{props.children}</code>
        </pre>
      </div>
    </div>
  )
}

ToolRegistry.register({
  name: "execute",
  render(props) {
    const i18n = useI18n()
    const pending = () => props.status === "streaming" || props.status === "running"
    const code = createMemo(() => toolInput(props.input).code ?? "")
    const output = () => stripAnsi(props.output ?? "").replace(/\r\n?/g, "\n")
    const sawPending = pending()

    return (
      <BasicTool
        {...props}
        icon="console"
        rail={false}
        hasContent
        compact
        allowOpenWhilePending
        trigger={(open) => (
          <div data-slot="basic-tool-tool-info-structured">
            <div data-slot="basic-tool-tool-info-main">
              <span data-slot="basic-tool-tool-title">
                <TextShimmer text={i18n.t("ui.tool.execute")} active={pending()} />
              </span>
              <Show when={!open() && code()}>
                <ShellSubmessage text={code().split("\n", 1)[0]} animate={sawPending} />
              </Show>
            </div>
          </div>
        )}
      >
        <ConsoleOutput copy={code()} variant="shell">
          <span data-slot="bash-command">{code()}</span>
          <Show when={output()}>{(value) => <span data-slot="bash-result">{value()}</span>}</Show>
        </ConsoleOutput>
      </BasicTool>
    )
  },
})

ToolRegistry.register({
  name: "shell",
  render(props) {
    const i18n = useI18n()
    const data = useData()
    const streaming = () => props.status === "streaming"
    const metadata = createMemo(() => toolMetadata(props.metadata))

    const pending = () => {
      const id = metadata().shellID

      return streaming() || props.status === "running" || (id !== undefined && data.shellRunning?.(id) === true)
    }

    const sawStreaming = streaming()
    const command = createMemo(() => toolInput(props.input).command ?? metadata().command ?? "")

    function Output() {
      const [streamed, setStreamed] = createSignal("")

      // Direct-user terminal snapshots are authoritative; agent results can describe background shells.
      const saved = createMemo(() =>
        metadata().status === "exited" || metadata().status === "timeout" || metadata().status === "killed"
          ? props.output
          : undefined,
      )

      createEffect(() => {
        if (saved() !== undefined) return
        const id = metadata().shellID
        const load = data.shellOutput

        if (id === undefined || !load) return
        onCleanup(followShellOutput({ id, directory: data.directory, running: pending(), load, onOutput: setStreamed }))
      })

      const output = createMemo(() =>
        stripAnsi(saved() ?? ((metadata().shellID !== undefined && streamed()) || props.output || "")).replace(
          /\r\n?/g,
          "\n",
        ),
      )

      return (
        <ConsoleOutput copy={command()} variant="shell">
          <span data-slot="bash-command">{command()}</span>
          <Show when={output()}>{(value) => <span data-slot="bash-result">{value()}</span>}</Show>
        </ConsoleOutput>
      )
    }

    return (
      <BasicTool
        {...props}
        icon="console"
        rail={false}
        hasContent
        compact
        allowOpenWhilePending
        trigger={(open) => (
          <div data-slot="basic-tool-tool-info-structured">
            <div data-slot="basic-tool-tool-info-main">
              <span data-slot="basic-tool-tool-title">
                <TextShimmer text={i18n.t("ui.tool.shell")} active={pending()} />
              </span>
              <Show when={!open()}>
                <Show
                  when={command()}
                  fallback={
                    <Show when={streaming()}>
                      <span data-slot="basic-tool-tool-subtitle">{i18n.t("ui.tool.shell.writingCommand")}</span>
                    </Show>
                  }
                >
                  {(command) => <ShellSubmessage text={command()} animate={sawStreaming} />}
                </Show>
              </Show>
            </div>
          </div>
        )}
      >
        <Output />
      </BasicTool>
    )
  },
})

export function SessionShellMessage(props: {
  message: SessionMessageShell
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const i18n = useI18n()
  const render = ToolRegistry.render("shell") ?? GenericTool

  const error = createMemo(() => {
    const message = props.message

    if (message.status === "timeout") return i18n.t("ui.tool.shell.timeout")

    if (message.status === "killed") return i18n.t("ui.tool.shell.cancelled")

    if (message.status !== "exited" || message.exit === undefined || message.exit === 0) return

    return i18n.t("ui.tool.shell.exit", { code: message.exit })
  })

  return (
    <div data-component="session-shell-message" data-timeline-part-id={props.message.id}>
      <Dynamic
        component={render}
        tool="shell"
        input={{ command: props.message.command }}
        metadata={{
          shellID: props.message.shellID,
          status: props.message.status,
          exit: props.message.exit,
          truncated: props.message.output?.truncated,
        }}
        output={props.message.output?.output}
        status={props.message.status === "running" ? "running" : "completed"}
        defaultOpen={props.defaultOpen}
        open={props.open}
        onOpenChange={props.onOpenChange}
      />
      <Show when={error()}>
        {(error) => <ToolErrorCard tool="shell" error={error()} subtitle={props.message.command} />}
      </Show>
    </div>
  )
}

ToolRegistry.register({
  name: "edit",
  render(props) {
    const i18n = useI18n()
    const fileComponent = useFileComponent()
    const input = createMemo(() => toolInput(props.input))
    const metadata = createMemo(() => toolMetadata(props.metadata))
    const inputPath = () => input().path ?? ""
    const diff = createMemo(() => metadata().files?.find(changedFileDiff))
    const diagnostics = createMemo(() => getDiagnostics(metadata().diagnostics, inputPath()))
    const path = createMemo(() => diff()?.file ?? inputPath())

    const pending = () => props.status === "streaming" || props.status === "running"

    // While the model is still typing the edit, the counts come from the arguments it has written; the
    // completion metadata only exists afterwards, which is why a running row showed no numbers at all.
    const changes = createMemo(() => (pending() ? streamedLineChanges(input()) : diff()))

    const diffSource = createMemo(
      () => {
        const source = diff()

        if (!source) return undefined

        return { file: source.file, patch: source.patch }
      },
      undefined,
      {
        equals: (a, b) => a?.file === b?.file && a?.patch === b?.patch,
      },
    )

    const fileCompProps = createMemo(() => {
      try {
        const source = diffSource()

        if (source) {
          const fileDiff = resolveFileDiff(source)

          if (fileDiff) return { fileDiff, hunkSeparators: fileDiff.isPartial ? "simple" : "line-info-basic" }
        }
      } catch {}

      return {
        before: {
          name: path(),
          contents: input().oldString ?? "",
        },
        after: {
          name: path(),
          contents: input().newString ?? "",
        },
      }
    })

    return (
      <div data-component="edit-tool">
        <FileTool {...props} title={i18n.t("ui.messagePart.title.edit")} count={path() ? 1 : 0}>
          <Show when={path()}>
            <ToolFileAccordion
              path={path()}
              type={diff()?.status === "added" ? "add" : diff()?.status === "deleted" ? "delete" : "update"}
              defaultOpen={props.defaultOpen}
              open={props.open}
              onOpenChange={props.onOpenChange}
              forceOpen={props.forceOpen}
              defer={props.deferContent !== false}
              actions={
                <Show when={changes()}>
                  {(changes) => <DiffChanges appearance="standard" changes={changes()} />}
                </Show>
              }
            >
              <div data-component="edit-content">
                <Dynamic
                  component={fileComponent}
                  mode="diff"
                  virtualize={props.virtualizeDiff}
                  onRendered={props.onContentRendered}
                  {...fileCompProps()}
                />
              </div>
            </ToolFileAccordion>
          </Show>
          <DiagnosticsDisplay diagnostics={diagnostics()} />
        </FileTool>
      </div>
    )
  },
})

ToolRegistry.register({
  name: "write",
  render(props) {
    const fileComponent = useFileComponent()
    const input = createMemo(() => toolInput(props.input))
    const path = createMemo(() => input().path ?? "")
    const content = createMemo(() => input().content ?? "")
    const diagnostics = createMemo(() => getDiagnostics(toolMetadata(props.metadata).diagnostics, path()))
    const pending = () => props.status === "streaming" || props.status === "running"
    // Same live count as `edit`: the file being written grows while the model types it.
    const changes = createMemo(() =>
      pending() ? streamedLineChanges(input()) : toolMetadata(props.metadata).files?.find(changedFileDiff),
    )

    return (
      <div data-component="write-tool">
        <Show when={content() && path()}>
          <ToolFileAccordion
            path={path()}
            type="add"
            defaultOpen={props.defaultOpen}
            open={props.open}
            onOpenChange={props.onOpenChange}
            forceOpen={props.forceOpen}
            defer={props.deferContent !== false}
            actions={
              <Show when={changes()}>
                {(changes) => <DiffChanges appearance="standard" changes={changes()} />}
              </Show>
            }
          >
            <div data-component="write-content">
              <Dynamic
                component={fileComponent}
                mode="text"
                file={{
                  name: path(),
                  contents: content(),
                  cacheKey: checksum(content()),
                }}
                overflow="scroll"
                onRendered={props.onContentRendered}
              />
            </div>
          </ToolFileAccordion>
        </Show>
        <DiagnosticsDisplay diagnostics={diagnostics()} />
      </div>
    )
  },
})

ToolRegistry.register({
  name: "patch",
  render(props) {
    const i18n = useI18n()
    const fileComponent = useFileComponent()

    const files = createMemo(
      () =>
        props.pendingFiles?.map((path) => ({
          path,
          type: "update" as const,
          additions: 0,
          deletions: 0,
          views: [],
        })) ?? patchFileGroups(props.metadata.files),
    )

    const [expanded, setExpanded] = createSignal<string[]>([])

    const title = createMemo(() => {
      if (props.tool === "edit") return i18n.t("ui.messagePart.title.edit")

      if (props.tool === "write") return i18n.t("ui.messagePart.title.write")

      return i18n.t("ui.tool.patch")
    })

    const open = createMemo(() => {
      if (!props.fileOpen) return expanded()

      return files().flatMap((file) => (props.fileOpen?.(file.path) === true ? [file.path] : []))
    })

    const change = (value: string | string[]) => {
      const next = Array.isArray(value) ? value : value ? [value] : []

      if (!props.onFileOpenChange) {
        setExpanded(next)

        return
      }

      files().forEach((file) => props.onFileOpenChange?.(file.path, next.includes(file.path)))
    }

    return (
      <div data-component="apply-patch-tool">
        <Show when={files().length > 0} fallback={<FileTool {...props} title={title()} count={0} />}>
          <FileAccordionGroup>
            <Index each={files()}>
              {(file) => {
                const value = () => file().path
                const active = createMemo(() => open().includes(value()))
                const [visible, setVisible] = createSignal(false)

                createEffect(() => {
                  if (!active()) {
                    setVisible(false)

                    return
                  }

                  requestAnimationFrame(() => {
                    if (!active()) return
                    setVisible(true)
                  })
                })

                return (
                  <FileAccordionItem
                    open={active()}
                    onOpenChange={(expanded) =>
                      change(expanded ? [...open(), value()] : open().filter((path) => path !== value()))
                    }
                    type={file().type}
                    collapse={i18n.t("ui.patch.collapse")}
                    header={
                      <FileChangeTriggerHeader
                        path={file().path}
                        type={file().type}
                        actions={
                          <DiffChanges
                            appearance="standard"
                            changes={{ additions: file().additions, deletions: file().deletions }}
                          />
                        }
                      />
                    }
                  >
                    <Show when={props.deferContent === false || visible()}>
                      <For each={file().views}>
                        {(view) => (
                          <div data-component="apply-patch-file-diff">
                            <Dynamic
                              component={fileComponent}
                              mode="diff"
                              virtualize={props.virtualizeDiff}
                              fileDiff={view.fileDiff}
                              hunkSeparators={view.fileDiff.isPartial ? "simple" : "line-info-basic"}
                              onRendered={props.onContentRendered}
                            />
                          </div>
                        )}
                      </For>
                    </Show>
                  </FileAccordionItem>
                )
              }}
            </Index>
          </FileAccordionGroup>
        </Show>
      </div>
    )
  },
})

ToolRegistry.register({
  name: "question",
  render(props) {
    const i18n = useI18n()

    const items = createMemo(() => questions(toolInput(props.input)))

    const answers = createMemo(() =>
      (toolMetadata(props.metadata).answers ?? []).flatMap((answer) => Option.toArray(decodeAnswer(answer))),
    )

    const completed = createMemo(() => answers().length > 0)

    const subtitle = createMemo(() => {
      const count = items().length

      if (count === 0) return ""

      if (completed()) return i18n.t("ui.question.subtitle.answered", { count })

      return `${count} ${i18n.plural("ui.common.question", count)}`
    })

    return (
      <BasicTool
        {...props}
        defaultOpen={completed()}
        icon="check"
        trigger={{
          title: i18n.t("ui.tool.questions"),
          subtitle: subtitle(),
        }}
      >
        <Show when={completed()}>
          <div data-component="question-answers">
            <For each={items()}>
              {(q, i) => {
                const answer = () => answers()[i()] ?? []

                // SiCode: rows mirror the process-shell chain language — a 19px glyph column
                // (help = question in faint, check = answer in success) aligned with the parent
                // row's icon column, instead of plain stacked text.
                return (
                  <div data-slot="question-answer-item">
                    <div data-slot="question-row">
                      <span data-slot="question-glyph">
                        <Icon name="help" size="small" />
                      </span>
                      <span data-slot="question-text">{q.question}</span>
                    </div>
                    <div data-slot="answer-row">
                      <span data-slot="answer-glyph">
                        <Icon name="check" size="small" />
                      </span>
                      <span data-slot="answer-text">{answer().join(", ") || i18n.t("ui.question.answer.none")}</span>
                    </div>
                  </div>
                )
              }}
            </For>
          </div>
        </Show>
      </BasicTool>
    )
  },
})

ToolRegistry.register({
  name: "skill",
  render(props) {
    const i18n = useI18n()
    const name = createMemo(() => skillToolName(toolInput(props.input), toolMetadata(props.metadata)))
    const running = createMemo(() => props.status === "streaming" || props.status === "running")
    const marker = "__OPENCODE_LOADED_SKILL__"
    const parts = createMemo(() => i18n.t("ui.tool.loadedSkill", { name: marker }).split(marker))

    return (
      <Show when={name()} fallback={<TextShimmer text={i18n.t("ui.tool.skill")} active={running()} />}>
        {(name) => (
          <div data-component="tool-loaded-item" aria-label={i18n.t("ui.tool.loadedSkill", { name: name() })}>
            <span data-slot="tool-loaded-label" aria-hidden="true">
              {parts()[0].trim()}
            </span>
            <span data-slot="tool-loaded-value" aria-hidden="true">
              <TextShimmer as="span" text={name()} active={running()} />
            </span>
            <Show when={parts()[1]?.trim()}>
              {(suffix) => (
                <span data-slot="tool-loaded-kind" aria-hidden="true">
                  {suffix()}
                </span>
              )}
            </Show>
          </div>
        )}
      </Show>
    )
  },
})
