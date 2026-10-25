import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode/client/promise"
import { shellResultFailed } from "../message/current-tool-state"

export const timelineCategories = ["shell", "edit", "thinking", "subagents", "notices", "tools"] as const

export type TimelineCategory = (typeof timelineCategories)[number]

export type TimelinePlacement = "separate" | "grouped" | "hidden"

export type TimelineExpansion = "collapsed" | "expanded"

export type TimelineDetail = {
  shell: { placement: TimelinePlacement; details: TimelineExpansion }
  edit: { placement: TimelinePlacement; details: TimelineExpansion }
  thinking: { placement: TimelinePlacement; details: TimelineExpansion }
  subagents: { placement: TimelinePlacement }
  notices: { placement: TimelinePlacement }
  tools: { placement: TimelinePlacement }
}

export const timelinePresets = [
  {
    id: "everything",
    value: {
      shell: { placement: "separate", details: "expanded" },
      edit: { placement: "separate", details: "expanded" },
      thinking: { placement: "separate", details: "expanded" },
      subagents: { placement: "separate" },
      notices: { placement: "separate" },
      tools: { placement: "separate" },
    },
  },
  {
    id: "detailed",
    value: {
      shell: { placement: "separate", details: "expanded" },
      edit: { placement: "separate", details: "expanded" },
      thinking: { placement: "grouped", details: "collapsed" },
      subagents: { placement: "separate" },
      notices: { placement: "grouped" },
      tools: { placement: "grouped" },
    },
  },
  {
    id: "compact",
    value: {
      // SiCode: shell/edit/tools were "grouped" here, which folded a tool run into one
      // "Edit, Shell · 6 steps" row *inside* a work shell the reader had already opened — a second
      // fold on top of the first. Density now comes from `details`, not from merging rows: the shell
      // is collapsed by default anyway, so opening it should show the steps themselves.
      shell: { placement: "separate", details: "collapsed" },
      edit: { placement: "separate", details: "collapsed" },
      thinking: { placement: "grouped", details: "collapsed" },
      subagents: { placement: "grouped" },
      notices: { placement: "grouped" },
      tools: { placement: "separate" },
    },
  },
  {
    id: "quiet",
    value: {
      shell: { placement: "hidden", details: "collapsed" },
      edit: { placement: "grouped", details: "collapsed" },
      thinking: { placement: "hidden", details: "collapsed" },
      subagents: { placement: "grouped" },
      notices: { placement: "hidden" },
      tools: { placement: "hidden" },
    },
  },
  {
    id: "text-only",
    value: {
      shell: { placement: "hidden", details: "collapsed" },
      edit: { placement: "hidden", details: "collapsed" },
      thinking: { placement: "hidden", details: "collapsed" },
      subagents: { placement: "hidden" },
      notices: { placement: "hidden" },
      tools: { placement: "hidden" },
    },
  },
] as const satisfies readonly { id: string; value: TimelineDetail }[]

export function timelinePreset(value: TimelineDetail) {
  return timelinePresets.find((preset) =>
    timelineCategories.every((category) => {
      const current = value[category]
      const expected = preset.value[category]

      return (
        current.placement === expected.placement &&
        (current.placement === "hidden" ||
          !("details" in current) ||
          ("details" in expected && current.details === expected.details))
      )
    }),
  )
}

export function timelineCategory(
  content: SessionMessageAssistant["content"][number],
): keyof TimelineDetail | undefined {
  if (content.type === "text") return

  if (content.type === "reasoning") return "thinking"

  if (["shell", "execute", "bash"].includes(content.name)) return "shell"

  if (["edit", "write", "patch", "apply_patch"].includes(content.name)) return "edit"

  if (["subagent", "task"].includes(content.name)) return "subagents"

  return "tools"
}

export function timelineNoticeRequired(message: SessionMessageInfo) {
  if (message.type === "compaction") return message.status !== "completed"

  if (message.type !== "synthetic") return false
  const metadata = message.metadata

  return (
    metadata?.state === "error" ||
    (metadata?.source === "shell" && metadata.state === "completed" && shellResultFailed(metadata))
  )
}
