import { describe, expect } from "bun:test"
import { existsSync } from "node:fs"
import { FSUtil } from "@opencode/util/fs-util"
import { Effect, Layer } from "effect"
import type { ToolHooks } from "@opencode/plugin/effect/tool"
import type { Tool as ToolSchema } from "@opencode/schema/tool"
import { Location } from "@opencode/core/location"
import { SyntaxCheckPlugin } from "@opencode/core/plugin/syntax-check"
import { testEffect } from "../lib/effect"
import { tempGlobalLayer } from "../fixture/global"
import { makePluginTestLayer } from "./fixture"
import { host } from "./host"

// clang is optional on a host: the runner skips C++ when it is missing, so the end-to-end case
// only registers where the checker can actually run. PATH first, then the usual install spots.
const clangAvailable =
  existsSync("C:\\Program Files\\LLVM\\bin\\clang++.exe") ||
  ["clang++", "/opt/homebrew/bin/clang++", "/usr/local/bin/clang++", "/usr/bin/clang++"].some((p) => {
    try {
      return Bun.which(p) !== null || existsSync(p)
    } catch {
      return false
    }
  })

// The plugin reads the file the tool just wrote and spawns a checker on it, so the test needs a real
// filesystem, a real spawner and a real Location — a stubbed host alone dies with "Service not found".
const layer = Layer.mergeAll(makePluginTestLayer(), tempGlobalLayer)
const it = testEffect(layer)

/** Captures the execute.after hook the plugin registers, then runs it against a fake event. */
const hook = Effect.fnUntraced(function* () {
  let captured: ((input: ToolHooks["execute.after"]) => Effect.Effect<void>) | undefined
  yield* SyntaxCheckPlugin.Plugin.effect(
    host({
      tool: {
        transform: () => Effect.die("unused tool.transform"),
        reload: () => Effect.die("unused tool.reload"),
        list: () => Effect.die("unused tool.list"),
        hook: (name, callback) => {
          if (name === "execute.after")
            captured = callback as unknown as (input: ToolHooks["execute.after"]) => Effect.Effect<void>
          return Effect.succeed({ dispose: Effect.void })
        },
      },
    }),
  )
  if (!captured) return yield* Effect.die("plugin did not register an execute.after hook")
  const dispatch = captured
  return (event: ToolHooks["execute.after"]) => dispatch(event)
})

const event = (overrides: {
  tool: string
  input: unknown
  content?: ToolSchema.Result["content"]
  metadata?: ToolSchema.Result["metadata"]
}) =>
  ({
    tool: overrides.tool,
    sessionID: "ses_test" as never,
    agent: "build" as never,
    messageID: "msg_test" as never,
    id: "call_test" as never,
    input: overrides.input,
    status: "completed",
    result: { content: overrides.content, metadata: overrides.metadata },
  }) as ToolHooks["execute.after"]

/** Writes a file into the temp Location so the checker has something real to read. */
const plant = Effect.fnUntraced(function* (name: string, text: string) {
  const fs = yield* FSUtil.Service
  const location = yield* Location.Service
  const file = `${location.directory}/${name}`
  yield* fs.writeFileString(file, text)
  return file
})

const text = (content: ToolSchema.Result["content"]) =>
  (typeof content === "string" ? [{ type: "text" as const, text: content }] : (content ?? []))
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n")

