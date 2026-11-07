export * as ShellTool from "./shell.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import type { ShellCreateBefore } from "@opencode/plugin/effect/shell"
import type { Tool } from "@opencode/schema/tool"
import { Deferred, Duration, Effect, Option, Schema, Scope } from "effect"
import { Config } from "../../config.js"
import { Environment } from "../../environment/index.js"
import { Job } from "../../job.js"
import { FileAccess } from "../../file-access.js"
import { Permission } from "../../permission.js"
import { NonNegativeInt } from "../../schema.js"
import { Session } from "../../session.js"
import { SessionSchema } from "../../session/schema.js"
import { Shell } from "../../shell.js"
import { ToolOutput } from "../../tool-output.js"
import { Shell as ShellSchema } from "@opencode/schema/shell"
import { shellParserWasm } from "#shell-parser-wasm"
import { ShellParse } from "../../shell/parse.js"
import { ShellSelect } from "../../shell/select.js"
import { ShellResult } from "../../shell/result.js"

export const name = "shell"
export const DEFAULT_TIMEOUT_MS = 2 * 60 * 1_000
// SiCode: a model-invoked background command used to have no timeout at all, so a server or
// watcher the model never reaped ran for the lifetime of the app. Cap it at a day by default;
// an explicit timeout still wins, and an explicit 0 still disables the cap entirely.
export const DEFAULT_BACKGROUND_TIMEOUT_MS = 24 * 60 * 60 * 1_000

// SiCode: a background command that stops producing output leaves the model waiting blind until
// its timeout. Poll the captured size and, after one silent stretch, surface a notification
// carrying the recent output so the model can judge whether the command is stuck (stop it with
// `kill`) or normally quiet (keep waiting). One notification per silent stretch; new output
// re-arms it. Mutable so tests can shorten the intervals.
export const stallTimings = { pollMs: 30_000, notifyMs: 5 * 60_000 }

export const resolveTimeout = (input: { background?: boolean | undefined; timeout?: number | undefined }) =>
  input.background === true
    ? (input.timeout ?? DEFAULT_BACKGROUND_TIMEOUT_MS)
    : (input.timeout ?? DEFAULT_TIMEOUT_MS)

// SiCode: a foreground command moved to the background mid-flight used to have its timeout cleared
// outright, which contradicted the 24 hour background cap above: it then ran forever. Apply the
// background policy instead, keeping a timeout the caller explicitly asked for.
export const backgroundedTimeout = (input: { timeout?: number | undefined }) =>
  input.timeout ?? DEFAULT_BACKGROUND_TIMEOUT_MS

// SiCode: the model cannot feel how long a command blocked the session, so it re-runs the same slow
// probe instead of changing approach. Once a foreground call is slow enough to matter, say what it
// cost next to the output; "blocked 78s and returned 2 characters" is the signal that a probe is
// flailing, and the model has never been able to see it. Mutable so tests can shorten it.
export const slowTimings = { thresholdMs: 30_000 }

export const slowNotice = (elapsedMs: number, returned: number) => {
  if (elapsedMs < slowTimings.thresholdMs) return undefined
  const seconds = Math.max(1, Math.round(elapsedMs / 1000))
  return `This command blocked the session for ${seconds}s and returned ${returned} character${returned === 1 ? "" : "s"}. If a command is expected to be slow and you do not need its output to continue, pass background: true instead of waiting for it.`
}

// SiCode: `background: true` already says not to poll, and BACKGROUND_INSTRUCTION spells out that
// repeatedly sleeping and then reading the output file is polling. Neither stops it. In three days of
// recorded local sessions, 17 calls shaped exactly like `Start-Sleep -Seconds 120; Get-Content <shell
// output file>` blocked the session for 14.6 minutes total. Words cannot fix a habit whose cost the
// model cannot feel, so block the shape at the boundary instead. Two guards keep it from eating real
// work: a short sleep before the next step is normal and stays allowed, and a command that only waits
// (or checks a port, or sleeps before running a command) never reads a file, so it does not match.
export const pollTimings = { minSeconds: 20 }
const SLEEP_SECONDS = /(?:Start-Sleep\s+(?:-Seconds\s+|-s\s+)?(\d+))|(?<![\w-])sleep\s+(\d+)/gi
const OUTPUT_READ = /Get-Content|Get-ChildItem|Test-Path|Get-Item|(?<![\w-])(?:cat|tail|head|less|more)\s+\S/i

export const pollingWaitNotice = (seconds: number) =>
  `This command sleeps for ${seconds}s and then reads a file, which blocks the session for the whole wait. Start the long-running part with background: true instead — it returns a shell ID immediately and you are notified with the output when it finishes — then read the output after that notification. If you only need a short pause before the next step, sleep for less than ${pollTimings.minSeconds}s.`

