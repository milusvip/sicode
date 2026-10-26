import { For, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import type { SessionDocument } from "../document"
import type { SessionUserActions } from "../actions"
import type { TimelineDetail } from "./detail"
import {
  createReactiveTimelineProjection,
  filterCollapsedWorkShellRows,
  openWorkShellOnly,
  TimelineRow,
  workShellDefaultOpen,
  workShellDisclosureKey,
  type ReasoningMode,
} from "./projection"
import { createSessionTimelineRowRenderer, type SessionUserPresentation } from "./session-timeline-row"
import { ArtifactPanel } from "../components/artifact-panel"

export type { SessionUserPresentation } from "./session-timeline-row"

export type SessionTimelineProps = {
  document: SessionDocument
  presentation?: Record<string, SessionUserPresentation | undefined>
  actions?: SessionUserActions
  reasoningMode?: ReasoningMode
  shellToolDefaultOpen?: boolean
  editToolDefaultOpen?: boolean
  timelineDetail?: TimelineDetail
  turnDiffs?: boolean
  class?: string
}

export function SessionTimeline(props: SessionTimelineProps) {
  const projection = createReactiveTimelineProjection({
    sessionMessages: () => props.document.messages,
    status: () => props.document.status,
    reasoningMode: () => props.reasoningMode ?? "compact",
    shellToolDefaultOpen: () => props.shellToolDefaultOpen ?? false,
    editToolDefaultOpen: () => props.editToolDefaultOpen ?? false,
    timelineDetail: props.timelineDetail && (() => props.timelineDetail!),
    turnDiffs: () => props.turnDiffs ?? false,
  })

  const [toolOpen, setToolOpen] = createStore<Record<string, boolean | undefined>>({})

  const renderer = createSessionTimelineRowRenderer({
    sessionID: () => props.document.sessionID,
    status: () => props.document.status,
    projection,
    presentation: (message) => props.presentation?.[message.id],
    actions: props.actions,
    reasoningMode: () => props.reasoningMode ?? "compact",
    shellToolDefaultOpen: () => props.shellToolDefaultOpen ?? false,
    editToolDefaultOpen: () => props.editToolDefaultOpen ?? false,
    timelineDetail: props.timelineDetail && (() => props.timelineDetail!),
    disclosure: {
      value: (key) => toolOpen[key],
      set: (key, open) => setToolOpen(key, open),
      openWorkShell: (userMessageID) => {
        openWorkShellOnly(projection.rows(), { set: (key, open) => setToolOpen(key, open) }, userMessageID)
        setToolOpen(workShellDisclosureKey(userMessageID), true)
      },
    },
  })

  const visibleRows = createMemo(() =>
    filterCollapsedWorkShellRows(projection.rows(), (userMessageID, status) => {
      const stored = toolOpen[workShellDisclosureKey(userMessageID)]
      if (stored !== undefined) return stored
      return workShellDefaultOpen(status)
    }),
  )
  const rowKeys = createMemo(() => visibleRows().map(TimelineRow.key))

  function Row(props: { rowKey: string }) {
    const initial = projection.rowByKey().get(props.rowKey)!
    const row = createMemo(() => projection.rowByKey().get(props.rowKey) ?? initial)

    return <renderer.Row row={row} />
  }

  return (
    <div data-component="session-timeline" class={props.class}>
      {/* SiCode: HTML demos the assistant writes open in the side drawer, never inline. */}
      <ArtifactPanel
        messages={() => props.document.messages.filter((message) => message.type === "assistant")}
      />
      <For each={rowKeys()}>{(rowKey) => <Row rowKey={rowKey} />}</For>
    </div>
  )
}
