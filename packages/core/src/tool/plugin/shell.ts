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
    "Quote file paths containing spaces or special characters.",
    "Prefer dedicated tools over shell commands when possible.",
    "When output is large, the full result is saved to a file and a truncated preview is returned.",
    "Rely on automatic truncation unless filtering the output is more useful.",
    "Commands accept an optional timeout, background commands default to a 24 hour timeout.",
    "Background commands return immediately, and you will be notified when they complete.",
    "If a background command stops producing output, you will be notified with its recent output so you can judge whether it is stuck.",
    "Set kill to a background command's shell ID to stop it instead of running a new command.",
  ].join(" ")

export const Input = Schema.Struct({
  command: Schema.optionalKey(Schema.String).annotate({
    description: "Shell command string to execute. Omit when kill is set.",
  }),
  kill: Schema.optionalKey(Schema.String).annotate({
    description:
      "Shell ID of a background command to stop instead of executing a command. The command you will be notified about includes its shell ID.",
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
      "Run the command in the background and return immediately (useful for dev servers and long-running builds). You do not need to use '&' at the end of the command when using this parameter. You will be notified when it completes. DO NOT poll for completion.",
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

const resultMessages = (output: Output) => {
  const notice = output.status === "running" ? BACKGROUND_INSTRUCTION : ShellResult.notice(output)
  return [...(output.output ? [output.output] : []), ...(notice ? [notice] : [])]
}

const toolResult = (output: Output) => {
  return {
    output,
    content: resultMessages(output).map((text) => ({ type: "text" as const, text })),
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
        const span = (ms: number) =>
          ms < 120_000
            ? `${Math.max(1, Math.round(ms / 1000))} seconds`
            : `${Math.round(ms / 60_000)} minutes`
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
          description: description(),
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              // SiCode: stop a background command instead of starting a new one. Removal kills a
              // running process through its scope-bound handle, so this is more reliable than
              // shelling out to kill the pid.
              if (input.kill !== undefined) {
                if (input.command !== undefined)
                  return yield* Effect.fail(new Error("Provide either a command or kill, not both."))
                const stopped = yield* shell.get(ShellSchema.ID.make(input.kill))
                yield* shell.remove(stopped.id)
                return {
                  output: `Stopped background command (shell ID: ${stopped.id}).\nCommand: ${stopped.command}`,
                  shellID: stopped.id,
                  truncated: false,
                }
              }
              if (input.command === undefined) return yield* Effect.fail(new Error("A command is required."))
              // SiCode: default a model-invoked background command to a 24h lifetime instead of no
              // timeout, so an unreaped server or watcher cannot run forever.
              const timeout = resolveTimeout(input)
              let finalTimeout = timeout
              const info = yield* shell.create(
                {
                  command: input.command,
                  cwd: input.workdir,
                  timeout,
                  shell: yield* compatibleShell,
                  metadata: { sessionID: context.sessionID },
                },
                (invocation) =>
                  Effect.gen(function* () {
                    invocation.env.AGENT = "1"
                    invocation.env.OPENCODE = "1"
                    invocation.env.AI_AGENT ||= "opencode"
                    invocation.env.OPENCODE_SESSION_ID = context.sessionID
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

              const result = yield* jobs
                .block({ id: job.id, sessionID: context.sessionID })
                .pipe(Effect.onInterrupt(() => jobs.cancel(job.id).pipe(Effect.ignore)))
              if (result?.type === "backgrounded") {
                yield* shell.timeout(info.id, 0)
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
              Effect.map(toolResult),
              Effect.mapError(
                (error) => new ToolFailure({ message: `Unable to execute command: ${input.command}`, error }),
              ),
            ),
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
