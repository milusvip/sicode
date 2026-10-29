import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { AppProcess } from "@opencode/util/process"
import { Context, Effect, Layer, Schema } from "effect"
import { Agent } from "@opencode/core/agent"
import { Location } from "@opencode/core/location"
import { Plugin } from "@opencode/core/plugin"
import { SyntaxCheckPlugin } from "@opencode/core/plugin/syntax-check"
import { Session } from "@opencode/core/session"
import { SessionMessage } from "@opencode/core/session/message"
import { Tool } from "@opencode/core/tool"
import { testEffect } from "../lib/effect"
import { tempGlobalLayer } from "../fixture/global"
import { makePluginTestLayer } from "./fixture"

// The unit tests call the hook directly, which proves the logic but not that the hook is reached.
// This file goes through `Plugin.Service.activate` and the real tool registry — the path a live
// `write` call takes — so a mis-registered hook or a wrong event shape fails here.
const it = testEffect(Layer.mergeAll(makePluginTestLayer(), tempGlobalLayer))

const identity = {
  sessionID: Session.ID.make("ses_syntax_integration"),
  agent: Agent.ID.make("build"),
  messageID: SessionMessage.ID.make("msg_syntax_integration"),
}

// Production supplies internal plugins their services in `PluginInternal.list`, which captures
// `Effect.context` and re-provides it. Doing the same keeps this test honest: without it the plugin
// dies with "Service not found: @opencode/FSUtil", which is what the first version of this test hit.
const captureServices = Effect.context<FSUtil.Service | Global.Service | Location.Service | AppProcess.Service>()

/**
 * Stands in for the real `write`: same name, same `path` input, really writes the file.
 *
 * The directory is resolved by the caller because a registered tool's `execute` must not require
 * services of its own — the registry runs it with none in scope.
 */
const writerTool = (directory: string) => ({
  id: "syntax-check-test-writer",
  revision: "1",
  effect: (context: Parameters<typeof SyntaxCheckPlugin.Plugin.effect>[0]) =>
    context.tool.transform((draft) =>
      draft.add({
        name: "write",
        options: { codemode: false },
        description: "Writes a file",
        input: Schema.Struct({ path: Schema.String, content: Schema.String }),
        output: Schema.Struct({ path: Schema.String }),
        execute: (input) =>
          // Real filesystem, because the plugin under test reads the file back through FSUtil.
          Effect.promise(() => fs.writeFile(path.join(directory, input.path), input.content, "utf8")).pipe(
            Effect.as({ output: { path: input.path }, content: `Wrote ${input.path}` }),
          ),
      }),
    ),
})

const run = (path: string, content: string) =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const registry = yield* Tool.Service
    const services = yield* captureServices
    const location = Context.get(services, Location.Service)
    yield* plugins.activate([
      writerTool(location.directory),
      {
        id: SyntaxCheckPlugin.Plugin.id,
        revision: "1",
        effect: (host: Parameters<typeof SyntaxCheckPlugin.Plugin.effect>[0]) =>
          SyntaxCheckPlugin.Plugin.effect(host).pipe(Effect.provide(services)),
      },
    ])
    const snapshot = yield* registry.snapshot()
    return yield* snapshot.execute({
      ...identity,
      call: { type: "tool-call", id: "call-integration-write", name: "write", input: { path, content } },
    })
  })

const text = (content: unknown) =>
  (Array.isArray(content) ? content : [])
    .map((part) => (part && typeof part === "object" && "text" in part ? String(part.text) : ""))
    .join("\n")

describe("syntax check through the tool registry", () => {
  it.effect("a broken file comes back with the error on the result the model reads", () =>
    Effect.gen(function* () {
      const result = yield* run("broken.js", "const x = ;\n")
      expect(text(result.content)).toContain("Wrote broken.js")
      expect(text(result.content)).toContain("1 syntax error in broken.js")
      const diagnostics = (result.metadata as { diagnostics?: Record<string, unknown[]> } | undefined)?.diagnostics
      expect(Object.keys(diagnostics ?? {})).toEqual(["broken.js"])
    }),
  )

  it.effect("a clean file comes back with no diagnostics", () =>
    Effect.gen(function* () {
      const result = yield* run("clean.js", "export const answer = 42\n")
      expect(text(result.content)).toBe("Wrote clean.js")
      expect((result.metadata as { diagnostics?: unknown } | undefined)?.diagnostics).toBeUndefined()
    }),
  )
})