export const detectPollingWait = (input: { command?: string | undefined; background?: boolean | undefined }) => {
  // A backgrounded command never blocks this call, so its own sleeping loop is none of our business.
  if (input.background === true) return undefined
  const command = input.command
  if (!command) return undefined
  let longest = 0
  for (const match of command.matchAll(SLEEP_SECONDS)) {
    const seconds = Number(match[1] ?? match[2])
    if (Number.isFinite(seconds)) longest = Math.max(longest, seconds)
  }
  if (longest < pollTimings.minSeconds) return undefined
  if (!OUTPUT_READ.test(command)) return undefined
  return pollingWaitNotice(longest)
}

/**
 * SiCode: Flash (ses_e6cda) walked `Get-ChildItem D:\ -Recurse` with no `-Depth` and blocked for
 * nearly a minute before interrupt. Words in the tool description did not stop it — reject the
 * shape at the boundary, same pattern as `detectPollingWait`. Require `-Depth` (or find
 * `-maxdepth`) so a synonym batch / filter still has a ceiling.
 */
export const UNBOUNDED_RECURSE_NOTICE =
  "This command recurses without a depth limit (Get-ChildItem -Recurse without -Depth, or find without -maxdepth), which can scan an entire drive and block the session. Add -Depth N (PowerShell) or -maxdepth N (find), narrow the path/Filter, and prefer hosts/vhost/config text search for a domain. Do not re-run an unbounded recurse."

export const detectUnboundedRecurse = (input: { command?: string | undefined }) => {
  const command = input.command
  if (!command) return undefined
  // PowerShell listing: -Recurse without -Depth. Do not treat bare -r (collides with other switches).
  if (/\b(?:Get-ChildItem|gci)\b/i.test(command) && /-[Rr]ecurse\b/.test(command) && !/-Depth\b/i.test(command))
    return UNBOUNDED_RECURSE_NOTICE
  // Unix find (not findstr / Find-*). Require -maxdepth whenever find walks a path.
  if (/(?:^|[;&|\n]\s*)find\s+/i.test(command) && !/\bfindstr\b/i.test(command) && !/-maxdepth\b/i.test(command))
    return UNBOUNDED_RECURSE_NOTICE
  return undefined
}

/**
 * SiCode: Flash (ses_e77146) spent 7.7 minutes on bare `rg` over `D:\` via shell — no deadline,
 * no trigram prefilter, no "use the grep tool" signal. Words in Prefer-dedicated-tools did not
 * stop it. Reject content-search shapes at the boundary (same pattern as detectPollingWait).
 * Leave version/help probes and pipe filters (`ps | grep`) alone.
 */
export const CONTENT_SEARCH_NOTICE =
  "This command searches file contents via the shell (rg / grep -r / Select-String / findstr /s). Use the grep tool instead — it has a deadline, trigram prefilter, and path/include narrowing. Pass path for directories outside the workspace (external_directory approval applies). Do not re-run the same search via shell."

const contentSearchVersionOnly = (afterBinary: string) =>
  /^(?:--version|-V|--help|-h)?\s*$/.test(afterBinary.trim())

export const detectContentSearch = (input: { command?: string | undefined }) => {
  const command = input.command
  if (!command) return undefined
  // PowerShell content search — always better as the grep tool.
  if (/\bSelect-String\b/i.test(command)) return CONTENT_SEARCH_NOTICE
  // findstr /s is recursive content search across files.
  if (/\bfindstr\b/i.test(command) && /\/[A-Za-z]*s/i.test(command)) return CONTENT_SEARCH_NOTICE
  // Standalone rg / ripgrep (not a pipe filter). Allow bare --version / --help.
  const rg = command.match(/(?:^|[;&|\n]\s*|&&\s*)(?:rg|ripgrep)\b(.*)$/is)
  if (rg && !contentSearchVersionOnly(rg[1] ?? "")) return CONTENT_SEARCH_NOTICE
  // Recursive grep / egrep only — `ps | grep foo` and single-file grep stay allowed.
  // Flag clusters like `-rn` keep letters after `r`, so do not require a word boundary at `r`.
  if (
    /(?:^|[;&|\n]\s*|&&\s*)(?:e?grep)\b/i.test(command) &&
    /(?:^|\s)(?:-[A-Za-z]*[rR][A-Za-z]*|--recursive)\b/.test(command)
  )
    return CONTENT_SEARCH_NOTICE
  return undefined
}

/**
 * SiCode: Flash (ses_e5b6962c) burned 120s on `$rb = Shell.Application.Namespace(10); $rb.Items()`
 * looking for a deleted .sav — Recycle Bin COM enumeration has no depth knob, so unbounded-recurse
 * and content-search detectors never fire. Reject the shape at the boundary.
 */
export const SLOW_ENUM_NOTICE =
  "This command enumerates the Recycle Bin or a Shell.Application Items() collection without a bound, which can block the session for the full shell timeout. Do not scan the Recycle Bin via COM; search known save/install paths with Get-ChildItem -Depth N, or ask the user. If you must list Shell items, pipe through Select-Object -First N."

