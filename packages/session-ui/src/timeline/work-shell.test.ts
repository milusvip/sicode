import { expect, test } from "bun:test"
import { TimelineRow } from "./timeline-row"
import {
  filterCollapsedWorkShellRows,
  formatElapsed,
  openWorkShellOnly,
  restoreDefaultOpenWorkShells,
  toolSpanElapsed,
  workShellDefaultOpen,
  workShellSilent,
} from "./work-shell"

test("workShellDefaultOpen expands only live work and failures", () => {
  expect(workShellDefaultOpen("running")).toBe(true)
  expect(workShellDefaultOpen("disconnected")).toBe(true)
  expect(workShellDefaultOpen("error")).toBe(true)
  // A turn whose tools failed must open: the collapsed head is the only place the failure shows.
  expect(workShellDefaultOpen("failed")).toBe(true)
  expect(workShellDefaultOpen("done")).toBe(false)
  expect(workShellDefaultOpen("interrupted")).toBe(false)
})

test("filterCollapsedWorkShellRows keeps assistant prose but hides tool rows", () => {
  const rows = [
    new TimelineRow.WorkShell({
      userMessageID: "u1",
      status: "done",
      startedAt: 1,
      endedAt: 2,
      toolCount: 2,
      failedCount: 0,
      hasReply: true,
    }),
    new TimelineRow.AssistantPart({
      userMessageID: "u1",
      previousAssistantPart: false,
      group: { type: "context", key: "context:a", refs: [{ messageID: "a", partID: "tool_a" }] },
    }),
    // The reply can sit between two tools (answer, then a final todo/verification call).
    new TimelineRow.AssistantPart({
      userMessageID: "u1",
      previousAssistantPart: true,
      group: { type: "part", key: "part:a:text:0", ref: { messageID: "a", partID: "a:text:0" } },
    }),
    new TimelineRow.AssistantPart({
      userMessageID: "u1",
      previousAssistantPart: true,
      group: { type: "context", key: "context:b", refs: [{ messageID: "a", partID: "tool_b" }] },
    }),
    new TimelineRow.WorkShellEnd({ userMessageID: "u1" }),
  ]

  expect(filterCollapsedWorkShellRows(rows, () => false).map((row) => row._tag)).toEqual([
    "WorkShell",
    "AssistantPart",
  ])
  // The surviving row is the prose, not a tool group.
  const kept = filterCollapsedWorkShellRows(rows, () => false)[1]
  expect(kept && "group" in kept ? kept.group.type : undefined).toBe("part")
})

test("filterCollapsedWorkShellRows folds narration and keeps only the closing answer", () => {
  const shell = () =>
    new TimelineRow.WorkShell({
      userMessageID: "u1",
      status: "done",
      startedAt: 1,
      endedAt: 2,
      toolCount: 4,
      failedCount: 0,
      hasReply: true,
    })
  const prose = (key: string) =>
    new TimelineRow.AssistantPart({
      userMessageID: "u1",
      previousAssistantPart: true,
      group: { type: "part", key: `part:a:${key}`, ref: { messageID: "a", partID: `a:${key}` } },
    })
  const tool = (key: string) =>
    new TimelineRow.AssistantPart({
      userMessageID: "u1",
      previousAssistantPart: true,
      group: { type: "context", key: `context:${key}`, refs: [{ messageID: "a", partID: key }] },
    })

  // A real turn narrates between tool batches, then answers. Collapsed, only the answer survives —
  // the bar already says "已完成 4 个工具", so the narration is duplication.
  const rows = [
    shell(),
    tool("thinking_0"),
    prose("text:0"),
    tool("grep_1"),
    prose("text:1"),
    tool("edit_2"),
    prose("text:2"),
    new TimelineRow.WorkShellEnd({ userMessageID: "u1" }),
  ]

  const kept = filterCollapsedWorkShellRows(rows, () => false)
  expect(kept.map((row) => row._tag)).toEqual(["WorkShell", "AssistantPart"])
  expect(kept[1] && "group" in kept[1] ? kept[1].group.key : undefined).toBe("part:a:text:2")
})

