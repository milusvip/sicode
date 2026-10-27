import type {
  FileDiffInfo,
  SessionInfo,
  SessionStatus,
  ShellOutputInput,
  ShellOutputOutput,
  ShellRemoveInput,
} from "@opencode/client/promise"
import { createSimpleContext } from "@opencode/ui/context"
import { PreloadMultiFileDiffResult } from "@pierre/diffs/ssr"

export type SessionSummary = Pick<SessionInfo, "id" | "parentID" | "title" | "time">

type ProviderCatalog = {
  all: Map<string, { models: Record<string, { name: string }> }>
  default: {
    [key: string]: string
  }
  connected: Array<string>
}

type Data = {
  agent?: {
    name: string
    color?: string
  }[]
  provider?: ProviderCatalog
  session: SessionSummary[]
  session_status: {
    [sessionID: string]: SessionStatus
  }
  session_diff: {
    [sessionID: string]: FileDiffInfo[]
  }
  session_diff_preload?: {
    [sessionID: string]: PreloadMultiFileDiffResult<unknown, undefined>[]
  }
}

/** Names a finished prompt by its Session and the user message that opened it. */
export type TurnDiffInput = { sessionID: string; from: string; prompt?: boolean }

/** The host's cache of the files each finished prompt changed. */
export type TurnDiffSource = {
  /** The prompt's diffs, or undefined until they load. */
  get: (input: TurnDiffInput) => readonly FileDiffInfo[] | undefined
  /** Starts loading the prompt's diffs unless they are cached or already loading. */
  load: (input: TurnDiffInput) => void
}

export type NavigateToSessionFn = (sessionID: string) => void

export type SessionHrefFn = (sessionID: string) => string

/** Opens one of the session's changed files in the host's side panel. Absent when the host offers no side panel. */
export type OpenFileFn = (path: string) => void

export const { use: useData, provider: DataProvider } = createSimpleContext({
  name: "Data",
  init: (props: {
    data: Data
    directory: string
    sessionID?: string
    shellRunning?: (id: string) => boolean
    shellOutput?: (input: ShellOutputInput) => Promise<ShellOutputOutput>
    /** SiCode: terminate one running background shell; absent when the host has no shell API. */
    shellKill?: (input: ShellRemoveInput) => Promise<void>
    /** SiCode: interrupt one running subagent (its child session); absent when the host has no session API. */
    sessionInterrupt?: (sessionID: string) => Promise<void>
    turnDiff?: TurnDiffSource
    /**
     * SiCode: the MCP servers configured for this Location. A tool call arrives as a flattened
     * `<server>_<tool>` name, so the server is only recoverable while this list is known; absent
     * hosts (storybook) fall back to the raw name.
     */
    mcpServers?: readonly string[]
    onNavigateToSession?: NavigateToSessionFn
    onSessionHref?: SessionHrefFn
    onOpenFile?: OpenFileFn
    /** Whether `experimental.background_compaction` is on for this location; automatic compactions then show quietly. */
    backgroundCompaction?: boolean
  }) => {
    return {
      get store() {
        return props.data
      },
      get directory() {
        return props.directory
      },
      get sessionID() {
        return props.sessionID
      },
      get backgroundCompaction() {
        return props.backgroundCompaction === true
      },
      navigateToSession: props.onNavigateToSession,
      sessionHref: props.onSessionHref,
      get openFile() {
        return props.onOpenFile
      },
      shellRunning: props.shellRunning,
      shellOutput: props.shellOutput,
      shellKill: props.shellKill,
      sessionInterrupt: props.sessionInterrupt,
      turnDiff: props.turnDiff,
      get mcpServers() {
        return props.mcpServers
      },
    }
  },
})
