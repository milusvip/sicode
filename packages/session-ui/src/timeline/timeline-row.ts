import { Data, Equal, Match } from "effect"

export type PartRef = {
  messageID: string
  partID: string
}

export type PartGroup =
  | {
      key: string
      type: "part"
      ref: PartRef
    }
  | {
      key: string
      type: "context"
      refs: PartRef[]
    }
  | {
      key: string
      type: "file" | "read"
      refs: PartRef[]
    }

export namespace TimelineRow {
  export class TurnGap extends Data.TaggedClass("TurnGap")<{
    userMessageID: string
  }> {}

  /** `steer` marks a follow-up that joined an open execution (引导), not a new task opener. */
  export class UserMessage extends Data.TaggedClass("UserMessage")<{
    userMessageID: string
    steer?: boolean
  }> {}

  export class Shell extends Data.TaggedClass("Shell")<{
    userMessageID: string
    messageID: string
  }> {}

  export class Notice extends Data.TaggedClass("Notice")<{
    userMessageID: string
    messageID: string
  }> {}

  export class TurnDivider extends Data.TaggedClass("TurnDivider")<{
    userMessageID: string
  }> {}

  export class AssistantPart extends Data.TaggedClass("AssistantPart")<{
    userMessageID: string
    group: PartGroup
    previousAssistantPart: boolean
    spacing?: "tool" | "content"
  }> {}

  export class Thinking extends Data.TaggedClass("Thinking")<{
    userMessageID: string
    ref: PartRef
  }> {}

  /**
   * `free-limit` marks OpenCode Zen's daily free allowance running out; `resetAt` is when the allowance comes back, if
   * known.
   */
  export class Error extends Data.TaggedClass("Error")<{
    userMessageID: string
    text: string
    kind?: "free-limit"
    resetAt?: number
  }> {}

  export class Retry extends Data.TaggedClass("Retry")<{
    userMessageID: string
  }> {}

  /** A compaction the server has admitted but not started. */
  export class CompactionQueued extends Data.TaggedClass("CompactionQueued")<{
    userMessageID: string
    inboxID: string
  }> {}

  /**
   * The files a finished turn changed, shown once the Session goes idle. `messageID` is the
   * idle marker that ended the turn; `from` is the prompt that opened it, which names the turn
   * to the session diff route even when later prompts were steered in. `files` are the paths its
   * steps recorded, listed before the diff loads; the diff can omit a file a later step reverted.
   */
  export class TurnDiff extends Data.TaggedClass("TurnDiff")<{
    userMessageID: string
    messageID: string
    from: string
    files: readonly string[]
  }> {}

  /** Where the host shows the active turn's live status when undelivered input waits below it. */
  export class Activity extends Data.TaggedClass("Activity")<{
    userMessageID: string
  }> {}

  /**
   * Outer chrome for one prompt's tool work: status + elapsed on the head; contiguous tool
   * groups (and mid-turn text between them) sit in following rows until the next WorkShellEnd.
   */
  export class WorkShell extends Data.TaggedClass("WorkShell")<{
    userMessageID: string
    /**
     * `failed` is a finished turn whose tools reported errors (a failing test, a non-zero exit,
     * a broken fetch). It is not `error`: the turn itself delivered, so the head must still say
     * what worked — but it may not wear the success check.
     */
    status: "running" | "done" | "failed" | "disconnected" | "interrupted" | "error"
    startedAt: number
    endedAt?: number
    toolCount: number
    failedCount: number
    /**
     * SiCode: tool mix by kind, so the head can say "read 4 files, ran 2 commands" instead of
     * "6 tools". Optional because a shell created outside the projection (tests, previews) has no
     * rows to count — the head falls back to the plain count.
     */
    counts?: {
      read: number
      search: number
      command: number
      write: number
      edit: number
      agent: number
      other: number
    }
    /**
     * Whether the turn produced any assistant prose. A turn that is stopped mid-run, or one whose
     * model never wrote a closing message, has tools but no text — the head says so instead of
     * leaving a gap that reads like a rendering bug.
     */
    hasReply: boolean
  }> {}

  /** Marks the last member row of a WorkShell so collapse can tuck the span into the head. */
  export class WorkShellEnd extends Data.TaggedClass("WorkShellEnd")<{
    userMessageID: string
  }> {}

  /**
   * SiCode: a heading inside a work shell. Mid-turn prose ("我先看一下 common.closeTab…") is the
   * model's own outline of the next batch of work; promoting it to a heading turns a 26-row wall
   * into 4 readable stages, each folded to a line until asked for. The row carries the prose it
   * replaces, so nothing is lost — opening the stage shows the steps, the heading keeps the intent.
   */
  export class WorkStage extends Data.TaggedClass("WorkStage")<{
    userMessageID: string
    /** Identity within the turn: the prose part this heading stands for. */
    stageKey: string
    title: string
    stepCount: number
    /**
     * SiCode: what happened inside the stage. A folded heading is the only thing left of a stage, so
     * it has to carry its own outcome — otherwise every folded stage claims success by default.
     */
    outcome?: "failed" | "running"
    /** Last stage of the turn opens by default; the rest stay folded so the shell stays scannable. */
    last: boolean
  }> {}