test("filterCollapsedWorkShellRows keeps the answer when a tool runs after it", () => {
  const rows = [
    new TimelineRow.WorkShell({
      userMessageID: "u1",
      status: "done",
      startedAt: 1,
      endedAt: 2,
      toolCount: 2,
      failedCount: 0,
      hasReply: true,
    }),
    new TimelineRow.AssistantPart({
      userMessageID: "u1",
      previousAssistantPart: true,
      group: { type: "part", key: "part:a:text:0", ref: { messageID: "a", partID: "a:text:0" } },
    }),
    // The answer, then a trailing todo write — the answer is *not* the last row of the turn.
    new TimelineRow.AssistantPart({
      userMessageID: "u1",
      previousAssistantPart: true,
      group: { type: "context", key: "context:todowrite", refs: [{ messageID: "a", partID: "todowrite" }] },
    }),
    new TimelineRow.WorkShellEnd({ userMessageID: "u1" }),
  ]

  expect(filterCollapsedWorkShellRows(rows, () => false).map((row) => row._tag)).toEqual([
    "WorkShell",
    "AssistantPart",
  ])
})

test("filterCollapsedWorkShellRows keeps pre-question framing and the question", () => {
  const shell = () =>
    new TimelineRow.WorkShell({
      userMessageID: "u1",
      status: "done",
      startedAt: 1,
      endedAt: 2,
      toolCount: 3,
      failedCount: 0,
      hasReply: true,
    })
  const prose = (key: string) =>
    new TimelineRow.AssistantPart({
      userMessageID: "u1",
      previousAssistantPart: true,
      group: { type: "part", key: `part:a:${key}`, ref: { messageID: "a", partID: `a:${key}` } },
    })
  const tool = (key: string) =>
    new TimelineRow.AssistantPart({
      userMessageID: "u1",
      previousAssistantPart: true,
      group: { type: "context", key: `context:${key}`, refs: [{ messageID: "a", partID: key }] },
    })
  const question = () =>
    new TimelineRow.AssistantPart({
      userMessageID: "u1",
      previousAssistantPart: true,
      group: {
        type: "part",
        key: "part:question:a:tool_question",
        ref: { messageID: "a", partID: "tool_question" },
      },
    })

  // Narration before the framing folds; framing + question + closing answer stay.
  const rows = [
    shell(),
    tool("grep_0"),
    prose("text:0"),
    tool("read_1"),
    prose("text:1"),
    question(),
    tool("edit_2"),
    prose("text:2"),
    new TimelineRow.WorkShellEnd({ userMessageID: "u1" }),
  ]

  const kept = filterCollapsedWorkShellRows(rows, () => false)
  expect(kept.map((row) => ("group" in row ? row.group.key : row._tag))).toEqual([
    "WorkShell",
    "part:a:text:1",
    "part:question:a:tool_question",
    "part:a:text:2",
  ])
})

test("openWorkShellOnly closes every other turn's bar", () => {
  const shell = (userMessageID: string, status: "done" | "running" = "done") =>
    new TimelineRow.WorkShell({
      userMessageID,
      status,
      startedAt: 1,
      endedAt: 2,
      toolCount: 1,
      failedCount: 0,
      hasReply: true,
    })

  const rows = [
    shell("u1"),
    new TimelineRow.UserMessage({ userMessageID: "u2" }),
    shell("u2", "running"),
    shell("u3"),
  ]
  const written = new Map<string, boolean | undefined>()
  const accordionClosed = new Set<string>()

  openWorkShellOnly(
    rows,
    {
      value: (key) => written.get(key),
      set: (key, open) => written.set(key, open),
      accordionClosed,
    },
    "u2",
  )

  // The opened turn keeps its own state; the others are written closed explicitly, because a live
  // turn is open by default and would otherwise stay open next to the one just clicked.
  expect([...written]).toEqual([
    ["work:u1", false],
    ["work:u3", false],
  ])
  // Done turns were already closed by default — only an actually-open sibling is accordion-marked.
  expect([...accordionClosed]).toEqual([])
})