describe("syntax check plugin", () => {
  it.effect("appends a syntax error to the result the model reads", () =>
    Effect.gen(function* () {
      const dispatch = yield* hook()
      yield* plant("broken.js", "const x = ;\n")
      const result = event({ tool: "write", input: { path: "broken.js" }, content: "Wrote broken.js" })
      yield* dispatch(result)
      if (result.status !== "completed") return yield* Effect.die("event changed status")
      // The model only sees `content`, so the note has to be here and not just in metadata.
      expect(text(result.result.content)).toContain("1 syntax error in broken.js")
      // The editor cards read this shape; paths are relative exactly as the tool input had them.
      const diagnostics = result.result.metadata?.diagnostics as
        | Record<string, Array<{ range: { start: { line: number; character: number } }; message: string }>>
        | undefined
      expect(Object.keys(diagnostics ?? {})).toEqual(["broken.js"])
      expect(diagnostics?.["broken.js"]?.[0]?.range.start.line).toBe(0)
    }),
  )

  it.effect("leaves a clean file untouched", () =>
    Effect.gen(function* () {
      const dispatch = yield* hook()
      yield* plant("clean.js", "export const answer = 42\n")
      const result = event({ tool: "write", input: { path: "clean.js" }, content: "Wrote clean.js" })
      yield* dispatch(result)
      if (result.status !== "completed") return yield* Effect.die("event changed status")
      expect(result.result.content).toBe("Wrote clean.js")
      expect(result.result.metadata?.diagnostics).toBeUndefined()
    }),
  )

  it.effect("reports a broken python file too", () =>
    Effect.gen(function* () {
      const dispatch = yield* hook()
      yield* plant("broken.py", "def f(:\n")
      const result = event({ tool: "write", input: { path: "broken.py" }, content: "Wrote broken.py" })
      yield* dispatch(result)
      if (result.status !== "completed") return yield* Effect.die("event changed status")
      expect(text(result.result.content)).toContain("1 syntax error in broken.py")
    }),
  )

  it.effect("reports a broken powershell script, which needs no executable", () =>
    Effect.gen(function* () {
      const dispatch = yield* hook()
      // `.ps1` is 11% of the editor calls on this machine; the grammar is in-process, so this
      // covers the case where the host has no PowerShell installed.
      yield* plant("broken.ps1", 'if ($true) {\n  Write-Output "hi"\n')
      const result = event({ tool: "write", input: { path: "broken.ps1" }, content: "Wrote broken.ps1" })
      yield* dispatch(result)
      if (result.status !== "completed") return yield* Effect.die("event changed status")
      expect(text(result.result.content)).toContain("1 syntax error in broken.ps1")
    }),
  )

  it.effect("reports a broken json file, which is parsed in-process", () =>
    Effect.gen(function* () {
      const dispatch = yield* hook()
      yield* plant("broken.json", '{"a": 1,}\n')
      const result = event({ tool: "write", input: { path: "broken.json" }, content: "Wrote broken.json" })
      yield* dispatch(result)
      if (result.status !== "completed") return yield* Effect.die("event changed status")
      expect(text(result.result.content)).toContain("1 syntax error in broken.json")
    }),
  )

  // The custom `it` has no skipIf, so registration itself is conditional.
  if (clangAvailable)
    it.effect("reports a broken c++ file through clang++", () =>
      Effect.gen(function* () {
        const dispatch = yield* hook()
        // `.cpp` is 28% of the editor calls on this machine — the largest class bun cannot check.
        yield* plant("broken.cpp", "int main( {\n")
        const result = event({ tool: "write", input: { path: "broken.cpp" }, content: "Wrote broken.cpp" })
        yield* dispatch(result)
        if (result.status !== "completed") return yield* Effect.die("event changed status")
        expect(text(result.result.content)).toContain("syntax error")
        expect(text(result.result.content)).toContain("broken.cpp")
      }),
    )

  it.effect("only reacts to tools that write a file", () =>
    Effect.gen(function* () {
      const dispatch = yield* hook()
      yield* plant("read-me.js", "const x = ;\n")
      const result = event({ tool: "read", input: { path: "read-me.js" }, content: "read it" })
      yield* dispatch(result)
      if (result.status !== "completed") return yield* Effect.die("event changed status")
      expect(result.result.content).toBe("read it")
    }),
  )

  it.effect("skips files with extensions no checker covers", () =>
    Effect.gen(function* () {
      const dispatch = yield* hook()
      const result = event({ tool: "write", input: { path: "notes.md" }, content: "wrote notes" })
      yield* dispatch(result)
      if (result.status !== "completed") return yield* Effect.die("event changed status")
      expect(result.result.metadata?.diagnostics).toBeUndefined()
    }),
  )

  it.effect("reports nothing for a patch, which writes many files", () =>
    Effect.gen(function* () {
      const dispatch = yield* hook()
      const result = event({ tool: "patch", input: { patchText: "*** Begin Patch" }, content: "patched" })
      yield* dispatch(result)
      if (result.status !== "completed") return yield* Effect.die("event changed status")
      expect(result.result.metadata?.diagnostics).toBeUndefined()
    }),
  )
})

describe("describe", () => {
  it.effect("names the file and counts the errors", () =>
    Effect.sync(() => {
      const message = SyntaxCheckPlugin.describe("a.js", [{ line: 3, character: 5, message: "boom" }])
      expect(message).toContain("1 syntax error in a.js")
      expect(message).toContain("3:5 boom")
    }),
  )

  it.effect("pluralises more than one error", () =>
    Effect.sync(() => {
      const message = SyntaxCheckPlugin.describe("a.js", [
        { line: 1, character: 1, message: "one" },
        { line: 2, character: 1, message: "two" },
      ])
      expect(message).toContain("2 syntax errors in a.js")
    }),
  )
})

describe("wire", () => {
  it.effect("emits the zero-based shape the editor cards decode", () =>
    Effect.sync(() => {
      const payload = SyntaxCheckPlugin.wire("a.js", [{ line: 3, character: 5, message: "boom" }])
      expect(payload).toEqual({
        "a.js": [{ range: { start: { line: 2, character: 4 } }, message: "boom", severity: 1 }],
      })
    }),
  )

  it.effect("caps the number of diagnostics it forwards", () =>
    Effect.sync(() => {
      const many = Array.from({ length: 20 }, (_, index) => ({ line: index + 1, character: 1, message: "x" }))
      expect(SyntaxCheckPlugin.wire("a.js", many)["a.js"]).toHaveLength(5)
    }),
  )
})

describe("enabled", () => {
  it.effect("defaults on and honours an explicit off switch", () =>
    Effect.sync(() => {
      expect(SyntaxCheckPlugin.enabled({})).toBe(true)
      expect(SyntaxCheckPlugin.enabled({ OPENCODE_SYNTAX_CHECK: "0" })).toBe(false)
      expect(SyntaxCheckPlugin.enabled({ OPENCODE_SYNTAX_CHECK: "off" })).toBe(false)
      expect(SyntaxCheckPlugin.enabled({ OPENCODE_SYNTAX_CHECK: "1" })).toBe(true)
    }),
  )
})
