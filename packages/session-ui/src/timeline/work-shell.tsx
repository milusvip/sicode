import { createEffect, createMemo, createSignal, onCleanup, Match, Show, Switch, type JSX } from "solid-js"
import { Predicate } from "effect"
import { Icon } from "@opencode/ui/icon"
import { useI18n } from "@opencode/ui/context/i18n"
import { SessionProgressIndicatorV2 } from "../v2/components/session-progress-indicator-v2"
import { TimelineRow } from "./timeline-row"
import "./work-shell.css"

export type WorkShellStatus = TimelineRow.WorkShell["status"]

export function workShellDisclosureKey(userMessageID: string) {
  return `work:${userMessageID}`
}

/**
 * The overview bars behave as an accordion: opening one turn closes every other turn's bar, so the
 * transcript never carries two open work spans and only one bar can be pinned to the top.
 *
 * Closing is written explicitly instead of being inferred from a "current" id because a live turn is
 * open by default (`workShellDefaultOpen`) without anything stored for it — an implicit default would
 * survive the switch and leave two bars open.
 */
type WorkShellDisclosure = {
  value: (key: string) => boolean | undefined
  set: (key: string, open: boolean | undefined) => void
  /** Keys the accordion closed while opening another bar — restore only these, never a manual close. */
  accordionClosed?: Set<string>
}

export function openWorkShellOnly(
  rows: readonly TimelineRow.TimelineRow[],
  disclosure: WorkShellDisclosure,
  keep: string,
) {
  for (const row of rows) {
    if (!Predicate.isTagged(row, "WorkShell")) continue
    if (row.userMessageID === keep) continue

    const key = workShellDisclosureKey(row.userMessageID)
    // Only mark siblings that were actually open; a user-collapsed live turn must stay collapsed
    // after the reader peeks at history and closes it again.
    const wasOpen = disclosure.value(key) ?? workShellDefaultOpen(row.status)
    disclosure.set(key, false)
    if (wasOpen) disclosure.accordionClosed?.add(key)
  }
}

/**
 * After closing one overview bar, drop accordion-forced `false` on siblings that should be open by
 * default (live / failed / disconnected). Manual collapses are left alone — they never enter
 * `accordionClosed`.
 */
export function restoreDefaultOpenWorkShells(
  rows: readonly TimelineRow.TimelineRow[],
  disclosure: WorkShellDisclosure,
  except: string,
) {
  for (const row of rows) {
    if (!Predicate.isTagged(row, "WorkShell")) continue
    if (row.userMessageID === except) continue
    if (!workShellDefaultOpen(row.status)) continue
    const key = workShellDisclosureKey(row.userMessageID)
    if (disclosure.accordionClosed && !disclosure.accordionClosed.has(key)) continue
    if (disclosure.value(key) !== false) continue
    disclosure.set(key, undefined)
    disclosure.accordionClosed?.delete(key)
  }
}

/**
 * Default expand for the overview bar:
 * - working / disconnected: open so the live chain stays reachable
 * - error / failed (失败): open, because the collapsed head is the only place a failure would show
 * - done / interrupted: collapsed (head still shows status; markers stay via filter)
 */
export function workShellDefaultOpen(status: WorkShellStatus) {
  return status === "running" || status === "disconnected" || status === "error" || status === "failed"
}

/** Outcome markers that must stay visible even when the work shell is collapsed. */
function isWorkShellOutcome(row: TimelineRow.TimelineRow) {
  return (
    Predicate.isTagged(row, "TurnDivider") ||
    Predicate.isTagged(row, "Error") ||
    Predicate.isTagged(row, "Retry")
  )
}

function isWorkShellProse(row: TimelineRow.TimelineRow) {
  return Predicate.isTagged(row, "AssistantPart") && row.group.type === "part" && /text:\d+$/.test(row.group.key)
}

/** Question tools are projected as `part:question:…` so collapse can keep them without a content lookup. */
function isWorkShellQuestion(row: TimelineRow.TimelineRow) {
  return Predicate.isTagged(row, "AssistantPart") && row.group.type === "part" && row.group.key.startsWith("part:question:")
}

/**
 * Prose a collapsed turn still shows: the last continuous text run of each segment. A `question`
 * is a hard segment boundary — the framing before it stays (users need it to read the Q), and only
 * the trailing answer of the post-question segment survives. Tool narration inside a segment still
 * folds: earlier runs in the same segment disappear with the tools.
 *
 * The last run, not "text after the last tool", because a turn often answers and *then* runs one
 * more tool (a todo write, a verification command) — the answer would be before the last tool and
 * would disappear.
 */