test("restoreDefaultOpenWorkShells clears accordion-forced closes on live siblings", () => {
  const shell = (userMessageID: string, status: "done" | "running") =>
    new TimelineRow.WorkShell({
      userMessageID,
      status,
      startedAt: 1,
      endedAt: status === "done" ? 2 : undefined,
      toolCount: 1,
      failedCount: 0,
      hasReply: true,
    })

  const rows = [shell("past", "done"), shell("live", "running")]
  const store = new Map<string, boolean | undefined>()
  const accordionClosed = new Set<string>()
  const disclosure = {
    value: (key: string) => store.get(key),
    set: (key: string, open: boolean | undefined) => store.set(key, open),
    accordionClosed,
  }

  // Peek at history: accordion closes the live default-open bar and marks it.
  openWorkShellOnly(rows, disclosure, "past")
  store.set("work:past", true)
  expect(store.get("work:live")).toBe(false)
  expect(accordionClosed.has("work:live")).toBe(true)

  restoreDefaultOpenWorkShells(rows, disclosure, "past")

  // Closing history restores only the accordion shove.
  expect(store.get("work:live")).toBeUndefined()
  expect(accordionClosed.has("work:live")).toBe(false)
  expect(store.get("work:past")).toBe(true)
})

test("restoreDefaultOpenWorkShells leaves a manual live collapse alone", () => {
  const rows = [
    new TimelineRow.WorkShell({
      userMessageID: "past",
      status: "done",
      startedAt: 1,
      endedAt: 2,
      toolCount: 1,
      failedCount: 0,
      hasReply: true,
    }),
    new TimelineRow.WorkShell({
      userMessageID: "live",
      status: "running",
      startedAt: 1,
      toolCount: 1,
      failedCount: 0,
      hasReply: false,
    }),
  ]
  const store = new Map<string, boolean | undefined>([["work:live", false]])
  const accordionClosed = new Set<string>()
  const disclosure = {
    value: (key: string) => store.get(key),
    set: (key: string, open: boolean | undefined) => store.set(key, open),
    accordionClosed,
  }

  // User collapsed live first — openWorkShellOnly must not mark it as accordion-closed.
  openWorkShellOnly(rows, disclosure, "past")
  expect(accordionClosed.has("work:live")).toBe(false)

  restoreDefaultOpenWorkShells(rows, disclosure, "past")
  expect(store.get("work:live")).toBe(false)
})

test("workShellSilent marks settled turns that produced no prose", () => {
  // Stopped mid-run: tools ran, nothing was written — the head must say so.
  expect(workShellSilent("interrupted", false)).toBe(true)
  expect(workShellSilent("done", false)).toBe(true)
  expect(workShellSilent("done", true)).toBe(false)
  // Still working: no text yet is normal, not a gap.
  expect(workShellSilent("running", false)).toBe(false)
  expect(workShellSilent("disconnected", false)).toBe(false)
})

test("formatElapsed renders seconds and minutes", () => {
  // Sub-second spans are the norm for one read; "0s" in every row is noise, not information.
  expect(formatElapsed(0)).toBeUndefined()
  expect(formatElapsed(999)).toBeUndefined()
  expect(formatElapsed(12_400)).toBe("12s")
  expect(formatElapsed(65_000)).toBe("1m 5s")
})

test("formatElapsed keeps long spans short enough for the meta column", () => {
  expect(formatElapsed(60_000)).toBe("1m")
  expect(formatElapsed(3_600_000)).toBe("1h")
  expect(formatElapsed(3_900_000)).toBe("1h 5m")
  expect(formatElapsed(90_000_000)).toBe("1d 1h")
})

