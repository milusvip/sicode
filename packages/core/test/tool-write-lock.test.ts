import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Environment } from "@opencode/core/environment/index"
import { FileMutation } from "@opencode/core/file-mutation"
import { Formatter } from "@opencode/core/formatter"
import { Location } from "@opencode/core/location"
import { FileAccess } from "@opencode/core/file-access"
import { Permission } from "@opencode/core/permission"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { Tool } from "@opencode/core/tool"
import { EditTool } from "@opencode/core/tool/plugin/edit"
import { WriteTool } from "@opencode/core/tool/plugin/write"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { transformEnvironmentFiles } from "./fixture/environment"
import { location } from "./fixture/location"
import { withTempDir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { permissionLayer } from "./lib/permission"
import { executeTool, registerToolPlugin, toolIdentity } from "./lib/tool"

const sessionID = Session.ID.make("ses_write_lock_test")

/**
 * Write and edit must share one per-path transaction lock. The bug this guards
 * against is silent: an edit reads, a write lands, and the edit then commits a
 * result computed from the pre-write content, discarding the write.
 */
const editToolNode = makeLocationNode({
  name: "test/edit-lock",
  layer: Layer.effectDiscard(registerToolPlugin(EditTool.Plugin)),
  deps: [
    Tool.node,
    FileAccess.node,
    FileMutation.node,
    Environment.node,
    Formatter.node,
    Location.node,
    Permission.node,
  ],
})

const writeToolNode = makeLocationNode({
  name: "test/write-lock",
  layer: Layer.effectDiscard(registerToolPlugin(WriteTool.Plugin)),
  deps: [
    Tool.node,
    FileAccess.node,
    FileMutation.node,
    Environment.node,
    Formatter.node,
    Location.node,
    Permission.node,
  ],
})

const withTools = <A, E, R>(
  directory: string,
  hooks: { readStarted: Deferred.Deferred<void>; hold: Effect.Effect<void> },
  body: (registry: Tool.Interface) => Effect.Effect<A, E, R>,
) => {
  let firstRead = true
  return Effect.gen(function* () {
    const registry = yield* Tool.Service
    return yield* body(registry)
  }).pipe(
    Effect.provide(
      AppNodeBuilder.build(LayerNode.group([Tool.node, FileAccess.node, FileMutation.node, editToolNode, writeToolNode]), [
        Environment.node.replace(
          transformEnvironmentFiles((files) => ({
            read: (target, range) =>
              files.read(target, range).pipe(
                Effect.tap(() =>
                  // Only the edit's read holds the transaction open; the write's own
                  // read must not re-arm the hold or the test would deadlock.
                  firstRead
                    ? Effect.sync(() => {
                        firstRead = false
                      }).pipe(Effect.andThen(Deferred.succeed(hooks.readStarted, void 0)), Effect.andThen(hooks.hold))
                    : Effect.void,
                ),
              ),
            write: (target, content) => files.write(target, content),
          })),
        ),
        Location.node.replace(
          Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(directory) }))),
        ),
        Formatter.node.replace(Layer.mock(Formatter.Service, { file: () => Effect.succeed(false) })),
        Permission.node.replace(permissionLayer({ assert: () => Effect.void })),
      ]),
    ),
  )
}

const callEdit = (input: typeof EditTool.Input.Type, id: string) => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: "edit", input },
})

const callWrite = (input: typeof WriteTool.Input.Type, id: string) => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: "write", input },
})

const it = testEffect(Layer.empty)

describe("write/edit transaction lock", () => {
  it.live("a write blocks until an in-flight edit commits, then wins", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const target = path.join(tmp.path, "shared.txt")
        yield* Effect.promise(() => fs.writeFile(target, "A\n"))

        const readStarted = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()

        yield* withTools(tmp.path, { readStarted, hold: Deferred.await(release) }, (registry) =>
          Effect.gen(function* () {
            const edit = yield* executeTool(registry, callEdit({ path: "shared.txt", oldString: "A", newString: "B" }, "call-edit")).pipe(Effect.forkScoped)
            yield* Deferred.await(readStarted)

            // The edit has read and still holds the lock; a write must queue behind it.
            const write = yield* executeTool(registry, callWrite({ path: "shared.txt", content: "C\n" }, "call-write")).pipe(Effect.forkScoped)
            yield* Effect.sleep("150 millis")
            expect(write.pollUnsafe()).toBeUndefined()

            yield* Deferred.succeed(release, void 0)
            yield* Fiber.join(edit)
            yield* Fiber.join(write)
          }),
        ).pipe(Effect.scoped)

        // Serialized: edit commits A->B, then the queued write overwrites with C.
        expect(yield* Effect.promise(() => fs.readFile(target, "utf8"))).toBe("C\n")
      }),
    ),
  )

  it.live("concurrent edits and writes never tear the file", () =>
    withTempDir((tmp) =>
      Effect.gen(function* () {
        const target = path.join(tmp.path, "shared.txt")
        yield* Effect.promise(() => fs.writeFile(target, "A\n"))
        const release = yield* Deferred.make<void>()
        yield* Deferred.succeed(release, void 0)

        yield* withTools(tmp.path, { readStarted: yield* Deferred.make<void>(), hold: Effect.void }, (registry) =>
          Effect.gen(function* () {
            const results = yield* Effect.forEach(
              Array.from({ length: 8 }, (_, index) => index),
              (index) =>
                index % 2 === 0
                  ? executeTool(registry, callWrite({ path: "shared.txt", content: `C${index}\n` }, `call-write-${index}`))
                  : executeTool(registry, callEdit({ path: "shared.txt", oldString: "A", newString: `B${index}` }, `call-edit-${index}`)),
              { concurrency: "unbounded" },
            )
            expect(results.length).toBe(8)
          }),
        )

        // Whatever order they settle in, the file must hold exactly one whole write.
        const content = yield* Effect.promise(() => fs.readFile(target, "utf8"))
        expect(content.endsWith("\n")).toBe(true)
        expect(content.trim()).toMatch(/^(A|B\d|C\d)$/)
      }),
    ),
  )
})