function trailingProseIndexes(rows: readonly TimelineRow.TimelineRow[]) {
  const keep = new Set<number>()
  const segmentTrailing = new Map<string, number[]>()
  let current: { turn: string; indexes: number[] } | undefined

  const sealRun = () => {
    if (!current) return
    segmentTrailing.set(current.turn, current.indexes)
    current = undefined
  }

  const sealSegment = (turn: string) => {
    sealRun()
    const indexes = segmentTrailing.get(turn)
    if (!indexes) return
    for (const index of indexes) keep.add(index)
    segmentTrailing.delete(turn)
  }

  rows.forEach((row, index) => {
    if (isWorkShellProse(row) && row.userMessageID) {
      if (current?.turn === row.userMessageID) {
        current.indexes.push(index)
        return
      }
      sealRun()
      current = { turn: row.userMessageID, indexes: [index] }
      return
    }

    // Question closes the pre-Q segment so its framing prose is committed, then opens a fresh one.
    if (isWorkShellQuestion(row) && row.userMessageID) {
      sealSegment(row.userMessageID)
      return
    }

    sealRun()
  })

  sealRun()
  for (const turn of [...segmentTrailing.keys()]) sealSegment(turn)

  return keep
}

/** Drop members of collapsed work shells; keep the head so status stays visible. */
export function filterCollapsedWorkShellRows(
  rows: readonly TimelineRow.TimelineRow[],
  open: (userMessageID: string, status: WorkShellStatus) => boolean,
) {
  const result: TimelineRow.TimelineRow[] = []
  const answers = trailingProseIndexes(rows)
  let hiding: string | undefined

  for (const [index, row] of rows.entries()) {
    if (Predicate.isTagged(row, "WorkShell")) {
      const expanded = open(row.userMessageID, row.status)
      result.push(row)
      hiding = expanded ? undefined : row.userMessageID
      continue
    }

    if (Predicate.isTagged(row, "WorkShellEnd")) {
      if (hiding === row.userMessageID) hiding = undefined
      continue
    }

    const member = hiding !== undefined && row.userMessageID === hiding
    // Question UI stays in the overview — it is the ask the turn paused on, not tool chrome.
    if (member && isWorkShellQuestion(row)) {
      result.push(row)
      continue
    }
    // Closing / pre-question framing survives the fold; earlier narration goes with the tools.
    if (member && isWorkShellProse(row)) {
      if (answers.has(index)) result.push(row)
      continue
    }

    // 已中断 / errors / retries stay in the overview when the body is tucked away.
    if (member && !isWorkShellOutcome(row)) continue
    result.push(row)
  }

  return result
}

/**
 * Compact duration for the head/meta column. Returns nothing below one second: a single read or
 * grep rounds to "0s", and five of those in a row read as broken rather than fast.
 */