test("toolSpanElapsed spans earliest start to latest end", () => {
  const tools = [
    { time: { created: 1_000, ran: 1_100, completed: 3_100 } },
    { time: { created: 2_000, ran: 2_200, completed: 5_200 } },
  ]

  expect(toolSpanElapsed(tools, false)).toBe("4s")
  // Completed tools keep their end even while the parent group is still pending.
  expect(toolSpanElapsed(tools, true, 6_200)).toBe("4s")
  expect(
    toolSpanElapsed([{ time: { created: 1_000, ran: 1_100 } }, tools[1]!], true, 6_200),
  ).toBe("5s")
  expect(toolSpanElapsed([], false)).toBeUndefined()
})

test("filterCollapsedWorkShellRows keeps the head and drops members when closed", () => {
  const rows = [
    new TimelineRow.UserMessage({ userMessageID: "u1" }),
    new TimelineRow.WorkShell({
      userMessageID: "u1",
      status: "done",
      startedAt: 1,
      endedAt: 2,
      toolCount: 1,
      failedCount: 0,
      hasReply: true,
    }),
    new TimelineRow.AssistantPart({
      userMessageID: "u1",
      previousAssistantPart: false,
      group: { type: "read", key: "read:a", refs: [{ messageID: "a", partID: "a" }] },
    }),
    new TimelineRow.WorkShellEnd({ userMessageID: "u1" }),
    new TimelineRow.UserMessage({ userMessageID: "u2" }),
  ]

  expect(filterCollapsedWorkShellRows(rows, () => false).map((row) => row._tag)).toEqual([
    "UserMessage",
    "WorkShell",
    "UserMessage",
  ])
  expect(filterCollapsedWorkShellRows(rows, () => true).map((row) => row._tag)).toEqual([
    "UserMessage",
    "WorkShell",
    "AssistantPart",
    "UserMessage",
  ])
})

test("filterCollapsedWorkShellRows hides a trailing thinking process with the shell", () => {
  const rows = [
    new TimelineRow.WorkShell({
      userMessageID: "u1",
      status: "done",
      startedAt: 1,
      endedAt: 2,
      toolCount: 1,
      failedCount: 0,
      hasReply: true,
    }),
    new TimelineRow.AssistantPart({
      userMessageID: "u1",
      previousAssistantPart: false,
      group: { type: "read", key: "read:a", refs: [{ messageID: "a", partID: "a" }] },
    }),
    new TimelineRow.AssistantPart({
      userMessageID: "u1",
      previousAssistantPart: true,
      group: {
        type: "context",
        key: "context:a:reasoning:0",
        refs: [{ messageID: "a", partID: "a:reasoning:0" }],
      },
    }),
    new TimelineRow.WorkShellEnd({ userMessageID: "u1" }),
  ]

  expect(filterCollapsedWorkShellRows(rows, () => false).map((row) => row._tag)).toEqual(["WorkShell"])
})

test("filterCollapsedWorkShellRows keeps interrupt and error markers when closed", () => {
  const rows = [
    new TimelineRow.WorkShell({
      userMessageID: "u1",
      status: "interrupted",
      startedAt: 1,
      endedAt: 2,
      toolCount: 1,
      failedCount: 0,
      hasReply: true,
    }),
    new TimelineRow.AssistantPart({
      userMessageID: "u1",
      previousAssistantPart: false,
      group: { type: "read", key: "read:a", refs: [{ messageID: "a", partID: "a" }] },
    }),
    new TimelineRow.TurnDivider({ userMessageID: "u1" }),
    new TimelineRow.Error({ userMessageID: "u1", text: "failed" }),
    new TimelineRow.WorkShellEnd({ userMessageID: "u1" }),
  ]

  expect(filterCollapsedWorkShellRows(rows, () => false).map((row) => row._tag)).toEqual([
    "WorkShell",
    "TurnDivider",
    "Error",
  ])
})
