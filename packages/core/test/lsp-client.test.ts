import { describe, expect } from "bun:test"
import { Effect, Exit } from "effect"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { LspClient } from "@opencode/core/lsp/client"
import { hostEnvironmentLayer } from "./fixture/environment"
import { testEffect } from "./lib/effect"

const it = testEffect(hostEnvironmentLayer).live

const withServer = <A, E>(body: (client: LspClient.Interface, root: string) => Effect.Effect<A, E, never>) =>
  Effect.gen(function* () {
    const root = yield* Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "opencode-lsp-")))
    const target = path.join(root, "retry.ts")
    yield* Effect.promise(() => fs.writeFile(target, "export function retry() {\n  return retry()\n}\n", "utf8"))
    const client = yield* LspClient.make({
      server: "mock",
      command: [process.execPath, path.join(import.meta.dir, "fixture", "lsp-server.mjs")],
      cwd: root,
      environment: {},
      initialization: {},
    })
    const exit = yield* Effect.exit(body(client, root))
    yield* client.close
    if (Exit.isFailure(exit)) return yield* Effect.failCause(exit.cause)
    return exit.value
  })

describe("lsp client", () => {
  it("completes the handshake and resolves definitions", () =>
    withServer((client, root) =>
      Effect.gen(function* () {
        const found = yield* client.definition({ path: "retry.ts", line: 1, character: 17 })
        expect(found).toHaveLength(1)
        expect(found[0]?.path).toBe(path.join(root, "retry.ts"))
        expect(found[0]?.range.start).toEqual({ line: 4, character: 7 })
      }),
    ))

  it("lists references across files", () =>
    withServer((client, root) =>
      Effect.gen(function* () {
        const found = yield* client.references({ path: "retry.ts", line: 1, character: 17 })
        expect(found).toHaveLength(2)
        expect(found[1]?.path).toBe(path.join(root, "other.ts"))
      }),
    ))

  it("returns hover content", () =>
    withServer((client) =>
      Effect.gen(function* () {
        const hover = yield* client.hover({ path: "retry.ts", line: 1, character: 17 })
        expect((hover as { contents: { value: string } }).contents.value).toBe("const retry: number")
      }),
    ))

  it("captures diagnostics published after didOpen", () =>
    withServer((client) =>
      Effect.gen(function* () {
        // Not published yet: undefined, not an empty list.
        const before = yield* client.diagnostics("retry.ts")
        expect(before).toBeUndefined()
        yield* client.sync("retry.ts", "export function retry() {}\n")
        let published: LspClient.Diagnostic[] | undefined
        for (let attempt = 0; attempt < 40 && published === undefined; attempt++) {
          published = yield* client.diagnostics("retry.ts")
          if (published === undefined) yield* Effect.sleep(100)
        }
        expect(published).toHaveLength(1)
        expect(published?.[0]?.message).toBe("mock error")
      }),
    ))

  it("close shuts the server down cleanly", () =>
    withServer((client) =>
      Effect.gen(function* () {
        yield* client.close
        // A requested exit completes `exited` without an error.
        yield* client.exited
      }),
    ))
})