  /** Marks the last member row of a WorkStage. */
  export class WorkStageEnd extends Data.TaggedClass("WorkStageEnd")<{
    userMessageID: string
    stageKey: string
  }> {}

  /**
   * SiCode: "show the rest" for a turn that ran long.
   *
   * A 110-step turn is real (measured on this machine), and neither printing 110 rows nor hiding
   * them behind one click works: the reader wants the shape of the work, then the tail they just
   * watched. So a stage keeps its last few steps and folds the rest behind one line, and a shell
   * with a dozen stages keeps the first and last few and folds the middle the same way.
   */
  export class WorkFold extends Data.TaggedClass("WorkFold")<{
    userMessageID: string
    /** One stage's early steps, or the shell's middle stages. */
    kind: "steps" | "stages"
    /** Identity: the stage whose steps fold, or the turn whose stages fold. */
    foldKey: string
    /** Rows this fold hides — the filter drops exactly these, whatever the nesting. */
    keys: readonly string[]
    /** Stages swallowed, for the stages variant: rows and stages are not the same number. */
    stages?: number
    /** Steps swallowed, for the stages variant. */
    steps?: number
  }> {}

  export type TimelineRow =
    | TurnGap
    | UserMessage
    | Shell
    | Notice
    | TurnDivider
    | AssistantPart
    | Thinking
    | Error
    | Retry
    | CompactionQueued
    | TurnDiff
    | Activity
    | WorkShell
    | WorkShellEnd
    | WorkStage
    | WorkStageEnd
    | WorkFold

  export const key: (row: TimelineRow) => string = Match.typeTags<TimelineRow>()({
    TurnGap: (row) => `turn-gap:${row.userMessageID}`,
    UserMessage: (row) => `user-message:${row.userMessageID}`,
    Shell: (row) => `shell:${row.messageID}`,
    Notice: (row) => `notice:${row.messageID}`,
    TurnDivider: (row) => `turn-divider:${row.userMessageID}`,
    // Keyed by part identity alone: a page boundary can truncate the leading turn,
    // and its rows regroup under the real user message once older history loads.
    // The group key already carries the owning message and part IDs.
    AssistantPart: (row) => `assistant-part:${row.group.type}:${row.group.key}`,
    Thinking: (row) => `thinking:${row.userMessageID}`,
    Error: (row) => `error:${row.userMessageID}`,
    Retry: (row) => `retry:${row.userMessageID}`,
    CompactionQueued: (row) => `compaction-queued:${row.inboxID}`,
    TurnDiff: (row) => `turn-diff:${row.userMessageID}`,
    // One live status exists at a time; it keeps its identity when the active turn changes.
    Activity: () => "activity",
    WorkShell: (row) => `work-shell:${row.userMessageID}`,
    WorkShellEnd: (row) => `work-shell-end:${row.userMessageID}`,
    WorkStage: (row) => `work-stage:${row.userMessageID}:${row.stageKey}`,
    WorkStageEnd: (row) => `work-stage-end:${row.userMessageID}:${row.stageKey}`,
    WorkFold: (row) => `work-fold:${row.userMessageID}:${row.kind}:${row.foldKey}`,
  })

  export function equals(a: TimelineRow, b: TimelineRow) {
    return Equal.equals(a, b)
  }
}

export type TimelineRowMap = {
  TurnGap: { userMessageID: string }
  UserMessage: { userMessageID: string; steer?: boolean }
  Shell: { userMessageID: string; messageID: string }
  Notice: { userMessageID: string; messageID: string }
  TurnDivider: { userMessageID: string }
  AssistantPart: {
    userMessageID: string
    group: PartGroup
    previousAssistantPart: boolean
    spacing?: "tool" | "content"
  }
  Thinking: { userMessageID: string; ref: PartRef }
  Retry: { userMessageID: string }
  Error: { userMessageID: string; text: string; kind?: "free-limit"; resetAt?: number }
  CompactionQueued: { userMessageID: string; inboxID: string }
  TurnDiff: { userMessageID: string; messageID: string; from: string; files: readonly string[] }
  Activity: { userMessageID: string }
  WorkShell: {
    userMessageID: string
    status: "running" | "done" | "disconnected" | "interrupted" | "error"
    startedAt: number
    endedAt?: number
    toolCount: number
  }
  WorkShellEnd: { userMessageID: string }
  WorkStage: { userMessageID: string; stageKey: string; title: string; stepCount: number }
  WorkStageEnd: { userMessageID: string; stageKey: string }
  WorkFold: {
    userMessageID: string
    kind: "steps" | "stages"
    foldKey: string
    keys: readonly string[]
    stages?: number
    steps?: number
  }
}