export const detectSlowEnumeration = (input: { command?: string | undefined }) => {
  const command = input.command
  if (!command) return undefined
  // Namespace(10) is the Recycle Bin folder — the ses_e5b6962c 120s timeout.
  if (/Namespace\s*\(\s*10\s*\)/i.test(command)) return SLOW_ENUM_NOTICE
  // Direct filesystem walk of $Recycle.Bin (any drive) without -Depth / -First.
  if (
    /\$Recycle\.Bin\b/i.test(command) &&
    /\b(?:Get-ChildItem|gci|dir)\b/i.test(command) &&
    !/-Depth\b/i.test(command) &&
    !/Select-Object\s+-First\b/i.test(command)
  )
    return SLOW_ENUM_NOTICE
  // Any Shell.Application Items() walk without an explicit -First cap.
  if (
    /Shell\.Application/i.test(command) &&
    /\.Items\s*\(/i.test(command) &&
    !/Select-Object\s+-First\b/i.test(command) &&
    !/\|\s*%\s*{[^}]{0,80}-First\b/i.test(command)
  )
    return SLOW_ENUM_NOTICE
  return undefined
}

/**
 * SiCode: ses_e537b4fa — model wrapped `pnpm pack:release` in `| Select-Object -Last 40` (+
 * background). Select-Object -Last buffers until EOF; nested `powershell -File` + Start-Job then
 * deadlocks on Wait-Job under a piped parent. User's own terminal finished in <1 min; the agent
 * hung for hours. Same idea as detectPollingWait: words in the tool description taught the bad
 * shape, so reject it at the boundary. Allow Get-Content/gc of an existing file — that is a real
 * log slice, not a live producer.
 */
export const TAIL_PIPE_NOTICE =
  "This command pipes a live process through Select-Object -Last / tail, which buffers until the process exits and can hang PowerShell Start-Job builds for hours. Run the command bare (no Select-Object -Last / tail pipe, prefer foreground for packs/builds whose exit you need). The tool already returns a head+tail preview and saves the full output to a file — open that path, or Get-Content <log> | Select-Object -Last N after the command finishes. Do not re-run the piped form."

/** Left of a tail pipe that is only reading an already-written file — safe. */
const FILE_TAIL_PRODUCER =
  /^(?:Get-Content|gc|Get-Content\.exe|type|cat)\b/i

export const detectTailPipeHang = (input: { command?: string | undefined }) => {
  const command = input.command
  if (!command) return undefined

  // PowerShell: … | Select-Object … -Last …
  const psLast = command.match(/^(.*?)\|\s*Select-Object\b([^|]*)$/is)
  if (psLast) {
    const left = (psLast[1] ?? "").trim()
    const args = psLast[2] ?? ""
    if (/-Last\b/i.test(args) && left && !FILE_TAIL_PRODUCER.test(left.split(/\|/).pop()?.trim() ?? left))
      return TAIL_PIPE_NOTICE
  }

  // Multi-stage: … | Tee-Object … | Select-Object -Last … (ses_e537b4fa retry)
  if (
    /\|\s*Tee-Object\b/i.test(command) &&
    /\|\s*Select-Object\b[^|]*-Last\b/i.test(command) &&
    !FILE_TAIL_PRODUCER.test(command.trim())
  )
    return TAIL_PIPE_NOTICE

  // Bash / git-bash: live producer | tail -n N (EOF buffering; same habit the description used to teach)
  const bashTail = command.match(/^(.*?)\|\s*tail\b(.*)$/is)
  if (bashTail) {
    const left = (bashTail[1] ?? "").trim()
    if (left && !FILE_TAIL_PRODUCER.test(left.split(/\|/).pop()?.trim() ?? left)) return TAIL_PIPE_NOTICE
  }

  return undefined
}

/**
 * SiCode: on PowerShell, bash-only shapes (`tail`, `for x in`, `sed`, `ls -la`, `<<`) exit 1 and
 * paint red Shell cards while teaching nothing. Reject at the boundary with PS equivalents.
 * Only when the session shell is PowerShell (`ShellSelect.ps`); Linux/mac bash stays untouched.
 */
export const BASH_ON_POWERSHELL_NOTICE =
  "This command uses bash syntax, but the session shell is PowerShell. Rewrite it: use `Select-Object -Last/-First` instead of `tail`/`head`, `foreach ($x in …)` instead of `for x in`, `Get-Content` instead of `sed`/`cat`, `Get-ChildItem` instead of `ls -…`, and never use bash here-strings (`<<`). Do not re-run the bash form."

export const detectBashOnPowerShell = (input: {
  command?: string | undefined
  /** Absolute path or name of the session shell binary. */
  shell?: string | undefined
}) => {
  if (!input.shell || !ShellSelect.ps(input.shell)) return undefined
  const command = input.command
  if (!command) return undefined
  // Pipe filters and bare tools that do not exist as PowerShell cmdlets.
  if (/\|\s*(?:tail|head)\b/i.test(command)) return BASH_ON_POWERSHELL_NOTICE
  if (/(?:^|[;&|\n]\s*|&&\s*)(?:tail|head)\b/i.test(command)) return BASH_ON_POWERSHELL_NOTICE
  if (/(?:^|[;&|\n]\s*|&&\s*)for\s+\w+\s+in\s+/i.test(command)) return BASH_ON_POWERSHELL_NOTICE
  if (/(?:^|[;&|\n]\s*|&&\s*)sed\b/i.test(command)) return BASH_ON_POWERSHELL_NOTICE
  if (/(?:^|[;&|\n]\s*|&&\s*)ls\s+-/i.test(command)) return BASH_ON_POWERSHELL_NOTICE
  if (/(?:^|[;&|\n]\s*|&&\s*)cat\b/i.test(command)) return BASH_ON_POWERSHELL_NOTICE
  // Bash heredoc / here-string — invalid in PowerShell.
  if (/<<<?-?\s*['"]?\w+/.test(command)) return BASH_ON_POWERSHELL_NOTICE
  return undefined
}

const BACKGROUND_INSTRUCTION =
  "You will be notified automatically when the command finishes. The notification will include the command's output. Unless the user explicitly asks otherwise, DO NOT poll for completion, even if you need the final result to continue. Repeatedly sleeping and reading or searching the output file is polling, not useful work. You may read the current output if it lets you do useful work now, but do not repeatedly check it while waiting for the command to finish. Keep working on anything that does not depend on the result. If you have nothing else to do, end your response; you will be resumed automatically when the command finishes."
const OS =
  process.platform === "darwin"
    ? "macOS"
    : process.platform === "win32"
      ? "Windows"
      : process.platform === "linux"
        ? "Linux"
        : process.platform
const description = (shell?: string) =>
  [
    "Execute a shell command and return its output.",
    ...(shell ? [`Commands run on ${OS} using ${shell}.`] : []),
    // SiCode: on Windows the session shell is PowerShell, where a bash here-string (`<<`) and an
    // input redirect (`<`) are not valid syntax. The portable scanner rejects those commands before
    // they run, and without this line the model has nothing to tell it which dialect to write.
    ...(shell && ShellSelect.ps(shell)
      ? [
          `Write PowerShell syntax, not bash: here-strings (\`<<\`), \`for x in\`, \`tail\`/\`head\`, \`sed\`, \`ls -…\`, and \`cat\` are invalid or wrong in ${shell}.`,
          "Use `foreach`, `Get-Content`, and `Get-ChildItem` instead. For an already-written log, `Get-Content <file> | Select-Object -Last N` (or `Get-Content -Tail N`) is fine — never pipe a live build/pack through Select-Object -Last.",
          "To pass a multi-line script or file on stdin, write it to a file first and pipe it, for example `Get-Content -Raw script.txt | <command>`.",
        ]
      : []),
    "Quote file paths containing spaces or special characters.",
    "Prefer dedicated tools over shell commands when possible.",
    "Search file contents with the grep tool, not rg / Select-String / findstr / grep -r in the shell.",
    "When output is large, only a short head+tail preview is returned and the full result is saved to a file. Do not pipe long-running builds through Select-Object -Last or tail — that buffers until exit and can hang PowerShell Start-Job scripts for hours. Run the command bare; open the saved path, or Get-Content the log afterward.",
    "Do not re-run the same dump hoping for more inline text; open the saved path or narrow the command.",
    "Commands accept an optional timeout, background commands default to a 24 hour timeout.",
    "Background commands return immediately, and you will be notified when they complete. Prefer foreground for packs/builds whose exit status you need; use background for long-lived servers/watchers.",
    "Read a background command's recent output with read: <shellID>, and list the ones this session is running with list: true, instead of sleeping and then reading its output file.",
    "If a background command stops producing output, you will be notified with its recent output so you can judge whether it is stuck.",
    "Set kill to a background command's shell ID to stop it instead of running a new command.",
  ].join(" ")

// SiCode: shared with `watchForStall` and the `read`/`list` branches — one phrasing of an elapsed
// span so a stall notice and a check-in describe the same duration the same way.
const span = (ms: number) =>
  ms < 120_000 ? `${Math.max(1, Math.round(ms / 1000))} seconds` : `${Math.round(ms / 60_000)} minutes`

export const Input = Schema.Struct({
  command: Schema.optionalKey(Schema.String).annotate({
    description: "Shell command string to execute. Omit when kill, read, or list is set.",
  }),
  kill: Schema.optionalKey(Schema.String).annotate({
    description:
      "Shell ID of a background command to stop instead of executing a command. The command you will be notified about includes its shell ID.",
  }),
  // SiCode: the model could start a background command but never look at it again — the notification
  // only arrives when it finishes, or after the stall window. Checking whether a server came up, or
  // why it exited immediately, meant killing and re-running it: a whole step (~6s) per check.
  // `read` returns the same bounded tail a finished command returns, while it is still running.
  read: Schema.optionalKey(Schema.String).annotate({
    description:
      "Shell ID of a background command whose output to read instead of executing a command. Returns the recent output and whether it is still running. Use this once to check on a background command; do not loop on it while waiting for it to finish.",
  }),
  // SiCode: after a compaction the model no longer remembers which background commands it started,
  // and `read` needs an ID. `list` answers that from the shell pool without a new tool.
  list: Schema.optionalKey(Schema.Boolean).annotate({
    description:
      "List the background commands still running in this session, with their shell IDs and elapsed time, instead of executing a command.",
  }),
  workdir: Schema.optionalKey(Schema.String).annotate({
    description:
      "Working directory to execute the command in. Defaults to the current working directory. When possible, avoid changing directories in the command and set the working directory here instead.",
  }),
  timeout: Schema.optionalKey(NonNegativeInt).annotate({
    description: `Timeout in milliseconds. Set to 0 to disable the timeout. Defaults to ${DEFAULT_TIMEOUT_MS} for foreground commands and ${DEFAULT_BACKGROUND_TIMEOUT_MS} for background commands.`,
  }),
  background: Schema.optionalKey(Schema.Boolean).annotate({
    description:
      "Run the command in the background and return immediately (useful for dev servers and watchers). Prefer foreground for packs/builds whose exit status you need. You do not need to use '&' at the end of the command when using this parameter. You will be notified when it completes. DO NOT poll for completion.",
  }),
})

const StructuredOutput = Schema.Struct({
  exit: Schema.optionalKey(Schema.Number),
  signal: Schema.optionalKey(Schema.String),
  shellID: Schema.optionalKey(Schema.String),
  truncated: Schema.Boolean,
  timeout: Schema.optionalKey(Schema.Boolean),
})

const Output = Schema.Struct({
  ...StructuredOutput.fields,
  output: Schema.String,
  status: Schema.optionalKey(Schema.Literals(["completed", "running"])),
})

type Output = typeof Output.Type

const resultMessages = (output: Output, extra?: string | undefined) => {
  const notice = output.status === "running" ? BACKGROUND_INSTRUCTION : ShellResult.notice(output)
  return [...(output.output ? [output.output] : []), ...(notice ? [notice] : []), ...(extra ? [extra] : [])]
}

const toolResult = (output: Output, extra?: string | undefined) => {
  return {
    output,
    content: resultMessages(output, extra).map((text) => ({ type: "text" as const, text })),
    metadata: {
      status: output.status,
      ...ShellResult.metadata(output),
      ...(output.shellID !== undefined ? { shellID: output.shellID } : {}),
    },
  }
}

const backgroundResult = (shellID: string, file: string, peers?: string) => ({
  output: `Command moved to the background (shell ID: ${shellID}).\nOutput is streaming to: ${file}${peers ? `\n\n${peers}` : ""}`,
  shellID,
  truncated: false,
  status: "running" as const,
})

export const Plugin = {
  id: "opencode.tool.shell",
  effect: Effect.fn("ShellTool.Plugin")(function* (ctx: Context) {
    const sessions = yield* Session.Service
    const jobs = yield* Job.Service
    const scope = yield* Scope.Scope
    const environment = yield* Environment.Service
    const access = yield* FileAccess.Service
    const shell = yield* Shell.Service
    const shellSelect = yield* ShellSelect.Service
    const compatibleShell = shellSelect.resolve({ priority: "compat" })
    // SiCode: name the dialect this session runs so the tool description can warn about bash-only
    // syntax. Resolved once here because registration is synchronous; a shell change applies on restart.
    const sessionShell = ShellSelect.name(yield* shellSelect.resolve({ priority: "config" }))
    const permission = yield* Permission.Service
    const config = yield* Config.Service

    const prepare = Effect.fn("ShellTool.prepare")(function* (invocation: ShellCreateBefore, context: Tool.Context) {
      const source = {
        type: "tool" as const,
        messageID: context.messageID,
        id: context.id,
      }
      const target = yield* access.resolve({ path: invocation.cwd, kind: "directory" })
      invocation.cwd = target.absolute
      const timeout = invocation.timeout
      const portable =
        Config.latest(yield* config.entries(), "experimental")?.portable_shell_scanner ??
        (shellParserWasm.bash === "" || ctx.app.channel === "local" || ctx.app.channel === "dev")
      const parsed = yield* ShellParse.scan(invocation.command, invocation.shell, target.absolute, { portable })
      const directories = yield* Effect.forEach(parsed.directories, (directory) =>
        access.resolve({
          path: FileAccess.resolvePath(target.absolute, directory),
          kind: "directory",
        }),
      )
      yield* access.authorizeExternal([target, ...directories], context)
      if (parsed.commands.length > 0)
        yield* permission.assert({
          action: name,
          resources: parsed.commands.map((command) => command.resource),
          save: parsed.commands.map((command) => command.save),
          sessionID: context.sessionID,
          agent: context.agent,
          source,
        })
      // Approval can outlive the directory, so validate immediately before spawning.
      const workdir = yield* Environment.typeFollowing(environment.files, target.absolute).pipe(
        Effect.catchTag("Environment.NotFound", () =>
          Effect.fail(new Error(`Working directory does not exist: ${target.absolute}`)),
        ),
      )
      if (workdir !== "directory")
        return yield* Effect.fail(new Error(`Working directory is not a directory: ${target.absolute}`))
      return timeout
    })

    const notifyWhenDone = Effect.fn("ShellTool.notifyWhenDone")(
      function* (
        sessionID: SessionSchema.ID,
        id: string,
        shellID: string,
        command: string,
        settled: Deferred.Deferred<Output>,
      ) {
        const info = (yield* jobs.wait({ id })).info
        if (!info || info.status === "running") return
        const output = info.status === "completed" ? yield* Deferred.await(settled) : undefined
        const text = output
          ? resultMessages(output).join("\n\n")
          : info.status === "error"
            ? (info.error ?? "Command failed")
            : "Cancelled"
        yield* sessions.synthetic({
          ...(info.notificationID ? { id: info.notificationID } : {}),
          sessionID,
          description: command,
          ...ShellResult.notification({
            jobID: id,
            shellID,
            command,
            state: info.status,
            text,
            output,
          }),
        })
        if (info.notificationID) yield* jobs.completeBackground(info.notificationID)
      },
      Effect.forkIn(scope, { startImmediately: true }),
    )

    // Bounded recent output for a still-running shell, using the same limits as a finished result.
    const tail = Effect.fn("ShellTool.tail")(function* (id: ShellSchema.ID) {
      const limits = Config.latest(yield* config.entries(), "tool_output")
      const maxBytes = limits?.max_bytes ?? ToolOutput.MAX_BYTES
      const maxLines = limits?.max_lines ?? ToolOutput.MAX_LINES
      const latest = yield* shell.output(id, { cursor: Number.MAX_SAFE_INTEGER })
      if (latest.size === 0) return { text: "(no output yet)", truncated: false }
      const page = yield* shell.output(id, { cursor: Math.max(0, latest.size - maxBytes), limit: maxBytes })
      const lines = page.output.split("\n")
      if (page.output.endsWith("\n")) lines.pop()
      const truncated = lines.length > maxLines
      const text = (truncated ? lines.slice(-maxLines).join("\n") : page.output).trimEnd()
      return { text: text || "(no output yet)", truncated }
    })

    // SiCode: a background command that has gone silent gives the model nothing to reconsider.
    // Once output stops growing for `stallTimings.notifyMs`, send one notification per silent
    // stretch with the recent output, so the model can look at the progress and decide whether to
    // stop the command (kill) or keep waiting for it.
    const watchForStall = Effect.fn("ShellTool.watchForStall")(
      function* (sessionID: SessionSchema.ID, shellID: ShellSchema.ID, command: string) {
        let lastSize: number | undefined
        let silentSince = 0
        let notified = false
        while (true) {
          yield* Effect.sleep(Duration.millis(stallTimings.pollMs))
          const info = yield* Effect.option(shell.get(shellID))
          if (Option.isNone(info) || info.value.status !== "running") return
          const current = yield* Effect.option(shell.output(shellID, { cursor: Number.MAX_SAFE_INTEGER }))
          if (Option.isNone(current)) return
          const now = Date.now()
          if (current.value.size !== lastSize) {
            lastSize = current.value.size
            silentSince = now
            notified = false
            continue
          }
          if (notified || now - silentSince < stallTimings.notifyMs) continue
          notified = true
          const captured = yield* tail(shellID)
          yield* sessions.synthetic({
            sessionID,
            description: command,
            ...ShellResult.notification({
              shellID,
              command,
              state: "running",
              text: [
                `Background command has produced no new output for ${span(now - silentSince)} (running for ${span(now - info.value.time.started)}).`,
                `Recent output:\n${captured.text}`,
                `Judge from the output whether the command is stuck. If it is, stop it by calling the shell tool with kill set to "${shellID}" and try a different approach. If it is normally quiet once running (a dev server, a watcher), keep waiting; you will be notified when it finishes.`,
              ].join("\n\n"),
            }),
          })
        }
      },
      Effect.forkIn(scope, { startImmediately: true }),
    )

    // SiCode: sessions in one project share the shell pool, but their models cannot see each
    // other. A background command may collide with work another session (or a user terminal) is
    // already doing, so say so once, at backgrounding time. Foreground commands stay silent —
    // their collision window is seconds, not hours.
    const peerNotice = Effect.fn("ShellTool.peerNotice")(function* (
      self: ShellSchema.ID,
      sessionID: SessionSchema.ID,
      command: string,
    ) {
      const peers = (yield* shell.list()).filter(
        (running) => running.id !== self && running.metadata.sessionID !== sessionID,
      )
      if (peers.length === 0) return undefined
      const same = peers.filter((peer) => peer.command === command)
      const others = peers.filter((peer) => peer.command !== command)
      return [
        ...(same.length > 0
          ? [
              `Another command already running in this project is identical (shell ID: ${same.map((peer) => peer.id).join(", ")}); a second copy may conflict with it.`,
            ]
          : []),
        ...(others.length > 0
          ? [
              `Other commands already running in this project (started elsewhere, not by this conversation): ${others.map((peer) => `${peer.command} (shell ID: ${peer.id})`).join("; ")}.`,
            ]
          : []),
      ].join("\n")
    })

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description: description(sessionShell),
          input: Input,
          output: Output,
          execute: (input, context) => {
            // Set when the tool starts blocked-waiting, so the reported cost is the wait itself and
            // not time spent in a permission prompt. Stays 0 for the paths that never block.
            let waitedFrom = 0
            return Effect.gen(function* () {
              // SiCode: stop a background command instead of starting a new one. Removal kills a
              // running process through its scope-bound handle, so this is more reliable than
              // shelling out to kill the pid.
              if (input.kill !== undefined) {
                if (input.command !== undefined || input.read !== undefined || input.list === true)
                  return yield* Effect.fail(new Error("Provide only one of command, kill, read, or list."))
                const stopped = yield* shell.get(ShellSchema.ID.make(input.kill))
                yield* shell.remove(stopped.id)
                return {
                  output: `Stopped background command (shell ID: ${stopped.id}).\nCommand: ${stopped.command}`,
                  shellID: stopped.id,
                  truncated: false,
                }
              }
              // SiCode: check on a background command without waiting for its notification. This is
              // the one reading of its output that is not polling: the model asks once, gets the
              // bounded tail plus whether it is still running, and then leaves it alone.
              if (input.read !== undefined) {
                if (input.command !== undefined || input.list === true)
                  return yield* Effect.fail(new Error("Provide only one of command, kill, read, or list."))
                const target = yield* shell.get(ShellSchema.ID.make(input.read))
                const captured = yield* tail(target.id)
                const elapsed = span(Date.now() - target.time.started)
                return {
                  output: [
                    `<shell id="${target.id}" state="${target.status}" command="${target.command}">`,
                    captured.text,
                    "</shell>",
                    ...(target.status === "running"
                      ? [
                          `Still running (${elapsed}). You will be notified when it finishes; do not read it again unless the output is needed for work you can do now.`,
                        ]
                      : [
                          `Finished after ${elapsed}${target.exit !== undefined && target.exit !== 0 ? ` with exit code ${target.exit}` : ""}.`,
                        ]),
                    ...(captured.truncated ? ["Only the most recent output is shown."] : []),
                  ].join("\n"),
                  shellID: target.id,
                  truncated: captured.truncated,
                  status: target.status === "running" ? ("running" as const) : ("completed" as const),
                }
              }
              // SiCode: after a compaction the model no longer remembers which background commands it
              // started, and `read` needs an ID. The shell pool already knows; this just asks it.
              if (input.list === true) {
                if (input.command !== undefined) return yield* Effect.fail(new Error("Provide only one of command, kill, read, or list."))
                const running = (yield* shell.list()).filter((info) => info.metadata.sessionID === context.sessionID)
                if (running.length === 0)
                  return {
                    output: "No background commands are running in this session.",
                    truncated: false,
                  }
                return {
                  output: [
                    `Background commands running in this session (${running.length}):`,
                    ...running.map((info) => `  ${info.id}: ${info.command} (${span(Date.now() - info.time.started)})`),
                  ].join("\n"),
                  truncated: false,
                }
              }
              if (input.command === undefined) return yield* Effect.fail(new Error("A command is required."))
              // SiCode: reject the polling shape before it starts, so the wait never happens. See
              // detectPollingWait for why a notice is not enough.
              const polling = detectPollingWait(input)
              if (polling) return yield* Effect.fail(new Error(polling))
              // SiCode: same idea for drive-wide Get-ChildItem -Recurse / find without maxdepth.
              const unbounded = detectUnboundedRecurse(input)
              if (unbounded) return yield* Effect.fail(new Error(unbounded))
              // SiCode: bare rg / Select-String via shell burned minutes with no deadline — route to grep.
              const contentSearch = detectContentSearch(input)
              if (contentSearch) return yield* Effect.fail(new Error(contentSearch))
              // SiCode: Recycle Bin / Shell.Application Items() has no -Depth — refuse before spawn.
              const slowEnum = detectSlowEnumeration(input)
              if (slowEnum) return yield* Effect.fail(new Error(slowEnum))
              // SiCode: live | Select-Object -Last / tail hangs Start-Job packs (ses_e537b4fa).
              const tailPipe = detectTailPipeHang(input)
              if (tailPipe) return yield* Effect.fail(new Error(tailPipe))
              // SiCode: bash-only shapes on PowerShell exit 1 and burn turns — refuse before spawn.
              const sessionShellPath = yield* compatibleShell
              const bashOnPs = detectBashOnPowerShell({ command: input.command, shell: sessionShellPath })
              if (bashOnPs) return yield* Effect.fail(new Error(bashOnPs))
              // SiCode: default a model-invoked background command to a 24h lifetime instead of no
              // timeout, so an unreaped server or watcher cannot run forever.
              const timeout = resolveTimeout(input)
              let finalTimeout = timeout
              const info = yield* shell.create(
                {
                  command: input.command,
                  cwd: input.workdir,
                  timeout,
                  shell: sessionShellPath,
                  metadata: { sessionID: context.sessionID },
                },
                (invocation) =>
                  Effect.gen(function* () {
                    invocation.env.AGENT = "1"
                    invocation.env.OPENCODE = "1"
                    invocation.env.AI_AGENT ||= "opencode"
                    invocation.env.OPENCODE_SESSION_ID = context.sessionID
                    // SiCode: Windows consoles often use a legacy code page; Python then raises
                    // UnicodeEncodeError on print after a successful write (ses_e507 D _probe_v2).
                    invocation.env.PYTHONUTF8 = "1"
                    invocation.env.PYTHONIOENCODING ||= "utf-8"
                    finalTimeout = yield* prepare(invocation, context)
                  }),
              )
              yield* context.progress({ shellID: info.id })

              const settled = yield* Deferred.make<Output>()
              const run = Effect.gen(function* () {
                const result = yield* shell.result(info)
                if (!result.capture) return yield* new Shell.NotFoundError({ id: info.id })
                const output = ShellResult.output(result)
                return {
                  ...output,
                  output: output.timeout
                    ? `${output.output}\n\nCommand exceeded timeout of ${finalTimeout} ms. Retry with a larger timeout if the command is expected to take longer.`
                    : output.output,
                  status: "completed" as const,
                }
              }).pipe(
                Effect.tap((output) => Deferred.succeed(settled, output)),
                Effect.map((output) => resultMessages(output).join("\n\n")),
                Effect.onInterrupt(() => shell.remove(info.id).pipe(Effect.ignore)),
              )
              const job = yield* jobs.start({
                // CodeMode children share a tool-call ID, but each shell must own its job.
                id: info.id,
                type: name,
                title: info.command,
                metadata: { sessionID: context.sessionID, shellID: info.id },
                recovery: {
                  kind: "shell",
                  sessionID: context.sessionID,
                  shellID: info.id,
                  command: info.command,
                },
                run,
              })

              if (input.background === true) {
                yield* jobs.background(job.id)
                const peers = yield* peerNotice(info.id, context.sessionID, input.command)
                yield* notifyWhenDone(context.sessionID, job.id, info.id, info.command, settled)
                yield* watchForStall(context.sessionID, info.id, info.command)
                return backgroundResult(info.id, info.file, peers)
              }

              waitedFrom = Date.now()
              const result = yield* jobs
                .block({ id: job.id, sessionID: context.sessionID })
                .pipe(Effect.onInterrupt(() => jobs.cancel(job.id).pipe(Effect.ignore)))
              if (result?.type === "backgrounded") {
                yield* shell.timeout(info.id, backgroundedTimeout(input))
                const peers = yield* peerNotice(info.id, context.sessionID, input.command)
                yield* notifyWhenDone(context.sessionID, job.id, info.id, info.command, settled)
                yield* watchForStall(context.sessionID, info.id, info.command)
                return backgroundResult(info.id, info.file, peers)
              }
              if (result?.info.status === "error")
                return yield* Effect.fail(new Error(result.info.error ?? "Command failed"))
              if (result?.info.status === "cancelled") return yield* Effect.fail(new Error("Command cancelled"))

              return yield* Deferred.await(settled)
            }).pipe(
              Effect.map((output) =>
                toolResult(output, slowNotice(waitedFrom === 0 ? 0 : Date.now() - waitedFrom, output.output.length)),
              ),
              Effect.mapError(
                (error) =>
                  new ToolFailure({
                    message: `Unable to ${input.read !== undefined ? "read the background command" : input.list === true ? "list background commands" : "execute command"}: ${input.command ?? input.read ?? ""}`,
                    error,
                  }),
              ),
            )
          },
        }),
      )
      .pipe(Effect.orDie)

    const hook = (event: SessionHooks["context"]) =>
      Effect.gen(function* () {
        const tool = event.tools[name]
        if (!tool) return
        tool.description = description(ShellSelect.name(yield* compatibleShell))
      })
    yield* ctx.session.hook("context", hook)
    yield* ctx.session.hook("compaction", hook)
    yield* ctx.session.hook("generate", hook)
  }),
}
