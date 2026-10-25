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

/** SiCode: disclosure key for one stage heading inside a work shell. */
export function workStageDisclosureKey(row: { userMessageID: string; stageKey: string }) {
  return `stage:${row.userMessageID}:${row.stageKey}`
}

/** SiCode: disclosure key for a long-turn fold line (early steps or middle stages). */
export function workFoldDisclosureKey(row: { userMessageID: string; kind: string; foldKey: string }) {
  return `fold:${row.userMessageID}:${row.kind}:${row.foldKey}`
}

/**
 * The overview bars behave as an accordion: opening one turn closes every other turn's bar, so the
 * transcript never carries two open work spans and only one bar can be pinned to the top.
 *
 * Closing is written explicitly instead of being inferred from a "current" id because a live turn is
 * open by default (`workShellDefaultOpen`) without anything stored for it — an implicit default would
 * survive the switch and leave two bars open.
 */
export function openWorkShellOnly(
  rows: readonly TimelineRow.TimelineRow[],
  disclosure: { set: (key: string, open: boolean) => void },
  keep: string,
) {
  for (const row of rows) {
    if (!Predicate.isTagged(row, "WorkShell")) continue
    if (row.userMessageID === keep) continue

    disclosure.set(workShellDisclosureKey(row.userMessageID), false)
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

/**
 * The only prose a collapsed turn still shows: its closing answer — the last run of consecutive
 * text rows. Everything before it is narration about work the bar already summarises ("我先看一下
 * common.closeTab…", "中文只需要改这三个…"), and leaving that visible defeats the point of collapsing:
 * the turn still fills the transcript with paragraphs that the head says in one line.
 *
 * The last run, not "text after the last tool", because a turn often answers and *then* runs one
 * more tool (a todo write, a verification command) — the answer would be before the last tool and
 * would disappear.
 */
function trailingProseIndexes(rows: readonly TimelineRow.TimelineRow[]) {
  const runs: { turn: string; indexes: number[] }[] = []
  let current: { turn: string; indexes: number[] } | undefined

  rows.forEach((row, index) => {
    if (isWorkShellProse(row) && row.userMessageID) {
      if (current?.turn === row.userMessageID) current.indexes.push(index)
      else {
        current = { turn: row.userMessageID, indexes: [index] }
        runs.push(current)
      }
      return
    }

    current = undefined
  })

  const last = new Map<string, number[]>()
  for (const run of runs) last.set(run.turn, run.indexes)
  return new Set([...last.values()].flat())
}

/**
 * Drop members of work shells from the flat timeline list.
 *
 * Process steps are withheld either way: open shells paint them inside one composite card
 * (`workShellCardMembers`); closed shells hide them. The closing answer and outcome markers stay as
 * sibling rows after the head/card — demo scheme B puts `.answer` outside `.card`.
 */
export function filterCollapsedWorkShellRows(
  rows: readonly TimelineRow.TimelineRow[],
  _open: (userMessageID: string, status: WorkShellStatus) => boolean,
) {
  const result: TimelineRow.TimelineRow[] = []
  const answers = trailingProseIndexes(rows)
  let hiding: string | undefined

  for (const [index, row] of rows.entries()) {
    if (Predicate.isTagged(row, "WorkShell")) {
      result.push(row)
      hiding = row.userMessageID
      continue
    }

    if (Predicate.isTagged(row, "WorkShellEnd")) {
      if (hiding === row.userMessageID) hiding = undefined
      continue
    }

    if (hiding !== undefined) {
      if (row.userMessageID !== hiding) {
        result.push(row)
        continue
      }
      // Answer + outcomes sit outside the card (open or closed). Everything else is packed or hidden.
      if (isWorkShellProse(row) && answers.has(index)) result.push(row)
      else if (isWorkShellOutcome(row)) result.push(row)
      continue
    }

    result.push(row)
  }

  return result
}

/**
 * SiCode: members the open card paints, already filtered by stage/fold disclosure — same rules the
 * flat list used to apply, so opening a stage still only reveals that stage's steps. Closing answer
 * and outcome markers are omitted: they render as sibling rows after the card (demo `.answer`).
 */
export function workShellCardMembers(
  rows: readonly TimelineRow.TimelineRow[],
  userMessageID: string,
  stageOpen?: (row: { userMessageID: string; stageKey: string; last: boolean }) => boolean,
  foldOpen?: (row: TimelineRow.WorkFold) => boolean,
) {
  const head = rows.findIndex(
    (row) => Predicate.isTagged(row, "WorkShell") && row.userMessageID === userMessageID,
  )
  const end = rows.findIndex(
    (row) => Predicate.isTagged(row, "WorkShellEnd") && row.userMessageID === userMessageID,
  )
  if (head < 0 || end < 0 || end <= head) return [] as TimelineRow.TimelineRow[]

  const answers = trailingProseIndexes(rows)
  const result: TimelineRow.TimelineRow[] = []
  const foldedKeys = new Set<string>()
  let hidingStage: string | undefined

  for (let index = head + 1; index < end; index++) {
    const row = rows[index]!
    if (answers.has(index) || isWorkShellOutcome(row)) continue
    if (Predicate.isTagged(row, "WorkStage")) {
      const expanded = stageOpen ? stageOpen(row) : true
      result.push(row)
      hidingStage = expanded ? undefined : row.stageKey
      continue
    }
    if (Predicate.isTagged(row, "WorkStageEnd")) {
      if (hidingStage === row.stageKey) hidingStage = undefined
      continue
    }
    if (Predicate.isTagged(row, "WorkFold")) {
      if (hidingStage !== undefined) continue
      result.push(row)
      if (!(foldOpen?.(row) ?? false)) {
        for (const key of row.keys) foldedKeys.add(key)
      }
      continue
    }
    if (hidingStage !== undefined) continue
    if (foldedKeys.has(TimelineRow.key(row))) continue
    result.push(row)
  }

  return result
}

/** Group packed members into demo blocks: optional lead well, then stage(head + well) units. */
export function workShellCardBlocks(members: readonly TimelineRow.TimelineRow[]) {
  type Block =
    | { type: "well"; rows: TimelineRow.TimelineRow[] }
    | { type: "stage"; stage: TimelineRow.WorkStage; rows: TimelineRow.TimelineRow[] }
    | { type: "fold"; fold: TimelineRow.WorkFold }

  const blocks: Block[] = []
  let well: TimelineRow.TimelineRow[] = []
  let stage: Extract<Block, { type: "stage" }> | undefined

  const flushWell = () => {
    if (well.length === 0) return
    blocks.push({ type: "well", rows: well })
    well = []
  }

  for (const row of members) {
    if (Predicate.isTagged(row, "WorkStage")) {
      flushWell()
      if (stage) blocks.push(stage)
      stage = { type: "stage", stage: row, rows: [] }
      continue
    }
    if (Predicate.isTagged(row, "WorkFold")) {
      flushWell()
      if (stage) {
        blocks.push(stage)
        stage = undefined
      }
      blocks.push({ type: "fold", fold: row })
      continue
    }
    if (stage) stage.rows.push(row)
    else well.push(row)
  }

  flushWell()
  if (stage) blocks.push(stage)
  return blocks
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
  counts?: TimelineRow.WorkShell["counts"]
  hasReply: boolean
  open: boolean
  onToggle: () => void
  class?: string
  trailing?: JSX.Element
}) {
  const i18n = useI18n()
  const [now, setNow] = createSignal(Date.now())

  createEffect(() => {
    if (props.status !== "running" || props.endedAt !== undefined) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => window.clearInterval(id))
  })

  const elapsed = createMemo(() => {
    const end = props.endedAt ?? (props.status === "running" ? now() : props.startedAt)
    return formatElapsed(end - props.startedAt)
  })

  // A settled turn with tools but no prose reads like a broken transcript; say so instead. While the
  // turn is still running, no text just means the model has not written anything yet.
  const silent = createMemo(() => workShellSilent(props.status, props.hasReply))

  // Preview scheme B: phase label always; done alone adds a · detail. Other phases stay bare.
  const phase = createMemo(() => statusLabel(i18n, props.status))
  /**
   * SiCode: "26 tools" is a count, not information — the reader wants to know whether the agent
   * read, ran, or changed something. Report the mix in the order a person would say it, capped at
   * three clauses so the head stays one line; the step pill still carries the exact total.
   */
  const detail = createMemo(() => {
    if (props.status !== "done" || props.toolCount <= 0) return undefined
    const counts = props.counts
    if (!counts) return i18n.plural("ui.workShell.detail.done", props.toolCount)

    const clauses: string[] = []
    const add = (key: Parameters<typeof i18n.plural>[0], count: number) => {
      if (count > 0) clauses.push(i18n.plural(key, count))
    }
    add("ui.workShell.summary.read", counts.read)
    add("ui.workShell.summary.search", counts.search)
    add("ui.workShell.summary.command", counts.command)
    add("ui.workShell.summary.write", counts.write)
    add("ui.workShell.summary.edit", counts.edit)
    add("ui.workShell.summary.agent", counts.agent)
    add("ui.workShell.summary.tool", counts.other)

    if (clauses.length === 0) return i18n.plural("ui.workShell.detail.done", props.toolCount)
    return clauses.slice(0, 3).join(i18n.t("ui.workShell.summary.separator"))
  })
  const steps = createMemo(() => {
    if (props.toolCount <= 0) return undefined
    return i18n.plural("ui.workShell.steps", props.toolCount)
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
      <span data-slot="work-shell-title">
        <span data-slot="work-shell-phase">{phase()}</span>
        <Show when={detail()}>{(text) => <span data-slot="work-shell-detail">{text()}</span>}</Show>
      </span>
      <Show when={silent()}>
        <span data-slot="work-shell-note">{i18n.t("ui.workShell.noReply")}</span>
      </Show>
      <Show when={steps()}>{(text) => <span data-slot="work-shell-steps">{text()}</span>}</Show>
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