export function formatElapsed(ms: number): string | undefined {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 1) return undefined
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    const rest = seconds % 60
    // "19m 0s" wastes the meta column; a whole minute is just "19m".
    return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`
  }
  // Long spans used to print as "951407m" when a resumed session kept a stale running timer.
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    const rest = minutes % 60
    return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
  }
  const days = Math.floor(hours / 24)
  const rest = hours % 24
  return rest === 0 ? `${days}d` : `${days}d ${rest}h`
}

/** Span from earliest tool start to latest completion (or now while pending). */
export function toolSpanElapsed(
  tools: readonly { time: { created: number; ran?: number; completed?: number } }[],
  pending: boolean,
  now = Date.now(),
) {
  if (tools.length === 0) return undefined
  const start = Math.min(...tools.map((tool) => tool.time.ran ?? tool.time.created))
  const end = Math.max(
    ...tools.map((tool) => tool.time.completed ?? (pending ? now : (tool.time.ran ?? tool.time.created))),
  )
  return formatElapsed(Math.max(0, end - start))
}

function statusLabel(i18n: ReturnType<typeof useI18n>, status: WorkShellStatus) {
  switch (status) {
    case "running":
      return i18n.t("ui.workShell.status.running")
    case "disconnected":
      return i18n.t("ui.workShell.status.disconnected")
    case "interrupted":
      return i18n.t("ui.workShell.status.interrupted")
    case "error":
      return i18n.t("ui.workShell.status.error")
    case "failed":
      return i18n.t("ui.workShell.status.failed")
    case "done":
      return i18n.t("ui.workShell.status.done")
  }
}

function StatusIcon(props: { status: WorkShellStatus }) {
  return (
    <Switch>
      <Match when={props.status === "running"}>
        <SessionProgressIndicatorV2 width={13} height={13} />
      </Match>
      <Match when={props.status === "done"}>
        <Icon name="circle-check" size="small" />
      </Match>
      <Match when={props.status === "interrupted"}>
        <Icon name="close" size="small" />
      </Match>
      <Match when={props.status === "disconnected"}>
        <Icon name="circle-xmark" size="small" />
      </Match>
      {/* error and failed share the warning shape; the colour separates a dead turn from a bad tool. */}
      <Match when={props.status === "error" || props.status === "failed"}>
        <Icon name="outline-hexagonal-warning" size="small" />
      </Match>
    </Switch>
  )
}

/** A settled turn with tools but no prose reads like a broken transcript; the head says so. */
export function workShellSilent(status: WorkShellStatus, hasReply: boolean) {
  return !hasReply && status !== "running" && status !== "disconnected"
}

export function WorkShellHead(props: {
  status: WorkShellStatus
  startedAt: number
  endedAt?: number
  toolCount: number
  failedCount: number
  hasReply: boolean
  open: boolean
  onToggle: () => void
  class?: string
  trailing?: JSX.Element
}) {
  const i18n = useI18n()
  const [now, setNow] = createSignal(Date.now())

  // Disconnected is still a live turn from the reader's seat — keep the clock moving until reconnect
  // or settlement, otherwise the meta column blanks the moment the socket drops.
  const liveClock = () =>
    props.endedAt === undefined && (props.status === "running" || props.status === "disconnected")

  createEffect(() => {
    if (!liveClock()) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => window.clearInterval(id))
  })

  const elapsed = createMemo(() => {
    const end = props.endedAt ?? (liveClock() ? now() : props.startedAt)
    return formatElapsed(end - props.startedAt)
  })

  // A settled turn with tools but no prose reads like a broken transcript; say so instead. While the
  // turn is still running, no text just means the model has not written anything yet.
  const silent = createMemo(() => workShellSilent(props.status, props.hasReply))

  const title = createMemo(() => {
    // Demo head reads "Completed 13 tools": the count is the only signal a collapsed shell carries.
    if (props.status === "done" && props.toolCount > 0) {
      // A turn that answered still keeps its green check — the answer is what the reader came for —
      // but a failed tool that the delivered answer never mentions has to stay countable, or a
      // collapsed shell silently claims a clean run.
      if (props.failedCount > 0)
        return i18n.plural("ui.workShell.title.doneFailed", props.toolCount, { failed: props.failedCount })

      return i18n.plural("ui.workShell.title.done", props.toolCount)
    }
    if (props.status === "failed")
      return i18n.plural("ui.workShell.title.failed", props.toolCount, { failed: props.failedCount })

    // With tools, the collapsed head is the only place the span size shows — including live turns.
    if (props.toolCount > 0) {
      if (props.status === "running") return i18n.plural("ui.workShell.title.running", props.toolCount)
      if (props.status === "disconnected") return i18n.plural("ui.workShell.title.disconnected", props.toolCount)
      if (props.status === "interrupted") return i18n.plural("ui.workShell.title.interrupted", props.toolCount)
      if (props.status === "error") return i18n.plural("ui.workShell.title.error", props.toolCount)
    }

    return statusLabel(i18n, props.status)
  })

  return (
    <button
      type="button"
      data-component="work-shell-head"
      data-status={props.status}
      data-open={props.open ? "true" : "false"}
      aria-expanded={props.open}
      class={props.class}
      onClick={props.onToggle}
    >
      <span data-slot="work-shell-icon">
        <StatusIcon status={props.status} />
      </span>
      <span data-slot="work-shell-title" title={title()}>
        {title()}
      </span>
      <Show when={silent()}>
        <span data-slot="work-shell-note">{i18n.t("ui.workShell.noReply")}</span>
      </Show>
      {/* The turn total stays put whether the body is open or not: it is the one number that does
          not change when you expand, and hiding it made the head jump. */}
      <span data-slot="work-shell-meta">{elapsed()}</span>
      <span data-slot="work-shell-chevron">
        <Icon name="chevron-right" size="small" />
      </span>
      {props.trailing}
    </button>
  )
}
